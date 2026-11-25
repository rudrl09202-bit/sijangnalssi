// [사후 발견] 용수철(되돌림)의 정반대 = '상대 모멘텀': 두 코인 비율이 크게 벌어지면 벌어진 쪽으로 따라감 (손절 없음, z 0 복귀·5일)
// 용수철 시험이 크게 손실이라 뒤집어 본 것 → 결과를 보고 만든 규칙이므로 무작위 검사 + 실시간 모의로 따로 확인해야 함
//  스프레드 s = ln(A) − β·ln(B)  (β 는 지난 30일(180봉) 회귀로 매 봉 다시 계산 → 미래 정보 없음)
//  z = (s − 20일 평균) / 20일 표준편차. |z| > 2 이면 비싼 쪽 숏 + 싼 쪽 롱 (금액 같게, β 반영)
//  청산: z 가 0 을 지나면(제자리 복귀) · |z| > 4 면 손절(용수철이 끊어짐) · 최대 5일(30봉)
//  OU 반감기(지난 20일 AR(1)로 추정)가 1~10일이 아니면 진입 안 함 (되돌아오는 힘이 없는 구간 제외)
//  비용: 다리 2개 × 진입·청산 = 수수료 0.05%×4 + 미끄러짐 0.02%×4, 펀딩비 실제값
// 사용: node research/spring.mjs [데이터폴더]   (k4-*.json, deriv.json)
import { readFileSync } from 'node:fs';
const DIR = process.argv[2] || process.env.RD || '/tmp/rd', DAY = 864e5;
const COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'ADA', 'LINK'];
const SHUF = process.env.SHUF ? +process.env.SHUF : 0; // 무작위 검사: 같은 순서로 봉을 섞음(두 코인의 상관은 유지, 시간 구조만 파괴)
let deriv = null; try { deriv = JSON.parse(readFileSync(DIR + '/deriv.json', 'utf8')); } catch (e) { /* 없으면 기본 펀딩 */ }
const fund = (s, t) => { const f = deriv && deriv.coins[s] && deriv.coins[s].f; if (!f || t < f[0][0]) return 0.0001; let lo = 0, hi = f.length - 1, k = 0; while (lo <= hi) { const m = (lo + hi) >> 1; if (f[m][0] <= t) { k = m; lo = m + 1; } else hi = m - 1; } return f[k][1]; };
const raw = {}; for (const s of COINS) raw[s] = JSON.parse(readFileSync(`${DIR}/k4-${s}.json`, 'utf8'));
// 공통 시간축
const T = raw.BTC.t.filter((t) => COINS.every((s) => raw[s].t.includes ? true : true));
const idx = {}; COINS.forEach((s) => { idx[s] = new Map(raw[s].t.map((t, i) => [t, i])); });
const Tall = raw.BTC.t;
let perm = null;
if (SHUF) { let seed = SHUF; const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296); perm = [...Array(Tall.length - 1).keys()].map((i) => i + 1); for (let i = perm.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; } }
// 각 코인 종가 (BTC 시간축 기준, 없으면 null). 섞기 모드면 같은 순서로 로그수익을 재배열
const C = {}; for (const s of COINS) { const r = raw[s], m = idx[s]; let a = Tall.map((t) => { const i = m.get(t); return i == null ? null : r.c[i]; });
  if (perm) { const lr = a.map((v, i) => (i && v && a[i - 1] ? Math.log(v / a[i - 1]) : null)); const out = [a.find((v) => v) || 1]; perm.forEach((k) => { out.push(out[out.length - 1] * Math.exp(lr[k] || 0)); }); a = out; } // 빠진 구간은 수익 0 으로 (섞기 검사 전용)
  C[s] = a; }

