#!/usr/bin/env bash
set -euo pipefail

set -a
source .env.docker
set +a

export NODE_ENV=test
export HOST=127.0.0.1
export PORT=3001
export API_PREFIX=api
export APP_VERSION=runtime-smoke
export LOG_LEVEL=debug
export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${POSTGRES_PORT}/${POSTGRES_DB}"
export REDIS_URL="redis://localhost:${REDIS_PORT}/0"
export READINESS_TIMEOUT_MS=500

timeout 90 bash -c 'until docker compose --env-file .env.docker exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"; do sleep 1; done'

pnpm --filter @booking-os/api exec tsx test/runtime-smoke-app.ts > api.log 2>&1 &
API_PID=$!
cleanup() {
  if [ "${API_PID:-0}" -gt 0 ]; then
    kill -TERM "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

timeout 60 bash -c 'until curl --fail --silent http://127.0.0.1:3001/api/health >/dev/null; do sleep 1; done'

curl --fail --silent -H 'x-request-id: health-redis-down' -D health.headers http://127.0.0.1:3001/api/health > health.json
grep -qi '^x-request-id: health-redis-down' health.headers
jq -e '.status == "ok"' health.json

STARTUP_READY_STATUS=$(curl --silent --output startup-ready.json --write-out '%{http_code}' -H 'x-request-id: startup-redis-down' http://127.0.0.1:3001/api/ready)
test "$STARTUP_READY_STATUS" = "503"
jq -e '.status == "unavailable" and .dependencies.postgresql.status == "ok" and .dependencies.redis.status == "unavailable"' startup-ready.json

docker compose --env-file .env.docker up -d redis
timeout 60 bash -c 'until docker compose --env-file .env.docker exec -T redis redis-cli ping | grep -q PONG; do sleep 1; done'
sleep 2
curl --fail --silent -H 'x-request-id: ready-healthy' http://127.0.0.1:3001/api/ready > ready.json
jq -e '.status == "ok" and .dependencies.postgresql.status == "ok" and .dependencies.redis.status == "ok"' ready.json

docker compose --env-file .env.docker stop redis
sleep 2
OUTAGE_STATUS=$(curl --silent --output outage-ready.json --write-out '%{http_code}' -H 'x-request-id: outage-redis-down' http://127.0.0.1:3001/api/ready)
test "$OUTAGE_STATUS" = "503"
jq -e '.status == "unavailable" and .dependencies.postgresql.status == "ok" and .dependencies.redis.status == "unavailable"' outage-ready.json

docker compose --env-file .env.docker start redis
timeout 60 bash -c 'until docker compose --env-file .env.docker exec -T redis redis-cli ping | grep -q PONG; do sleep 1; done'
sleep 2
curl --fail --silent http://127.0.0.1:3001/api/ready > recovered-ready.json
jq -e '.status == "ok" and .dependencies.redis.status == "ok"' recovered-ready.json

ERROR_STATUS=$(curl --silent --output error.json --dump-header error.headers --write-out '%{http_code}' -H 'x-request-id: error-request' http://127.0.0.1:3001/api/runtime-smoke/boom)
test "$ERROR_STATUS" = "500"
jq -e '.statusCode == 500 and .error == "Internal Server Error" and .message == "An unexpected error occurred" and .requestId == "error-request"' error.json
grep -qi '^x-request-id: error-request' error.headers
! grep -Fq 'runtime smoke internal detail' error.json

jq -Rs -e 'split("\n") | map(fromjson?) | any(.message == "readiness.probe_failed" and .dependency == "redis")' api.log
jq -Rs -e 'split("\n") | map(fromjson?) | any(.message == "http.request_completed" and .requestId == "outage-redis-down" and .statusCode == 503)' api.log
jq -Rs -e 'split("\n") | map(fromjson?) | any(.message == "http.request_failed" and .requestId == "error-request" and .statusCode == 500)' api.log
jq -Rs -e 'split("\n") | map(fromjson?) | any(.message == "http.request_completed" and .requestId == "error-request" and .statusCode == 500)' api.log
jq -Rs -e 'split("\n") | map(fromjson?) | all(.message != "http.request_completed" or (.requestId != "health-redis-down" and .requestId != "ready-healthy"))' api.log

! grep -Fq "$DATABASE_URL" api.log
! grep -Fq "$REDIS_URL" api.log
! grep -Fq "$POSTGRES_PASSWORD" api.log
! grep -Fiq 'authorization' api.log
! grep -Fiq 'cookie' api.log
! grep -Fq '?q=' api.log

kill -TERM "$API_PID"
set +e
wait "$API_PID"
API_EXIT=$?
set -e
test "$API_EXIT" = "0" || test "$API_EXIT" = "143"
API_PID=0
! grep -Fiq 'unhandledrejection' api.log
