// 지정학 위험 지수(GPR, Caldara·Iacoviello 일별)를 류신영 봇에 붙였을 때 — 규칙·합격 기준은 결과 보기 전에 고정 (2026-11-26)
//  데이터: https://www.matteoiacoviello.com/gpr_files/data_gpr_daily_recent.xls (신문 기사로 매일 계산, 1985~)
//    → <MH>/gpr.json = { t:[날짜], g:[GPRD], m7:[GPRD_MA7] } 로 바꿔 둠 (xls 읽기는 저장소 밖 도구로 함)
//  발표 지연: 파일은 며칠~1주 늦게 올라옴 → 시점 t 에는 t 보다 7일 이상 지난 날짜의 값만 씀 (미래 엿보기 방지)
//  H "지정학 위험 급등": 쓸 수 있는 마지막 날의 7일 평균(GPRD_MA7)이 그 전 365일 7일 평균들의 상위 10% 이상
//  기준선 = 지금 실제로 쓰는 F (A~D 중 2개 이상이면 새 롱 쉼)
//  후보 ① F또는H  ② A·B·C·D·H 다섯 중 2개 이상 · 참고 H단독(판정 안 함)
//  합격(F 대비): 전체 샤프 상승 + 앞·뒤 반기 샤프 모두 F 이상 + 새로 건너뛴 후보 평균R < 남긴 후보 평균R
//  합격하면 무작위 건너뛰기 200번과 비교 — 무작위가 실제 이상인 경우 10% 넘으면 우연으로 봄
// 결과 (2026-11-26, 2021-03~2026-11, 류신영 봇 8코인 4시간봉, GPR 2026-11-23까지):
//   필터 없음 샤프 1.31 · F(지금) 1.35 · H 단독 1.23 (H 켜진 날 16%, 낙폭은 −24.3→−22.4%로 조금 줄어듦)
//   ① F 또는 H 1.27 (앞 1.31 뒤 1.24) → 불합격: 새로 건너뛴 173개 평균R 0.511 > 남김 0.303
//   ② A~D·H 중 2개+ 1.34 (앞 1.47 뒤 1.24) → 불합격
//   → 봇에는 넣지 않음. 통화 약세(research/fx-breadth.mjs)와 같은 모습: 위험이 커진 때 들어간 롱이 오히려 더 벌었음. 기준을 바꿔 다시 돌리지 않음
// 사용: RD=/tmp/rd MH=/tmp/mh node research/gpr-filter.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { RCFG, prepareRS, buildSamples, trainOn, simulate, statsOf } from '../connect/rs.mjs';
import { predict } from '../connect/mk.mjs';
const DIR = process.env.RD || '/tmp/rd', MH = process.env.MH || '/tmp/mh', DAY = 864e5, LAG = 7;
const COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'ADA', 'LINK'], series = {};
for (const s of COINS) { const r = JSON.parse(readFileSync(`${DIR}/k4-${s}.json`, 'utf8')); series[s] = { t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }; }
const deriv = JSON.parse(readFileSync(`${DIR}/deriv.json`, 'utf8')), P = { ...RCFG }, W = prepareRS(series);
const M = {}; for (const k of ['usdcny', 'dxy', 'us10y', 'nasdaq', 'vix']) { const ctx = { window: {} }; ctx.window.SNW_HIST = (n, d) => { M[k] = d; }; vm.runInNewContext(readFileSync(`${MH}/m_${k}.js`, 'utf8'), ctx); const d = M[k]; d.T = d.t.map((x) => Date.parse(x + 'T00:00:00Z')); if (k === 'us10y' && d.c.at(-1) > 20) d.c = d.c.map((x) => x / 10); }
const GP = JSON.parse(readFileSync(`${MH}/gpr.json`, 'utf8')); GP.T = GP.t.map((x) => Date.parse(x + 'T00:00:00Z'));
const idx = (d, t) => { const day = Math.floor(t / DAY) * DAY; let lo = 0, hi = d.T.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (d.T[m] < day) { k = m; lo = m + 1; } else hi = m - 1; } return k; };
const ch = (k, t, n, pct = true) => { const d = M[k], i = idx(d, t); if (i < n) return null; return pct ? (d.c[i] / d.c[i - n] - 1) * 100 : d.c[i] - d.c[i - n]; };
const sma200 = (t) => { const d = M.nasdaq, i = idx(d, t); if (i < 200) return null; let s = 0; for (let q = i - 199; q <= i; q++) s += d.c[q]; return d.c[i] < s / 200; };
const hMemo = new Map();
const H = (t) => { const k = Math.floor(t / DAY); if (hMemo.has(k)) return hMemo.get(k);
  const i = idx(GP, t - (LAG - 1) * DAY); let on = false; // t 보다 7일 이상 지난 날까지
  if (i >= 365 && GP.m7[i] != null) { const past = GP.m7.slice(i - 365, i).filter((x) => x != null).sort((a, b) => a - b); on = GP.m7[i] >= past[Math.floor(past.length * 0.9)]; }
  hMemo.set(k, on); return on; };
