/* 류신영 봇 2세대 — 4시간봉 "거래량 확인 돌파" + 학습 필터(메타 라벨링) · 코인 선물 롱·숏 모의투자
 *
 *  왜 바뀌었나: 1세대(15분봉 단타 후보 + 학습)는 바이낸스 15분봉 약 13개월 시험에서 -97%.
 *    단타 규칙 10가지(1시간·15분 돌파, 극단 되돌림, 거래량 폭발 되돌림, 펀딩비 과열 반대, 테이커 쏠림 등)를 같은 비용으로 다시 시험했지만
 *    몇 시간 안에 끝나는 규칙은 모두 수수료를 넘는 우위가 없었음. 앞·뒤 절반 모두 플러스였던 건 4시간봉 돌파 계열뿐.
 *  1차 후보: 20봉(약 3.3일) 고점 돌파 + 50/200 EMA 정배열 (숏은 반대) + 그 봉 거래량이 최근 8일 평균의 1.5배 이상
 *  2차 판단: 학습 모델이 "이 후보가 +0.5R 넘게 끝날 확률"을 매겨 하위 절반은 건너뜀
 *  청산: 손절 2ATR → 처음부터 최고점에서 4ATR 추적 손절 · 최대 60봉(10일) 지나면 정리
 *  계좌: 거래당 위험 0.75% · 동시 최대 4개 · 총 규모 자산의 3배 이하 · 수수료·미끄러짐·실제 펀딩비 포함
 *  데이터: 바이낸스 선물 4시간봉 2019~ (서울 서버가 deriv-data 브랜치 k4-*.json 에 4시간마다 올림)
 *  시험: 과거로만 배우고(끝난 거래만 정답) 다음 90일을 매매 → 반복. '거래량 돌파 혼자'와 같은 기간·같은 규칙으로 비교
 *  결과: <dir>/rs-live.json · <dir>/rs-state.json
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { loadEnv, push, cleanTicks } from './paper.mjs';
import { trainGBM, predict, MK_COINS } from './mk.mjs';
import { MG } from './mg.mjs';
import * as MAC from './macro.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..');
const H4 = 4 * 3600e3, DAY = 864e5;
const isoT = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
const thin = (eq, n = 500) => { const k = Math.max(1, Math.ceil(eq.length / n)); return eq.filter((e, i) => i % k === 0 || i === eq.length - 1).map(([t, v]) => [isoT(t), v]); };
const r2 = (x, n = 2) => (x == null || !isFinite(x) ? null : Math.round(x * 10 ** n) / 10 ** n);
export const RS_V = 2;
const NAME = Object.fromEntries(MK_COINS.map((c) => [c.sym, c.name]));

export const RCFG = { N: 20, volx: 1.5, stopAtr: 2, trail: 4, maxBars: 60, riskPct: 0.75, maxPos: 4, maxLev: 3, taker: 0.0005, slipIn: 0.0002, slipStop: 0.0005, fundBase: 0.0001, start: 1e8, label: 0.5, skipQ: 50 };

export const FEATS_RS = [
  ['side', '방향 (롱/숏)'], ['str', '돌파 세기'], ['atrP', '변동성(ATR %)'], ['vol', '거래량 배수'], ['dS', '200EMA 거리 (진행 방향)'], ['slope', '50EMA 기울기 (진행 방향)'],
  ['r6', '하루 수익 (진행 방향)'], ['r42', '7일 수익 (진행 방향)'], ['rsi', 'RSI (진행 방향)'], ['bTrend', '비트코인 추세 (진행 방향)'], ['bR42', '비트코인 7일 수익 (진행 방향)'],
  ['fr', '펀딩비 (진행 방향)'], ['hour', '시간대']
];

/* ---------- 지표 ---------- */
const ema = (a, n) => { const k = 2 / (n + 1), o = []; let e = null; a.forEach((x, i) => { e = e == null ? x : x * k + e * (1 - k); o.push(i >= n ? e : null); }); return o; };
function atrOf(d, n = 14) { const o = []; let a = null; for (let i = 0; i < d.c.length; i++) { const tr = i ? Math.max(d.h[i] - d.l[i], Math.abs(d.h[i] - d.c[i - 1]), Math.abs(d.l[i] - d.c[i - 1])) : d.h[i] - d.l[i]; a = a == null ? tr : (a * (n - 1) + tr) / n; o.push(i >= n ? a : null); } return o; }
function sma(a, n) { const o = []; let s = 0; for (let i = 0; i < a.length; i++) { s += a[i] || 0; if (i >= n) s -= a[i - n] || 0; o.push(i >= n - 1 ? s / n : null); } return o; }
function rsiOf(c, n = 14) { const o = [null]; let up = 0, dn = 0; for (let i = 1; i < c.length; i++) { const ch = c[i] - c[i - 1]; up = (up * (n - 1) + Math.max(ch, 0)) / n; dn = (dn * (n - 1) + Math.max(-ch, 0)) / n; o.push(i > n ? 100 - 100 / (1 + up / (dn || 1e-12)) : null); } return o; }
export function prepareRS(series) {
  const X = {};
  for (const s of Object.keys(series)) { const d = series[s]; X[s] = { d, m: new Map(d.t.map((t, i) => [t, i])), atr: atrOf(d), e50: ema(d.c, 50), e200: ema(d.c, 200), vA: sma(d.v, 48), rsi: rsiOf(d.c) }; }
  const T = [...new Set(Object.values(series).flatMap((d) => d.t))].sort((a, b) => a - b);
  return { X, T, syms: Object.keys(series) };
}
function fundRate(deriv, s, t, P) { const f = deriv && deriv.coins && deriv.coins[s] && deriv.coins[s].f; if (!f || !f.length || t < f[0][0]) return P.fundBase; let lo = 0, hi = f.length - 1, k = 0; while (lo <= hi) { const m = (lo + hi) >> 1; if (f[m][0] <= t) { k = m; lo = m + 1; } else hi = m - 1; } return f[k][1]; }

