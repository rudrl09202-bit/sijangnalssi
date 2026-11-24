#!/usr/bin/env bash
# 봇 루프: 약 5시간 40분 동안 15분봉 마감 1분 뒤마다 단타 봇, 매시간 민경기 봇, 4시간마다 선물 봇·금리 갱신
# (GitHub 예약 실행이 늦거나 빠지는 문제를 피하려고 한 작업 안에서 직접 시간을 맞춤)
set -u
END=$(( $(date +%s) + ${LOOP_MINUTES:-340} * 60 ))
git config user.name "sijangnalssi-bot"; git config user.email "actions@users.noreply.github.com"
REPO_URL="https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
mkdir -p botdata
save_botdata() {
  ( cd botdata && rm -rf .git && git init -q && git checkout -q -b bot-data \
    && git -c user.name=sijangnalssi-bot -c user.email=actions@users.noreply.github.com add -A \
    && git -c user.name=sijangnalssi-bot -c user.email=actions@users.noreply.github.com commit -qm "단타 상태 $(date -u +'%F %H:%M')" \
    && git push -q -f "$REPO_URL" bot-data ) || echo "bot-data 저장 실패"
}
last_fut=""
while [ "$(date +%s)" -lt "$END" ]; do
  echo "── $(date -u +'%F %H:%M:%S') UTC"
  git pull -q --rebase origin main 2>/dev/null || true   # 그사이 고친 코드도 바로 반영
  MK_SEPARATE=1 SCALP_DIR=botdata timeout 420 node connect/scalp.mjs || echo "단타 봇 실패"
  H=$(date -u +%H); M=$(date -u +%M)
  if [ $((10#$M)) -lt 15 ] || [ ! -f botdata/mk-live.json ]; then  # 매시간(처음엔 바로) 첫 15분 안: 민경기 봇(학습형) — 1시간봉 마감 뒤 판단, 일주일마다 다시 학습
    MK_DIR=botdata timeout 900 node connect/mk.mjs || echo "민경기 봇 실패"
  fi
  if { [ $((10#$M)) -ge 15 ] && [ $((10#$M)) -lt 30 ]; } || [ ! -f botdata/mk3-live.json ]; then  # 3세대(4시간봉): 서버가 :05에 올린 바이낸스 4시간봉을 읽음
    MK_DIR=botdata timeout 600 node connect/mk3.mjs || echo "민경기 봇 3세대 실패"
  fi
  save_botdata
  SLOT="$(date -u +%F)-$((10#$H / 4))"
  if [ $((10#$H % 4)) -eq 0 ] && [ "$last_fut" != "$SLOT" ]; then
    last_fut="$SLOT"
    git pull -q --rebase origin main || git reset -q --hard origin/main
    timeout 600 node connect/futures.mjs || echo "선물 봇 실패"
    timeout 120 node connect/policy-run.mjs || echo "금리 갱신 실패"
    git add data/futures-state.json data/futures-live.json data/policy-state.json data/policy-live.json 2>/dev/null
    git commit -qm "선물 모의투자·금리 $(date -u +'%F %H:%M')" || echo "변경 없음"
    for i in 1 2 3; do git pull -q --rebase origin main && git push -q origin HEAD:main && break; sleep 5; done
  fi
  # 다음 15분봉 마감 + 70초까지 대기
  now=$(date +%s); next=$(( (now / 900 + 1) * 900 + 70 ))
  [ "$next" -ge "$END" ] && break
  sleep $(( next - now ))
done
echo "루프 끝 — 다음 루프를 시작합니다"