const SIG = { A: (t) => (ch('usdcny', t, 20) ?? 0) >= 1.5, B: (t) => (ch('dxy', t, 20) ?? 0) >= 3, C: (t) => (ch('us10y', t, 20, false) ?? 0) >= 0.5, D: (t) => !!sma200(t), H };
const cnt = (t, ks) => ks.filter((k) => SIG[k](t)).length;
const RULE = { F: (t) => cnt(t, ['A', 'B', 'C', 'D']) >= 2, H, FH: (t) => cnt(t, ['A', 'B', 'C', 'D']) >= 2 || H(t), F5: (t) => cnt(t, ['A', 'B', 'C', 'D', 'H']) >= 2 };
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
console.log('기간', new Date(F0).toISOString().slice(0, 10), '~', new Date(T1).toISOString().slice(0, 10), '| GPR 마지막', GP.t.at(-1), '| H 켜진 날', onPct(H) + '%', '| F 켜진 날', onPct(RULE.F) + '%');
const F = runRule('F'); line('필터 없음', run(() => false)); line('F (지금 쓰는 것)', F);
const skH = inW.filter((z) => block('H', z.t, sideG(z))), kpH = inW.filter((z) => !block('H', z.t, sideG(z)));
line('참고: H 단독', runRule('H'), `| 건너뛴 후보 ${skH.length} 평균R ${avg(skH.map((z) => z.R))} vs 남김 ${avg(kpH.map((z) => z.R))}`);
const passed = [];
for (const [nm, label] of [['FH', '① F 또는 H'], ['F5', '② A~D·H 중 2개+']]) {
  const r = runRule(nm), extra = inW.filter((z) => block(nm, z.t, sideG(z)) && !block('F', z.t, sideG(z))), kept = inW.filter((z) => !block(nm, z.t, sideG(z))), unblock = inW.filter((z) => !block(nm, z.t, sideG(z)) && block('F', z.t, sideG(z)));
  const pass = r.all.sharpe > F.all.sharpe && r.h1.sharpe >= F.h1.sharpe && r.h2.sharpe >= F.h2.sharpe && extra.length > 0 && avg(extra.map((z) => z.R)) < avg(kept.map((z) => z.R));
  line(label, r, `| 켜진 날 ${onPct(RULE[nm])}% | F 대비 새로 건너뜀 ${extra.length} 평균R ${avg(extra.map((z) => z.R))} vs 남김 ${avg(kept.map((z) => z.R))}${unblock.length ? ' | F 가 막던 것 다시 허용 ' + unblock.length : ''} ${pass ? '→ 합격' : '→ 불합격'}`);
  if (pass) passed.push([label, r.all.sharpe, extra.length]);
}
let seed = 13; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
for (const [label, real, nSkip] of passed) { const pool = inW.filter((z) => !block('F', z.t, sideG(z)) && z.side === 'long').map((z) => key(z.s, z.t)), res = [];
  for (let it = 0; it < 200; it++) { const skip = new Set(); while (skip.size < Math.min(nSkip, pool.length)) skip.add(pool[Math.floor(rnd() * pool.length)]);
    const r = simulate(W, P, deriv, { judge: (s, t, c) => ({ ok: gbm(s, t) && !block('F', t, c.g) && !skip.has(key(s, t)) }), tA: F0, tB: T1 }); res.push((statsOf(r.equity.filter(([t]) => t >= F0), r.trades, P) || {}).sharpe); }
  res.sort((a, b) => a - b); const pct = Math.round(res.filter((x) => x >= real).length / 2);
  console.log(label, '실제 샤프', real, '| 무작위 중간', res[100], '상위 5%', res[190], '| 무작위가 실제 이상', pct + '%', pct > 10 ? '→ 우연과 구분 안 됨' : '→ 우연 아님'); }
