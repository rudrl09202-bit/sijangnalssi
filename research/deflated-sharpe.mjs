// 다중 시험 보정 샤프 (Deflated Sharpe Ratio, Bailey·López de Prado 2014) — 류신영 봇(학습 필터) 6년 백테스트
//  질문: "전략을 N번 시험해서 가장 좋은 걸 골랐을 때, 이 샤프가 우연이 아닐 확률은?"
//  SR0 = 우연히 나올 최고 샤프 기대값 = sqrt(V) · ((1−γ)·Φ⁻¹(1−1/N) + γ·Φ⁻¹(1−1/(N·e))),  γ = 0.5772
//  DSR = Φ( (SR − SR0)·sqrt(T−1) / sqrt(1 − 왜도·SR + (첨도−1)/4·SR²) )   (SR 은 하루 단위)
//  N(시험 횟수)과 V(시험들 사이 샤프의 흩어짐)는 정확히 알 수 없어 여러 값으로 봄:
//   N = 20 · 50 · 100 (research/LEDGER.md 의 시험 수는 변형까지 세면 약 50)
//   V: 낙관(같은 전략의 변형끼리 흩어짐, 연 샤프 표준편차 0.07) / 보수(서로 다른 전략들, 연 0.5)
//  읽는 법: DSR 95% 이상이면 "우연이 아니다"라고 말할 만함
// 결과 (2026-11-27, 거래일 2,096 · 연 샤프 1.31 · 왜도 2.85 · 첨도 26.0):
//   낙관 V: N=20 99.9% · N=50 99.9% · N=100 99.8%
//   보수 V: N=20 82.5% · N=50 67.1% · N=100 54.4%  (우연히 나올 최고 연 샤프 0.95 · 1.14 · 1.27)
//   → 서로 다른 전략을 여러 개 시험해 고른 것이므로 보수 쪽에 가까움: 95% 에 못 미침 = 아직 통계적으로 증명된 우위가 아님. 모의 기록으로 확인 필요
// 사용: RD=/tmp/rd node research/deflated-sharpe.mjs
import { readFileSync } from 'node:fs';
import { RCFG, prepareRS, buildSamples, trainOn, simulate } from '../connect/rs.mjs';
import { predict } from '../connect/mk.mjs';
const DIR = process.env.RD || '/tmp/rd', DAY = 864e5, COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'ADA', 'LINK'], series = {};
for (const s of COINS) { const r = JSON.parse(readFileSync(`${DIR}/k4-${s}.json`, 'utf8')); series[s] = { t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }; }
const deriv = JSON.parse(readFileSync(`${DIR}/deriv.json`, 'utf8')), P = { ...RCFG }, W = prepareRS(series), samples = buildSamples(W, P, deriv), key = (s, t) => s + '|' + t, pred = new Map(); let F0 = null;
for (let ts = W.T[0] + 540 * DAY; ts < W.T.at(-1); ts += 90 * DAY) { const m = trainOn(samples, ts, P); if (!m) continue; if (F0 == null) F0 = ts; samples.forEach((z) => { if (z.t >= ts && z.t < ts + 90 * DAY) pred.set(key(z.s, z.t), predict(m, z.row) >= m.qs[50]); }); }
const r = simulate(W, P, deriv, { judge: (s, t) => ({ ok: !!pred.get(key(s, t)) }), tA: F0, tB: W.T.at(-1) + 1 });
const daily = []; let last = null; r.equity.filter(([t]) => t >= F0).forEach(([t, v]) => { const k = Math.floor(t / DAY); if (k !== last) { daily.push(v); last = k; } else daily[daily.length - 1] = v; });
const x = daily.slice(1).map((v, i) => v / daily[i] - 1), T = x.length, mean = x.reduce((a, b) => a + b, 0) / T, sd = Math.sqrt(x.reduce((a, b) => a + (b - mean) ** 2, 0) / T);
const skew = x.reduce((a, b) => a + ((b - mean) / sd) ** 3, 0) / T, kurt = x.reduce((a, b) => a + ((b - mean) / sd) ** 4, 0) / T, SR = mean / sd, ann = Math.sqrt(365);
// 표준정규 분포 함수와 역함수
const Phi = (z) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };
const PhiInv = (p) => { let lo = -8, hi = 8; for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (Phi(m) < p) lo = m; else hi = m; } return (lo + hi) / 2; };
const G = 0.5772156649, sr0 = (N, sdAnn) => (sdAnn / ann) * ((1 - G) * PhiInv(1 - 1 / N) + G * PhiInv(1 - 1 / (N * Math.E)));
const dsr = (s0) => Phi((SR - s0) * Math.sqrt(T - 1) / Math.sqrt(1 - skew * SR + (kurt - 1) / 4 * SR * SR));
console.log('류신영 봇 (학습 필터) ' + new Date(F0).toISOString().slice(0, 10) + ' ~ · 거래일 ' + T + ' · 연 샤프 ' + (SR * ann).toFixed(2) + ' · 왜도 ' + skew.toFixed(2) + ' · 첨도 ' + kurt.toFixed(1));
console.log('한 번만 시험했다면 (보정 없음): 샤프가 0보다 클 확률 ' + (dsr(0) * 100).toFixed(1) + '%');
for (const [label, sdAnn] of [['낙관 (변형끼리 흩어짐 0.07)', 0.07], ['보수 (다른 전략들 0.5)', 0.5]]) for (const N of [20, 50, 100]) { const s0 = sr0(N, sdAnn); console.log(label.padEnd(22), 'N=' + String(N).padEnd(4), '우연히 나올 최고 연 샤프', (s0 * ann).toFixed(2), '→ DSR', (dsr(s0) * 100).toFixed(1) + '%'); }
