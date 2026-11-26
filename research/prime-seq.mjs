// 소수 순서 확인: 2시간봉 신호 → 그 뒤 3시간봉 신호 → 그 뒤 5시간봉 신호(→ 7시간봉)가 같은 방향으로 차례로 나올 때만 진입
// 신호 = 류신영 봇 규칙(20봉 고점 돌파 + 50EMA>200EMA + 거래량 1.5배, 숏은 반대). 순서가 24시간 안에 이어져야 함
// 진입: 마지막 신호 봉이 끝난 직후 15분봉 시가. 청산: 마지막 간격 ATR 기준 손절 2ATR · 4ATR 추적 · 최대 60봉 (15분봉으로 확인). 비용 포함
// 비교: 같은 엔진으로 4시간 혼자 / 소수 아닌 순서(2→4→6, 4→6→8) / 순서 상관없이 셋 다
import { readFileSync } from 'node:fs';
const DIR = process.env.RD || '/tmp/rd', COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE'], TAKER = 0.0005, SIN = 0.0002, SST = 0.0005, H = 3600e3, WIN = 24 * H;
const ema = (a, n) => { const k = 2 / (n + 1), o = []; let e = null; a.forEach((x, i) => { e = e == null ? x : x * k + e * (1 - k); o.push(i >= n ? e : null); }); return o; };
const sma = (a, n) => { const o = []; let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; o.push(i >= n - 1 ? s / n : null); } return o; };
function atrOf(d, n = 14) { const o = []; let a = null; for (let i = 0; i < d.c.length; i++) { const tr = i ? Math.max(d.h[i] - d.l[i], Math.abs(d.h[i] - d.c[i - 1]), Math.abs(d.l[i] - d.c[i - 1])) : d.h[i] - d.l[i]; a = a == null ? tr : (a * (n - 1) + tr) / n; o.push(i >= n ? a : null); } return o; }
function agg(d, hrs) { const W = hrs * H, o = { t: [], o: [], h: [], l: [], c: [], v: [] }; let cur = null;
  for (let i = 0; i < d.t.length; i++) { const b = Math.floor(d.t[i] / W); if (b !== cur) { cur = b; o.t.push(b * W); o.o.push(d.o[i]); o.h.push(d.h[i]); o.l.push(d.l[i]); o.c.push(d.c[i]); o.v.push(d.v[i]); } else { const k = o.t.length - 1; o.h[k] = Math.max(o.h[k], d.h[i]); o.l[k] = Math.min(o.l[k], d.l[i]); o.c[k] = d.c[i]; o.v[k] += d.v[i]; } }
  ['t', 'o', 'h', 'l', 'c', 'v'].forEach((k) => { o[k] = o[k].slice(1, -1); }); return o; }
// 간격별 신호: { end: 봉 끝난 시각, g, atr }
function signals(d, hrs) { const a = atrOf(d), e50 = ema(d.c, 50), e200 = ema(d.c, 200), vA = sma(d.v, 48), out = [];
  for (let j = 220; j < d.c.length; j++) { if (!a[j] || e200[j] == null || !vA[j] || !(d.v[j] > 1.5 * vA[j])) continue; let hi = -Infinity, lo = Infinity; for (let q = j - 20; q < j; q++) { hi = Math.max(hi, d.h[q]); lo = Math.min(lo, d.l[q]); }
    const g = d.c[j] > hi && e50[j] > e200[j] ? 1 : d.c[j] < lo && e50[j] < e200[j] ? -1 : 0; if (g) out.push({ end: d.t[j] + hrs * H, g, atr: a[j] }); }
  return out; }
const RAW = {}, SIG = {};
for (const s of COINS) { const r = JSON.parse(readFileSync(`${DIR}/k15-${s}.json`, 'utf8')); RAW[s] = { t: r.t.map(Number), o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }; SIG[s] = {}; for (const h of [2, 3, 4, 5, 6, 7, 8]) SIG[s][h] = signals(agg(RAW[s], h), h); }
function entries(s, seq, ordered) { const last = seq.at(-1), out = [];
  for (const z of SIG[s][last]) { let t = z.end, ok = true;
    for (let k = seq.length - 2; k >= 0; k--) { const cand = SIG[s][seq[k]].filter((w) => w.g === z.g && w.end <= (ordered ? t : z.end) && w.end >= z.end - WIN); if (!cand.length) { ok = false; break; } if (ordered) t = cand.at(-1).end; }
    if (ok) out.push({ t: z.end, g: z.g, atr: z.atr, hrs: last }); }
  return out; }