const P0 = { betaN: 180, zN: 120, zIn: 2, zStop: 4, maxBars: 30, hlMin: 6, hlMax: 60, taker: 0.0005, slip: 0.0002, lev: 1 };
function pairTrades(A, B, P) {
  const a = C[A], b = C[B], n = Tall.length, tr = []; let pos = null;
  const la = a.map((v) => (v ? Math.log(v) : null)), lb = b.map((v) => (v ? Math.log(v) : null));
  const beta = (i) => { let sx = 0, sy = 0, sxx = 0, sxy = 0, k = 0; for (let j = i - P.betaN + 1; j <= i; j++) { if (la[j] == null || lb[j] == null) return null; const x = lb[j], y = la[j]; sx += x; sy += y; sxx += x * x; sxy += x * y; k++; } const d = k * sxx - sx * sx; return d ? (k * sxy - sx * sy) / d : null; };
  for (let i = P.betaN + P.zN; i < n - 1; i++) {
    if (la[i] == null || lb[i] == null || la[i + 1] == null) { continue; }
    const be = pos ? pos.beta : beta(i); if (be == null || be <= 0) continue;
    const S = []; for (let j = i - P.zN + 1; j <= i; j++) { if (la[j] == null || lb[j] == null) { S.length = 0; break; } S.push(la[j] - be * lb[j]); } if (S.length < P.zN) continue;
    const m = S.reduce((x, y) => x + y, 0) / S.length, sd = Math.sqrt(S.reduce((x, y) => x + (y - m) ** 2, 0) / S.length); if (!sd) continue; const z = (S.at(-1) - m) / sd;
    if (pos) {
      const bars = i - pos.i0, done = (pos.g > 0 ? z <= 0 : z >= 0), stop = false;
      if (done || stop || bars >= P.maxBars) { // 판단은 이 봉 종가, 실제 청산은 다음 봉 종가 (4시간 늦게 — 보수적)
        const pa = a[i + 1], pb = b[i + 1]; if (!pa || !pb) continue;
        const ra = Math.log(pa / pos.pa), rb = Math.log(pb / pos.pb), wA = 1 / (1 + pos.beta), wB = pos.beta / (1 + pos.beta);
        const gross = pos.g * (wA * (Math.exp(ra) - 1) - wB * (Math.exp(rb) - 1));
        let f = 0; for (let j = pos.i0 + 1; j <= i; j++) if (new Date(Tall[j]).getUTCHours() % 8 === 0) f += pos.g * (wA * fund(A, Tall[j]) - wB * fund(B, Tall[j]));
        const cost = 2 * (P.taker + P.slip); // 진입·청산 각각 두 다리(가중합=1)
        tr.push({ t: Tall[pos.i0 + 1], t1: Tall[i + 1], r: P.lev * (gross - cost - f), why: stop ? '손절' : done ? '복귀' : '시간', pair: A + '/' + B });
        pos = null; continue;
      }
    } else if (Math.abs(z) > P.zIn && Math.abs(z) < P.zStop) {
      // OU 반감기: Δs = κ(μ − s) → AR(1) 기울기
      let sx = 0, sy = 0, sxx = 0, sxy = 0; for (let j = 1; j < S.length; j++) { const x = S[j - 1], y = S[j] - S[j - 1]; sx += x; sy += y; sxx += x * x; sxy += x * y; } const k = S.length - 1, sl = (k * sxy - sx * sy) / (k * sxx - sx * sx), hl = sl < 0 ? Math.log(2) / -sl : Infinity;
      if (hl < P.hlMin || hl > P.hlMax) continue;
      if (!a[i + 1] || !b[i + 1]) continue; pos = { g: z > 0 ? 1 : -1, i0: i, pa: a[i + 1], pb: b[i + 1], beta: be }; // 진입도 다음 봉 종가 // z>0: A가 비쌈 → A 숏, B 롱 (g=-1)
    }
  }
  return tr;
}
function book(trades, cap = 3) { // 동시 최대 cap 쌍, 각 쌍에 자산의 1/cap
  const ev = trades.slice().sort((x, y) => x.t - y.t); const open = []; let eq = 1; const curve = [[Tall[0], 1]], taken = [];
  for (const z of ev) { for (let k = open.length - 1; k >= 0; k--) if (open[k].t1 <= z.t) { eq *= 1 + open[k].r / cap; curve.push([open[k].t1, eq]); taken.push(open[k]); open.splice(k, 1); } if (open.length < cap && !open.some((o) => o.pair === z.pair)) open.push(z); }
  open.forEach((o) => { eq *= 1 + o.r / cap; curve.push([o.t1, eq]); taken.push(o); });
  curve.sort((x, y) => x[0] - y[0]); return { curve, taken };
}
function stats(curve, taken, a = -Infinity, b = Infinity) {
  const c = curve.filter(([t]) => t >= a && t < b); if (c.length < 5) return { n: 0 };
  const d = new Map(); c.forEach(([t, v]) => d.set(Math.floor(t / DAY), v)); const ks = [...d.keys()].sort((x, y) => x - y), first = ks[0], last = ks.at(-1); const daily = []; let v = d.get(first); for (let k = first; k <= last; k++) { if (d.has(k)) v = d.get(k); daily.push(v); }
  const r = daily.slice(1).map((x, i) => x / daily[i] - 1), m = r.reduce((x, y) => x + y, 0) / r.length, sd = Math.sqrt(r.reduce((x, y) => x + (y - m) ** 2, 0) / r.length); let pk = 0, mdd = 0; daily.forEach((x) => { pk = Math.max(pk, x); mdd = Math.min(mdd, x / pk - 1); });
  const tk = taken.filter((z) => z.t >= a && z.t < b), gw = tk.filter((z) => z.r > 0).reduce((x, z) => x + z.r, 0), gl = -tk.filter((z) => z.r <= 0).reduce((x, z) => x + z.r, 0), yrs = (last - first) / 365.25;
  return { n: tk.length, ret: +((daily.at(-1) / daily[0] - 1) * 100).toFixed(1), cagr: +((Math.pow(daily.at(-1) / daily[0], 1 / Math.max(yrs, 0.1)) - 1) * 100).toFixed(1), mdd: +(mdd * 100).toFixed(1), sharpe: +(sd ? m / sd * Math.sqrt(365.25) : 0).toFixed(2), pf: +(gl ? gw / gl : 0).toFixed(2), win: Math.round(tk.filter((z) => z.r > 0).length / (tk.length || 1) * 100), daily: d };
}
const T0 = Tall[400], T1 = Tall.at(-1) + 1, mid = (T0 + T1) / 2;
const show = (name, tr, cap) => { const B = book(tr, cap), a = stats(B.curve, B.taken, T0, T1), h1 = stats(B.curve, B.taken, T0, mid), h2 = stats(B.curve, B.taken, mid, T1);
  console.log(name.padEnd(30), '거래', a.n, '승률', a.win + '%', 'PF', a.pf, '연', a.cagr + '%', '낙폭', a.mdd + '%', '샤프', a.sharpe, '| 앞', h1.ret + '%', '뒤', h2.ret + '%', h1.ret > 0 && h2.ret > 0 ? '✓' : ''); return { B, a }; };
