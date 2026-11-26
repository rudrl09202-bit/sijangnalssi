// 세계 경제 신호(미·중 패권 싸움의 흔적)를 류신영 봇에 붙였을 때 — 규칙은 결과 보기 전에 고정
// 신호는 전날까지 마감된 일봉만 사용(미래 엿보기 없음). '위험 회피' 신호가 켜지면 새 롱 진입만 건너뜀 (숏은 그대로) · VIX 극단은 둘 다 건너뜀
//  A 위안화 급약세: 달러/위안 20거래일 +1.5% 이상 (미·중 긴장·자본 유출)
//  B 달러 급등: 달러지수 20거래일 +3% 이상
//  C 미국 10년 금리 급등: 20거래일 +0.5%p 이상
//  D 나스닥 약세장: 나스닥 종가 < 200일 평균
//  E 공포지수: VIX 30 이상 → 새 진입 모두 건너뜀
//  F 위험 회피 2개 이상 동시 (A~D 중)
// 합격: 샤프 상승 + 앞·뒤 반기 샤프 모두 기준 이상 + 건너뛴 후보 평균R < 남긴 후보 평균R
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { RCFG, prepareRS, buildSamples, trainOn, simulate, statsOf } from '../connect/rs.mjs';
import { predict } from '../connect/mk.mjs';
const DIR = process.env.RD || '/tmp/rd', MH = process.env.MH || '/tmp/mh', DAY = 864e5;
const COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'ADA', 'LINK'], series = {};
for (const s of COINS) { const r = JSON.parse(readFileSync(`${DIR}/k4-${s}.json`, 'utf8')); series[s] = { t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }; }
const deriv = JSON.parse(readFileSync(`${DIR}/deriv.json`, 'utf8')), P = { ...RCFG }, W = prepareRS(series);
const M = {}; for (const k of ['usdcny', 'dxy', 'us10y', 'nasdaq', 'vix']) { const ctx = { window: {} }; ctx.window.SNW_HIST = (n, d) => { M[k] = d; }; vm.runInNewContext(readFileSync(`${MH}/m_${k}.js`, 'utf8'), ctx); const d = M[k]; d.T = d.t.map((x) => Date.parse(x + 'T00:00:00Z')); if (k === 'us10y' && d.c.at(-1) > 20) d.c = d.c.map((x) => x / 10); }
// t 시점에 쓸 수 있는 마지막 일봉 = t의 UTC 날짜보다 이전 날짜 (미국 장 마감 반영)
const idx = (d, t) => { const day = Math.floor(t / DAY) * DAY; let lo = 0, hi = d.T.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (d.T[m] < day) { k = m; lo = m + 1; } else hi = m - 1; } return k; };
const ch = (k, t, n, pct = true) => { const d = M[k], i = idx(d, t); if (i < n) return null; return pct ? (d.c[i] / d.c[i - n] - 1) * 100 : d.c[i] - d.c[i - n]; };
const sma200 = (t) => { const d = M.nasdaq, i = idx(d, t); if (i < 200) return null; let s = 0; for (let q = i - 199; q <= i; q++) s += d.c[q]; return d.c[i] < s / 200; };
const SIG = { A: (t) => (ch('usdcny', t, 20) ?? 0) >= 1.5, B: (t) => (ch('dxy', t, 20) ?? 0) >= 3, C: (t) => (ch('us10y', t, 20, false) ?? 0) >= 0.5, D: (t) => !!sma200(t), E: (t) => { const d = M.vix, i = idx(d, t); return i >= 0 && d.c[i] >= 30; } };
const SIG_F = (t) => ['A', 'B', 'C', 'D'].filter((k) => SIG[k](t)).length >= 2;
const block = (name, t, g) => name === 'E' ? SIG.E(t) : name === 'F' ? g > 0 && SIG_F(t) : g > 0 && SIG[name](t);
const samples = buildSamples(W, P, deriv), key = (s, t) => s + '|' + t, pred = new Map(); let F0 = null;
for (let ts = W.T[0] + 540 * DAY; ts < W.T.at(-1); ts += 90 * DAY) { const m = trainOn(samples, ts, P); if (!m) continue; if (F0 == null) F0 = ts; samples.forEach((z) => { if (z.t >= ts && z.t < ts + 90 * DAY) pred.set(key(z.s, z.t), { p: predict(m, z.row), qs: m.qs }); }); }
const T1 = W.T.at(-1) + 1, mid = Math.floor((F0 + T1) / 2), gbm = (s, t) => { const z = pred.get(key(s, t)); return !!z && z.p >= z.qs[50]; };
const avg = (a) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3) : null);
const inW = samples.filter((z) => z.R != null && z.t >= F0 && gbm(z.s, z.t));
const run = (nm) => { const row = {}; for (const [k, a, b] of [['all', F0, T1], ['h1', F0, mid], ['h2', mid, T1]]) { const r = simulate(W, P, deriv, { judge: (s, t, c) => ({ ok: gbm(s, t) && !(nm && block(nm, t, c.g)) }), tA: a, tB: b }); const st = statsOf(r.equity.filter(([t]) => t >= a && t < b), r.trades.filter((z) => Date.parse(z.in.replace(' ', 'T') + 'Z') >= a), P) || {}; row[k] = st; } return row; };
const base = run(null), on = (nm) => { const days = new Set(); for (let t = F0; t < T1; t += DAY) if (nm === 'E' ? SIG.E(t) : nm === 'F' ? SIG_F(t) : SIG[nm](t)) days.add(t); return Math.round(days.size / ((T1 - F0) / DAY) * 100); };
console.log('기간', new Date(F0).toISOString().slice(0, 10), '~', new Date(T1).toISOString().slice(0, 10));
console.log('류신영 봇 그대로'.padEnd(20), '연', base.all.cagr + '%', '낙폭', base.all.mdd + '%', '샤프', base.all.sharpe, '거래', base.all.n, '| 앞 샤프', base.h1.sharpe, '뒤', base.h2.sharpe);
const NM = { A: 'A 위안화 급약세', B: 'B 달러 급등', C: 'C 미 금리 급등', D: 'D 나스닥 약세장', E: 'E VIX 30 이상', F: 'F 위험 신호 2개+' };
for (const k of Object.keys(NM)) { const r = run(k), g = (z) => (z.side === 'long' ? 1 : -1), sk = inW.filter((z) => block(k, z.t, g(z))), kp = inW.filter((z) => !block(k, z.t, g(z)));
  const pass = r.all.sharpe > base.all.sharpe && r.h1.sharpe >= base.h1.sharpe && r.h2.sharpe >= base.h2.sharpe && avg(sk.map((z) => z.R)) < avg(kp.map((z) => z.R));
  console.log(NM[k].padEnd(20), '연', r.all.cagr + '%', '낙폭', r.all.mdd + '%', '샤프', r.all.sharpe, '거래', r.all.n, '| 앞', r.h1.sharpe, '뒤', r.h2.sharpe, '| 켜진 날', on(k) + '%', '| 건너뛴 후보', sk.length, '평균R', avg(sk.map((z) => z.R)), 'vs 남김', avg(kp.map((z) => z.R)), pass ? '→ 합격' : '→ 불합격'); }
// 우연 확인: 같은 수의 후보를 무작위로 건너뛰었을 때 샤프가 이만큼 오르는 경우가 얼마나 되나
if (process.env.PLACEBO) { let seed = 9; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (const [k, nSkip] of [['E', 49], ['F', 43]]) { const real = run(k).all.sharpe, ids = inW.map((z) => key(z.s, z.t)), res = [];
    for (let it = 0; it < 200; it++) { const skip = new Set(); while (skip.size < nSkip) skip.add(ids[Math.floor(rnd() * ids.length)]);
      const r = simulate(W, P, deriv, { judge: (s, t) => ({ ok: gbm(s, t) && !skip.has(key(s, t)) }), tA: F0, tB: T1 }); res.push((statsOf(r.equity.filter(([t]) => t >= F0), r.trades, P) || {}).sharpe); }
    res.sort((a, b) => a - b); console.log(NM[k], '실제 샤프', real, '| 무작위 건너뛰기 중간', res[100], '상위 5%', res[190], '| 실제보다 좋거나 같은 경우', Math.round(res.filter((x) => x >= real).length / 2) + '%'); } }