/* ---------- 후보·재료·정답 ---------- */
export function signalAt(W, P, s, j) {
  const x = W.X[s], d = x.d; if (j < 220 || x.e200[j] == null || !x.atr[j] || !x.vA[j]) return null;
  if (!(d.v[j] > P.volx * x.vA[j])) return null;
  let hi = -Infinity, lo = Infinity; for (let q = j - P.N; q < j; q++) { if (d.h[q] > hi) hi = d.h[q]; if (d.l[q] < lo) lo = d.l[q]; }
  if (d.c[j] > hi && x.e50[j] > x.e200[j]) return { side: 'long', g: 1, str: (d.c[j] - hi) / x.atr[j], vol: d.v[j] / x.vA[j], lvl: hi };
  if (d.c[j] < lo && x.e50[j] < x.e200[j]) return { side: 'short', g: -1, str: (lo - d.c[j]) / x.atr[j], vol: d.v[j] / x.vA[j], lvl: lo };
  return null;
}
export function featRow(W, s, j, c, deriv, P) {
  const x = W.X[s], d = x.d, g = c.g, p = d.c[j], a = x.atr[j], B = W.X.BTC, bj = B ? B.m.get(d.t[j]) : null;
  if (bj == null || bj < 50 || x.e50[j - 6] == null) return null;
  return [g, c.str, a / p * 100, c.vol, (p - x.e200[j]) / a * g, (x.e50[j] / x.e50[j - 6] - 1) * 100 * g, Math.log(p / d.c[j - 6]) * 100 * g, Math.log(p / d.c[j - 42]) * 100 * g,
    g > 0 ? x.rsi[j] : 100 - x.rsi[j], (B.e50[bj] > B.e200[bj] ? 1 : -1) * g, Math.log(B.d.c[bj] / B.d.c[bj - 42]) * 100 * g, fundRate(deriv, s, d.t[j], P) * 1e4 * g, new Date(d.t[j]).getUTCHours()];
}
// 후보 하나를 같은 청산 규칙으로 따로 끝까지 → R (수수료·미끄러짐 포함)
export function outcome(W, P, s, j, g) {
  const x = W.X[s], d = x.d, n = d.c.length; if (j + 1 >= n) return null;
  const e = d.o[j + 1] * (1 + g * P.slipIn), R = x.atr[j] * P.stopAtr, cost = (e) => e * P.taker * 2; let stop = e - g * R, best = e;
  for (let q = j + 1; q < n; q++) {
    const o = d.o[q], h = d.h[q], l = d.l[q], c = d.c[q];
    if (q > j + 1 && (g > 0 ? o <= stop : o >= stop)) return { R: (g * (o * (1 - g * P.slipStop) - e) - cost(e)) / R, exitT: d.t[q] };
    if (g > 0 ? l <= stop : h >= stop) return { R: (g * (stop * (1 - g * P.slipStop) - e) - cost(e)) / R, exitT: d.t[q] };
    best = g > 0 ? Math.max(best, h) : Math.min(best, l);
    if (x.atr[q]) { const ns = best - g * x.atr[q] * P.trail; if (g > 0 ? ns > stop : ns < stop) stop = ns; }
    if (q - j >= P.maxBars - 1) return { R: (g * (c * (1 - g * P.slipIn) - e) - cost(e)) / R, exitT: d.t[q] };
  }
  return null;
}
export function buildSamples(W, P, deriv) {
  const S = [];
  for (const s of W.syms) { const x = W.X[s], d = x.d; for (let j = 230; j < d.c.length; j++) { const c = signalAt(W, P, s, j); if (!c) continue; const row = featRow(W, s, j, c, deriv, P); if (!row) continue; const o = outcome(W, P, s, j, c.g); S.push({ s, t: d.t[j], side: c.side, row, R: o ? o.R : null, exitT: o ? o.exitT : Infinity }); } }
  return S.sort((a, b) => a.t - b.t);
}
const GB = { rounds: 100, depth: 3, lr: 0.06, minLeaf: 60, lambda: 5, sub: 0.6 };
export function trainOn(samples, tCut, P) {
  const tr = samples.filter((z) => z.R != null && z.exitT < tCut); if (tr.length < 300) return null;
  const m = trainGBM(tr.map((z) => z.row), tr.map((z) => (z.R > P.label ? 1 : 0)), GB);
  const ps = tr.map((z) => predict(m, z.row)).sort((a, b) => a - b), q = (f) => ps[Math.floor(f * (ps.length - 1))];
  m.qs = { 30: q(0.3), 50: q(0.5), 70: q(0.7) }; m.n = tr.length; m.rate = tr.filter((z) => z.R > P.label).length / tr.length; return m;
}

