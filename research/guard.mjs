// 변화 감지·자동 크기 조절 6년 시험 (2026-11-26): 낙폭 단계·성적 이탈 모두 불합격(수익 −22~34%, 샤프 1.56→1.29~1.39) → 자동 축소 대신 감시·알림·비상 정지만 채택. 아래 끝에서 감시 기준(60일 수익 분포·낙폭) 계산
// 민경기 매매법 만들기: 시험 통과한 재료(류신영 4h, 상대 모멘텀) + 후보(류신영 8h)를 6년 데이터로 섞고 크기를 정함
// 기준(미리 고정): ① 8h 후보는 규칙만으로 평균R>0, 앞·뒤 모두 플러스, 비용 2배 플러스, 섞었을 때 샤프 상승이어야 채택
// ② 크기: 일별 수익을 10일 덩어리로 1000번 다시 섞었을 때 낙폭이 −25%보다 나빠질 확률 ≤ 20% 인 범위에서 가장 큰 크기
// ③ 크기·비율은 앞 절반 데이터로만 정하고, 뒤 절반에서 그대로 써서 확인
import { readFileSync, writeFileSync } from 'node:fs';
import { RCFG, prepareRS, buildSamples, trainOn, simulate as simRS, statsOf as stRS } from '../connect/rs.mjs';
import { PCFG, align, signals, simulate as simPR } from '../connect/pair.mjs';
import { predict } from '../connect/mk.mjs';
import vm from 'node:vm';
const MHD = process.env.MH || '/tmp/mh', MM = {}; for (const k of ['usdcny', 'dxy', 'us10y', 'nasdaq']) { const ctx = { window: { SNW_HIST: (n, d) => { MM[k] = d; } } }; vm.runInNewContext(readFileSync(`${MHD}/m_${k}.js`, 'utf8'), ctx); MM[k].T = MM[k].t.map((x) => Date.parse(x + 'T00:00:00Z')); if (k === 'us10y' && MM[k].c.at(-1) > 20) MM[k].c = MM[k].c.map((x) => x / 10); }
const mIdx = (d, t) => { const day = Math.floor(t / 864e5) * 864e5; let lo = 0, hi = d.T.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (d.T[m] < day) { k = m; lo = m + 1; } else hi = m - 1; } return k; };
const mCh = (k, t, n, pct = true) => { const d = MM[k], i = mIdx(d, t); if (i < n) return 0; return pct ? (d.c[i] / d.c[i - n] - 1) * 100 : d.c[i] - d.c[i - n]; };
const mNq = (t) => { const d = MM.nasdaq, i = mIdx(d, t); if (i < 200) return false; let s = 0; for (let q = i - 199; q <= i; q++) s += d.c[q]; return d.c[i] < s / 200; };
const riskF = (t) => [mCh('usdcny', t, 20) >= 1.5, mCh('dxy', t, 20) >= 3, mCh('us10y', t, 20, false) >= 0.5, mNq(t)].filter(Boolean).length >= 2;
const DIR = process.env.RD || '/tmp/rd', DAY = 864e5, H = 3600e3, COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'ADA', 'LINK'];
const deriv = JSON.parse(readFileSync(`${DIR}/deriv.json`, 'utf8')), S4 = {};
for (const s of COINS) { const r = JSON.parse(readFileSync(`${DIR}/k4-${s}.json`, 'utf8')); S4[s] = { t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }; }
const agg = (d, k) => { const W = k * 4 * H, o = { t: [], o: [], h: [], l: [], c: [], v: [] }; let cur = null; for (let i = 0; i < d.t.length; i++) { const b = Math.floor(d.t[i] / W); if (b !== cur) { cur = b; o.t.push(b * W); o.o.push(d.o[i]); o.h.push(d.h[i]); o.l.push(d.l[i]); o.c.push(d.c[i]); o.v.push(d.v[i]); } else { const q = o.t.length - 1; o.h[q] = Math.max(o.h[q], d.h[i]); o.l[q] = Math.min(o.l[q], d.l[i]); o.c[q] = d.c[i]; o.v[q] += d.v[i]; } } ['t', 'o', 'h', 'l', 'c', 'v'].forEach((x) => { o[x] = o[x].slice(1, -1); }); return o; };
const S8 = Object.fromEntries(COINS.map((s) => [s, agg(S4[s], 2)]));
const W4 = prepareRS(S4), W8 = prepareRS(S8), P0 = { ...RCFG };
// 류신영 4h 학습 필터 (실제 봇과 같은 90일 걸음)
const samples = buildSamples(W4, P0, deriv), key = (s, t) => s + '|' + t, pred = new Map(); let F0 = null;
for (let ts = W4.T[0] + 540 * DAY; ts < W4.T.at(-1); ts += 90 * DAY) { const m = trainOn(samples, ts, P0); if (!m) continue; if (F0 == null) F0 = ts; samples.forEach((z) => { if (z.t >= ts && z.t < ts + 90 * DAY) pred.set(key(z.s, z.t), { p: predict(m, z.row), qs: m.qs }); }); }
const gbm = (s, t, c) => { const z = pred.get(key(s, t)); return { ok: !!z && z.p >= z.qs[50] && !(c && c.g > 0 && riskF(t)) }; };
const T1 = W4.T.at(-1) + 1, MID = Math.floor((F0 + T1) / 2);
const daily = (eq, a, b) => { const m = new Map(); eq.forEach(([t, v]) => { if (t >= a && t < b) m.set(Math.floor(t / DAY), v); }); return m; };
const stat = (eq, tr) => stRS(eq, tr, P0) || {};
// ── ① 8h 후보 단독 시험 (규칙만) vs 4h 규칙만 ──
const one = {};
for (const [nm, W, P] of [['4h 규칙만', W4, P0], ['8h 규칙만', W8, P0], ['8h 규칙만 · 비용 2배', W8, { ...P0, taker: P0.taker * 2, slipIn: P0.slipIn * 2, slipStop: P0.slipStop * 2 }], ['4h 학습필터 (류신영)', W4, P0]]) {
  const row = {}; for (const [k, a, b] of [['all', F0, T1], ['h1', F0, MID], ['h2', MID, T1]]) { const r = simRS(W, P, deriv, { judge: nm.includes('학습') ? gbm : null, tA: a, tB: b }); row[k] = stat(r.equity.filter(([t]) => t >= a && t < b), r.trades.filter((z) => Date.parse(z.in.replace(' ', 'T') + 'Z') >= a)); }
  one[nm] = row; console.log(nm.padEnd(18), '연', row.all.cagr + '%', '낙폭', row.all.mdd + '%', '샤프', row.all.sharpe, 'PF', row.all.pf, '평균R', row.all.avgR, '거래', row.all.n, '| 앞', row.h1.ret + '%', '뒤', row.h2.ret + '%'); }
