// 주식 봇에 머니 글로브 거시 신호를 붙였을 때 — 신호·합격 기준은 결과 보기 전에 고정 (2026-11-26)
//  대상: ATLAS(추세 돌파) · ORBIT(모멘텀 순환) · CHIEF(시장날씨 점수) — 실제 모의투자 봇과 같은 엔진(js/quant.js)·같은 10년 자료
//  방법: 신호가 켜진 날엔 새 매수를 안 함 (js/quant.js 의 gate — 이미 있는 "지수 200일선" 시장 필터와 같은 자리). 보유·청산은 그대로
//  신호 (모두 그 날보다 앞선 날짜의 값만 씀):
//   F  세계 경제 신호 A~D 중 2개 이상 (코인 봇에서 쓰는 것과 같음) — 모든 주식
//   G  통화 20개 중 6개 이상 동시 약세 (머니 글로브) — 모든 주식
//   K  원화 3개월(91일) +7.5% 이상 약세 (한국 위기 경보 X 의 절반 기준 — 15%는 10년에 거의 안 나와서) — 한국 주식만
//  합격(봇마다): 전체 샤프 상승 + 표본 안(앞 70%)·밖(뒤 30%) 샤프 모두 신호 없을 때 이상 + 최대 낙폭이 2%p 넘게 나빠지지 않음
// 결과 (2026-11-26, 2017-08~2026-11, 표본 밖 2024-02~ · 켜진 날 F 6% · G 27% · K 4%):
//   ATLAS 없음 샤프 0.61 · +F 0.63(안 0.65 밖 0.61) 합격선 넘음 → 무작위 날짜 이동 100번 중 37%가 실제 이상 = 우연과 구분 안 됨
//         +G 0.63(밖 0.35) 불합격 · +K 0.61 변화 없음
//   ORBIT 없음 1.01 · +F 1.01(달 첫날에 거의 안 켜짐) · +G 0.72 · +K 1.00 → 모두 불합격
//   CHIEF 0.19 그대로 — CHIEF 는 시장 필터 자리를 거치지 않고 자기 경로로 사서 이 시험이 적용 안 됨
//   → 주식 봇에는 아무 신호도 붙이지 않음. 기준을 바꿔 다시 돌리지 않음
// 사용: SNW_ROOT=<market.mjs 로 js/history 를 받은 폴더> MH=/tmp/mh node research/stock-macro.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadQuant, loadAssets, cutoffDate, makeChief } from '../connect/paper.mjs';
import { loadApp } from '../connect/alerts.mjs';
import { FX, breadthAt } from '../connect/fxbreadth.mjs';
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..'), ROOT = process.env.SNW_ROOT || REPO, MH = process.env.MH || '/tmp/mh', DAY = 864e5;
const app = loadApp(ROOT), Q = loadQuant(REPO), { assets, usdkrw } = loadAssets(ROOT, app, cutoffDate(new Date()));
const M = {}; for (const k of ['usdcny', 'dxy', 'us10y', 'nasdaq', ...FX.map((f) => 'fx_' + f.id)]) { const ctx = { window: {} }; ctx.window.SNW_HIST = (n, d) => { M[k] = d; }; vm.runInNewContext(readFileSync(`${MH}/m_${k}.js`, 'utf8'), ctx); const d = M[k]; d.T = d.t.map((x) => Date.parse(x + 'T00:00:00Z')); if (k === 'us10y' && d.c.at(-1) > 20) d.c = d.c.map((x) => x / 10); }
const idx = (d, t) => { let lo = 0, hi = d.T.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (d.T[m] < t) { k = m; lo = m + 1; } else hi = m - 1; } return k; }; // t 날짜보다 앞선 마지막
const ch = (k, t, n, pct = true) => { const d = M[k], i = idx(d, t); if (i < n) return null; return pct ? (d.c[i] / d.c[i - n] - 1) * 100 : d.c[i] - d.c[i - n]; };
const below200 = (t) => { const d = M.nasdaq, i = idx(d, t); if (i < 200) return false; let s = 0; for (let q = i - 199; q <= i; q++) s += d.c[q]; return d.c[i] < s / 200; };
const memo = {}; const day = (k, d, f) => { const key = k + d; if (!(key in memo)) memo[key] = f(Date.parse(d + 'T00:00:00Z')); return memo[key]; };
const SIG = {
  F: (d) => day('F', d, (t) => [(ch('usdcny', t, 20) ?? 0) >= 1.5, (ch('dxy', t, 20) ?? 0) >= 3, (ch('us10y', t, 20, false) ?? 0) >= 0.5, below200(t)].filter(Boolean).length >= 2),
  G: (d) => day('G', d, (t) => breadthAt(M, t).on),
  K: (d) => day('K', d, (t) => { const k = M.fx_krw, i = idx(k, t); if (i < 0) return false; let j = -1; for (let q = i; q >= 0; q--) if (k.T[q] <= k.T[i] - 91 * DAY) { j = q; break; } return j >= 0 && (k.c[i] / k.c[j] - 1) * 100 >= 7.5; })
};
const isKR = (a) => a.market === 'kospi' || a.market === 'kosdaq' || a.cur === 'KRW';
const GATES = { none: null, F: (d, a) => a.kind !== 'stock' || !SIG.F(d), G: (d, a) => a.kind !== 'stock' || !SIG.G(d), K: (d, a) => a.kind !== 'stock' || !isKR(a) || !SIG.K(d) };
const BOTS = ['atlas', 'orbit', 'chief'], regimeOf = { spx: 'IDX_spx', nasdaq: 'IDX_spx', kospi: 'IDX_kospi', kosdaq: 'IDX_kospi', coin: 'C_BTC' };
const res = {};
for (const [g, gate] of Object.entries(GATES)) {
  let W = null; const chief = makeChief(app, Q, () => W, '9999-12-31');
  W = Q.buildWorld(assets.map((a) => ({ ...a })), { usdkrw, regimeOf, chief, gate });
  const from = W.cal[Math.min(W.cal.length - 1, 260)], split = W.cal[Math.floor(W.cal.indexOf(from) + (W.cal.length - W.cal.indexOf(from)) * 0.7)];
  const bt = Q.backtest(W, { only: BOTS, from }); res[g] = {};
  for (const b of BOTS) { const A = bt.accounts[b]; if (!A) continue; const m = (lo, hi) => Q.metrics(A.equity.filter(([d]) => d >= lo && d <= hi), A.trades.filter((z) => z.out >= lo && z.out <= hi)) || {};
    res[g][b] = { all: m(from, '9999'), ins: m(from, split), out: m(split, '9999') }; }
  if (g === 'none') { let on = { F: 0, G: 0, K: 0 }, n = 0; for (const d of W.cal) { if (d < from) continue; n++; for (const k of ['F', 'G', 'K']) if (SIG[k](d)) on[k]++; }
    console.log('기간', from, '~', W.cal.at(-1), '| 표본 밖 시작', split, '| 켜진 날 F', Math.round(on.F / n * 100) + '% G', Math.round(on.G / n * 100) + '% K', Math.round(on.K / n * 100) + '%'); }
}
const f = (x) => `연 ${x.all.cagr}% 낙폭 ${x.all.mdd}% 샤프 ${x.all.sharpe} | 안 ${x.ins.sharpe} 밖 ${x.out.sharpe}`;
for (const b of BOTS) { const base = res.none[b]; if (!base) continue; console.log('\n' + b.toUpperCase().padEnd(8), '신호 없음', f(base));
  for (const g of ['F', 'G', 'K']) { const x = res[g][b]; if (!x) continue; const pass = x.all.sharpe > base.all.sharpe && x.ins.sharpe >= base.ins.sharpe && x.out.sharpe >= base.out.sharpe && x.all.mdd >= base.all.mdd - 2;
    console.log('  + ' + g.padEnd(5), f(x), pass ? '→ 합격' : '→ 불합격'); } }
