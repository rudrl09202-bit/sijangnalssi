// ② 강제청산 폭포 되받기 — 미결제약정 기록이 한 달뿐이라, 청산의 흔적인 '시장가 매도 쏠림'(테이커 매수 비율)으로 대신함. 규칙 미리 고정
// 폭포: 이 봉이 몸통 2.5ATR 넘게 하락 + 거래량 ≥ 평균 3배 + 시장가 매수 비율 ≤ 40%(매도가 압도) → 다음 봉 시가 롱
//   손절: 봉 저점 − 0.5ATR, 목표: 하락 몸통의 50% 되돌림, 최대 보유 6봉(4시간봉) / 16봉(15분봉). 급등 폭포(숏 스퀴즈)는 반대로 숏.
// 4시간봉은 시장가 비율이 덜 흔들려 40%/60% 기준에 거래가 2번뿐 → PCT=1 이면 코인별 하위·상위 5% 기준으로 (전체 기간 분포라 약간 낙관적)
// 사용: node cascade.mjs 4h | 15m   (COST=2 비용 2배)
import { readFileSync } from 'node:fs';
const DIR = process.env.RD || '/tmp/rd', TF = process.argv[2] || '4h', CM = +(process.env.COST ?? 1);
const TAKER = 0.0005 * CM, SLIP_IN = 0.0002 * CM, SLIP_STOP = 0.0005 * CM, M = TF === '4h' ? 6 : 16, MIN = TF === '4h' ? 40 : 100;
function atrOf(d, n = 14) { const o = []; let a = null; for (let i = 0; i < d.c.length; i++) { const tr = i ? Math.max(d.h[i] - d.l[i], Math.abs(d.h[i] - d.c[i - 1]), Math.abs(d.l[i] - d.c[i - 1])) : d.h[i] - d.l[i]; a = a == null ? tr : (a * (n - 1) + tr) / n; o.push(i >= n ? a : null); } return o; }
function sma(a, n) { const o = []; let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; o.push(i >= n - 1 ? s / n : null); } return o; }
const COINS = TF === '4h' ? ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'ADA', 'LINK'] : ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE'], X = {};
for (const s of COINS) { const r = JSON.parse(readFileSync(`${DIR}/${TF === '4h' ? 'k4' : 'k15'}-${s}.json`, 'utf8')); const d = { t: r.t.map(Number), o: r.o, h: r.h, l: r.l, c: r.c, v: r.v, tb: r.tb }; const rr = d.tb.map((b, i) => b / d.v[i]).filter(isFinite).sort((a, b) => a - b); X[s] = { d, atr: atrOf(d), vA: sma(d.v, 20), lo: process.env.PCT ? rr[Math.floor(rr.length * 0.05)] : 0.4, hi: process.env.PCT ? rr[Math.floor(rr.length * 0.95)] : 0.6 }; }
function trade(x, j, g, stop, tp) { const d = x.d, n = d.c.length; if (j + 1 >= n) return null; const e = d.o[j + 1] * (1 + g * SLIP_IN), R = Math.abs(e - stop);
  if (!(R > 0) || (g > 0 ? e <= stop || e >= tp : e >= stop || e <= tp)) return null;
  for (let q = j + 1; q < n; q++) { const o = d.o[q], h = d.h[q], l = d.l[q], c = d.c[q]; let out = null;
    if (q > j + 1 && (g > 0 ? o <= stop : o >= stop)) out = o * (1 - g * SLIP_STOP); else if (g > 0 ? l <= stop : h >= stop) out = stop * (1 - g * SLIP_STOP);
    else if (g > 0 ? h >= tp : l <= tp) out = tp; else if (q - j >= M) out = c * (1 - g * SLIP_IN);
    if (out != null) return { R: (g * (out - e) - (e + out) * TAKER) / R, exitJ: q, t: d.t[j + 1] }; } return null; }