/* ---------- 계좌 시뮬레이션 (시험·실시간 같은 엔진) ---------- */
// judge(s, t, c, row) → {ok, p, why}. tA~tB 구간만 매매. events: 새로 생긴 진입·청산
export function simulate(W, P, deriv, { judge = null, tA = -Infinity, tB = Infinity } = {}) {
  const { X, T } = W; let cash = P.start; const pos = {}, trades = [], equity = [], events = []; let pend = [], fees = 0, fund = 0;
  const eqAt = (t) => { let e = cash; for (const s in pos) { const p = pos[s], j = X[s].m.get(t), c = j != null ? X[s].d.c[j] : p.last; e += p.g * (c - p.e) * p.q - p.fund; } return e; };
  const close = (s, px, t, why) => { const p = pos[s], g = p.g, gross = g * (px - p.e) * p.q, fee = px * p.q * P.taker, pnl = gross - fee - p.fee0 - p.fund; cash += gross - fee - p.fund; fees += fee; fund += p.fund;
    trades.push({ sym: s, name: NAME[s] || s, side: p.side, kind: 'vbrk', in: isoT(p.t0), out: isoT(t), entry: r2(p.e, 6), exit: r2(px, 6), qty: p.q, lev: r2(p.e * p.q / p.eq0, 2), pnl: Math.round(pnl), pct: r2(pnl / p.eq0 * 100, 2), R: r2(pnl / p.risk, 2), days: r2((t - p.t0) / DAY, 2), funding: Math.round(-p.fund), reason: why, ai: p.why });
    events.push({ kind: 'close', t, sym: s, name: NAME[s] || s, side: p.side, pnl: Math.round(pnl), reason: why }); delete pos[s]; };
  let prevT = null;
  for (const t of T) {
    if (t < tA - 400 * H4) { prevT = t; continue; }
    // 1) 대기 주문: 이 봉 시가 진입
    for (const o of pend) {
      if (pos[o.s] || Object.keys(pos).length >= P.maxPos) continue; const x = X[o.s], j = x.m.get(t); if (j == null) continue;
      const eq = eqAt(prevT), e = x.d.o[j] * (1 + o.g * P.slipIn), Rd = x.atr[o.j] * P.stopAtr; let q = eq * P.riskPct / 100 / Rd;
      const used = Object.values(pos).reduce((a, p) => a + p.e * p.q, 0); q = Math.min(q, Math.max(0, (eq * P.maxLev - used) / e)); if (q * e < eq * 0.01) continue;
      const fee0 = e * q * P.taker; cash -= fee0; fees += fee0;
      pos[o.s] = { side: o.side, g: o.g, e, q, stop: e - o.g * Rd, best: e, t0: t, j0: j, risk: Rd * q, fee0, fund: 0, last: e, eq0: eq, why: o.why, trail: false };
      events.push({ kind: 'open', t, sym: o.s, name: NAME[o.s] || o.s, side: o.side, lev: r2(e * q / eq, 2) });
    }
    pend = [];
    // 2) 보유 관리
    for (const s of Object.keys(pos)) {
      const x = X[s], j = x.m.get(t); if (j == null) continue; const p = pos[s], g = p.g, d = x.d, o = d.o[j], h = d.h[j], l = d.l[j], c = d.c[j];
      if (new Date(t).getUTCHours() % 8 === 0) p.fund += g * fundRate(deriv, s, t, P) * o * p.q;
      if (j > p.j0 && (g > 0 ? o <= p.stop : o >= p.stop)) { close(s, o * (1 - g * P.slipStop), t, '손절(갭)'); continue; }
      if (g > 0 ? l <= p.stop : h >= p.stop) { close(s, p.stop * (1 - g * P.slipStop), t, p.trail && g * (p.stop - p.e) > 0 ? '추적 손절(이익)' : p.trail ? '추적 손절' : '손절'); continue; }
      p.best = g > 0 ? Math.max(p.best, h) : Math.min(p.best, l); p.last = c;
      if (x.atr[j]) { const ns = p.best - g * x.atr[j] * P.trail; if (g > 0 ? ns > p.stop : ns < p.stop) { p.stop = ns; p.trail = true; } }
      if (j - p.j0 >= P.maxBars - 1) { close(s, c * (1 - g * P.slipIn), t, '10일 정리'); continue; }
    }
    // 3) 이 봉 종가 신호 → 다음 봉 시가 (거래량이 큰 돌파부터)
    if (t >= tA && t < tB) {
      const cand = [];
      for (const s of W.syms) { if (pos[s]) continue; const x = X[s], j = x.m.get(t); if (j == null) continue; const c = signalAt(W, P, s, j); if (!c) continue;
        let why = (c.side === 'long' ? '20봉 고점 돌파' : '20봉 저점 이탈') + ' · 거래량 ' + r2(c.vol, 1) + '배';
        if (judge) { const r = judge(s, t, c, j); if (!r.ok) continue; if (r.why) why += ' · ' + r.why; }
        cand.push({ s, g: c.g, side: c.side, j, vol: c.vol, why }); }
      pend = cand.sort((a, b) => b.vol - a.vol);
    }
    equity.push([t, eqAt(t)]); prevT = t;
  }
  return { cash, pos, trades, equity, events, pend, fees, fund };
}
export function statsOf(equity, trades, P) {
  if (equity.length < 30) return null;
  const yrs = (equity.at(-1)[0] - equity[0][0]) / (365.25 * DAY), ret = equity.at(-1)[1] / equity[0][1] - 1; let pk = -Infinity, mdd = 0;
  const daily = []; let lastDay = null; equity.forEach(([t, v]) => { const k = Math.floor(t / DAY); if (k !== lastDay) { daily.push(v); lastDay = k; } else daily[daily.length - 1] = v; pk = Math.max(pk, v); mdd = Math.min(mdd, v / pk - 1); });
  const dr = daily.slice(1).map((v, i) => v / daily[i] - 1), m = dr.reduce((a, b) => a + b, 0) / (dr.length || 1), sd = Math.sqrt(dr.reduce((a, b) => a + (b - m) ** 2, 0) / (dr.length || 1));
  const gw = trades.filter((z) => z.pnl > 0).reduce((a, z) => a + z.pnl, 0), gl = -trades.filter((z) => z.pnl <= 0).reduce((a, z) => a + z.pnl, 0);
  return { ret: r2(ret * 100, 1), cagr: r2((Math.pow(1 + ret, 1 / Math.max(yrs, 0.1)) - 1) * 100, 1), mdd: r2(mdd * 100, 1), sharpe: r2(sd ? m / sd * Math.sqrt(365.25) : 0, 2), n: trades.length,
    win: r2(trades.filter((z) => z.pnl > 0).length / (trades.length || 1) * 100, 1), pf: r2(gl ? gw / gl : null, 2), avgR: r2(trades.reduce((a, z) => a + (z.R || 0), 0) / (trades.length || 1), 2), perDay: r2(trades.length / Math.max(1, dr.length), 2) };
}
function monthly(equity) { const out = []; let cur = null, v0 = null, vl = null; equity.forEach(([t, v]) => { const k = new Date(t).toISOString().slice(0, 7); if (k !== cur) { if (cur) out.push([cur, r2((vl / v0 - 1) * 100, 1)]); cur = k; v0 = vl == null ? v : vl; } vl = v; }); if (cur) out.push([cur, r2((vl / v0 - 1) * 100, 1)]); return out; }