function sim(s, ents) { const d = RAW[s], idx = new Map(d.t.map((t, i) => [t, i])), out = []; let busyT = -Infinity;
  for (const E of ents) { if (E.t <= busyT) continue; const j = idx.get(E.t); if (j == null) continue; const g = E.g, e = d.o[j] * (1 + g * SIN), R = 2 * E.atr; let stop = e - g * R, best = e, px = null, q = j;
    for (; q < d.t.length; q++) { const o = d.o[q], h = d.h[q], l = d.l[q], c = d.c[q];
      if (q > j && (g > 0 ? o <= stop : o >= stop)) px = o * (1 - g * SST); else if (g > 0 ? l <= stop : h >= stop) px = stop * (1 - g * SST);
      else { best = g > 0 ? Math.max(best, h) : Math.min(best, l); const ns = best - g * 4 * E.atr; if (g > 0 ? ns > stop : ns < stop) stop = ns; if (d.t[q] - E.t >= 60 * E.hrs * H) px = c * (1 - g * SIN); }
      if (px != null) break; }
    if (px == null) break; out.push({ R: (g * (px - e) - (e + px) * TAKER) / R, t: E.t }); busyT = d.t[q]; }
  return out; }
function summ(tr) { const n = tr.length; if (!n) return { n: 0 }; const gw = tr.filter((z) => z.R > 0).reduce((s, z) => s + z.R, 0), gl = -tr.filter((z) => z.R <= 0).reduce((s, z) => s + z.R, 0); let eq = 1, pk = 1, mdd = 0; tr.forEach((z) => { eq *= 1 + 0.0075 * z.R; pk = Math.max(pk, eq); mdd = Math.min(mdd, eq / pk - 1); });
  return { n, win: Math.round(tr.filter((z) => z.R > 0).length / n * 100), avgR: +(tr.reduce((s, z) => s + z.R, 0) / n).toFixed(3), pf: +(gl ? gw / gl : 9).toFixed(2), ret: +((eq - 1) * 100).toFixed(1), mdd: +(mdd * 100).toFixed(1) }; }
const CASES = [['4시간 혼자 (지금 방식)', [4], true], ['2→3→5 순서대로 (소수)', [2, 3, 5], true], ['2→3→5→7 순서대로 (소수)', [2, 3, 5, 7], true], ['2·3·5 순서 상관없이', [2, 3, 5], false],
  ['2→4→6 순서대로 (비교)', [2, 4, 6], true], ['4→6→8 순서대로 (비교)', [4, 6, 8], true], ['3→5→7 순서대로 (소수)', [3, 5, 7], true]];
for (const [nm, seq, ord] of CASES) { const all = COINS.flatMap((s) => sim(s, entries(s, seq, ord))).sort((a, b) => a.t - b.t), m = all.length ? (all[0].t + all.at(-1).t) / 2 : 0, A = summ(all), h1 = summ(all.filter((z) => z.t < m)), h2 = summ(all.filter((z) => z.t >= m));
  console.log(nm.padEnd(22), '거래', String(A.n).padStart(4), '승률', A.win + '%', '평균R', A.avgR, 'PF', A.pf, '수익', A.ret + '%', '낙폭', A.mdd + '%', '| 앞', h1.avgR, '뒤', h2.avgR); }
// 공정 비교: 2~8시간 중 서로 다른 간격 3개·4개를 작은 것부터 순서대로 고르는 모든 조합을 같은 엔진으로 돌려, 소수 조합의 순위를 봄
const TFS = [2, 3, 4, 5, 6, 7, 8], combos = [];
const pick = (k, st, cur) => { if (cur.length === k) { combos.push(cur.slice()); return; } for (let i = st; i < TFS.length; i++) { cur.push(TFS[i]); pick(k, i + 1, cur); cur.pop(); } };
pick(3, 0, []); pick(4, 0, []);
const isP = (h) => [2, 3, 5, 7].includes(h), res = combos.map((seq) => { const all = COINS.flatMap((s) => sim(s, entries(s, seq, true))).sort((a, b) => a.t - b.t); return { seq: seq.join('→'), prime: seq.every(isP), ...summ(all) }; }).filter((r) => r.n >= 30);
for (const k of [3, 4]) { const R = res.filter((r) => r.seq.split('→').length === k).sort((a, b) => b.avgR - a.avgR);
  console.log(`\n간격 ${k}개 조합 ${R.length}개 (거래 30번 이상), 평균R 높은 순:`); R.forEach((r, i) => console.log(String(i + 1).padStart(2), r.seq.padEnd(10), r.prime ? '소수' : '    ', '거래', r.n, '평균R', r.avgR, 'PF', r.pf, '수익', r.ret + '%', '낙폭', r.mdd + '%')); }
// 마지막 간격만 같은 '혼자' 기준
for (const h of [5, 7, 8]) { const all = COINS.flatMap((s) => sim(s, entries(s, [h], true))).sort((a, b) => a.t - b.t); console.log(h + '시간 혼자', summ(all)); }