console.log((SHUF ? '[무작위 섞기 ' + SHUF + '] ' : '') + '기간', new Date(T0).toISOString().slice(0, 10), '~', new Date(T1).toISOString().slice(0, 10));
const btceth = pairTrades('ETH', 'BTC', P0);
const R1 = show('(반대) BTC·ETH 벌어지는 쪽', btceth, 1);
show('BTC·ETH · 비용 2배', pairTrades('ETH', 'BTC', { ...P0, taker: 0.001, slip: 0.0004 }), 1);
show('BTC·ETH · 반감기 필터 없음', pairTrades('ETH', 'BTC', { ...P0, hlMin: 0, hlMax: Infinity }), 1);
const pairs = []; for (let i = 0; i < COINS.length; i++) for (let j = i + 1; j < COINS.length; j++) pairs.push([COINS[j], COINS[i]]);
const all = pairs.flatMap(([A, B]) => pairTrades(A, B, P0));
const R2 = show('(반대) 28쌍', all, 3);
show('28쌍 · 비용 2배', pairs.flatMap(([A, B]) => pairTrades(A, B, { ...P0, taker: 0.001, slip: 0.0004 })), 3);
const per = pairs.map(([A, B]) => { const t = pairTrades(A, B, P0); const s = t.reduce((x, z) => x + z.r, 0); return [A + '/' + B, t.length, +(s * 100).toFixed(1)]; }).sort((x, y) => y[2] - x[2]);
console.log('쌍별 합계 수익%(상위5·하위5):', JSON.stringify(per.slice(0, 5)), JSON.stringify(per.slice(-5)));
export { R1, R2, T0, T1 };

// 류신영 봇과 섞기 (BTC·ETH 상대 모멘텀 반 + 류신영 반)
if (!SHUF) {
  const { prepareRS, simulate, RCFG } = await import('../connect/rs.mjs');
  const ser = {}; for (const s of COINS) ser[s] = { t: raw[s].t, o: raw[s].o, h: raw[s].h, l: raw[s].l, c: raw[s].c, v: raw[s].v };
  const W = prepareRS(ser), F = Date.parse('2021-05-01'), rr = simulate(W, RCFG, deriv, { tA: F });
  const dRS = new Map(); rr.equity.forEach(([t, v]) => dRS.set(Math.floor(t / DAY), v));
  const dSP = R1.a.daily, ks = [...dRS.keys()].filter((k) => k >= Math.floor(F / DAY) && dRS.has(k - 1)).sort((a, b) => a - b);
  let lastSp = 1; const sp = (k) => { if (dSP.has(k)) lastSp = dSP.get(k); return lastSp; }; ks.forEach((k) => sp(k - 1));
  const ra = [], rb = []; let pa = null; lastSp = 1; for (const k of ks) { const a = dRS.get(k) / dRS.get(k - 1) - 1; const prev = sp(k - 1), cur = sp(k); ra.push(a); rb.push(cur / prev - 1); }
  const st = (r) => { const m = r.reduce((x, y) => x + y, 0) / r.length, sd = Math.sqrt(r.reduce((x, y) => x + (y - m) ** 2, 0) / r.length); let v = 1, pk = 1, mdd = 0; r.forEach((x) => { v *= 1 + x; pk = Math.max(pk, v); mdd = Math.min(mdd, v / pk - 1); }); return { sharpe: +(m / sd * Math.sqrt(365.25)).toFixed(2), cagr: +((Math.pow(v, 365.25 / r.length) - 1) * 100).toFixed(1), mdd: +(mdd * 100).toFixed(1) }; };
  const ma = ra.reduce((x, y) => x + y, 0) / ra.length, mb = rb.reduce((x, y) => x + y, 0) / rb.length, cor = ra.reduce((x, v, i) => x + (v - ma) * (rb[i] - mb), 0) / Math.sqrt(ra.reduce((x, v) => x + (v - ma) ** 2, 0) * rb.reduce((x, v) => x + (v - mb) ** 2, 0));
  console.log('2021-05~ 류신영 혼자', JSON.stringify(st(ra)), '· BTC·ETH 상대모멘텀 혼자', JSON.stringify(st(rb)), '· 반반', JSON.stringify(st(ra.map((x, i) => (x + rb[i]) / 2))), '· 하루 수익 상관', cor.toFixed(2));
}
