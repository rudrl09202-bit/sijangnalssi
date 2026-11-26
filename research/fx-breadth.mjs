// 머니 글로브 1호 신호: 통화 20개 동시 약세(G)를 류신영 봇에 붙였을 때 — 규칙·합격 기준은 결과 보기 전에 고정 (2026-11-26)
//  G: 20개 통화 중 달러 대비 20거래일 +2% 이상 약해진 통화가 6개 이상 (connect/fxbreadth.mjs)
//  기준선 = 지금 실제로 쓰는 F (A~D 중 2개 이상이면 새 롱 쉼)
//  후보 ① F또는G: F 이거나 G 이면 새 롱 쉼
//       ② F5: A·B·C·D·G 다섯 중 2개 이상이면 새 롱 쉼 (F 를 대신함)
//  참고 G단독: 필터 없음과 비교 (판정은 안 함)
//  합격(F 대비): 전체 샤프 상승 + 앞·뒤 반기 샤프 모두 F 이상 + 새로 건너뛴 후보 평균R < 남긴 후보 평균R
//  합격한 후보는 무작위 건너뛰기 200번과 비교(같은 수를 F 위에 추가로 건너뜀) — 무작위가 실제 이상인 경우 10% 넘으면 우연으로 봄
// 결과 (2026-11-26, 2021-03~2026-11, 류신영 봇 8코인 4시간봉):
//   필터 없음 샤프 1.31 · F(지금) 1.35 · G 단독 1.23 (G 켜진 날 30%)
//   ① F 또는 G 1.25 (앞 1.31 뒤 1.22) → 불합격: 새로 건너뛴 177개 평균R 0.749 > 남김 0.277 — 통화 약세 때 들어간 롱이 오히려 더 벌었음
//   ② A~D·G 중 2개+ 1.33 (앞 1.48 뒤 1.21) → 불합격
//   → 봇에는 넣지 않음. connect/macro.mjs 가 보여 주기용으로만 계산(앱 "세계 경제 신호" 화면의 머니 글로브). 기준을 바꿔 다시 돌리지 않음(결과 맞추기 방지)
// 사용: RD=/tmp/rd MH=/tmp/mh node research/fx-breadth.mjs   (MH 는 node research/fx-hist.mjs 로 만듦)
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { RCFG, prepareRS, buildSamples, trainOn, simulate, statsOf } from '../connect/rs.mjs';
import { predict } from '../connect/mk.mjs';
import { FX, breadthAt } from '../connect/fxbreadth.mjs';
const DIR = process.env.RD || '/tmp/rd', MH = process.env.MH || '/tmp/mh', DAY = 864e5;
const COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'ADA', 'LINK'], series = {};
for (const s of COINS) { const r = JSON.parse(readFileSync(`${DIR}/k4-${s}.json`, 'utf8')); series[s] = { t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }; }
const deriv = JSON.parse(readFileSync(`${DIR}/deriv.json`, 'utf8')), P = { ...RCFG }, W = prepareRS(series);
const M = {}; for (const k of ['usdcny', 'dxy', 'us10y', 'nasdaq', 'vix', ...FX.map((f) => 'fx_' + f.id)]) { const ctx = { window: {} }; ctx.window.SNW_HIST = (n, d) => { M[k] = d; }; vm.runInNewContext(readFileSync(`${MH}/m_${k}.js`, 'utf8'), ctx); const d = M[k]; d.T = d.t.map((x) => Date.parse(x + 'T00:00:00Z')); if (k === 'us10y' && d.c.at(-1) > 20) d.c = d.c.map((x) => x / 10); }
const idx = (d, t) => { const day = Math.floor(t / DAY) * DAY; let lo = 0, hi = d.T.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (d.T[m] < day) { k = m; lo = m + 1; } else hi = m - 1; } return k; };
const ch = (k, t, n, pct = true) => { const d = M[k], i = idx(d, t); if (i < n) return null; return pct ? (d.c[i] / d.c[i - n] - 1) * 100 : d.c[i] - d.c[i - n]; };
const sma200 = (t) => { const d = M.nasdaq, i = idx(d, t); if (i < 200) return null; let s = 0; for (let q = i - 199; q <= i; q++) s += d.c[q]; return d.c[i] < s / 200; };
const gMemo = new Map(), G = (t) => { const k = Math.floor(t / DAY); if (!gMemo.has(k)) gMemo.set(k, breadthAt(M, t).on); return gMemo.get(k); };
const SIG = { A: (t) => (ch('usdcny', t, 20) ?? 0) >= 1.5, B: (t) => (ch('dxy', t, 20) ?? 0) >= 3, C: (t) => (ch('us10y', t, 20, false) ?? 0) >= 0.5, D: (t) => !!sma200(t), G };
const cnt = (t, ks) => ks.filter((k) => SIG[k](t)).length;
const RULE = { F: (t) => cnt(t, ['A', 'B', 'C', 'D']) >= 2, G: (t) => G(t), FG: (t) => cnt(t, ['A', 'B', 'C', 'D']) >= 2 || G(t), F5: (t) => cnt(t, ['A', 'B', 'C', 'D', 'G']) >= 2 };
const block = (nm, t, g) => !!nm && g > 0 && RULE[nm](t);
const samples = buildSamples(W, P, deriv), key = (s, t) => s + '|' + t, pred = new Map(); let F0 = null;
for (let ts = W.T[0] + 540 * DAY; ts < W.T.at(-1); ts += 90 * DAY) { const m = trainOn(samples, ts, P); if (!m) continue; if (F0 == null) F0 = ts; samples.forEach((z) => { if (z.t >= ts && z.t < ts + 90 * DAY) pred.set(key(z.s, z.t), { p: predict(m, z.row), qs: m.qs }); }); }
const T1 = W.T.at(-1) + 1, mid = Math.floor((F0 + T1) / 2), gbm = (s, t) => { const z = pred.get(key(s, t)); return !!z && z.p >= z.qs[50]; };
const avg = (a) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3) : null);
const inW = samples.filter((z) => z.R != null && z.t >= F0 && gbm(z.s, z.t)), sideG = (z) => (z.side === 'long' ? 1 : -1);
const run = (judgeExtra) => { const row = {}; for (const [k, a, b] of [['all', F0, T1], ['h1', F0, mid], ['h2', mid, T1]]) { const r = simulate(W, P, deriv, { judge: (s, t, c) => ({ ok: gbm(s, t) && !judgeExtra(s, t, c) }), tA: a, tB: b }); row[k] = statsOf(r.equity.filter(([t]) => t >= a && t < b), r.trades.filter((z) => Date.parse(z.in.replace(' ', 'T') + 'Z') >= a), P) || {}; } return row; };
const runRule = (nm) => run((s, t, c) => block(nm, t, c.g));
const onPct = (f) => { let n = 0, d = 0; for (let t = F0; t < T1; t += DAY) { d++; if (f(t)) n++; } return Math.round(n / d * 100); };
const line = (name, r, extra = '') => console.log(name.padEnd(22), '연', r.all.cagr + '%', '낙폭', r.all.mdd + '%', '샤프', r.all.sharpe, '거래', r.all.n, '| 앞', r.h1.sharpe, '뒤', r.h2.sharpe, extra);
console.log('기간', new Date(F0).toISOString().slice(0, 10), '~', new Date(T1).toISOString().slice(0, 10), '| G 켜진 날', onPct(G) + '%', '| F 켜진 날', onPct(RULE.F) + '%');
const none = run(() => false), F = runRule('F');
line('필터 없음', none); line('F (지금 쓰는 것)', F);
const gOnly = runRule('G'), skG = inW.filter((z) => block('G', z.t, sideG(z))), kpG = inW.filter((z) => !block('G', z.t, sideG(z)));
line('참고: G 단독', gOnly, `| 건너뛴 후보 ${skG.length} 평균R ${avg(skG.map((z) => z.R))} vs 남김 ${avg(kpG.map((z) => z.R))}`);
const passed = [];
for (const [nm, label] of [['FG', '① F 또는 G'], ['F5', '② A~D·G 중 2개+']]) {
  const r = runRule(nm), extra = inW.filter((z) => block(nm, z.t, sideG(z)) && !block('F', z.t, sideG(z))), kept = inW.filter((z) => !block(nm, z.t, sideG(z))), unblock = inW.filter((z) => !block(nm, z.t, sideG(z)) && block('F', z.t, sideG(z)));
  const pass = r.all.sharpe > F.all.sharpe && r.h1.sharpe >= F.h1.sharpe && r.h2.sharpe >= F.h2.sharpe && extra.length > 0 && avg(extra.map((z) => z.R)) < avg(kept.map((z) => z.R));
  line(label, r, `| 켜진 날 ${onPct(RULE[nm])}% | F 대비 새로 건너뜀 ${extra.length} 평균R ${avg(extra.map((z) => z.R))} vs 남김 ${avg(kept.map((z) => z.R))}${unblock.length ? ' | F 가 막던 것 다시 허용 ' + unblock.length : ''} ${pass ? '→ 합격' : '→ 불합격'}`);
  if (pass) passed.push([nm, label, r.all.sharpe, extra.length]);
}
let seed = 11; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
for (const [nm, label, real, nSkip] of passed) { const pool = inW.filter((z) => !block('F', z.t, sideG(z)) && z.side === 'long').map((z) => key(z.s, z.t)), res = [];
  for (let it = 0; it < 200; it++) { const skip = new Set(); while (skip.size < Math.min(nSkip, pool.length)) skip.add(pool[Math.floor(rnd() * pool.length)]);
    const r = simulate(W, P, deriv, { judge: (s, t, c) => ({ ok: gbm(s, t) && !block('F', t, c.g) && !skip.has(key(s, t)) }), tA: F0, tB: T1 }); res.push((statsOf(r.equity.filter(([t]) => t >= F0), r.trades, P) || {}).sharpe); }
  res.sort((a, b) => a - b); const pct = Math.round(res.filter((x) => x >= real).length / 2);
  console.log(label, '실제 샤프', real, '| 무작위(F 위에 같은 수 롱 추가로 건너뜀) 중간', res[100], '상위 5%', res[190], '| 무작위가 실제 이상', pct + '%', pct > 10 ? '→ 우연과 구분 안 됨' : '→ 우연 아님'); }
