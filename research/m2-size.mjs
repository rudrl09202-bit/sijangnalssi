// 미국 M2(돈의 양)가 빨리 늘어날 때 롱 크기를 키우면 나아지나 — 규칙·합격 기준은 결과 보기 전에 고정 (2026-11-26)
//  데이터: FRED M2SL (월별, 계절조정) https://fred.stlouisfed.org/graph/fredgraph.csv?id=M2SL → <MH>/M2SL.csv
//    세계 M2(중국·유럽·일본)는 FRED 공개 자료가 끊겨서 미국만 씀. 과거 수정치(빈티지)는 반영 못 함 — 지금 값으로 과거를 봄
//  발표 지연: 어떤 달의 값은 약 4주 뒤 발표 → 보수적으로 "그 달 1일 + 2달"부터 쓸 수 있다고 봄
//  L "돈이 풀리는 중": 쓸 수 있는 마지막 달의 1년 증가율 > 0  그리고  3달 전 달의 1년 증가율보다 큼 (가속)
//  행동: L 이 켜진 동안 새 롱 크기 ×1.25 (숏·F 필터는 그대로) — 기준선 = 지금 쓰는 F
//  합격: 전체 샤프 상승 + 앞·뒤 반기 샤프 모두 F 이상 + 최대 낙폭이 F 보다 3%p 넘게 나빠지지 않음
//        + L 켜진 때 롱 후보 평균R > 꺼진 때 롱 후보 평균R
//  합격하면 무작위 200번: 같은 수의 롱을 무작위로 골라 ×1.25 — 무작위가 실제 샤프 이상인 경우 10% 넘으면 우연으로 봄
// 결과 (2026-11-26, 2021-03~2026-11, 류신영 봇 8코인 4시간봉, M2 2026-10까지 · L 켜진 날 43%):
//   F(지금) 연 38.7% 낙폭 −24.3% 샤프 1.35 (앞 1.49 뒤 1.24)
//   L 켜지면 롱 ×1.25: 연 40.5% 낙폭 −26.7% 샤프 1.32 (앞 1.51 뒤 1.19) → 불합격
//   L 켜진 때 롱 후보 549개 평균R 0.215 < 꺼진 때 499개 0.583 — 돈이 빨리 풀릴 때의 롱이 오히려 덜 벌었음
//   → 크기 키우기에 쓰지 않음. 수익이 조금 는 것은 크기를 키웠기 때문일 뿐(낙폭도 같이 커짐). 기준을 바꿔 다시 돌리지 않음
// 사용: RD=/tmp/rd MH=/tmp/mh node research/m2-size.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { RCFG, prepareRS, buildSamples, trainOn, simulate, statsOf } from '../connect/rs.mjs';
import { predict } from '../connect/mk.mjs';
const DIR = process.env.RD || '/tmp/rd', MH = process.env.MH || '/tmp/mh', DAY = 864e5, UP = 1.25;
const COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'ADA', 'LINK'], series = {};
for (const s of COINS) { const r = JSON.parse(readFileSync(`${DIR}/k4-${s}.json`, 'utf8')); series[s] = { t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }; }
const deriv = JSON.parse(readFileSync(`${DIR}/deriv.json`, 'utf8')), P = { ...RCFG }, W = prepareRS(series);
const M = {}; for (const k of ['usdcny', 'dxy', 'us10y', 'nasdaq']) { const ctx = { window: {} }; ctx.window.SNW_HIST = (n, d) => { M[k] = d; }; vm.runInNewContext(readFileSync(`${MH}/m_${k}.js`, 'utf8'), ctx); const d = M[k]; d.T = d.t.map((x) => Date.parse(x + 'T00:00:00Z')); if (k === 'us10y' && d.c.at(-1) > 20) d.c = d.c.map((x) => x / 10); }
const idx = (d, t) => { const day = Math.floor(t / DAY) * DAY; let lo = 0, hi = d.T.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (d.T[m] < day) { k = m; lo = m + 1; } else hi = m - 1; } return k; };
const ch = (k, t, n, pct = true) => { const d = M[k], i = idx(d, t); if (i < n) return null; return pct ? (d.c[i] / d.c[i - n] - 1) * 100 : d.c[i] - d.c[i - n]; };
const sma200 = (t) => { const d = M.nasdaq, i = idx(d, t); if (i < 200) return null; let s = 0; for (let q = i - 199; q <= i; q++) s += d.c[q]; return d.c[i] < s / 200; };
const SIG = { A: (t) => (ch('usdcny', t, 20) ?? 0) >= 1.5, B: (t) => (ch('dxy', t, 20) ?? 0) >= 3, C: (t) => (ch('us10y', t, 20, false) ?? 0) >= 0.5, D: (t) => !!sma200(t) };
const F = (t) => ['A', 'B', 'C', 'D'].filter((k) => SIG[k](t)).length >= 2;
// M2: 월별 → 쓸 수 있는 날(그 달 1일 + 2달)
const m2 = readFileSync(`${MH}/M2SL.csv`, 'utf8').trim().split('\n').slice(1).map((l) => l.split(',')).filter((r) => r[1] && r[1] !== '.').map(([d, v]) => ({ d, v: +v }));
m2.forEach((r, i) => { const [y, m] = r.d.split('-').map(Number); r.avail = Date.UTC(y, m - 1 + 2, 1); r.yoy = i >= 12 ? (r.v / m2[i - 12].v - 1) * 100 : null; });
const L = (t) => { let i = -1; for (let k = 0; k < m2.length; k++) if (m2[k].avail <= t) i = k; else break; if (i < 15) return false; const y = m2[i].yoy, y3 = m2[i - 3].yoy; return y > 0 && y > y3; };
const lMemo = new Map(), Lm = (t) => { const k = Math.floor(t / DAY); if (!lMemo.has(k)) lMemo.set(k, L(t)); return lMemo.get(k); };
const samples = buildSamples(W, P, deriv), key = (s, t) => s + '|' + t, pred = new Map(); let F0 = null;
for (let ts = W.T[0] + 540 * DAY; ts < W.T.at(-1); ts += 90 * DAY) { const m = trainOn(samples, ts, P); if (!m) continue; if (F0 == null) F0 = ts; samples.forEach((z) => { if (z.t >= ts && z.t < ts + 90 * DAY) pred.set(key(z.s, z.t), { p: predict(m, z.row), qs: m.qs }); }); }
const T1 = W.T.at(-1) + 1, mid = Math.floor((F0 + T1) / 2), gbm = (s, t) => { const z = pred.get(key(s, t)); return !!z && z.p >= z.qs[50]; };
const avg = (a) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3) : null);
const run = (sizeOf) => { const row = {}; for (const [k, a, b] of [['all', F0, T1], ['h1', F0, mid], ['h2', mid, T1]]) { const r = simulate(W, P, deriv, { judge: (s, t, c) => ({ ok: gbm(s, t) && !(c.g > 0 && F(t)), size: sizeOf(s, t, c) }), tA: a, tB: b }); row[k] = statsOf(r.equity.filter(([t]) => t >= a && t < b), r.trades.filter((z) => Date.parse(z.in.replace(' ', 'T') + 'Z') >= a), P) || {}; } return row; };
const line = (name, r, extra = '') => console.log(name.padEnd(22), '연', r.all.cagr + '%', '낙폭', r.all.mdd + '%', '샤프', r.all.sharpe, '거래', r.all.n, '| 앞', r.h1.sharpe, '뒤', r.h2.sharpe, extra);
let on = 0, nd = 0; for (let t = F0; t < T1; t += DAY) { nd++; if (Lm(t)) on++; }
console.log('기간', new Date(F0).toISOString().slice(0, 10), '~', new Date(T1).toISOString().slice(0, 10), '| M2 마지막', m2.at(-1).d, '| L 켜진 날', Math.round(on / nd * 100) + '%');
const base = run(() => 1), test = run((s, t, c) => (c.g > 0 && Lm(t) ? UP : 1));
const longs = samples.filter((z) => z.R != null && z.t >= F0 && gbm(z.s, z.t) && z.side === 'long' && !F(z.t)), lOn = longs.filter((z) => Lm(z.t)), lOff = longs.filter((z) => !Lm(z.t));
line('F (지금 쓰는 것)', base);
const pass = test.all.sharpe > base.all.sharpe && test.h1.sharpe >= base.h1.sharpe && test.h2.sharpe >= base.h2.sharpe && test.all.mdd >= base.all.mdd - 3 && avg(lOn.map((z) => z.R)) > avg(lOff.map((z) => z.R));
line('L 켜지면 롱 ×1.25', test, `| 롱 후보 켜짐 ${lOn.length}개 평균R ${avg(lOn.map((z) => z.R))} vs 꺼짐 ${lOff.length}개 ${avg(lOff.map((z) => z.R))} ${pass ? '→ 합격' : '→ 불합격'}`);
if (pass) { let seed = 17; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648); const ids = longs.map((z) => key(z.s, z.t)), res = [];
  for (let it = 0; it < 200; it++) { const up = new Set(); while (up.size < lOn.length) up.add(ids[Math.floor(rnd() * ids.length)]);
    const r = simulate(W, P, deriv, { judge: (s, t, c) => ({ ok: gbm(s, t) && !(c.g > 0 && F(t)), size: up.has(key(s, t)) ? UP : 1 }), tA: F0, tB: T1 }); res.push((statsOf(r.equity.filter(([t]) => t >= F0), r.trades, P) || {}).sharpe); }
  res.sort((a, b) => a - b); const pct = Math.round(res.filter((x) => x >= test.all.sharpe).length / 2);
  console.log('무작위로 같은 수 롱 ×1.25: 중간', res[100], '상위 5%', res[190], '| 무작위가 실제 이상', pct + '%', pct > 10 ? '→ 우연과 구분 안 됨' : '→ 우연 아님'); }