/* ---------- 데이터 ---------- */
async function loadSeries({ fetchImpl, repo, now }) {
  const series = {};
  for (const c of MK_COINS) {
    try { const r = await fetchImpl('https://raw.githubusercontent.com/' + repo + '/deriv-data/k4-' + c.sym + '.json?t=' + Math.floor(now / 6e5)); if (!r.ok) continue; const K = await r.json();
      if (K.t && K.t.length > 1500) series[c.sym] = cleanTicks({ t: K.t, o: K.o, h: K.h, l: K.l, c: K.c, v: K.v }); } catch (e) { /* 없음 */ }
  }
  Object.values(series).forEach((d) => { while (d.t.length && d.t[d.t.length - 1] + H4 > now) Object.keys(d).forEach((k) => Array.isArray(d[k]) && d[k].pop()); }); // 안 끝난 봉 제거
  return series;
}

/* ---------- 학습 + 시험 ---------- */
export function study(W, P, deriv, now, log = () => {}) {
  const tA0 = Date.now(), samples = buildSamples(W, P, deriv), key = (s, t) => s + '|' + t;
  const warm = W.T[0] + 540 * DAY, step = 90 * DAY, pred = new Map(), folds = [];
  for (let ts = warm; ts < W.T.at(-1); ts += step) { const m = trainOn(samples, ts, P); if (!m) continue; folds.push({ from: isoT(ts).slice(0, 10), n: m.n, rate: r2(m.rate * 100, 1) }); samples.forEach((z) => { if (z.t >= ts && z.t < ts + step) pred.set(key(z.s, z.t), { p: predict(m, z.row), qs: m.qs }); }); }
  if (!folds.length) return null;
  const F0 = Date.parse(folds[0].from), T1 = W.T.at(-1) + 1, mid = Math.floor((F0 + T1) / 2);
  const J = (q, PP) => (q ? (s, t) => { const z = pred.get(key(s, t)); return { ok: !!z && z.p >= z.qs[q] }; } : null);
  const rows = [];
  for (const [name, q, over] of [['거래량 돌파 혼자 (비교 기준)', 0, {}], ['류신영 봇 (하위 50% 건너뜀)', 50, {}], ['하위 30% 건너뜀', 30, {}], ['거래량 조건 없이 (돌파만)', 0, { volx: 0 }], ['류신영 봇 · 비용 2배 (스트레스)', 50, { taker: P.taker * 2, slipIn: P.slipIn * 2, slipStop: P.slipStop * 2 }]]) {
    const PP = { ...P, ...over }, row = { name };
    for (const [k, a, b] of [['all', F0, T1], ['h1', F0, mid], ['h2', mid, T1]]) {
      const r = simulate(W, PP, deriv, { judge: J(q), tA: a, tB: b }), eq = r.equity.filter(([t]) => t >= a && t < b), tr = r.trades.filter((z) => Date.parse(z.in.replace(' ', 'T') + 'Z') >= a);
      row[k] = statsOf(eq, tr, PP) || {};
      if (k === 'all') { row.curve = thin(eq, 300).map(([t, v]) => [t.slice(0, 10), Math.round(v)]); row.monthly = monthly(eq); row.fees = Math.round(r.fees); }
    }
    rows.push(row); log('  시험 ' + name.padEnd(24) + ' 연 ' + row.all.cagr + '% · 낙폭 ' + row.all.mdd + '% · 샤프 ' + row.all.sharpe + ' · PF ' + row.all.pf + ' · 거래 ' + row.all.n + ' | 앞 ' + row.h1.ret + '% 뒤 ' + row.h2.ret + '%');
  }
  const B0 = rows[0].all, M0 = rows[1];
  const pass = { beats: (M0.all.sharpe || 0) > (B0.sharpe || 0), halves: M0.h1.ret > 0 && M0.h2.ret > 0, pf: (M0.all.pf || 0) >= 1.3, mdd: M0.all.mdd != null && M0.all.mdd > -25, trades: M0.all.n >= 40, stress: rows[4].all.ret > 0 };
  pass.ok = pass.beats && pass.halves && pass.pf && pass.mdd && pass.trades && pass.stress;
  const sc = samples.filter((z) => z.R != null && pred.has(key(z.s, z.t))).map((z) => [pred.get(key(z.s, z.t)).p, z.R]).sort((a, b) => a[0] - b[0]);
  const buckets = [0, 0.2, 0.4, 0.6, 0.8].map((f, q, arr) => { const a = Math.floor(f * sc.length), b = Math.floor((q === arr.length - 1 ? 1 : arr[q + 1]) * sc.length), z = sc.slice(a, b); return { q: Math.round(f * 100), n: z.length, avgR: z.length ? r2(z.reduce((s2, x) => s2 + x[1], 0) / z.length, 2) : null, win: z.length ? r2(z.filter((x) => x[1] > 0).length / z.length * 100, 0) : null }; });
  const mF = trainOn(samples, now + 1, P);
  return { mF, wf: { at: new Date(now).toISOString(), from: isoT(F0), to: isoT(W.T.at(-1)), step: '90일', folds, study: rows, pass, buckets, samples: samples.filter((z) => z.R != null).length, secs: Math.round((Date.now() - tA0) / 1000) } };
}

