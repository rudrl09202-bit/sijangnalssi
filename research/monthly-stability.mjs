// "10년 · 수익률 + 매달 안정성"으로 평가받는다면 지금 봇들은 어떤가 — 비교 대상은 결과 보기 전에 고정 (2026-11-27)
//  낱개: 류신영 봇(코인 추세, 학습 필터) · ORBIT(주식 모멘텀) · 외환 캐리(S3)
//  섞기: 세 봇을 같은 위험 크기로 — 각 봇의 일별 수익을 "지난 60일 변동성이 연 10%가 되도록" 날마다 크기를 맞추고(전날까지의 값만 씀) 1/3 씩
//        (봇마다 가상 계좌가 따로라 실제로는 자금 배분으로 구현. 여기서는 일별 수익률을 합쳐 근사)
//  보는 것: 연 수익 · 월 샤프(연율) · 플러스인 달 비율 · 최악의 달 · 최대 낙폭(월말 기준) · 가장 긴 연속 손실 달
//  기간: 세 봇 자료가 모두 있는 2021-03 ~ 2026-10 (68개월). 봇 변경 없음 — 기록·판단용 (LEDGER #31)
// 결과 (2026-11-27, 2021-03 ~ 2026-10, 68개월):
//   류신영 봇   연 35.9% · 월 샤프 1.18 · 플러스인 달 53% · 최악의 달 −8.8% · 낙폭 −16.7% · 연속 손실 3개월
//   ORBIT      연 36.5% · 월 샤프 1.30 · 플러스인 달 63% · 최악의 달 −16.0% · 낙폭 −20.6% · 연속 손실 5개월
//   외환 캐리    연 5.7% · 월 샤프 1.33 · 플러스인 달 72% · 최악의 달 −2.2% · 낙폭 −5.5% · 연속 손실 3개월
//   섞은 것     연 15.2% · 월 샤프 1.80 · 플러스인 달 69% · 최악의 달 −4.5% · 낙폭 −5.3% · 연속 손실 2개월
//   월 수익 상관: 코인↔주식 0.14 · 코인↔외환 −0.04 · 주식↔외환 0.29 — 서로 거의 따로 움직여서 섞으면 달마다의 출렁임이 크게 줄어듦
//   주의: 백테스트(낱개 봇들은 여러 번 시험해 고른 것), ORBIT 은 종목 목록이 지금 기준이라 부풀었음(승자 빼면 연 13%),
//         외환 캐리는 변동성이 작아 같은 위험으로 맞추려면 큰 배수가 필요(최대 3배로 제한함). 모의 기록 기간이라 봇·자금 배분은 바꾸지 않음
// 사용: SNW_ROOT=<js/history 폴더가 있는 곳> RD=/tmp/rd MH=/tmp/mh node research/monthly-stability.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RCFG, prepareRS, buildSamples, trainOn, simulate } from '../connect/rs.mjs';
import { predict } from '../connect/mk.mjs';
import { loadQuant, loadAssets, cutoffDate } from '../connect/paper.mjs';
import { loadApp } from '../connect/alerts.mjs';
import { FXC, CFG as FXCFG, targetWeights, rateAt } from '../connect/fxpaper.mjs';
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..'), ROOT = process.env.SNW_ROOT || REPO, RD = process.env.RD || '/tmp/rd', MH = process.env.MH || '/tmp/mh', DAY = 864e5;
const A0 = '2021-03-01', A1 = '2026-10-31';
// ① 류신영 봇 일별 평가액
const COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'ADA', 'LINK'], series = {};
for (const s of COINS) { const r = JSON.parse(readFileSync(`${RD}/k4-${s}.json`, 'utf8')); series[s] = { t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }; }
const deriv = JSON.parse(readFileSync(`${RD}/deriv.json`, 'utf8')), P = { ...RCFG }, W = prepareRS(series), samples = buildSamples(W, P, deriv), key = (s, t) => s + '|' + t, pred = new Map(); let F0 = null;
for (let ts = W.T[0] + 540 * DAY; ts < W.T.at(-1); ts += 90 * DAY) { const m = trainOn(samples, ts, P); if (!m) continue; if (F0 == null) F0 = ts; samples.forEach((z) => { if (z.t >= ts && z.t < ts + 90 * DAY) pred.set(key(z.s, z.t), predict(m, z.row) >= m.qs[50]); }); }
const rs = simulate(W, P, deriv, { judge: (s, t) => ({ ok: !!pred.get(key(s, t)) }), tA: F0, tB: W.T.at(-1) + 1 });
const dailyOf = (pts) => { const m = new Map(); pts.forEach(([d, v]) => m.set(d, v)); return m; };
const RSd = dailyOf(rs.equity.map(([t, v]) => [new Date(t).toISOString().slice(0, 10), v]));
// ② ORBIT 일별 평가액
const app = loadApp(ROOT), Q = loadQuant(REPO), { assets, usdkrw } = loadAssets(ROOT, app, cutoffDate(new Date()));
const Wq = Q.buildWorld(assets, { usdkrw, regimeOf: { spx: 'IDX_spx', nasdaq: 'IDX_spx', kospi: 'IDX_kospi', kosdaq: 'IDX_kospi', coin: 'C_BTC' } }), bt = Q.backtest(Wq, { only: ['orbit'], from: Wq.cal[260] });
const ORd = dailyOf(bt.accounts.orbit.equity);
// ③ 외환 캐리 일별 평가액 (connect/fxpaper.mjs 의 규칙 그대로: 매달 첫 거래일 교체, 비용 0.10%)
const load = (k) => { let d; const ctx = { window: { SNW_HIST: (n, x) => { d = x; } } }; vm.runInNewContext(readFileSync(`${MH}/m_${k}.js`, 'utf8'), ctx); return d; };
const base = load('fx_krw'), CAL = base.t, rows = {}; FXC.forEach((f) => { const d = load('fx_' + f.id), m = new Map(d.t.map((t, i) => [t, d.c[i]])); let last = null; rows[f.id] = CAL.map((t) => { const v = m.get(t); if (v > 0) last = v; return last; }); });
const rates = {}; for (const c of ['US', ...FXC.map((f) => f.c)]) rates[c] = readFileSync(`${MH}/r_${c}.csv`, 'utf8').trim().split('\n').slice(1).map((l) => l.split(',')).filter((x) => x[1] && !isNaN(+x[1])).map(([d, v]) => [d.slice(0, 7), +v]);
let eq = 1, Wt = {}, lastM = null; const FXd = new Map();
for (let i = 1; i < CAL.length; i++) { const d = CAL[i], rUS = rateAt(rates.US, d); let r = 0; for (const [id, w] of Object.entries(Wt)) { const p = rows[id], f = FXC.find((x) => x.id === id), rf = rateAt(rates[f.c], d); if (!p[i] || !p[i - 1]) continue; r += w * (p[i - 1] / p[i] - 1 + (rf != null && rUS != null ? (rf - rUS) / 100 / 252 : 0)); }
  eq *= 1 + r; if (i >= 260 && d.slice(0, 7) !== lastM) { const { W: nw } = targetWeights(rows, i, d, rates, rUS); if (Object.keys(nw).length) { let turn = 0; new Set([...Object.keys(nw), ...Object.keys(Wt)]).forEach((id) => { turn += Math.abs((nw[id] || 0) - (Wt[id] || 0)); }); eq *= 1 - turn * FXCFG.cost; Wt = nw; lastM = d.slice(0, 7); } } FXd.set(d, eq); }