// ── 크기별 일별 곡선 ──
const K = [1, 1.25];
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

// ── 변화 감지 · 자동 크기 조절 시험 (규칙 미리 고정) ──
// A 낙폭 단계: 계좌 고점 대비 −10% → 크기 0.5, −18% → 0.25 · −5% 안으로 회복하면 1 · 줄인 채 60일 지나면 한 단계 올림 (전날까지 정보로 결정)
// B 성적 이탈: 매매법별 최근 60일 수익이 '그때까지의 60일 수익 분포' 하위 5%보다 나쁘면 그 몫 0.5, 하위 25% 위로 오면 1 (분포는 그날 이전 기록만)
// 크기를 바꿀 때 바뀐 노출의 0.1% 비용
// 합격: 6년·앞·뒤 모두 최대 낙폭이 줄고, −25% 넘을 확률이 줄고, 연 수익 감소가 20% 이내, 샤프 감소 0.05 이내
const RA = R.rs4[1.25], RB = R.pr[1.25], N = RA.length;
const met = (r) => { let eq = 1, pk = 1, mdd = 0; r.forEach((x) => { eq *= 1 + x; pk = Math.max(pk, eq); mdd = Math.min(mdd, eq / pk - 1); }); const m = r.reduce((a, b) => a + b, 0) / r.length, sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / r.length); return { cagr: +((Math.pow(eq, 365.25 / r.length) - 1) * 100).toFixed(1), mdd: +(mdd * 100).toFixed(1), sharpe: +(sd ? m / sd * Math.sqrt(365.25) : 0).toFixed(2) }; };
let seed = 42; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const boot = (r, NN = 1000, B = 10) => { let bad = 0; for (let n = 0; n < NN; n++) { let eq = 1, pk = 1, mdd = 0; for (let i = 0; i < r.length; i += B) { const s0 = Math.floor(rnd() * (r.length - B)); for (let j = 0; j < B && i + j < r.length; j++) { eq *= 1 + r[s0 + j]; pk = Math.max(pk, eq); mdd = Math.min(mdd, eq / pk - 1); } } if (mdd < -0.25) bad++; } return Math.round(bad / NN * 100); };
function run(useA, useB) { const out = []; let eq = 1, pk = 1, lvl = 1, since = 0, prevExp = 1; const wA = [], wB = []; let mA = 1, mB = 1;
  const roll = (arr, i) => { let s = 1; for (let q = Math.max(0, i - 60); q < i; q++) s *= 1 + arr[q]; return s - 1; };
  const hist = { a: [], b: [] };
  for (let i = 0; i < N; i++) {
    if (useB && i > 120) { const ra = roll(RA, i), rb = roll(RB, i); hist.a.push(ra); hist.b.push(rb); const q = (h, p) => { const s2 = h.slice().sort((x, y) => x - y); return s2[Math.floor(p * (s2.length - 1))]; };
      if (hist.a.length > 60) { if (ra < q(hist.a, 0.05)) mA = 0.5; else if (ra > q(hist.a, 0.25)) mA = 1; if (rb < q(hist.b, 0.05)) mB = 0.5; else if (rb > q(hist.b, 0.25)) mB = 1; } }
    const exp = lvl * (0.5 * mA + 0.5 * mB) / 1, cost = Math.abs(exp - prevExp) * 0.001; prevExp = exp;
    const r = lvl * (0.5 * mA * RA[i] + 0.5 * mB * RB[i]) - cost; out.push(r);
    eq *= 1 + r; pk = Math.max(pk, eq); const dd = eq / pk - 1;
    if (useA) { const want = dd <= -0.18 ? 0.25 : dd <= -0.10 ? 0.5 : null;
      if (want != null && want < lvl) { lvl = want; since = i; } else if (lvl < 1 && dd > -0.05) lvl = 1; else if (lvl < 1 && i - since >= 60) { lvl = lvl === 0.25 ? 0.5 : 1; since = i; } } }
  return out; }
