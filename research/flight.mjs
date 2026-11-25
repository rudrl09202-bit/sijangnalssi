// 플라이트 매매법 → 기계 규칙으로 바꿔 시험 (수수료 0.05%×2 + 미끄러짐 포함, 거래당 위험 1% 순차 복리로 비교)
// 사용: node flight.mjs 4h   (바이낸스 4시간봉 2019~ 8코인)   |   node flight.mjs 1h  (15분봉→1시간봉 약 18개월 5코인)
import { readFileSync } from 'node:fs';
const DIR = process.env.RD || '/tmp/rd', TF = process.argv[2] || '4h';
const TAKER = 0.0005, SLIP_IN = 0.0002, SLIP_STOP = 0.0005;
const ema = (a, n) => { const k = 2 / (n + 1), o = []; let e = null; a.forEach((x, i) => { e = e == null ? x : x * k + e * (1 - k); o.push(i >= n ? e : null); }); return o; };
function atrOf(d, n = 14) { const o = []; let a = null; for (let i = 0; i < d.c.length; i++) { const tr = i ? Math.max(d.h[i] - d.l[i], Math.abs(d.h[i] - d.c[i - 1]), Math.abs(d.l[i] - d.c[i - 1])) : d.h[i] - d.l[i]; a = a == null ? tr : (a * (n - 1) + tr) / n; o.push(i >= n ? a : null); } return o; }
function rsiOf(c, n = 14) { const o = [null]; let up = 0, dn = 0; for (let i = 1; i < c.length; i++) { const ch = c[i] - c[i - 1]; up = (up * (n - 1) + Math.max(ch, 0)) / n; dn = (dn * (n - 1) + Math.max(-ch, 0)) / n; o.push(i > n ? 100 - 100 / (1 + up / (dn || 1e-12)) : null); } return o; }
function sma(a, n) { const o = []; let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; o.push(i >= n - 1 ? s / n : null); } return o; }
function agg(d, k) { const o = { t: [], o: [], h: [], l: [], c: [], v: [] }; for (let i = 0; i + k <= d.t.length; i++) { if (new Date(d.t[i]).getTime() % (k * 9e5) !== 0) continue; let h = -Infinity, l = Infinity, v = 0; for (let j = i; j < i + k; j++) { h = Math.max(h, d.h[j]); l = Math.min(l, d.l[j]); v += d.v[j]; } o.t.push(d.t[i]); o.o.push(d.o[i]); o.h.push(h); o.l.push(l); o.c.push(d.c[i + k - 1]); o.v.push(v); i += k - 1; } return o; }

const COINS = TF === '4h' ? ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'ADA', 'LINK'] : ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE'];
const X = {};
for (const s of COINS) {
  const r = JSON.parse(readFileSync(`${DIR}/${TF === '4h' ? 'k4' : 'k15'}-${s}.json`, 'utf8')); let d = { t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v };
  if (TF === '1h') d = agg(d, 4);
  X[s] = { d, atr: atrOf(d), rsi: rsiOf(d.c), e50: ema(d.c, 50), e200: ema(d.c, 200), vA: sma(d.v, 20) };
}

// 한 거래: j봉 종가에 판단 → j+1 시가 진입. sig = { g, stop(가격), tp(가격|null), max(봉), exitFn(q)→bool }
function trade(x, j, sig) {
  const d = x.d, n = d.c.length, g = sig.g; if (j + 1 >= n) return null;
  const e = d.o[j + 1] * (1 + g * SLIP_IN), R = Math.abs(e - sig.stop); if (!(R > 0) || R / e > 0.25) return null;
  for (let q = j + 1; q < n; q++) {
    const o = d.o[q], h = d.h[q], l = d.l[q], c = d.c[q];
    let out = null;
    if (q > j + 1 && (g > 0 ? o <= sig.stop : o >= sig.stop)) out = o * (1 - g * SLIP_STOP);
    else if (g > 0 ? l <= sig.stop : h >= sig.stop) out = sig.stop * (1 - g * SLIP_STOP);
    else if (sig.tp != null && (g > 0 ? h >= sig.tp : l <= sig.tp)) out = sig.tp;
    else if ((sig.exitFn && sig.exitFn(q)) || q - j >= sig.max) out = c * (1 - g * SLIP_IN);
    if (out != null) { const fee = (e + out) * TAKER; return { R: (g * (out - e) - fee) / R, exitJ: q, t: d.t[j + 1], moveR: R / e }; }
  }
  return null;
}

