// 민경기 매매법 만들기: 시험 통과한 재료(류신영 4h, 상대 모멘텀) + 후보(류신영 8h)를 6년 데이터로 섞고 크기를 정함
// 기준(미리 고정): ① 8h 후보는 규칙만으로 평균R>0, 앞·뒤 모두 플러스, 비용 2배 플러스, 섞었을 때 샤프 상승이어야 채택
// ② 크기: 일별 수익을 10일 덩어리로 1000번 다시 섞었을 때 낙폭이 −25%보다 나빠질 확률 ≤ 20% 인 범위에서 가장 큰 크기
// ③ 크기·비율은 앞 절반 데이터로만 정하고, 뒤 절반에서 그대로 써서 확인
import { readFileSync, writeFileSync } from 'node:fs';
import { RCFG, prepareRS, buildSamples, trainOn, simulate as simRS, statsOf as stRS } from '../connect/rs.mjs';
import { PCFG, align, signals, simulate as simPR } from '../connect/pair.mjs';
import { predict } from '../connect/mk.mjs';
const DIR = process.env.RD || '/tmp/rd', DAY = 864e5, H = 3600e3, COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'ADA', 'LINK'];
const deriv = JSON.parse(readFileSync(`${DIR}/deriv.json`, 'utf8')), S4 = {};
for (const s of COINS) { const r = JSON.parse(readFileSync(`${DIR}/k4-${s}.json`, 'utf8')); S4[s] = { t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }; }
const agg = (d, k) => { const W = k * 4 * H, o = { t: [], o: [], h: [], l: [], c: [], v: [] }; let cur = null; for (let i = 0; i < d.t.length; i++) { const b = Math.floor(d.t[i] / W); if (b !== cur) { cur = b; o.t.push(b * W); o.o.push(d.o[i]); o.h.push(d.h[i]); o.l.push(d.l[i]); o.c.push(d.c[i]); o.v.push(d.v[i]); } else { const q = o.t.length - 1; o.h[q] = Math.max(o.h[q], d.h[i]); o.l[q] = Math.min(o.l[q], d.l[i]); o.c[q] = d.c[i]; o.v[q] += d.v[i]; } } ['t', 'o', 'h', 'l', 'c', 'v'].forEach((x) => { o[x] = o[x].slice(1, -1); }); return o; };
const S8 = Object.fromEntries(COINS.map((s) => [s, agg(S4[s], 2)]));
const W4 = prepareRS(S4), W8 = prepareRS(S8), P0 = { ...RCFG };
// 류신영 4h 학습 필터 (실제 봇과 같은 90일 걸음)
const samples = buildSamples(W4, P0, deriv), key = (s, t) => s + '|' + t, pred = new Map(); let F0 = null;
for (let ts = W4.T[0] + 540 * DAY; ts < W4.T.at(-1); ts += 90 * DAY) { const m = trainOn(samples, ts, P0); if (!m) continue; if (F0 == null) F0 = ts; samples.forEach((z) => { if (z.t >= ts && z.t < ts + 90 * DAY) pred.set(key(z.s, z.t), { p: predict(m, z.row), qs: m.qs }); }); }
const gbm = (s, t) => { const z = pred.get(key(s, t)); return { ok: !!z && z.p >= z.qs[50] }; };
const T1 = W4.T.at(-1) + 1, MID = Math.floor((F0 + T1) / 2);
const daily = (eq, a, b) => { const m = new Map(); eq.forEach(([t, v]) => { if (t >= a && t < b) m.set(Math.floor(t / DAY), v); }); return m; };
const stat = (eq, tr) => stRS(eq, tr, P0) || {};
// ── ① 8h 후보 단독 시험 (규칙만) vs 4h 규칙만 ──
const one = {};
for (const [nm, W, P] of [['4h 규칙만', W4, P0], ['8h 규칙만', W8, P0], ['8h 규칙만 · 비용 2배', W8, { ...P0, taker: P0.taker * 2, slipIn: P0.slipIn * 2, slipStop: P0.slipStop * 2 }], ['4h 학습필터 (류신영)', W4, P0]]) {
  const row = {}; for (const [k, a, b] of [['all', F0, T1], ['h1', F0, MID], ['h2', MID, T1]]) { const r = simRS(W, P, deriv, { judge: nm.includes('학습') ? gbm : null, tA: a, tB: b }); row[k] = stat(r.equity.filter(([t]) => t >= a && t < b), r.trades.filter((z) => Date.parse(z.in.replace(' ', 'T') + 'Z') >= a)); }
  one[nm] = row; console.log(nm.padEnd(18), '연', row.all.cagr + '%', '낙폭', row.all.mdd + '%', '샤프', row.all.sharpe, 'PF', row.all.pf, '평균R', row.all.avgR, '거래', row.all.n, '| 앞', row.h1.ret + '%', '뒤', row.h2.ret + '%'); }
// ── 크기별 일별 곡선 ──
const K = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4];
const D = align(S4.ETH, S4.BTC), Z = signals(D, PCFG);
const curves = { rs4: {}, rs8: {}, pr: {} };
for (const k of K) { const P = { ...P0, riskPct: 0.75 * k, maxLev: Math.min(10, 3 * k) };
  curves.rs4[k] = daily(simRS(W4, P, deriv, { judge: gbm, tA: F0 }).equity, F0, T1);
  curves.rs8[k] = daily(simRS(W8, P, deriv, { tA: F0 }).equity, F0, T1);
  curves.pr[k] = daily(simPR(D, Z, { ...PCFG, lev: 1 * k }, deriv, { tA: F0 }).equity, F0, T1); }
