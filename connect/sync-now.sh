#!/bin/sh
# 서버용: 바로 한 번 동기화 (bash connect/sync-now.sh)
cd "$(dirname "$0")" && SNW_SKIP_MARKET=1 node --dns-result-order=ipv4first sync.mjs "$@"
