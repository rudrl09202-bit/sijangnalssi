// 독창성 연구 1: 펀딩비 쏠림 · 김치 프리미엄을 류신영 봇에 붙였을 때 — 규칙·합격 기준은 자료를 받기 전에 고정 (2026-11-27)
//  왜 이 자료: 남이 쉽게 안 쓰는 쪽 — 펀딩비(파생 쏠림)와 한국 시장만의 가격 차이. 모의 기록 기간이라 연구만 하고 봇에는 넣지 않음(CLAUDE.md 1장)
//  펀딩비 (research/fund-filter.mjs 에서 먼저 정해 둔 규칙 그대로, 기간만 2년 → 6년. 자료: 바이낸스 공개 자료실)
//   FA 순위형: 코인별 최근 90일(270회) 펀딩비 중 지금 값 순위 — 롱인데 상위 10% → 건너뜀, 숏인데 하위 10% → 건너뜀
//   FB 절대값형: 롱인데 펀딩 ≥ 0.03%/8h → 건너뜀, 숏인데 ≤ −0.01%/8h → 건너뜀
//  김치 프리미엄 P = 업비트 KRW-BTC ÷ (바이낸스 BTC × 원/달러) − 1  (4시간봉 종가, 환율은 전날까지의 일별 값)
//   KA: P 가 지난 1년(2190봉) 분포의 상위 10% (한국 개인 과열) → 새 롱 건너뜀
//   KB: KA + P 가 하위 10% (한국이 더 쌈) → 새 숏도 건너뜀
//  기준선 = 류신영 봇(학습 필터). 합격: 전체 샤프 상승 + 앞·뒤 반기 샤프 모두 기준선 이상 + 건너뛴 후보 평균R < 남긴 후보 평균R
//  합격하면 무작위 200번(같은 수를 무작위로 건너뜀) — 무작위가 실제 이상인 경우 10% 넘으면 우연으로 봄
// 결과 (2026-11-27, 2021-03~2026-11 · 김치 프리미엄 중간 1.65% · 하위10% −0.33% · 상위10% 4.93%):
//   기준선 연 37.1% · 낙폭 −24.3% · 샤프 1.31 (앞 1.40 뒤 1.23)
//   FA 샤프 1.37 (앞 1.83 뒤 0.98) → 불합격: 건너뛴 716개 평균R 0.025 vs 남김 0.473 으로 구분은 잘하지만 뒤 반기 샤프가 기준선 아래
//   FB 연 41.0% · 낙폭 −23.7% · 샤프 1.43 (앞 1.55 뒤 1.33) · 건너뛴 253개 평균R 0.008 vs 남김 0.347 → 합격, 무작위 200번 중 3%
//   KA 샤프 1.13 · KB 1.05 → 불합격: 가설과 반대 — 김치 프리미엄이 높을 때 들어간 롱이 오히려 더 벌었음(평균R 0.66 vs 0.27)
//   주의: 이 파일에서만 변형 4개를 시험함(다중 시험). FB 는 모의 기록 기간이라 봇에 넣지 않고 2027-02-27 검토 후보로 둠.
//         2026-11-27 이후 석 달이 FB 의 진짜 표본 밖 구간 — 검토 때 그 기간만 따로 다시 계산할 것.
//         "김치 프리미엄 높으면 롱에 유리"는 결과를 보고 안 것(사후 발견) → 지금 시험하지 않음. 쓰려면 새 자료 구간에서 따로 확인
// 사용: node research/kimchi-hist.mjs && RD=/tmp/rd MH=/tmp/mh node research/kimchi-funding.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { RCFG, prepareRS, buildSamples, trainOn, simulate, statsOf } from '../connect/rs.mjs';
import { predict } from '../connect/mk.mjs';
const DIR = process.env.RD || '/tmp/rd', MH = process.env.MH || '/tmp/mh', DAY = 864e5, H4 = 4 * 3600e3, COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'ADA', 'LINK'], series = {};
for (const s of COINS) { const r = JSON.parse(readFileSync(`${DIR}/k4-${s}.json`, 'utf8')); series[s] = { t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }; }
const deriv = JSON.parse(readFileSync(`${DIR}/deriv.json`, 'utf8')), P = { ...RCFG }, W = prepareRS(series);
// 펀딩비: 자료실(2020~) + 최근 달은 deriv.json 으로 이어 붙임
const FUND = {}; for (const s of COINS) { const a = JSON.parse(readFileSync(`${MH}/fund-${s}.json`, 'utf8')), last = a.length ? a.at(-1)[0] : 0; (deriv.coins[s]?.f || []).forEach((x) => { if (x[0] > last + 3600e3) a.push(x); }); FUND[s] = a; }
const lastLE = (a, t) => { let lo = 0, hi = a.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m][0] <= t) { k = m; lo = m + 1; } else hi = m - 1; } return k; };
const fundSkip = (mode) => (s, t, g) => { const a = FUND[s], k = lastLE(a, t + H4); if (k < 0) return false; const v = a[k][1];
  if (mode === 'FB') return g > 0 ? v >= 0.0003 : v <= -0.0001;
  if (k < 269) return false; let below = 0; for (let q = k - 269; q <= k; q++) if (a[q][1] <= v) below++; const pr = below / 270; return g > 0 ? pr >= 0.9 : pr <= 0.1; };
