// ① 손절 털기(스톱 헌팅) 되받기 — 규칙은 결과 보기 전에 고정
// 최근 N봉 저점을 꼬리로 0.1ATR 넘게 뚫고 → 그 봉이 저점 위에서 마감 + 봉의 위쪽 절반에서 마감 + 거래량 ≥ 평균 2배 → 다음 봉 시가 롱
// 손절: 꼬리 끝 − 0.2ATR, 목표: 2R, 최대 보유 M봉. 고점 쪽은 반대(숏). 수수료 0.05%×2 + 미끄러짐.
// 사용: node sweep.mjs 4h | 15m   (COST=2 로 비용 2배)
import { readFileSync } from 'node:fs';
const DIR = process.env.RD || '/tmp/rd', TF = process.argv[2] || '4h', CM = +(process.env.COST || 1);
const TAKER = 0.0005 * CM, SLIP_IN = 0.0002 * CM, SLIP_STOP = 0.0005 * CM;
const P = TF === '4h' ? { N: 20, M: 12, minTr: 40 } : { N: 48, M: 32, minTr: 100 };
function atrOf(d, n = 14) { const o = []; let a = null; for (let i = 0; i < d.c.length; i++) { const tr = i ? Math.max(d.h[i] - d.l[i], Math.abs(d.h[i] - d.c[i - 1]), Math.abs(d.l[i] - d.c[i - 1])) : d.h[i] - d.l[i]; a = a == null ? tr : (a * (n - 1) + tr) / n; o.push(i >= n ? a : null); } return o; }
function sma(a, n) { const o = []; let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; o.push(i >= n - 1 ? s / n : null); } return o; }
const COINS = TF === '4h' ? ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'ADA', 'LINK'] : ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE'];
const X = {};
for (const s of COINS) { const r = JSON.parse(readFileSync(`${DIR}/${TF === '4h' ? 'k4' : 'k15'}-${s}.json`, 'utf8')); const d = { t: r.t.map((t) => +new Date(t)), o: r.o, h: r.h, l: r.l, c: r.c, v: r.v };
  const lo = [], hi = []; for (let j = 0; j < d.c.length; j++) { let a = Infinity, b = -Infinity; for (let q = Math.max(0, j - P.N); q < j; q++) { a = Math.min(a, d.l[q]); b = Math.max(b, d.h[q]); } lo.push(a); hi.push(b); }
  X[s] = { d, atr: atrOf(d), vA: sma(d.v, 20), lo, hi }; }
function trade(x, j, g, stop) { const d = x.d, n = d.c.length; if (j + 1 >= n) return null;
  const e = d.o[j + 1] * (1 + g * SLIP_IN), R = Math.abs(e - stop); if (!(R > 0) || (g > 0 ? e <= stop : e >= stop) || R / e > 0.15) return null; const tp = e + g * 2 * R;
  for (let q = j + 1; q < n; q++) { const o = d.o[q], h = d.h[q], l = d.l[q], c = d.c[q]; let out = null;
    if (q > j + 1 && (g > 0 ? o <= stop : o >= stop)) out = o * (1 - g * SLIP_STOP);
    else if (g > 0 ? l <= stop : h >= stop) out = stop * (1 - g * SLIP_STOP);
    else if (g > 0 ? h >= tp : l <= tp) out = tp;
    else if (q - j >= P.M) out = c * (1 - g * SLIP_IN);
    if (out != null) return { R: (g * (out - e) - (e + out) * TAKER) / R, exitJ: q, t: d.t[j + 1] }; } return null; }
function sig(x, j) { const d = x.d, a = x.atr[j]; if (!a || !x.vA[j - 1] || !isFinite(x.lo[j])) return null; const rng = d.h[j] - d.l[j]; if (!(rng > 0)) return null; const vOk = d.v[j] >= 2 * x.vA[j - 1];
  if (vOk && d.l[j] < x.lo[j] - 0.1 * a && d.c[j] > x.lo[j] && d.c[j] > d.l[j] + 0.5 * rng) return { g: 1, stop: d.l[j] - 0.2 * a };
  if (vOk && d.h[j] > x.hi[j] + 0.1 * a && d.c[j] < x.hi[j] && d.c[j] < d.h[j] - 0.5 * rng) return { g: -1, stop: d.h[j] + 0.2 * a };
  return null; }
function run(pick) { const out = []; for (const s of COINS) { const x = X[s]; let busy = -1; for (let j = 60; j < x.d.c.length - 1; j++) { if (j <= busy) continue; const sg = pick(x, j); if (!sg) continue; const t = trade(x, j, sg.g, sg.stop); if (!t) continue; out.push({ ...t, s, g: sg.g }); busy = t.exitJ; } } return out.sort((a, b) => a.t - b.t); }
function summ(tr) { const n = tr.length; if (!n) return { n: 0, avgR: 0 }; const gw = tr.filter((z) => z.R > 0).reduce((s, z) => s + z.R, 0), gl = -tr.filter((z) => z.R <= 0).reduce((s, z) => s + z.R, 0); let eq = 1, pk = 1, mdd = 0; tr.forEach((z) => { eq *= 1 + 0.01 * z.R; pk = Math.max(pk, eq); mdd = Math.min(mdd, eq / pk - 1); });
  return { n, win: Math.round(tr.filter((z) => z.R > 0).length / n * 100), avgR: +(tr.reduce((s, z) => s + z.R, 0) / n).toFixed(3), pf: +(gl ? gw / gl : 99).toFixed(2), ret: +((eq - 1) * 100).toFixed(1), mdd: +(mdd * 100).toFixed(1) }; }
const tr = run(sig), A = summ(tr), mid = (tr[0]?.t + tr.at(-1)?.t) / 2, H1 = summ(tr.filter((z) => z.t < mid)), H2 = summ(tr.filter((z) => z.t >= mid));
// 무작위 비교: 같은 코인·같은 방향 비율·같은 손절 폭(ATR 기준)으로 아무 봉에서나 진입 200번
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const p = tr.length / COINS.reduce((s, c) => s + X[c].d.c.length, 0), longP = tr.filter((z) => z.g > 0).length / (tr.length || 1); const rs = [];
for (let k = 0; k < 200; k++) { const rt = run((x, j) => { if (rnd() > p * 1.6 || !x.atr[j]) return null; const g = rnd() < longP ? 1 : -1, w = (0.7 + rnd()) * x.atr[j]; return { g, stop: x.d.o[j + 1] - g * w }; }); rs.push(summ(rt).avgR); }
rs.sort((a, b) => a - b); const p95 = rs[189], beat = rs.filter((r) => r < A.avgR).length / 2;
const by = {}; for (const z of tr) (by[z.s] ||= []).push(z);
console.log(JSON.stringify({ TF, cost: CM, from: new Date(tr[0]?.t).toISOString().slice(0, 10), to: new Date(tr.at(-1)?.t).toISOString().slice(0, 10), all: A, long: summ(tr.filter((z) => z.g > 0)), short: summ(tr.filter((z) => z.g < 0)), h1: H1, h2: H2, rand: { median: rs[100], p95, beatPct: beat }, perCoin: Object.fromEntries(Object.entries(by).map(([s, v]) => [s, summ(v).avgR])),
  pass: { avgR: A.avgR > 0, pf: A.pf >= 1.3, halves: H1.avgR > 0 && H2.avgR > 0, n: A.n >= P.minTr, rand: A.avgR > p95 } }, null, 1));