/* ---------- 플라이트 규칙 ---------- */
const RULES = {
  // ① RSI 70 이상 과매수 → 숏 (글 그대로) / 대칭으로 30 이하 롱도
  '① RSI 과매수 숏 (70↑)': (x, j) => { if (!(x.rsi[j] > 70 && x.rsi[j - 1] <= 70)) return null; const a = x.atr[j], c = x.d.c[j]; return { g: -1, stop: c + 2 * a, tp: c - 2 * a, max: 12, exitFn: (q) => x.rsi[q] < 50 }; },
  '① RSI 과매수 숏 + 과매도 롱': (x, j) => { const a = x.atr[j], c = x.d.c[j]; if (x.rsi[j] > 70 && x.rsi[j - 1] <= 70) return { g: -1, stop: c + 2 * a, tp: c - 2 * a, max: 12, exitFn: (q) => x.rsi[q] < 50 }; if (x.rsi[j] < 30 && x.rsi[j - 1] >= 30) return { g: 1, stop: c - 2 * a, tp: c + 2 * a, max: 12, exitFn: (q) => x.rsi[q] > 50 }; return null; },
  // ③ 추세선(50EMA) 지지에서 거래량 늘며 반등 → 롱 / 하락추세 저항에서 거래량 실린 거절 → 숏
  '③ 추세선 지지 + 거래량 증가': (x, j) => { const d = x.d, a = x.atr[j]; if (!x.e200[j]) return null; const vUp = d.v[j] > 1.2 * x.vA[j];
    if (x.e50[j] > x.e200[j] && d.l[j] <= x.e50[j] + 0.3 * a && d.c[j] > x.e50[j] && d.c[j] > d.o[j] && vUp) return { g: 1, stop: Math.min(d.l[j], x.e50[j]) - a, tp: null, max: 30, exitFn: (q) => d.c[q] < x.e50[q] - a };
    if (x.e50[j] < x.e200[j] && d.h[j] >= x.e50[j] - 0.3 * a && d.c[j] < x.e50[j] && d.c[j] < d.o[j] && vUp) return { g: -1, stop: Math.max(d.h[j], x.e50[j]) + a, tp: null, max: 30, exitFn: (q) => d.c[q] > x.e50[q] + a };
    return null; },
  // ③-2 거래량 줄며 약한 반등 → 숏 (3봉 연속 상승인데 거래량은 계속 줄고 평균 아래)
  '③ 거래량 감소 약한 반등 → 숏': (x, j) => { const d = x.d, a = x.atr[j]; if (j < 4) return null;
    const up3 = d.c[j] > d.c[j - 1] && d.c[j - 1] > d.c[j - 2] && d.c[j - 2] > d.c[j - 3], vDn = d.v[j] < d.v[j - 1] && d.v[j - 1] < d.v[j - 2] && d.v[j] < x.vA[j];
    if (up3 && vDn && (d.c[j] - d.c[j - 3]) < 2 * a) return { g: -1, stop: d.h[j] + a, tp: d.c[j] - 2 * a, max: 12 }; return null; },
  // ④ 프랙탈(비슷한 과거 모양): 최근 16봉 모양과 가장 닮은 과거 20곳의 다음 6봉 방향이 70% 이상 같으면 그쪽
  '④ 프랙탈 (닮은 과거 패턴)': (x, j) => {
    const W = 16, H = 6, d = x.d; if (j < 400 || j % 3) return null;
    if (!x.lr) x.lr = d.c.map((c, i) => (i ? Math.log(c / d.c[i - 1]) : 0));
    const cur = x.lr.slice(j - W + 1, j + 1), m = cur.reduce((s, v) => s + v, 0) / W, sd = Math.sqrt(cur.reduce((s, v) => s + (v - m) ** 2, 0) / W) || 1e-9, cz = cur.map((v) => (v - m) / sd);
    const best = [];
    for (let k = W; k + H < j - H; k += 2) { // 과거 창 (미래 6봉까지 이미 끝난 것만)
      let mm = 0; for (let i = 0; i < W; i++) mm += x.lr[k - W + 1 + i]; mm /= W; let ss = 0; for (let i = 0; i < W; i++) ss += (x.lr[k - W + 1 + i] - mm) ** 2; ss = Math.sqrt(ss / W) || 1e-9;
      let cor = 0; for (let i = 0; i < W; i++) cor += cz[i] * (x.lr[k - W + 1 + i] - mm) / ss; cor /= W;
      if (best.length < 20 || cor > best[best.length - 1][0]) { best.push([cor, Math.log(d.c[k + H] / d.c[k])]); best.sort((a, b) => b[0] - a[0]); if (best.length > 20) best.pop(); }
    }
    const upN = best.filter((b) => b[1] > 0).length, a = x.atr[j], c = d.c[j];
    if (upN >= 14) return { g: 1, stop: c - 2 * a, tp: null, max: H }; if (upN <= 6) return { g: -1, stop: c + 2 * a, tp: null, max: H }; return null; },
  // ⑤ VPVR 매물대: 최근 120봉 거래량 분포에서 두꺼운 가격대(상위 20%)에 닿고 지지(종가가 위) → 롱 / 저항(종가가 아래) → 숏
  '⑤ VPVR 매물대 지지·저항': (x, j) => { const d = x.d, N = 120, B = 40; if (j < N + 5) return null;
    let lo = Infinity, hi = -Infinity; for (let q = j - N; q < j; q++) { lo = Math.min(lo, d.l[q]); hi = Math.max(hi, d.h[q]); }
    const bw = (hi - lo) / B; if (!(bw > 0)) return null; const vol = new Array(B).fill(0);
    for (let q = j - N; q < j; q++) { const b = Math.min(B - 1, Math.floor(((d.h[q] + d.l[q] + d.c[q]) / 3 - lo) / bw)); vol[b] += d.v[q]; }
    const thr = [...vol].sort((a, b) => b - a)[Math.floor(B * 0.2)], a = x.atr[j];
    const bin = (p) => Math.floor((p - lo) / bw), hv = (b) => b >= 0 && b < B && vol[b] >= thr;
    const bl = bin(d.l[j]), bh = bin(d.h[j]);
    if (hv(bl) && d.c[j] > lo + (bl + 1) * bw && d.c[j] > d.o[j]) return { g: 1, stop: lo + bl * bw - a, tp: d.c[j] + 2.5 * a, max: 12 };
    if (hv(bh) && d.c[j] < lo + bh * bw && d.c[j] < d.o[j]) return { g: -1, stop: lo + (bh + 1) * bw + a, tp: d.c[j] - 2.5 * a, max: 12 };
    return null; },
  // ⑤ 채널: 최근 50봉 회귀 채널 ±2σ — 위쪽 닿고 안으로 → 숏, 아래쪽 → 롱, 목표 가운데선
  '⑤ 채널 상단 숏·하단 롱': (x, j) => { const d = x.d, N = 50; if (j < N) return null;
    let sx = 0, sy = 0, sxy = 0, sxx = 0; for (let i = 0; i < N; i++) { const y = d.c[j - N + 1 + i]; sx += i; sy += y; sxy += i * y; sxx += i * i; }
    const b = (N * sxy - sx * sy) / (N * sxx - sx * sx), a0 = (sy - b * sx) / N; let ss = 0; for (let i = 0; i < N; i++) ss += (d.c[j - N + 1 + i] - (a0 + b * i)) ** 2; const sd = Math.sqrt(ss / N), mid = a0 + b * (N - 1), A = x.atr[j];
    if (d.h[j] >= mid + 2 * sd && d.c[j] < mid + 2 * sd && d.c[j] < d.o[j]) return { g: -1, stop: d.h[j] + A, tp: mid, max: 12 };
    if (d.l[j] <= mid - 2 * sd && d.c[j] > mid - 2 * sd && d.c[j] > d.o[j]) return { g: 1, stop: d.l[j] - A, tp: mid, max: 12 };
    return null; },
  // ⑥ 역추세: 거래량 3배 장대 음봉(몸통 2.5ATR↑) 뒤 반등 롱 — 목표는 음봉 절반 되돌림
  '⑥ 거래량 급락 뒤 반등 롱': (x, j) => { const d = x.d, a = x.atr[j - 1]; if (!a || !x.vA[j - 1]) return null;
    if (d.o[j] - d.c[j] > 2.5 * a && d.v[j] > 3 * x.vA[j - 1]) return { g: 1, stop: d.l[j] - 0.5 * a, tp: d.c[j] + (d.o[j] - d.c[j]) * 0.5, max: 6 }; return null; },
};

