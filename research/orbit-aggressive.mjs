// ORBIT(= 오늘의 추천 TOP 10) 공격형 비교 — 후보는 결과 보기 전에 고정 (2026-11-27)
//  지금: 12-1 모멘텀 상위 10 · 절대 모멘텀 · 시장 필터(지수 200일선 아래면 그 시장 안 삼) · −25% 손절
//  A 시장 필터 없음 · B 상위 5개 집중(시장 필터 유지) · C 시장 필터 없음 + 상위 5개
//  판단: 연 수익·낙폭·샤프(전체·앞 70%·뒤 30%)·최악의 1년을 함께 봄. "공격형 비교 계좌"로 둘지 정하는 참고 자료
// 결과 (2026-11-27, 2017-08~2026-11):
//   지금 연 24.75% · 낙폭 −29.1% · 샤프 1.01 (안 0.75 밖 1.46) · 2022 −8.58%
//   A 연 29.27% · −32.88% · 1.11 (0.80 · 1.64) · 2022 −28.87%
//   B 연 27.09% · −26.32% · 1.08 (0.96 · 1.32) · 2022 −3.28%
//   C 연 38.18% · −28.61% · 1.36 (1.21 · 1.64) · 2022 −23.04%
//   견고성(최대 승자 17개 뺌): 지금 연 13.09% · 샤프 0.57 / C 연 24.49% · 샤프 0.96 — C 가 여전히 나음, 대신 하락장(2022)에서 더 아픔
// 사용: SNW_ROOT=<js/history 를 받은 폴더> node research/orbit-aggressive.mjs
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadQuant, loadAssets, cutoffDate } from '../connect/paper.mjs';
import { loadApp } from '../connect/alerts.mjs';
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..'), ROOT = process.env.SNW_ROOT || REPO;
const app = loadApp(ROOT), { assets, usdkrw } = loadAssets(ROOT, app, cutoffDate(new Date()));
const FULL = { spx: 'IDX_spx', nasdaq: 'IDX_spx', kospi: 'IDX_kospi', kosdaq: 'IDX_kospi', coin: 'C_BTC' }, NOF = { coin: 'C_BTC' }; // 시장 필터 없음 = 주식 시장 지수를 안 넘김
for (const [name, regimeOf, maxPos] of [['지금 (필터 · 10개)', FULL, 10], ['A 필터 없음 · 10개', NOF, 10], ['B 필터 · 5개 집중', FULL, 5], ['C 필터 없음 · 5개', NOF, 5]]) {
  const Q = loadQuant(REPO); Q.BOTS.find((x) => x.id === 'orbit').maxPos = maxPos;
  const W = Q.buildWorld(assets.map((a) => ({ ...a })), { usdkrw, regimeOf }), from = W.cal[Math.min(W.cal.length - 1, 260)], split = W.cal[Math.floor(W.cal.indexOf(from) + (W.cal.length - W.cal.indexOf(from)) * 0.7)];
  const A = Q.backtest(W, { only: ['orbit'], from }).accounts.orbit, m = (lo, hi) => Q.metrics(A.equity.filter(([d]) => d >= lo && d <= hi), A.trades.filter((z) => z.out >= lo && z.out <= hi)) || {};
  const all = m(from, '9999'), yr = Object.entries(all.yearly || {}), worst = yr.sort((a, b) => a[1] - b[1])[0];
  console.log(name.padEnd(20), '연', all.cagr + '%', '낙폭', all.mdd + '%', '샤프', all.sharpe, '| 안', m(from, split).sharpe, '밖', m(split, '9999').sharpe, '| 최악의 해', worst ? worst[0] + ' ' + worst[1] + '%' : '—', '| 2022', (all.yearly || {})['2022'] + '%');
}
// 견고성: 10년 동안 가장 많이 오른 종목 상위 10%(지금 와서 아는 승자)를 빼고 다시 (paper.mjs robustRun 과 같은 방법) — 집중할수록 이 착시에 민감
if (process.env.ROBUST) { const st = assets.filter((a) => a.kind === 'stock' && a.c.length > 260).map((a) => [a.id, a.c[a.c.length - 1] / a.c[0]]).sort((x, y) => y[1] - x[1]), drop = new Set(st.slice(0, Math.max(1, Math.round(st.length * 0.1))).map((x) => x[0]));
  console.log('\n견고성 — 10년 최대 승자 ' + drop.size + '개 빼고');
  for (const [name, regimeOf, maxPos] of [['지금 (필터 · 10개)', FULL, 10], ['C 필터 없음 · 5개', NOF, 5]]) {
    const Q = loadQuant(REPO); Q.BOTS.find((x) => x.id === 'orbit').maxPos = maxPos;
    const W = Q.buildWorld(assets.filter((a) => !drop.has(a.id)).map((a) => ({ ...a })), { usdkrw, regimeOf }), from = W.cal[Math.min(W.cal.length - 1, 260)];
    const A = Q.backtest(W, { only: ['orbit'], from }).accounts.orbit, all = Q.metrics(A.equity, A.trades);
    console.log(name.padEnd(20), '연', all.cagr + '%', '낙폭', all.mdd + '%', '샤프', all.sharpe, '| 2022', all.yearly['2022'] + '%'); } }