// 김치 프리미엄
const UP = JSON.parse(readFileSync(`${MH}/upbit-BTC-4h.json`, 'utf8')), upAt = new Map(UP.t.map((t, i) => [t, UP.c[i]]));
let KR; { const ctx = { window: { SNW_HIST: (n, d) => { KR = d; } } }; vm.runInNewContext(readFileSync(`${MH}/m_fx_krw.js`, 'utf8'), ctx); KR.T = KR.t.map((x) => Date.parse(x + 'T00:00:00Z')); }
const krwBefore = (t) => { const day = Math.floor(t / DAY) * DAY; let lo = 0, hi = KR.T.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (KR.T[m] < day) { k = m; lo = m + 1; } else hi = m - 1; } return k >= 0 ? KR.c[k] : null; };
const B = series.BTC, PT = [], PV = []; B.t.forEach((t, i) => { const u = upAt.get(t), fx = krwBefore(t + H4); if (u && fx) { PT.push(t); PV.push(u / (B.c[i] * fx) - 1); } });
const pIdx = new Map(PT.map((t, i) => [t, i])), pctMemo = new Map();
const pPct = (t) => { if (pctMemo.has(t)) return pctMemo.get(t); const i = pIdx.get(t); let r = null; if (i != null && i >= 2190) { let below = 0; for (let q = i - 2190; q < i; q++) if (PV[q] <= PV[i]) below++; r = below / 2190; } pctMemo.set(t, r); return r; };
const kimSkip = (mode) => (s, t, g) => { const r = pPct(t); if (r == null) return false; return g > 0 ? r >= 0.9 : mode === 'KB' && r <= 0.1; };
const SKIP = { FA: fundSkip('FA'), FB: fundSkip('FB'), KA: kimSkip('KA'), KB: kimSkip('KB') }, NM = { FA: 'FA 펀딩 순위형', FB: 'FB 펀딩 절대값형', KA: 'KA 김치 과열 → 롱 쉼', KB: 'KB 김치 과열·역프 → 롱·숏 쉼' };
const samples = buildSamples(W, P, deriv), key = (s, t) => s + '|' + t, pred = new Map(); let F0 = null;
for (let ts = W.T[0] + 540 * DAY; ts < W.T.at(-1); ts += 90 * DAY) { const m = trainOn(samples, ts, P); if (!m) continue; if (F0 == null) F0 = ts; samples.forEach((z) => { if (z.t >= ts && z.t < ts + 90 * DAY) pred.set(key(z.s, z.t), predict(m, z.row) >= m.qs[50]); }); }
const T1 = W.T.at(-1) + 1, mid = Math.floor((F0 + T1) / 2), gbm = (s, t) => !!pred.get(key(s, t)), avg = (a) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3) : null);
const inW = samples.filter((z) => z.R != null && z.t >= F0 && gbm(z.s, z.t)), sg = (z) => (z.side === 'long' ? 1 : -1);
const run = (skip) => { const row = {}; for (const [k, a, b] of [['all', F0, T1], ['h1', F0, mid], ['h2', mid, T1]]) { const r = simulate(W, P, deriv, { judge: (s, t, c) => ({ ok: gbm(s, t) && !(skip && skip(s, t, c.g)) }), tA: a, tB: b }); row[k] = statsOf(r.equity.filter(([t]) => t >= a && t < b), r.trades.filter((z) => Date.parse(z.in.replace(' ', 'T') + 'Z') >= a), P) || {}; } return row; };
const line = (nm, r, x = '') => console.log(nm.padEnd(26), '연', r.all.cagr + '%', '낙폭', r.all.mdd + '%', '샤프', r.all.sharpe, '| 앞', r.h1.sharpe, '뒤', r.h2.sharpe, x);
const pv = PV.filter((_, i) => PT[i] >= F0).sort((a, b) => a - b); console.log('기간', new Date(F0).toISOString().slice(0, 10), '~', new Date(T1).toISOString().slice(0, 10), '| 김치 프리미엄 중간', (pv[pv.length >> 1] * 100).toFixed(2) + '%', '하위10%', (pv[Math.floor(pv.length * 0.1)] * 100).toFixed(2) + '%', '상위10%', (pv[Math.floor(pv.length * 0.9)] * 100).toFixed(2) + '%', '지금', (PV.at(-1) * 100).toFixed(2) + '%');
const base = run(null); line('류신영 봇 (기준선)', base); const passed = [];
for (const k of Object.keys(SKIP)) { const r = run(SKIP[k]), sk = inW.filter((z) => SKIP[k](z.s, z.t, sg(z))), kp = inW.filter((z) => !SKIP[k](z.s, z.t, sg(z)));
  const pass = r.all.sharpe > base.all.sharpe && r.h1.sharpe >= base.h1.sharpe && r.h2.sharpe >= base.h2.sharpe && sk.length > 0 && avg(sk.map((z) => z.R)) < avg(kp.map((z) => z.R));
  line(NM[k], r, `| 건너뛴 후보 ${sk.length} 평균R ${avg(sk.map((z) => z.R))} vs 남김 ${avg(kp.map((z) => z.R))} ${pass ? '→ 합격' : '→ 불합격'}`); if (pass) passed.push([k, r.all.sharpe, sk]); }
let seed = 41; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
for (const [k, real, sk] of passed) { const res = [], nL = sk.filter((z) => z.side === 'long').length, nS = sk.length - nL, pool = (side) => inW.filter((z) => z.side === side).map((z) => key(z.s, z.t)), PL = pool('long'), PS = pool('short');
  for (let it = 0; it < 200; it++) { const skip = new Set(); const pick = (pl, n) => { let c = 0; while (c < Math.min(n, pl.length)) { const id = pl[Math.floor(rnd() * pl.length)]; if (!skip.has(id)) { skip.add(id); c++; } } }; pick(PL, nL); pick(PS, nS);
    const r = simulate(W, P, deriv, { judge: (s, t) => ({ ok: gbm(s, t) && !skip.has(key(s, t)) }), tA: F0, tB: T1 }); res.push((statsOf(r.equity.filter(([t]) => t >= F0), r.trades, P) || {}).sharpe); }
  res.sort((a, b) => a - b); const pct = Math.round(res.filter((x) => x >= real).length / 2); console.log(NM[k], '실제 샤프', real, '| 무작위 중간', res[100], '상위 5%', res[190], '| 무작위가 실제 이상', pct + '%', pct > 10 ? '→ 우연과 구분 안 됨' : '→ 우연 아님'); }