/* ---------- 실행 ---------- */
export async function run({ root = ROOT, dir = process.env.SCALP_DIR || process.env.MK_DIR || join(ROOT, 'data'), now = new Date(), log = console.log, env = loadEnv(), reset = false, sendPush = true, fetchImpl = fetch, data = null, derivData, retrain = false } = {}) {
  const t0 = Date.now(), P = RCFG, nowT = now.getTime();
  const repo = env.GITHUB_REPOSITORY || process.env.GITHUB_REPOSITORY || env.GITHUB_REPO || 'rudrl09202-bit/sijangnalssi';
  mkdirSync(dir, { recursive: true });
  const stFile = join(dir, 'rs-state.json'), outFile = join(dir, 'rs-live.json');
  let st = !reset && existsSync(stFile) ? JSON.parse(readFileSync(stFile, 'utf8')) : null;
  if (st && st.v !== 2) { log('류신영 봇 2세대로 바꿉니다 (1세대 15분봉 단타 계좌는 기록만 남기고 닫음)'); st = { v: 2, gen1: st.wf ? { at: st.wf.at, from: st.wf.from, to: st.wf.to, study: (st.wf.study || []).map((r) => ({ name: r.name, all: r.all })) } : null, gen1Live: st.acc ? { ret: r2((st.acc.cash / st.acc.start - 1) * 100, 2), n: (st.acc.trades || []).length } : null }; }
  if (!st) st = { v: 2 };
  st.judged = st.judged || {}; st.decisions = st.decisions || [];
  const lastBar = st.lastBar || 0, age = st.model ? nowT - Date.parse(st.model.at) : Infinity, needTrain = retrain || !st.model || st.model.v !== RS_V || age > 7 * DAY;
  // 새 4시간봉이 없으면 다시 받을 필요 없음 (서버가 봉 끝나고 5분 뒤 올림)
  if (!data && !needTrain && existsSync(outFile) && nowT < lastBar + 2 * H4 + 10 * 60e3) {
    const o = JSON.parse(readFileSync(outFile, 'utf8')); o.generatedAt = now.toISOString(); writeFileSync(outFile, JSON.stringify(o)); log('류신영 봇: 새 4시간봉 없음 — 그대로');
    try { await MAC.load({ dir, fetchImpl, now: nowT, log }); } catch (e) { log('세계 경제 신호 실패: ' + e.message); } // 세계 경제 신호·뉴스는 새 봉이 없어도 1시간마다 새로 받음 (앱 표시용)
    return o;
  }
  let deriv = derivData; if (deriv === undefined) { try { const r = await fetchImpl('https://raw.githubusercontent.com/' + repo + '/deriv-data/deriv.json?t=' + Math.floor(nowT / 6e5)); deriv = r.ok ? await r.json() : null; } catch (e) { deriv = null; } }
  const series = data || await loadSeries({ fetchImpl, repo, now: nowT });
  if (!series.BTC) { log('류신영 봇: 바이낸스 4시간봉 역사를 못 받아 이번엔 건너뜀'); return null; }
  const W = prepareRS(series), last = W.T.at(-1);

  // ── 1) 매주 다시 학습 + 시험
  if (needTrain) {
    log('류신영 봇 학습: 4시간봉 ' + W.syms.map((s) => s + ' ' + series[s].c.length).join(', '));
    const R = study(W, P, deriv, nowT, log);
    if (R && R.mF) { const mF = R.mF;
      st.model = { v: RS_V, at: now.toISOString(), trees: mF.trees, base: mF.base, qs: mF.qs, n: mF.n, rate: r2(mF.rate * 100, 1), ver: (st.model ? st.model.ver || 0 : 0) + 1,
        imp: FEATS_RS.map(([k2, label], f) => ({ k: k2, label, v: r2((mF.imp[f] || 0) * 100, 1) })).sort((a, b) => b.v - a.v) };
      st.wf = R.wf; log('류신영 봇 학습 완료: 모델 ' + st.model.ver + '번째 · 후보 ' + st.model.n + '개 · 합격 ' + (R.wf.pass.ok ? 'O' : 'X') + ' · ' + R.wf.secs + '초');
    }
  }

  // ── 2) 실시간 모의 계좌: 시작 시점부터 같은 엔진으로 다시 계산 (지난 판단은 저장된 그대로 사용)
  if (!st.inception) { st.inception = last; log('류신영 봇 2세대 모의 계좌를 새로 엽니다 (1억)'); }
  const M = st.model, passOk = st.wf && st.wf.pass && st.wf.pass.ok;
  const judge = (s, t, c, j) => {
    const k = s + '|' + t; if (st.judged[k]) return st.judged[k];
    let r;
    if (!M) r = { ok: false, p: null, why: '아직 학습 전 — 건너뜀' };
    else if (!passOk) r = { ok: false, p: null, why: '시험 불합격 — 쉼' };
    else { const row = featRow(W, s, j, c, deriv, P), p = row ? predict(M, row) : 0, ok = p >= M.qs[P.skipQ]; r = { ok, p: r2(p * 100, 0), why: '학습 점수 ' + Math.round(p * 100) + (ok ? ' (상위 절반 — 진입)' : ' (하위 절반 — 건너뜀)') }; }
    st.judged[k] = r; st.decisions.push({ t: isoT(t), sym: s, name: NAME[s] || s, side: c.side, kind: 'vbrk', p: r.p, ok: r.ok, why: r.why });
    return r;
  };
  const L = simulate(W, P, deriv, { judge, tA: st.inception });
  // 민경기 매매법용: 같은 판단 + 세계 경제 필터(위험 회피 신호 2개 이상이면 새 롱 쉼), 크기 1.25배 · 시작 시점부터
  //  지난 판단은 저장된 그대로(st.mgMacro) — 나중에 받은 데이터로 과거 결정이 바뀌지 않게
  let MAC_LIVE = null; try { MAC_LIVE = await MAC.load({ dir, fetchImpl, now: nowT, log }); } catch (e) { log('세계 경제 신호 실패: ' + e.message); }
  const MM = MAC.prepare(MAC_LIVE); st.mgMacro = st.mgMacro || {};
  const judgeM = (s, t, c, j) => { const r = judge(s, t, c, j); if (!r.ok || c.g < 0) return r; const k = s + '|' + t;
    if (st.mgMacro[k] == null) { const R = MAC.riskAt(MM, t); st.mgMacro[k] = R ? (R.blockLongs ? 1 : 0) : 0; }
    return st.mgMacro[k] ? { ok: false, p: r.p, why: r.why + ' · 세계 경제 위험 신호 2개 이상 — 롱 쉼' } : r; };
  const PM = { ...P, riskPct: P.riskPct * MG.k, maxLev: P.maxLev * MG.k }, LM = simulate(W, PM, deriv, { judge: judgeM, tA: MG.start });
  { const ks = Object.keys(st.mgMacro).filter((k) => +k.split('|')[1] >= MG.start - 400 * H4); st.mgMacro = Object.fromEntries(ks.slice(-400).map((k) => [k, st.mgMacro[k]])); }
  const eqL = L.equity.filter(([t]) => t >= st.inception), trL = L.trades.filter((z) => Date.parse(z.in.replace(' ', 'T') + 'Z') >= st.inception);
  const fresh = L.events.filter((e) => e.t > lastBar && e.t >= st.inception);
  // 저장 크기: 판단 기록은 최근 400개 · 시작 전 것은 버림
  const keys = Object.keys(st.judged).filter((k) => +k.split('|')[1] >= st.inception - 400 * H4); st.judged = Object.fromEntries(keys.slice(-400).map((k) => [k, st.judged[k]]));
  st.decisions = st.decisions.slice(-80); st.lastBar = last; st.updatedAt = now.toISOString();
  writeFileSync(stFile, JSON.stringify(st));

  // ── 3) 앱용
  const eq = Math.round(eqL.length ? eqL.at(-1)[1] : P.start), mark = (s) => series[s].c[series[s].c.length - 1];
  const posOf = (LL, eqx) => Object.entries(LL.pos).map(([s, p]) => { const m = mark(s), u = p.g * (m - p.e) * p.q - p.fund, j = W.X[s].m.get(last); return { sym: s, name: NAME[s] || s, side: p.side, kind: 'vbrk', entry: r2(p.e, 6), mark: m, lev: r2(m * p.q / eqx, 2), notional: Math.round(m * p.q), upnl: Math.round(u), stop: r2(p.stop, 6), trail: p.trail, tp: null, why: p.why, since: isoT(p.t0), barsLeft: Math.max(0, P.maxBars - 1 - (j - p.j0)) }; });
  const eqM = LM.equity.filter(([t]) => t >= MG.start), mEq = Math.round(eqM.length ? eqM.at(-1)[1] : P.start);
  const out = {
    v: 2, gen: 2, generatedAt: now.toISOString(), lastBar: isoT(last), inception: isoT(st.inception), tf: '4시간봉',
    cfg: { riskPct: P.riskPct, maxPos: P.maxPos, maxLev: P.maxLev, N: P.N, volx: P.volx, stopAtr: P.stopAtr, trailAtr: P.trail, maxBars: P.maxBars, skipQ: P.skipQ },
    model: M ? { ver: M.ver, at: M.at, n: M.n, rate: M.rate, imp: M.imp.slice(0, 10) } : null, wf: st.wf || null, gen1: st.gen1 || null, gen1Live: st.gen1Live || null,
    live: { equity: eq, start: P.start, ret: r2((eq / P.start - 1) * 100, 2), trades: trL.slice(-300).reverse(), n: trL.length, curve: thin(eqL.length ? eqL : [[last, P.start]]), status: !M ? 'learning' : passOk ? 'ok' : 'pause',
      positions: Object.entries(L.pos).map(([s, p]) => { const m = mark(s), u = p.g * (m - p.e) * p.q - p.fund, j = W.X[s].m.get(last); return { sym: s, name: NAME[s] || s, side: p.side, kind: 'vbrk', entry: r2(p.e, 6), mark: m, lev: r2(m * p.q / eq, 2), notional: Math.round(m * p.q), upnl: Math.round(u), stop: r2(p.stop, 6), trail: p.trail, tp: null, why: p.why, since: isoT(p.t0), barsLeft: Math.max(0, P.maxBars - 1 - (j - p.j0)) }; }),
      pending: L.pend.map((o) => ({ sym: o.s, name: NAME[o.s] || o.s, side: o.side, why: o.why })) },
    decisions: st.decisions.slice(-20).reverse(),
    mg: { k: MG.k, riskPct: PM.riskPct, maxLev: PM.maxLev, start: P.start, equity: mEq, ret: r2((mEq / P.start - 1) * 100, 2), curve: thin(eqM.length ? eqM : [[MG.start, P.start]]), trades: LM.trades.filter((z) => Date.parse(z.in.replace(' ', 'T') + 'Z') >= MG.start).slice(-200).reverse(), positions: posOf(LM, mEq), macro: MAC_LIVE && MAC_LIVE.now ? { at: MAC_LIVE.at, n: MAC_LIVE.now.n, blockLongs: MAC_LIVE.now.blockLongs } : null }
  };
  writeFileSync(outFile, JSON.stringify(out));
  log('류신영 봇: 모의 ' + out.live.ret + '% · 거래 ' + out.live.n + ' · 포지션 ' + out.live.positions.length + ' · 대기 ' + out.live.pending.length + ' · ' + ((Date.now() - t0) / 1000).toFixed(1) + '초');
  if (sendPush && fresh.length) {
    const sd = (s) => (s === 'long' ? '롱' : '숏');
    await push(env, { title: '류신영 봇 ' + fresh.length + '건', body: fresh.slice(-4).map((e) => (e.kind === 'open' ? sd(e.side) + ' 진입 ' + e.name + ' ' + e.lev + '배' : sd(e.side) + ' 청산 ' + e.name + ' ' + (e.pnl >= 0 ? '+' : '') + Math.round(e.pnl / 1e4) + '만')).join('\n'), url: './index.html#bot/rs', tag: 'snw-rs' }, log);
  }
  return out;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run({ reset: process.argv.includes('--reset'), retrain: process.argv.includes('--retrain') }).catch((e) => { console.error('✗ ' + e.message); process.exitCode = 1; })
  // 감시자(서울 서버 생존 확인)를 이어서 — 루프 본문이 바뀌기 전까지 여기서 부름
  .finally(async () => {
    const dir = process.env.SCALP_DIR || process.env.MK_DIR || join(ROOT, 'data');
    if (!process.env.PAIR_SEPARATE) { try { const PR = await import('./pair.mjs'); await PR.run({ dir }); } catch (e) { console.log('✗ 상대 모멘텀: ' + e.message); } } // 상대 모멘텀(민경기 4세대 후보) — 루프 본문이 바뀌기 전까지 여기서
    if (!process.env.MG_SEPARATE) { try { const G = await import('./mg.mjs'); await G.run({ dir }); } catch (e) { console.log('✗ 민경기 매매법: ' + e.message); } } // 민경기 매매법(류신영 50 + 상대 모멘텀 50, 1.25배)
    if (!process.env.WATCH_SEPARATE) { try { const W = await import('./watch.mjs'); await W.run({ dir }); } catch (e) { console.log('✗ 감시자: ' + e.message); } } });
