// 소수 시간 간격 시험: 류신영 봇 규칙(학습 필터 없이, 규칙만)을 1~13시간 봉에 똑같이 적용해 소수(2·3·5·7·11·13)와 아닌 수(1·4·6·8·9·10·12)를 비교
// 15분봉(2025-06~, 5코인)을 묶어서 h시간 봉을 만듦. 봉 시작 시각에 따라 운이 갈리지 않게 시작 시각을 h가지로 다 바꿔 평균
// 규칙: 20봉 고점 돌파 + 50EMA>200EMA + 거래량 ≥ 48봉 평균 1.5배 → 다음 봉 시가 진입 (숏은 반대) · 손절 2ATR · 최고점에서 4ATR 추적 손절 · 최대 60봉 · 수수료 0.05%×2 + 미끄러짐
import { readFileSync } from 'node:fs';
const DIR = process.env.RD || '/tmp/rd', COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE'], TAKER = 0.0005, SIN = 0.0002, SST = 0.0005, H = 3600e3;
const ema = (a, n) => { const k = 2 / (n + 1), o = []; let e = null; a.forEach((x, i) => { e = e == null ? x : x * k + e * (1 - k); o.push(i >= n ? e : null); }); return o; };
const sma = (a, n) => { const o = []; let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; o.push(i >= n - 1 ? s / n : null); } return o; };
function atrOf(d, n = 14) { const o = []; let a = null; for (let i = 0; i < d.c.length; i++) { const tr = i ? Math.max(d.h[i] - d.l[i], Math.abs(d.h[i] - d.c[i - 1]), Math.abs(d.l[i] - d.c[i - 1])) : d.h[i] - d.l[i]; a = a == null ? tr : (a * (n - 1) + tr) / n; o.push(i >= n ? a : null); } return o; }
const RAW = Object.fromEntries(COINS.map((s) => { const r = JSON.parse(readFileSync(`${DIR}/k15-${s}.json`, 'utf8')); return [s, { t: r.t.map(Number), o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }]; }));
function agg(d, hrs, off) { const W = hrs * H, o = { t: [], o: [], h: [], l: [], c: [], v: [] }; let cur = null;
  for (let i = 0; i < d.t.length; i++) { const b = Math.floor((d.t[i] - off * H) / W); if (b !== cur) { if (cur != null) o.t.length; cur = b; o.t.push(b * W + off * H); o.o.push(d.o[i]); o.h.push(d.h[i]); o.l.push(d.l[i]); o.c.push(d.c[i]); o.v.push(d.v[i]); }
    else { const k = o.t.length - 1; o.h[k] = Math.max(o.h[k], d.h[i]); o.l[k] = Math.min(o.l[k], d.l[i]); o.c[k] = d.c[i]; o.v[k] += d.v[i]; } }
  // 안 끝난 첫·마지막 봉 버림
  ['t', 'o', 'h', 'l', 'c', 'v'].forEach((k) => { o[k] = o[k].slice(1, -1); }); return o; }
function trades(d) { const a = atrOf(d), e50 = ema(d.c, 50), e200 = ema(d.c, 200), vA = sma(d.v, 48), n = d.c.length, out = []; let busy = -1;
  for (let j = 220; j < n - 1; j++) { if (j <= busy || !a[j] || e200[j] == null || !vA[j] || !(d.v[j] > 1.5 * vA[j])) continue; let hi = -Infinity, lo = Infinity; for (let q = j - 20; q < j; q++) { hi = Math.max(hi, d.h[q]); lo = Math.min(lo, d.l[q]); }
    const g = d.c[j] > hi && e50[j] > e200[j] ? 1 : d.c[j] < lo && e50[j] < e200[j] ? -1 : 0; if (!g) continue;
    const e = d.o[j + 1] * (1 + g * SIN), R = 2 * a[j]; let stop = e - g * R, best = e, res = null;
    for (let q = j + 1; q < n; q++) { const o = d.o[q], h = d.h[q], l = d.l[q], c = d.c[q]; let px = null;
      if (q > j + 1 && (g > 0 ? o <= stop : o >= stop)) px = o * (1 - g * SST); else if (g > 0 ? l <= stop : h >= stop) px = stop * (1 - g * SST);
      else { best = g > 0 ? Math.max(best, h) : Math.min(best, l); if (a[q]) { const ns = best - g * 4 * a[q]; if (g > 0 ? ns > stop : ns < stop) stop = ns; } if (q - j >= 59) px = c * (1 - g * SIN); }
      if (px != null) { res = { R: (g * (px - e) - (e + px) * TAKER) / R, t: d.t[j + 1], q }; break; } }
    if (!res) break; out.push(res); busy = res.q; }
  return out; }
