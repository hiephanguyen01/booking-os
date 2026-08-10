#!/usr/bin/env bash
set -uo pipefail

log_file="$(mktemp)"
set +e
pnpm exec turbo run test 2>&1 | tee "$log_file"
status=${PIPESTATUS[0]}
set -e

if [[ $status -ne 0 ]]; then
  marker_line="$(grep -n -m1 -E 'not ok|AssertionError|ERR_(ASSERTION|TEST_FAILURE)|failureType:|testCodeFailure' "$log_file" | cut -d: -f1 || true)"
  if [[ -n "$marker_line" ]]; then
    start=$((marker_line > 10 ? marker_line - 10 : 1))
    end=$((marker_line + 45))
  else
    end="$(wc -l < "$log_file")"
    start=$((end > 60 ? end - 60 : 1))
  fi

  block="$(sed -n "${start},${end}p" "$log_file" | head -n 56)"
  escaped="${block//'%'/'%25'}"
  escaped="${escaped//$'\r'/'%0D'}"
  escaped="${escaped//$'\n'/'%0A'}"
  echo "::error title=Workspace failing test block::${escaped}"
  rm -f "$log_file"
  exit "$status"
fi

rm -f "$log_file"
pnpm test:scripts
