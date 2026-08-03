#!/bin/sh

set -eu

: "${MINIO_ROOT_USER:?MINIO_ROOT_USER is required}"
: "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD is required}"
: "${MINIO_DEFAULT_BUCKET:?MINIO_DEFAULT_BUCKET is required}"

mc alias set \
  local \
  http://minio:9000 \
  "$MINIO_ROOT_USER" \
  "$MINIO_ROOT_PASSWORD"

mc mb \
  --ignore-existing \
  "local/$MINIO_DEFAULT_BUCKET"

mc anonymous set \
  none \
  "local/$MINIO_DEFAULT_BUCKET"

printf 'MinIO bucket is ready: %s\n' "$MINIO_DEFAULT_BUCKET"
