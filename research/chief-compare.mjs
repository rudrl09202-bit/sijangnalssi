// 주식 CHIEF 봇(앱 스크리너 점수대로 매수): "매주 월요일만 매수" vs "알림처럼 매일 매수" 를 지난 10년으로 비교
// 실행: node connect/market.mjs 로 10년치 시세를 받은 뒤 node research/chief-compare.mjs  (GitHub Actions research.yml)
import { writeFileSync, mkdirSync } from 'node:fs';
import { loadQuant, loadAssets, cutoffDate, makeChief } from '../connect/paper.mjs';
import { loadApp } from '../connect/alerts.mjs';
const root = new URL('..', import.meta.url).pathname, app = loadApp(root), Q = loadQuant(root), cutoff = cutoffDate();
const { assets, usdkrw } = loadAssets(root, app, cutoff); let W = null;
const chief = makeChief(app, Q, () => W, cutoff);
W = Q.buildWorld(assets, { usdkrw, regimeOf: { spx: 'IDX_spx', nasdaq: 'IDX_spx', kospi: 'IDX_kospi', kosdaq: 'IDX_kospi', coin: 'C_BTC' }, chief });
const from = W.cal[Math.min(W.cal.length - 1, 260)], split = W.cal[Math.floor(W.cal.indexOf(from) + (W.cal.length - W.cal.indexOf(from)) * 0.7)];
const B = Q.BOTS.find((b) => b.id === 'chief'), out = { from, to: W.cal.at(-1), split, rows: [] };
for (const [name, daily] of [['매주 월요일만 (지금)', false], ['매일 (알림 다음 날)', true]]) {
  const t0 = Date.now(); B.daily = daily; const st = Q.backtest(W, { only: ['chief'], from }), a = st.accounts.chief;
  const all = Q.metrics(a.equity, a.trades), isM = Q.metrics(a.equity.filter((x) => x[0] < split), a.trades.filter((x) => x.out < split)), oos = Q.metrics(a.equity.filter((x) => x[0] >= split), a.trades.filter((x) => x.out >= split));
  const pick = (m) => m && { cagr: m.cagr, mdd: m.mdd, sharpe: m.sharpe, pf: m.pf, trades: m.trades, win: m.winRate, total: m.total };
  const row = { name, daily, all: pick(all), in: pick(isM), oos: pick(oos), yearly: all && all.yearly, fees: a.fees || null, secs: Math.round((Date.now() - t0) / 1000) };
  out.rows.push(row); console.log(JSON.stringify(row));
}
mkdirSync(new URL('../data/', import.meta.url).pathname, { recursive: true }); writeFileSync(new URL('../data/chief-compare.json', import.meta.url).pathname, JSON.stringify(out, null, 1));