// 공통 달력(평일)로 일별 수익률 맞추기
const days = CAL.filter((d) => d >= A0 && d <= A1), ret = (M) => { const out = []; let prev = null, last = null; for (const d of CAL) { if (M.has(d)) last = M.get(d); if (d < A0 || d > A1) { if (last != null) prev = last; continue; } out.push(prev && last ? last / prev - 1 : 0); if (last != null) prev = last; } return out; };
const R = { '류신영 봇 (코인)': ret(RSd), 'ORBIT (주식)': ret(ORd), '외환 캐리': ret(FXd) };
// 같은 위험으로 섞기: 전날까지 60일 변동성으로 크기 맞춤 (최대 3배)
const scaled = (x) => x.map((v, i) => { if (i < 60) return 0; let s = 0, s2 = 0; for (let k = i - 60; k < i; k++) { s += x[k]; s2 += x[k] * x[k]; } const sd = Math.sqrt(Math.max(s2 / 60 - (s / 60) ** 2, 1e-12)) * Math.sqrt(252); return v * Math.min(3, 0.10 / sd); });
const SC = Object.values(R).map(scaled); R['세 봇 같은 위험으로 섞기'] = days.map((_, i) => SC.reduce((a, x) => a + x[i], 0) / SC.length);
const monthly = (x) => { const m = new Map(); x.forEach((v, i) => { const k = days[i].slice(0, 7); m.set(k, (m.get(k) || 1) * (1 + v)); }); return [...m.entries()].map(([k, v]) => [k, v - 1]); };
console.log('기간', days[0], '~', days.at(-1), '·', monthly(R['외환 캐리']).length + '개월');
for (const [name, x] of Object.entries(R)) { const m = monthly(x).map((z) => z[1]), n = m.length, tot = m.reduce((a, v) => a * (1 + v), 1), mean = m.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(m.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  let pk = 1, e = 1, mdd = 0, streak = 0, worstStreak = 0; m.forEach((v) => { e *= 1 + v; pk = Math.max(pk, e); mdd = Math.min(mdd, e / pk - 1); streak = v < 0 ? streak + 1 : 0; worstStreak = Math.max(worstStreak, streak); });
  console.log(name.padEnd(22), '연', ((Math.pow(tot, 12 / n) - 1) * 100).toFixed(1) + '%', '| 월 샤프', (mean / sd * Math.sqrt(12)).toFixed(2), '| 플러스인 달', Math.round(m.filter((v) => v > 0).length / n * 100) + '%', '| 최악의 달', (Math.min(...m) * 100).toFixed(1) + '%', '| 최대 낙폭', (mdd * 100).toFixed(1) + '%', '| 연속 손실', worstStreak + '개월'); }
const corr = (a, b) => { const n = a.length, ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n; let c = 0, va = 0, vb = 0; for (let i = 0; i < n; i++) { c += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; } return (c / Math.sqrt(va * vb)).toFixed(2); };
const mm = Object.fromEntries(Object.entries(R).slice(0, 3).map(([k, x]) => [k, monthly(x).map((z) => z[1])])), ks = Object.keys(mm);
console.log('월 수익 상관: ' + ks[0] + '↔' + ks[1] + ' ' + corr(mm[ks[0]], mm[ks[1]]) + ' · ' + ks[0] + '↔' + ks[2] + ' ' + corr(mm[ks[0]], mm[ks[2]]) + ' · ' + ks[1] + '↔' + ks[2] + ' ' + corr(mm[ks[1]], mm[ks[2]]));
