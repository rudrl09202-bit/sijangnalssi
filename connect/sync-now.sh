#!/bin/sh
# 서버용: 최신 코드로 바꾼 뒤 한 번 동기화 (bash connect/sync-now.sh)
# - 매번 GitHub 의 최신 코드를 받아 옴(.env·키·내 자산 파일은 건드리지 않음). 끄려면 SNW_NO_UPDATE=1
# - cron 으로 돌 때(화면 없음)는 봇 결과가 바뀌면 바로 바이낸스 데모를 맞추고, 장이 열린 시간엔 5분마다 주식 가격도 다시 동기화. 직접 실행할 땐 안 함
# - 아래는 한 줄로 실행돼야 함(받아 오는 도중 이 파일이 바뀌어도 안전)
cd "$(dirname "$0")/.." && { [ -n "$SNW_NO_UPDATE" ] || { git fetch -q origin main && git reset -q --hard origin/main; } || echo '· 코드 업데이트 실패 — 지금 코드로 계속'; } ; cd connect && SNW_SKIP_MARKET=1 node --dns-result-order=ipv4first sync.mjs "$@" ; { [ -t 1 ] || [ -n "$SNW_NO_LOOP" ] ; } || exec node --dns-result-order=ipv4first exec.mjs --loop