function runRule(fn) { const out = []; for (const s of COINS) { const x = X[s]; let busy = -1; for (let j = 210; j < x.d.c.length - 1; j++) { if (j <= busy || !x.atr[j]) continue; const sg = fn(x, j); if (!sg) continue; const t = trade(x, j, sg); if (!t) continue; out.push({ ...t, s, g: sg.g }); busy = t.exitJ; } } return out.sort((a, b) => a.t - b.t); }
function summ(tr) { const n = tr.length; if (!n) return { n: 0 }; const gw = tr.filter((z) => z.R > 0).reduce((s, z) => s + z.R, 0), gl = -tr.filter((z) => z.R <= 0).reduce((s, z) => s + z.R, 0); let eq = 1, pk = 1, mdd = 0; tr.forEach((z) => { eq *= 1 + 0.01 * z.R; pk = Math.max(pk, eq); mdd = Math.min(mdd, eq / pk - 1); });
  return { n, win: Math.round(tr.filter((z) => z.R > 0).length / n * 100), avgR: +(tr.reduce((s, z) => s + z.R, 0) / n).toFixed(3), pf: +(gl ? gw / gl : 99).toFixed(2), ret: +((eq - 1) * 100).toFixed(1), mdd: +(mdd * 100).toFixed(1) }; }
const T0 = Math.min(...COINS.map((s) => X[s].d.t[210])), T1 = Math.max(...COINS.map((s) => X[s].d.t.at(-1))), mid = (T0 + T1) / 2;
console.log(TF, new Date(T0).toISOString().slice(0, 10), '~', new Date(T1).toISOString().slice(0, 10), COINS.length + '코인');
const ALL = {};
for (const [name, fn] of Object.entries(RULES)) { const t0 = Date.now(), tr = runRule(fn), a = summ(tr), h1 = summ(tr.filter((z) => z.t < mid)), h2 = summ(tr.filter((z) => z.t >= mid)); ALL[name] = tr;
  console.log(name.padEnd(26), '거래', String(a.n).padStart(4), '승률', a.win + '%', '평균R', a.avgR, 'PF', a.pf, '수익', a.ret + '%', '낙폭', a.mdd + '%', '| 앞', h1.avgR, h1.ret + '%', '| 뒤', h2.avgR, h2.ret + '%', h1.avgR > 0 && h2.avgR > 0 ? '✓ 둘 다 플러스' : '', (Date.now() - t0) + 'ms'); }
export { ALL, X, COINS, RULES, trade, runRule };
