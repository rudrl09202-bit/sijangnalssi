// ORBIT(= 오늘의 추천 TOP 10 규칙) 손절 방식 비교 — 후보·합격 기준은 결과 보기 전에 고정 (2026-11-27)
//  지금: 산 값 −25% 비상 손절 · 후보 A: 산 값 −15% · 후보 B: −25% 그대로 + 보유 중 최고 종가 대비 −20% 추적 손절
//  나머지 규칙(매달 12-1 모멘텀 상위 10 · 절대 모멘텀 · 시장 필터 · 변동성 반비례 비중 · 순위 밖이면 매도)은 같음
//  합격(지금 대비): 전체 샤프 상승 + 표본 안(앞 70%)·밖(뒤 30%) 샤프 모두 지금 이상. 낙폭은 참고
// 결과 (2026-11-27, 2017-08~2026-11):
//   지금 −25%: 연 24.75% · 낙폭 −29.1% · 샤프 1.01 (안 0.75 밖 1.46) · 손절 29번
//   A −15%: 연 22.14% · 낙폭 −28.68% · 샤프 0.94 (안 0.63 밖 1.46) · 손절 86번 → 불합격
//   B 추적 −20%: 연 20.23% · 낙폭 −21.61% · 샤프 0.95 (안 0.52 밖 1.63) · 손절 168번 → 불합격 (낙폭은 줄지만 수익·샤프가 더 줄어듦)
//   → 손절은 −25% 그대로. 촘촘한 손절은 흔들렸다 다시 오르는 주도주까지 팔아 버림
// 사용: SNW_ROOT=<js/history 를 받은 폴더> node research/orbit-stops.mjs
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadQuant, loadAssets, cutoffDate } from '../connect/paper.mjs';
import { loadApp } from '../connect/alerts.mjs';
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..'), ROOT = process.env.SNW_ROOT || REPO;
const app = loadApp(ROOT), { assets, usdkrw } = loadAssets(ROOT, app, cutoffDate(new Date())), regimeOf = { spx: 'IDX_spx', nasdaq: 'IDX_spx', kospi: 'IDX_kospi', kosdaq: 'IDX_kospi', coin: 'C_BTC' };
const VAR = [['지금 (−25%)', {}], ['A −15% 손절', { stopPct: 0.15 }], ['B −25% + 고점 −20% 추적', { trailPct: 0.20 }]], res = [];
for (const [name, cfg] of VAR) {
  const Q = loadQuant(REPO), b = Q.BOTS.find((x) => x.id === 'orbit'); Object.assign(b, cfg);
  const W = Q.buildWorld(assets.map((a) => ({ ...a })), { usdkrw, regimeOf }), from = W.cal[Math.min(W.cal.length - 1, 260)], split = W.cal[Math.floor(W.cal.indexOf(from) + (W.cal.length - W.cal.indexOf(from)) * 0.7)];
  const A = Q.backtest(W, { only: ['orbit'], from }).accounts.orbit, m = (lo, hi) => Q.metrics(A.equity.filter(([d]) => d >= lo && d <= hi), A.trades.filter((z) => z.out >= lo && z.out <= hi)) || {};
  const all = m(from, '9999'), ins = m(from, split), out = m(split, '9999'), stops = A.trades.filter((z) => /손절/.test(z.exitWhy || '')).length;
  res.push({ name, all, ins, out, n: A.trades.length, stops });
  console.log(name.padEnd(24), '연', all.cagr + '%', '낙폭', all.mdd + '%', '샤프', all.sharpe, '| 안', ins.sharpe, '밖', out.sharpe, '| 거래', A.trades.length, '손절', stops);
}
const base = res[0]; for (const r of res.slice(1)) console.log(r.name, r.all.sharpe > base.all.sharpe && r.ins.sharpe >= base.ins.sharpe && r.out.sharpe >= base.out.sharpe ? '→ 합격' : '→ 불합격');
