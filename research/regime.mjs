// 허스트 지수·순열 엔트로피 필터를 류신영 봇(4시간봉 거래량 돌파)에 붙여 보는 시험 — 미리 정한 기준
//  허스트 H: 지난 128봉 로그수익의 분산비(1·2·4·8·16봉 묶음) 기울기로 추정. H ≥ 0.5 = 추세가 이어지는 성질 → 이때만 진입
//  순열 엔트로피 PE(차수 3, 지난 96봉): 낮을수록 움직임에 규칙성. 그 코인의 지난 1년 PE 중 하위 70% 안일 때만 진입 (미래 정보 없음)
//  비교: 규칙 혼자 / +H / +PE / +H+PE / 학습 필터(지금 류신영) / 학습+H
import { readFileSync } from 'node:fs';
import { prepareRS, simulate, statsOf, RCFG, buildSamples, trainOn } from '../connect/rs.mjs';
import { predict } from '../connect/mk.mjs';
const DIR = process.argv[2] || '/tmp/rd', DAY = 864e5, COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'ADA', 'LINK'];
const deriv = JSON.parse(readFileSync(DIR + '/deriv.json', 'utf8'));
const series = {}; for (const s of COINS) { const r = JSON.parse(readFileSync(`${DIR}/k4-${s}.json`, 'utf8')); series[s] = { t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }; }
const W = prepareRS(series), P = RCFG;
function hurst(c, j, N = 128) { if (j < N + 1) return null; const r = []; for (let k = j - N + 1; k <= j; k++) r.push(Math.log(c[k] / c[k - 1]));
  const xs = [], ys = []; for (const q of [1, 2, 4, 8, 16]) { const agg = []; for (let k = 0; k + q <= r.length; k += q) { let s = 0; for (let u = 0; u < q; u++) s += r[k + u]; agg.push(s); } const m = agg.reduce((a, b) => a + b, 0) / agg.length, v = agg.reduce((a, b) => a + (b - m) ** 2, 0) / agg.length; if (v > 0) { xs.push(Math.log(q)); ys.push(Math.log(v)); } }
  const n = xs.length, sx = xs.reduce((a, b) => a + b, 0), sy = ys.reduce((a, b) => a + b, 0), sxx = xs.reduce((a, b) => a + b * b, 0), sxy = xs.reduce((a, b, i) => a + b * ys[i], 0); return ((n * sxy - sx * sy) / (n * sxx - sx * sx)) / 2; }
function pe(c, j, N = 96) { if (j < N + 3) return null; const cnt = {}; for (let k = j - N + 1; k <= j; k++) { const a = c[k - 2], b = c[k - 1], d = c[k]; const key = (a < b ? 'a' : 'b') + (b < d ? 'a' : 'b') + (a < d ? 'a' : 'b'); cnt[key] = (cnt[key] || 0) + 1; } let h = 0; Object.values(cnt).forEach((n) => { const p = n / N; h -= p * Math.log(p); }); return h / Math.log(6); }
for (const s of COINS) { const x = W.X[s], c = x.d.c; x.H = c.map((_, j) => hurst(c, j)); x.PE = c.map((_, j) => pe(c, j)); }
const peOk = (x, j) => { const v = x.PE[j]; if (v == null) return false; const hist = []; for (let k = Math.max(0, j - 2190); k < j; k += 3) if (x.PE[k] != null) hist.push(x.PE[k]); if (hist.length < 200) return true; hist.sort((a, b) => a - b); return v <= hist[Math.floor(hist.length * 0.7)]; };
// 학습 필터 걷기 시험 예측 (rs.mjs study 와 같은 방식)
const samples = buildSamples(W, P, deriv), pred = new Map(), warm = W.T[0] + 540 * DAY;
for (let ts = warm; ts < W.T.at(-1); ts += 90 * DAY) { const m = trainOn(samples, ts, P); if (!m) continue; samples.forEach((z) => { if (z.t >= ts && z.t < ts + 90 * DAY) pred.set(z.s + '|' + z.t, { p: predict(m, z.row), q: m.qs[50] }); }); }
const ml = (s, t) => { const z = pred.get(s + '|' + t); return !!z && z.p >= z.q; };
const F0 = warm, T1 = W.T.at(-1) + 1, mid = (F0 + T1) / 2;
const J = { '규칙 혼자': null, '+ 허스트 ≥ 0.5': (s, t, c, j) => ({ ok: W.X[s].H[j] >= 0.5 }), '+ 엔트로피 낮을 때': (s, t, c, j) => ({ ok: peOk(W.X[s], j) }), '+ 허스트 + 엔트로피': (s, t, c, j) => ({ ok: W.X[s].H[j] >= 0.5 && peOk(W.X[s], j) }),
  '학습 필터 (지금 류신영)': (s, t) => ({ ok: ml(s, t) }), '학습 + 허스트': (s, t, c, j) => ({ ok: ml(s, t) && W.X[s].H[j] >= 0.5 }), '학습 + 엔트로피': (s, t, c, j) => ({ ok: ml(s, t) && peOk(W.X[s], j) }) };
const out = {};
for (const [name, judge] of Object.entries(J)) { const row = {}; for (const [k, a, b] of [['all', F0, T1], ['h1', F0, mid], ['h2', mid, T1]]) { const r = simulate(W, P, deriv, { judge, tA: a, tB: b }); row[k] = statsOf(r.equity.filter(([t]) => t >= a && t < b), r.trades.filter((z) => Date.parse(z.in.replace(' ', 'T') + 'Z') >= a), P); if (k === 'all') row.eq = r.equity; }
  out[name] = row; console.log(name.padEnd(20), '연', row.all.cagr + '%', '낙폭', row.all.mdd + '%', '샤프', row.all.sharpe, 'PF', row.all.pf, '거래', row.all.n, '| 앞', row.h1.ret + '%', '뒤', row.h2.ret + '%'); }
// 허스트가 실제로 결과를 가르는지: 후보별 H 구간 평균 R
const b = { lo: [], hi: [] }; samples.forEach((z) => { if (z.R == null || z.t < F0) return; const j = W.X[z.s].m.get(z.t); const h = W.X[z.s].H[j]; if (h == null) return; (h >= 0.5 ? b.hi : b.lo).push(z.R); });
const avg = (a) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(3); console.log('후보 평균R: 허스트<0.5', avg(b.lo), '(' + b.lo.length + ') · ≥0.5', avg(b.hi), '(' + b.hi.length + ')');
export { out, W };