function summ(tr) { const n = tr.length; if (!n) return null; const gw = tr.filter((z) => z.R > 0).reduce((s, z) => s + z.R, 0), gl = -tr.filter((z) => z.R <= 0).reduce((s, z) => s + z.R, 0); let eq = 1; tr.forEach((z) => { eq *= 1 + 0.0075 * z.R; });
  return { n, avgR: tr.reduce((s, z) => s + z.R, 0) / n, pf: gl ? gw / gl : 9, ret: (eq - 1) * 100 }; }
const isP = (h) => [2, 3, 5, 7, 11, 13].includes(h), rows = [];
for (let h = 1; h <= 13; h++) { const per = [];
  for (let off = 0; off < h; off++) { const all = []; for (const s of COINS) all.push(...trades(agg(RAW[s], h, off))); all.sort((a, b) => a.t - b.t); const m = (all[0].t + all.at(-1).t) / 2, S = summ(all), A = summ(all.filter((z) => z.t < m)), B = summ(all.filter((z) => z.t >= m)); per.push({ ...S, h1: A ? A.avgR : 0, h2: B ? B.avgR : 0 }); }
  const av = (k) => per.reduce((s, x) => s + x[k], 0) / per.length, sd = Math.sqrt(per.reduce((s, x) => s + (x.avgR - av('avgR')) ** 2, 0) / per.length);
  rows.push({ h, prime: isP(h), n: Math.round(av('n')), avgR: +av('avgR').toFixed(3), avgRsd: +sd.toFixed(3), pf: +av('pf').toFixed(2), ret: +av('ret').toFixed(1), h1: +av('h1').toFixed(3), h2: +av('h2').toFixed(3), offs: per.length, posOffs: per.filter((x) => x.avgR > 0).length }); }
rows.forEach((r) => console.log(String(r.h).padStart(2) + '시간', r.prime ? '소수' : '    ', '거래', String(r.n).padStart(4), '평균R', r.avgR.toFixed(3).padStart(7), '(±' + r.avgRsd + ')', 'PF', r.pf, '수익', r.ret + '%', '앞', r.h1, '뒤', r.h2, '플러스 시작시각', r.posOffs + '/' + r.offs));
const g = (p) => { const z = rows.filter((r) => r.prime === p && r.h > 1); return +(z.reduce((s, r) => s + r.avgR, 0) / z.length).toFixed(3); };
console.log('소수(2~13) 평균R', g(true), ' 소수 아님(4~12) 평균R', g(false));
// 순서 섞기 검정: 13개 간격의 평균R에 소수/아님 이름표를 무작위로 붙였을 때, 실제 차이 이상이 나올 확률
const base = rows.filter((r) => r.h > 1), real = g(true) - g(false); let cnt = 0, seed = 5; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
for (let k = 0; k < 20000; k++) { const v = base.map((r) => r.avgR).sort(() => rnd() - 0.5), a = v.slice(0, 5), b = v.slice(5); if (a.reduce((s, x) => s + x, 0) / 5 - b.reduce((s, x) => s + x, 0) / b.length >= real) cnt++; }
console.log('차이', real.toFixed(3), '· 우연히 이만큼 날 확률', (cnt / 20000 * 100).toFixed(1) + '%');