// 우연 확인 (ATLAS + F 가 합격선을 넘어서 추가, 결과 보기 전에 방법 고정): F 가 켜진 날 무늬를 그대로 두고 날짜만 무작위로 밀어(순환 이동) 100번
if (process.env.PLACEBO) {
  let W0 = null; const ch0 = makeChief(app, Q, () => W0, '9999-12-31'); W0 = Q.buildWorld(assets.map((a) => ({ ...a })), { usdkrw, regimeOf, chief: ch0 });
  const from = W0.cal[Math.min(W0.cal.length - 1, 260)], days = W0.cal.filter((d) => d >= from), onArr = days.map((d) => SIG.F(d)), real = res.F.atlas.all.sharpe, out = [];
  let seed = 31; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let it = 0; it < 100; it++) { const sh = 30 + Math.floor(rnd() * (days.length - 60)), set = new Set(days.filter((d, i) => onArr[(i + sh) % days.length]));
    let W = null; const chief = makeChief(app, Q, () => W, '9999-12-31'); W = Q.buildWorld(assets.map((a) => ({ ...a })), { usdkrw, regimeOf, chief, gate: (d, a) => a.kind !== 'stock' || !set.has(d) });
    const A = Q.backtest(W, { only: ['atlas'], from }).accounts.atlas; out.push((Q.metrics(A.equity, A.trades) || {}).sharpe); }
  out.sort((a, b) => a - b); const p = out.filter((x) => x >= real).length;
  console.log('\nATLAS + F 실제 샤프', real, '| 무작위 날짜 이동 100번: 중간', out[50], '상위 5%', out[95], '| 무작위가 실제 이상', p + '%', p > 10 ? '→ 우연과 구분 안 됨' : '→ 우연 아님'); }
