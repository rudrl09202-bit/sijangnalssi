// 미래 엿보기 검사: 같은 시점의 신호를 "전체 자료"와 "그 시점까지만 자른 자료"로 계산해 비교. 다르면 미래 정보를 쓴 것
import test from 'node:test';
import assert from 'node:assert/strict';
import { coinSeries, cut, world, REGIME, rng } from './helpers.mjs';
import { RCFG, prepareRS, signalAt, featRow } from '../connect/rs.mjs';
import { riskAt } from '../connect/macro.mjs';
import { breadthAt, FX } from '../connect/fxbreadth.mjs';
import { targetWeights, FXC } from '../connect/fxpaper.mjs';
import { loadQuant } from '../connect/paper.mjs';
const SY = ['BTC', 'ETH', 'SOL'], full = Object.fromEntries(SY.map((s, i) => [s, coinSeries(11 + i)]));

test('류신영 봇: 진입 신호·학습 재료가 미래 봉을 쓰지 않음', () => {
  const W = prepareRS(full), n = full.BTC.t.length; let seen = 0;
  for (let j = 400; j < n - 5; j += 37) { const part = Object.fromEntries(SY.map((s) => [s, cut(full[s], j + 1)])), Wp = prepareRS(part);
    for (const s of SY) { const a = signalAt(W, RCFG, s, j), b = signalAt(Wp, RCFG, s, j); assert.deepEqual(b, a, `${s} 봉 ${j} 신호가 다름`);
      if (a) { seen++; assert.deepEqual(featRow(Wp, s, j, b, null, RCFG), featRow(W, s, j, a, null, RCFG), `${s} 봉 ${j} 학습 재료가 다름`); } } }
  // 표본만으로 신호가 안 잡혔으면 신호가 난 봉을 직접 찾아 확인
  for (const s of SY) for (let j = 400; j < n - 5 && seen < 30; j++) { const a = signalAt(W, RCFG, s, j); if (!a) continue; seen++; const Wp = prepareRS(Object.fromEntries(SY.map((q) => [q, cut(full[q], j + 1)]))); assert.deepEqual(signalAt(Wp, RCFG, s, j), a); assert.deepEqual(featRow(Wp, s, j, a, null, RCFG), featRow(W, s, j, a, null, RCFG)); }
  assert.ok(seen >= 10, '검사한 신호가 너무 적음: ' + seen);
});

const DAY = 864e5, dser = (seed, n = 600, px = 100) => { const r = rng(seed), T = [], c = []; let p = px; for (let i = 0; i < n; i++) { p *= 1 + (r() - 0.5) * 0.02; T.push(Date.UTC(2024, 0, 1) + i * DAY); c.push(p); } return { T, c }; };
const before = (d, t) => { const k = d.T.filter((x) => x < Math.floor(t / DAY) * DAY).length; return { T: d.T.slice(0, k), c: d.c.slice(0, k) }; };

test('세계 경제 신호 A~D: 그 날보다 앞선 값만 씀', () => {
  const M = { usdcny: dser(1, 600, 7), dxy: dser(2), us10y: dser(3, 600, 4), nasdaq: dser(4, 600, 15000), vix: dser(5, 600, 20) };
  for (let i = 260; i < 600; i += 23) { const t = M.dxy.T[i] + 3600e3, Mp = Object.fromEntries(Object.entries(M).map(([k, d]) => [k, before(d, t)])); assert.deepEqual(riskAt(Mp, t), riskAt(M, t), `${i}일째 신호가 다름`); }
});

test('통화 20개 동시 약세: 그 날보다 앞선 값만 씀', () => {
  const M = Object.fromEntries(FX.map((f, i) => ['fx_' + f.id, dser(40 + i, 400, 100 + i)]));
  for (let i = 60; i < 400; i += 17) { const t = M.fx_krw.T[i] + 3600e3, Mp = Object.fromEntries(Object.entries(M).map(([k, d]) => [k, before(d, t)])); assert.deepEqual(breadthAt(Mp, t), breadthAt(M, t)); }
});

test('외환 캐리: 목표 비중이 그 날까지의 환율·전달까지의 금리만 씀', () => {
  const N = 300, days = Array.from({ length: N }, (_, i) => new Date(Date.UTC(2025, 0, 1) + i * DAY).toISOString().slice(0, 10)), rows = Object.fromEntries(FXC.map((f, i) => [f.id, dser(70 + i, N, 10 + i).c]));
  const months = ['2024-10', '2024-11', '2024-12', '2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11'];
  const rates = Object.fromEntries(['US', ...FXC.map((f) => f.c)].map((c, i) => [c, months.map((m, k) => [m, 1 + ((i * 7 + k * 3) % 11) * 0.5])]));
  const rateAtUS = (d) => { const [y, m] = d.slice(0, 7).split('-').map(Number), lag = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7); let v = null; for (const [k, x] of rates.US) { if (k <= lag) v = x; else break; } return v; };
  for (let i = 80; i < N; i += 19) { const d = days[i], rowsP = Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.slice(0, i + 1)])), ratesP = Object.fromEntries(Object.entries(rates).map(([k, v]) => [k, v.filter(([m]) => m < d.slice(0, 7))]));
    assert.deepEqual(targetWeights(rowsP, i, d, ratesP, rateAtUS(d)).W, targetWeights(rows, i, d, rates, rateAtUS(d)).W, d + ' 비중이 다름'); }
});

test('주식·코인 봇 엔진(ATLAS·ORBIT·ORBIT-X·NOVA): 어느 날까지의 계좌 기록이 그 뒤 자료와 무관', () => {
  const Q = loadQuant(), A = world(), Wf = Q.buildWorld(A.map((a) => ({ ...a })), { regimeOf: REGIME }), D = Wf.cal[Math.floor(Wf.cal.length * 0.8)];
  const Wp = Q.buildWorld(A.map((a) => { const n = a.t.filter((d) => d <= D).length; return cut(a, n); }), { regimeOf: REGIME }), only = ['atlas', 'orbit', 'orbitx', 'nova'], from = Wf.cal[300];
  const f = Q.backtest(Wf, { only, from, to: D }), p = Q.backtest(Wp, { only, from, to: D });
  for (const b of only) { assert.deepEqual(p.accounts[b].equity, f.accounts[b].equity, b + ' 평가액 기록이 다름'); assert.equal(p.accounts[b].trades.length, f.accounts[b].trades.length, b + ' 거래 수가 다름'); }
  assert.ok(only.some((b) => f.accounts[b].trades.length > 0), '거래가 하나도 없어 검사가 의미 없음');
});