const mid = Math.floor(N / 2);
for (const [nm, a, b] of [['그대로', 0, 0], ['A 낙폭 단계', 1, 0], ['B 성적 이탈', 0, 1], ['A + B', 1, 1]]) { const r = run(a, b), all = met(r), h1 = met(r.slice(0, mid)), h2 = met(r.slice(mid));
  console.log(nm.padEnd(10), '6년 연', all.cagr + '%', '낙폭', all.mdd + '%', '샤프', all.sharpe, '−25% 확률', boot(r) + '%', '| 앞', h1.cagr + '%/' + h1.mdd + '%', '뒤', h2.cagr + '%/' + h2.mdd + '%'); }
// 감시 기준 뽑기: 6년 일별 수익(그대로)에서 60일 수익 분포, 연속 하락일, 낙폭
{ const r = run(0, 0), q = (a, p) => { const s2 = a.slice().sort((x, y) => x - y); return s2[Math.floor(p * (s2.length - 1))]; };
  const r60 = []; for (let i = 60; i <= r.length; i++) { let s = 1; for (let k = i - 60; k < i; k++) s *= 1 + r[k]; r60.push((s - 1) * 100); }
  const ra60 = [], rb60 = []; for (let i = 60; i <= N; i++) { let a = 1, b = 1; for (let k = i - 60; k < i; k++) { a *= 1 + RA[k]; b *= 1 + RB[k]; } ra60.push((a - 1) * 100); rb60.push((b - 1) * 100); }
  console.log('60일 수익 (민경기 매매법) 1%:', q(r60, 0.01).toFixed(1), '5%:', q(r60, 0.05).toFixed(1), '최저:', Math.min(...r60).toFixed(1));
  console.log('60일 수익 (류신영 몫 1.25배) 1%:', q(ra60, 0.01).toFixed(1), '5%:', q(ra60, 0.05).toFixed(1), '최저:', Math.min(...ra60).toFixed(1));
  console.log('60일 수익 (상대 모멘텀 1.25배) 1%:', q(rb60, 0.01).toFixed(1), '5%:', q(rb60, 0.05).toFixed(1), '최저:', Math.min(...rb60).toFixed(1));
  let eq = 1, pk = 1, dd = []; r.forEach((x) => { eq *= 1 + x; pk = Math.max(pk, eq); dd.push((eq / pk - 1) * 100); }); console.log('낙폭 최저', Math.min(...dd).toFixed(1), '낙폭 −10% 넘은 날 비율', (dd.filter((x) => x <= -10).length / dd.length * 100).toFixed(1) + '%'); }