const days = [...curves.rs4[1].keys()].filter((d) => curves.pr[1].has(d) && curves.rs8[1].has(d)).sort((a, b) => a - b);
const rets = (m) => days.slice(1).map((d, i) => m.get(d) / m.get(days[i]) - 1);
const R = { rs4: {}, rs8: {}, pr: {} }; for (const s of Object.keys(R)) for (const k of K) R[s][k] = rets(curves[s][k]);
const corr = (a, b) => { const ma = a.reduce((x, y) => x + y, 0) / a.length, mb = b.reduce((x, y) => x + y, 0) / b.length; let c = 0, va = 0, vb = 0; for (let i = 0; i < a.length; i++) { c += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; } return c / Math.sqrt(va * vb); };
console.log('상관(일별): 4h·상대', corr(R.rs4[1], R.pr[1]).toFixed(2), ' 4h·8h', corr(R.rs4[1], R.rs8[1]).toFixed(2), ' 8h·상대', corr(R.rs8[1], R.pr[1]).toFixed(2));
// 포트폴리오: 매일 비율대로 다시 맞춤 (각 계좌가 자기 크기 k 로 매매)
const MIX = { '류신영 4h 혼자': { rs4: 1 }, '4h 50 + 상대 50': { rs4: 0.5, pr: 0.5 }, '4h 60 + 상대 40': { rs4: 0.6, pr: 0.4 }, '4h·8h·상대 1/3씩': { rs4: 1 / 3, rs8: 1 / 3, pr: 1 / 3 }, '4h 40 + 8h 20 + 상대 40': { rs4: 0.4, rs8: 0.2, pr: 0.4 } };
const port = (mix, k, i0, i1) => { const out = []; for (let i = i0; i < i1; i++) { let r = 0; for (const [s, w] of Object.entries(mix)) r += w * R[s][k][i]; out.push(r); } return out; };
const met = (r) => { let eq = 1, pk = 1, mdd = 0; r.forEach((x) => { eq *= 1 + x; pk = Math.max(pk, eq); mdd = Math.min(mdd, eq / pk - 1); }); const m = r.reduce((a, b) => a + b, 0) / r.length, sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / r.length), yrs = r.length / 365.25; return { cagr: (Math.pow(eq, 1 / yrs) - 1) * 100, mdd: mdd * 100, sharpe: sd ? m / sd * Math.sqrt(365.25) : 0, mult: eq }; };
let seed = 42; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const boot = (r, N = 1000, B = 10) => { let bad = 0; const mdds = []; for (let n = 0; n < N; n++) { let eq = 1, pk = 1, mdd = 0; for (let i = 0; i < r.length; i += B) { const s0 = Math.floor(rnd() * (r.length - B)); for (let j = 0; j < B && i + j < r.length; j++) { eq *= 1 + r[s0 + j]; pk = Math.max(pk, eq); mdd = Math.min(mdd, eq / pk - 1); } } mdds.push(mdd); if (mdd < -0.25) bad++; } mdds.sort((a, b) => a - b); return { pBad: bad / N, p5: mdds[Math.floor(N * 0.05)] * 100, med: mdds[Math.floor(N / 2)] * 100 }; };
const iMid = days.findIndex((d) => d * DAY >= MID) - 1, nR = days.length - 1, res = [];
for (const [nm, mix] of Object.entries(MIX)) { for (const k of K) { const A1 = port(mix, k, 0, iMid), A2 = port(mix, k, iMid, nR), AL = port(mix, k, 0, nR);
  res.push({ mix: nm, k, h1: met(A1), h2: met(A2), all: met(AL), b1: boot(A1), ball: boot(AL) }); } }
// ③ 앞 절반만 보고 고르기: 기준 통과(앞 절반 부트스트랩 pBad ≤ 20% · 실제 낙폭 > −25%) 중 앞 절반 연수익 최대
const ok1 = res.filter((r) => r.b1.pBad <= 0.2 && r.h1.mdd > -25), pick = ok1.sort((a, b) => b.h1.cagr - a.h1.cagr)[0];
console.log('\n비율·크기별 (크기 1 = 지금 류신영 봇 크기: 거래당 0.75%, 상대 모멘텀 1배)');
for (const nm of Object.keys(MIX)) { console.log('◆ ' + nm); res.filter((r) => r.mix === nm).forEach((r) => console.log('  크기', String(r.k).padEnd(4), '6년 연', r.all.cagr.toFixed(1) + '%', '낙폭', r.all.mdd.toFixed(1) + '%', '샤프', r.all.sharpe.toFixed(2), '| 섞기 낙폭 −25% 넘을 확률', Math.round(r.ball.pBad * 100) + '%', '(5% 최악', r.ball.p5.toFixed(0) + '%)', '| 앞', r.h1.cagr.toFixed(0) + '%/' + r.h1.mdd.toFixed(0) + '%', '뒤', r.h2.cagr.toFixed(0) + '%/' + r.h2.mdd.toFixed(0) + '%')); }
console.log('\n앞 절반으로 고른 것:', pick.mix, '크기', pick.k, '→ 뒤 절반(처음 보는 기간) 연', pick.h2.cagr.toFixed(1) + '%', '낙폭', pick.h2.mdd.toFixed(1) + '%', '샤프', pick.h2.sharpe.toFixed(2));
console.log('기간', new Date(days[0] * DAY).toISOString().slice(0, 10), '~', new Date(days.at(-1) * DAY).toISOString().slice(0, 10), '중간', new Date(days[iMid] * DAY).toISOString().slice(0, 10));
writeFileSync('/tmp/pf/res.json', JSON.stringify({ one, res, pick, from: days[0] * DAY, to: days.at(-1) * DAY, mid: days[iMid] * DAY }));