function sig(x, j) { const d = x.d, a = x.atr[j - 1], vA = x.vA[j - 1]; if (!a || !vA || !(d.v[j] > 0)) return null; const body = d.c[j] - d.o[j], buy = d.tb[j] / d.v[j];
  if (-body > 2.5 * a && d.v[j] >= 3 * vA && buy <= x.lo) return { g: 1, stop: d.l[j] - 0.5 * a, tp: d.c[j] - body * 0.5 };
  if (body > 2.5 * a && d.v[j] >= 3 * vA && buy >= x.hi) return { g: -1, stop: d.h[j] + 0.5 * a, tp: d.c[j] - body * 0.5 };
  return null; }
function run(pick) { const out = []; for (const s of COINS) { const x = X[s]; let busy = -1; for (let j = 30; j < x.d.c.length - 1; j++) { if (j <= busy) continue; const sg = pick(x, j); if (!sg) continue; const t = trade(x, j, sg.g, sg.stop, sg.tp); if (!t) continue; out.push({ ...t, s, g: sg.g }); busy = t.exitJ; } } return out.sort((a, b) => a.t - b.t); }
function summ(tr) { const n = tr.length; if (!n) return { n: 0, avgR: 0 }; const gw = tr.filter((z) => z.R > 0).reduce((s, z) => s + z.R, 0), gl = -tr.filter((z) => z.R <= 0).reduce((s, z) => s + z.R, 0); let eq = 1, pk = 1, mdd = 0; tr.forEach((z) => { eq *= 1 + 0.01 * z.R; pk = Math.max(pk, eq); mdd = Math.min(mdd, eq / pk - 1); });
  return { n, win: Math.round(tr.filter((z) => z.R > 0).length / n * 100), avgR: +(tr.reduce((s, z) => s + z.R, 0) / n).toFixed(3), pf: +(gl ? gw / gl : 99).toFixed(2), ret: +((eq - 1) * 100).toFixed(1), mdd: +(mdd * 100).toFixed(1) }; }
const tr = run(sig), A = summ(tr), mid = (tr[0]?.t + tr.at(-1)?.t) / 2, H1 = summ(tr.filter((z) => z.t < mid)), H2 = summ(tr.filter((z) => z.t >= mid));
// 비교: 같은 크기 급락·급등(몸통 2.5ATR + 거래량 3배)인데 매도 쏠림 조건 없이 / 무작위 진입
const noFlow = summ(run((x, j) => { const d = x.d, a = x.atr[j - 1], vA = x.vA[j - 1]; if (!a || !vA) return null; const b = d.c[j] - d.o[j]; if (Math.abs(b) > 2.5 * a && d.v[j] >= 3 * vA) { const g = b < 0 ? 1 : -1; return { g, stop: g > 0 ? d.l[j] - 0.5 * a : d.h[j] + 0.5 * a, tp: d.c[j] - b * 0.5 }; } return null; }));
let seed = 11; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648); const p = tr.length / COINS.reduce((s, c) => s + X[c].d.c.length, 0), rs = [];
for (let k = 0; k < 200; k++) rs.push(summ(run((x, j) => { if (rnd() > p * 1.3 || !x.atr[j]) return null; const g = rnd() < 0.5 ? 1 : -1, w = (1 + rnd()) * x.atr[j], e = x.d.c[j]; return { g, stop: e - g * w, tp: e + g * w * 0.9 }; })).avgR);
rs.sort((a, b) => a - b);
console.log(JSON.stringify({ TF, cost: CM, all: A, long: summ(tr.filter((z) => z.g > 0)), short: summ(tr.filter((z) => z.g < 0)), h1: H1, h2: H2, 쏠림조건없이: noFlow, rand: { median: rs[100], p95: rs[189] },
  pass: { avgR: A.avgR > 0, pf: A.pf >= 1.3, halves: H1.avgR > 0 && H2.avgR > 0, n: A.n >= MIN, rand: A.avgR > rs[189] } }));
