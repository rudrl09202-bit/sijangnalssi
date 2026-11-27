// 류신영 봇의 학습 필터(GBM, 특징 13개)를 "ATR% 상한" 한 줄로 바꿔도 되나 — 규칙·합격 기준은 결과 보기 전에 고정 (2026-11-27)
//  계기: 블라인드 역설계(거래 기록만 본 AI)가 진입·청산·크기 규칙은 그대로 맞혔고, 학습 필터만 못 맞혔는데
//        "ATR% 상한 하나"로 비슷한 성적이 났다고 보고함. 단 그 2.62% 는 6년 전체를 보고 고른 값(미래 엿봄) → 여기선 쓰지 않음
//  공정 비교: 학습 필터처럼 90일마다 그때까지의 과거 신호만 보고 상한을 정함
//   V0 필터 없음 (규칙만) · V1 학습 필터 (지금) · V2 ATR% 상한 = 과거 신호 ATR% 의 중간값 (학습 필터와 같은 50% 건너뜀)
//  합격(V2 가 V1 을 대신): 단순한 쪽을 택하므로 "비열등" — 전체·앞 절반·뒤 절반 샤프가 모두 V1 보다 0.05 넘게 낮지 않음
// 결과 (2026-11-27, 2021-03~2026-11):
//   V0 필터 없음: 연 35.0% · 낙폭 −26.3% · 샤프 1.15 (앞 1.07 뒤 1.23) · 969거래
//   V1 학습 필터: 연 37.1% · 낙폭 −24.3% · 샤프 1.31 (앞 1.40 뒤 1.23) · 762거래
//   V2 ATR% 상한: 연 37.3% · 낙폭 −25.0% · 샤프 1.28 (앞 1.39 뒤 1.20) · 764거래 → 합격(비열등)
//   학습 필터의 효과(1.15→1.31)를 ATR 한 줄이 거의 다 가져감 = 학습 필터는 사실상 "변동성 큰 신호 피하기"
//   연도별 합계 R 은 해마다 서로 엎치락뒤치락 (어느 쪽이 확실히 낫지는 않음). 실제 봇 교체는 따로 결정
// 사용: RD=/tmp/rd node research/rs-atrcap.mjs
import { readFileSync } from 'node:fs';
import { RCFG, prepareRS, buildSamples, trainOn, simulate, statsOf } from '../connect/rs.mjs';
import { predict } from '../connect/mk.mjs';
const DIR = process.env.RD || '/tmp/rd', DAY = 864e5, COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'ADA', 'LINK'], series = {};
for (const s of COINS) { const r = JSON.parse(readFileSync(`${DIR}/k4-${s}.json`, 'utf8')); series[s] = { t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }; }
const deriv = JSON.parse(readFileSync(`${DIR}/deriv.json`, 'utf8')), P = { ...RCFG }, W = prepareRS(series);
const samples = buildSamples(W, P, deriv), key = (s, t) => s + '|' + t, gbm = new Map(), cap = new Map(); let F0 = null;
for (let ts = W.T[0] + 540 * DAY; ts < W.T.at(-1); ts += 90 * DAY) { const m = trainOn(samples, ts, P); if (!m) continue; if (F0 == null) F0 = ts;
  const past = samples.filter((z) => z.t < ts).map((z) => z.row[2]).sort((a, b) => a - b), med = past[Math.floor(past.length / 2)];
  samples.forEach((z) => { if (z.t >= ts && z.t < ts + 90 * DAY) { gbm.set(key(z.s, z.t), predict(m, z.row) >= m.qs[50]); cap.set(key(z.s, z.t), z.row[2] <= med); } }); }
const T1 = W.T.at(-1) + 1, mid = Math.floor((F0 + T1) / 2);
const run = (ok) => { const row = {}; for (const [k, a, b] of [['all', F0, T1], ['h1', F0, mid], ['h2', mid, T1]]) { const r = simulate(W, P, deriv, { judge: (s, t) => ({ ok: ok(s, t) }), tA: a, tB: b }); row[k] = statsOf(r.equity.filter(([t]) => t >= a && t < b), r.trades.filter((z) => Date.parse(z.in.replace(' ', 'T') + 'Z') >= a), P) || {}; row.n = r.trades.length; } return row; };
const has = (m) => (s, t) => m.has(key(s, t));
const V = { V0: run(has(gbm)), V1: run((s, t) => !!gbm.get(key(s, t))), V2: run((s, t) => !!cap.get(key(s, t))) };
const line = (nm, r) => console.log(nm.padEnd(22), '연', r.all.cagr + '%', '낙폭', r.all.mdd + '%', '샤프', r.all.sharpe, '| 앞', r.h1.sharpe, '뒤', r.h2.sharpe, '| 거래', r.all.n);
console.log('기간', new Date(F0).toISOString().slice(0, 10), '~', new Date(T1).toISOString().slice(0, 10));
line('V0 필터 없음', V.V0); line('V1 학습 필터 (지금)', V.V1); line('V2 ATR% 상한 (과거 중간값)', V.V2);
const ok = ['all', 'h1', 'h2'].every((k) => V.V2[k].sharpe >= V.V1[k].sharpe - 0.05);
console.log('V2 가 V1 을 대신해도 되나:', ok ? '합격 (비열등)' : '불합격');
const yr = (ok2) => { const r = simulate(W, P, deriv, { judge: (s, t) => ({ ok: ok2(s, t) }), tA: F0, tB: T1 }), by = {}; r.trades.forEach((z) => { const y = z.out.slice(0, 4); by[y] = (by[y] || 0) + z.R; }); return by; };
const y1 = yr((s, t) => !!gbm.get(key(s, t))), y2 = yr((s, t) => !!cap.get(key(s, t)));
console.log('연도별 합계 R (V1 / V2):', Object.keys(y1).sort().map((y) => y + ' ' + y1[y].toFixed(1) + '/' + (y2[y] || 0).toFixed(1)).join(' · '));
