// ③ 펀딩비 쏠림 필터를 류신영 봇(RS 2세대)에 붙였을 때 — 규칙은 결과 보기 전에 고정
// 쏠림: 코인별 최근 90일(270회) 펀딩비 중 지금 값의 순위. 롱 진입인데 상위 10% 이상 → 건너뜀, 숏 진입인데 하위 10% 이하 → 건너뜀
// 변형 B(절대값): 롱인데 펀딩 ≥ 0.03%/8h, 숏인데 펀딩 ≤ −0.01%/8h → 건너뜀
// 펀딩 기록이 있는 2024-11-24 이후만 비교. 합격: 필터 쪽 샤프가 더 높고, 앞·뒤 반기 모두 필터 쪽 수익이 같거나 높고, 건너뛴 후보 평균R < 남긴 후보 평균R
import { readFileSync } from 'node:fs';
import { RCFG, prepareRS, buildSamples, trainOn, simulate, statsOf } from '../connect/rs.mjs';
import { predict } from '../connect/mk.mjs';
const DIR = process.env.RD || '/tmp/rd', DAY = 864e5;
const COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'ADA', 'LINK'], series = {};
for (const s of COINS) { const r = JSON.parse(readFileSync(`${DIR}/k4-${s}.json`, 'utf8')); series[s] = { t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }; }
const deriv = JSON.parse(readFileSync(`${DIR}/deriv.json`, 'utf8')), P = { ...RCFG }, W = prepareRS(series);
const fAt = (s, t) => { const f = deriv.coins[s]?.f; if (!f || t < f[0][0]) return null; let lo = 0, hi = f.length - 1, k = 0; while (lo <= hi) { const m = (lo + hi) >> 1; if (f[m][0] <= t) { k = m; lo = m + 1; } else hi = m - 1; } return k; };
const crowdPct = (s, t) => { const k = fAt(s, t); if (k == null || k < 270) return null; const f = deriv.coins[s].f, v = f[k][1]; let below = 0; for (let i = k - 269; i <= k; i++) if (f[i][1] < v) below++; return below / 270; };
const fVal = (s, t) => { const k = fAt(s, t); return k == null ? null : deriv.coins[s].f[k][1]; };
const crowdA = (s, t, g) => { const p = crowdPct(s, t); return p != null && (g > 0 ? p >= 0.9 : p <= 0.1); };
const crowdB = (s, t, g) => { const v = fVal(s, t); return v != null && (g > 0 ? v >= 0.0003 : v <= -0.0001); };
// 실제 봇과 같은 90일 걸음 학습 → 예측
const samples = buildSamples(W, P, deriv), key = (s, t) => s + '|' + t, pred = new Map();
for (let ts = W.T[0] + 540 * DAY; ts < W.T.at(-1); ts += 90 * DAY) { const m = trainOn(samples, ts, P); if (!m) continue; samples.forEach((z) => { if (z.t >= ts && z.t < ts + 90 * DAY) pred.set(key(z.s, z.t), { p: predict(m, z.row), qs: m.qs }); }); }
const F0 = Math.max(...COINS.map((s) => deriv.coins[s].f[270]?.[0] || Infinity)), T1 = W.T.at(-1) + 1, mid = Math.floor((F0 + T1) / 2);
const gbm = (s, t) => { const z = pred.get(key(s, t)); return !!z && z.p >= z.qs[50]; };
const mk = (crowd) => (s, t, c) => ({ ok: gbm(s, t) && !(crowd && crowd(s, t, c.g)) });
const avg = (a) => a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3) : null;
const out = { window: [new Date(F0).toISOString().slice(0, 10), new Date(T1).toISOString().slice(0, 10)] };
// 후보 수준: 봇이 통과시킨 후보 중 쏠림 걸린 것 vs 아닌 것
const inW = samples.filter((z) => z.R != null && z.t >= F0 && gbm(z.s, z.t));
for (const [nm, fn] of [['A_순위', crowdA], ['B_절대값', crowdB]]) { const g = (z) => (z.side === 'long' ? 1 : -1), sk = inW.filter((z) => fn(z.s, z.t, g(z))), kp = inW.filter((z) => !fn(z.s, z.t, g(z)));
  out['후보_' + nm] = { 남김: { n: kp.length, avgR: avg(kp.map((z) => z.R)) }, 건너뜀: { n: sk.length, avgR: avg(sk.map((z) => z.R)) } }; }
// 계좌 수준
for (const [nm, crowd] of [['류신영 봇 그대로', null], ['+ 필터A(순위)', crowdA], ['+ 필터B(절대값)', crowdB]]) { const row = {};
  for (const [k, a, b] of [['all', F0, T1], ['h1', F0, mid], ['h2', mid, T1]]) { const r = simulate(W, P, deriv, { judge: mk(crowd), tA: a, tB: b }); const eq = r.equity.filter(([t]) => t >= a && t < b); const tr = r.trades.filter((z) => Date.parse(z.in.replace(' ', 'T') + 'Z') >= a); const st = statsOf(eq, tr, P) || {}; row[k] = { ret: st.ret, mdd: st.mdd, sharpe: st.sharpe, pf: st.pf, n: st.n }; }
  out[nm] = row; }
console.log(JSON.stringify(out, null, 1));
