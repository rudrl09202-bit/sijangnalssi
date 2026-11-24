#!/bin/sh
# 서버용: 최신 코드로 바꾼 뒤 한 번 동기화 (bash connect/sync-now.sh)
# - 매번 GitHub 의 최신 코드를 받아 옴(.env·키·내 자산 파일은 건드리지 않음). 끄려면 SNW_NO_UPDATE=1
# - 아래는 한 줄로 실행돼야 함(받아 오는 도중 이 파일이 바뀌어도 안전)
cd "$(dirname "$0")/.." && { [ -n "$SNW_NO_UPDATE" ] || { git fetch -q origin main && git reset -q --hard origin/main; } || echo '· 코드 업데이트 실패 — 지금 코드로 계속'; } ; cd connect && SNW_SKIP_MARKET=1 exec node --dns-result-order=ipv4first sync.mjs "$@"
