/* 민경기 봇 2세대 (학습형) — 코인 선물 1시간봉 롱·숏 모의투자
 *
 *  1) 데이터: 코인 8개 1시간봉 약 2년 (Yahoo)
 *  2) 재료(특징) 26개: 리만·나비에-스토크스 착안 지표 + 추세·변동성·거래량·비트코인 분위기·시간대
 *  3) 정답: 다음 봉 시가에 들어갔다면 손절(1.5ATR)보다 목표(2R)에 24시간 안에 먼저 닿았나 (롱·숏 따로)
 *  4) 학습: 그래디언트 부스팅(얕은 나무 여러 개) — 외부 패키지 없이 직접 구현
 *  5) 커닝 금지 시험(워크포워드): 과거 데이터로만 배우고, 그 뒤 30일은 처음 보는 데이터로 매매 → 30일씩 밀며 반복
 *  6) 진입: 수수료를 빼고도 기대 손익이 +0.1R 이상일 때만 (확률 × 2R − (1−확률) × 1R − 수수료)
 *  7) 매주 다시 학습, 실시간 모의 계좌는 매시간 판단 (실제 돈 아님)
 *  결과: <dir>/mk-live.json (앱), <dir>/mk-state.json (계좌·모델)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { loadEnv, loadQuant, push, cleanTicks } from './paper.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..');
const require = createRequire(import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HOUR = 3600e3, DAY = 864e5;
const isoT = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
const r2 = (x, n = 2) => (x == null || !isFinite(x) ? null : Math.round(x * 10 ** n) / 10 ** n);

export const MK_COINS = [
  { sym: 'BTC', name: '비트코인', y: 'BTC-USD' }, { sym: 'ETH', name: '이더리움', y: 'ETH-USD' }, { sym: 'SOL', name: '솔라나', y: 'SOL-USD' },
  { sym: 'XRP', name: '엑스알피', y: 'XRP-USD' }, { sym: 'DOGE', name: '도지코인', y: 'DOGE-USD' }, { sym: 'BNB', name: '바이낸스코인', y: 'BNB-USD' },
  { sym: 'ADA', name: '에이다', y: 'ADA-USD' }, { sym: 'LINK', name: '체인링크', y: 'LINK-USD' }
];
export const FEAT_V = 1; // 기본 재료를 바꾸면 올림 → 모델 새로 학습 (선물 데이터 재료가 붙으면 'f'·'o'가 덧붙음)
// 1시간봉 매매 규칙 (단타 엔진과 같은 안전장치, 시간 단위만 1시간)
export function mkCfg(SC) {
  return Object.assign({}, SC.CFG, { ml: true, bar: 60, riskPct: 1, maxPos: 3, stopAtr: 1.5, minStopPct: 0.8, tpR: 2, beR: 1, maxBars: 24, coolBars: 4, pauseBars: 12, killBars: 168, atrMaxPct: 6,
    names: Object.fromEntries(MK_COINS.map((c) => [c.sym, c.name])) });
}

/* ---------- 재료(특징) ---------- */
export const FEATS = [
  ['ret1', '1시간 수익(변동성 대비)'], ['ret4', '4시간 수익'], ['ret12', '12시간 수익'], ['ret24', '하루 수익'], ['ret72', '3일 수익'],
  ['mkZ', '파동 정렬 (리만)'], ['mkDev', '균형선 이탈 (리만)'], ['mkPhase', '변곡 시점 (리만)'], ['mkReg', '변곡 간격 고름 (리만)'],
  ['mkEr', '흐름 매끄러움 (나비에-스토크스)'], ['mkTi', '난류 지수 (나비에-스토크스)'],
  ['rsi', 'RSI'], ['bwR', '볼린저 폭 순위'], ['atrPct', '변동성(ATR %)'], ['atrR', '변동성 순위'],
  ['d20', '20EMA 거리'], ['d50', '50EMA 거리'], ['d200', '200EMA 거리'], ['vol', '거래량 배수'], ['rng', '48시간 범위 안 위치'],
  ['bRet24', '비트코인 하루 수익'], ['bZ', '비트코인 파동 정렬'], ['bTi', '비트코인 난류'],
  ['hs', '시간대(sin)'], ['hc', '시간대(cos)'], ['wkd', '주말']
];
// 선물 시장 재료 (서울 서버가 모은 바이낸스 데이터)
export const FUND_FEATS = [['fr', '펀딩비 (선물)'], ['f3', '펀딩비 3회 평균'], ['fz', '펀딩비 평소 대비']];
export const OI_FEATS = [['oi1', '미결제약정 1시간 변화'], ['oi24', '미결제약정 하루 변화'], ['lsr', '개인 롱숏 비율'], ['topr', '상위 트레이더 롱숏 비율'], ['tkr', '테이커 매수/매도']];
export const OI_MIN_DAYS = 90; // OI 계열은 바이낸스가 30일만 줘서 서버에 90일 쌓이면 자동으로 재료에 넣음
export function featList(deriv) { const useF = !!(deriv && deriv.coins && deriv.coins.BTC && deriv.coins.BTC.f.length > 500), useO = useF && deriv.cover && deriv.cover.oiDays >= OI_MIN_DAYS;
  return { list: FEATS.concat(useF ? FUND_FEATS : [], useO ? OI_FEATS : []), useF, useO, fv: FEAT_V + (useF ? 'f' : '') + (useO ? 'o' : '') }; }
function derivCols(deriv, sym, T, useO) {
  const D = deriv.coins[sym]; if (!D) return null;
  const f = D.f, n = T.length, fr = new Array(n).fill(null), f3 = new Array(n).fill(null), fz = new Array(n).fill(null);
  let k = -1;
  for (let i = 0; i < n; i++) {
    const close = T[i] + HOUR; while (k + 1 < f.length && f[k + 1][0] <= close) k++;
    if (k < 0) continue; fr[i] = f[k][1] * 1e4; if (k >= 2) f3[i] = (f[k][1] + f[k - 1][1] + f[k - 2][1]) / 3 * 1e4;
    if (k >= 89) { let m = 0; for (let j = k - 89; j <= k; j++) m += f[j][1]; m /= 90; let v = 0; for (let j = k - 89; j <= k; j++) v += (f[j][1] - m) ** 2; v = Math.sqrt(v / 90); fz[i] = v ? (f[k][1] - m) / v : 0; }
  }
  const out = { fr, f3, fz };
  if (useO) {
    const at = (S, t, back) => { if (!S || S.t0 == null) return null; const i = Math.floor((t - S.t0) / HOUR) - back; return i >= 0 && i < S.v.length ? S.v[i] : null; };
    const lg = (a, b) => (a > 0 && b > 0 ? Math.log(a / b) : null), ln = (a) => (a > 0 ? Math.log(a) : null);
    out.oi1 = T.map((t) => lg(at(D.oi, t, 0), at(D.oi, t, 1))); out.oi24 = T.map((t) => lg(at(D.oi, t, 0), at(D.oi, t, 24)));
    out.lsr = T.map((t) => ln(at(D.ls, t, 0))); out.topr = T.map((t) => ln(at(D.top, t, 0))); out.tkr = T.map((t) => ln(at(D.tk, t, 0)));
  }
  return out;
}
function sdArr(r, n) { const out = new Array(r.length).fill(null); for (let i = n; i < r.length; i++) { let m = 0; for (let j = i - n + 1; j <= i; j++) m += r[j]; m /= n; let v = 0; for (let j = i - n + 1; j <= i; j++) v += (r[j] - m) ** 2; out[i] = Math.sqrt(v / n); } return out; }
export function buildFeatures(W, deriv) {
  const B = W.X.BTC, F = {}, FL = featList(deriv);
  for (const s of W.syms) {
    const x = W.X[s], d = x.d, n = d.c.length, lr = d.c.map((v, i) => (i ? Math.log(v / d.c[i - 1]) : 0)), sd = sdArr(lr, 72);
    const atrP = x.atr.map((a, i) => (a == null ? null : a / d.c[i] * 100)), atrR = SC_.pctRank(atrP, 500);
    const rows = new Array(n).fill(null);
    const DC = FL.useF ? derivCols(deriv, s, d.t, FL.useO) : null;
    // 이 코인 봉 → 비트코인 봉 위치
    const bIdx = new Map(); B.d.t.forEach((t, i) => bIdx.set(t, i));
    for (let i = 0; i < n; i++) {
      if (i < 260 || sd[i] == null || !sd[i] || x.eS[i] == null || x.atr[i] == null || x.mkZ[i] == null || x.mkTi[i] == null || x.bwR[i] == null) continue;
      const rk = (k) => Math.log(d.c[i] / d.c[i - k]) / (sd[i] * Math.sqrt(k)), a = x.atr[i], c = d.c[i];
      let hi = -Infinity, lo = Infinity; for (let j = i - 47; j <= i; j++) { if (d.h[j] > hi) hi = d.h[j]; if (d.l[j] < lo) lo = d.l[j]; }
      const bj = bIdx.get(d.t[i]); if (bj == null || B.mkZ[bj] == null || B.mkTi[bj] == null || bj < 24) continue;
      const hr = new Date(d.t[i]).getUTCHours(), dw = new Date(d.t[i]).getUTCDay();
      rows[i] = [rk(1), rk(4), rk(12), rk(24), rk(72), x.mkZ[i], x.mkDev[i], x.mkPhase[i] == null ? 1 : Math.min(x.mkPhase[i], 4), x.mkReg[i] == null ? 0 : x.mkReg[i], x.mkEr[i], x.mkTi[i],
        x.rsi[i], x.bwR[i], atrP[i], atrR[i] == null ? 0.5 : atrR[i], (c - x.eP[i]) / a, (c - x.eF[i]) / a, (c - x.eS[i]) / a,
        x.vAvg[i] ? Math.min((d.v[i] || 0) / x.vAvg[i], 6) : 1, hi > lo ? (c - lo) / (hi - lo) : 0.5,
        Math.log(B.d.c[bj] / B.d.c[bj - 24]), B.mkZ[bj], B.mkTi[bj], Math.sin(hr / 24 * 2 * Math.PI), Math.cos(hr / 24 * 2 * Math.PI), dw === 0 || dw === 6 ? 1 : 0];
      if (FL.useF) { rows[i].push(DC ? DC.fr[i] : null, DC ? DC.f3[i] : null, DC ? DC.fz[i] : null); }
      if (FL.useO) { rows[i].push(...['oi1', 'oi24', 'lsr', 'topr', 'tkr'].map((k) => (DC ? DC[k][i] : null))); }
    }
    F[s] = rows;
  }
  return F;
}
let SC_ = null; // scalp.js 지표 도우미

/* ---------- 정답: 다음 봉 시가 진입 → 목표(2R)가 손절(1R)보다 먼저? (24시간 안, 둘 다 닿은 봉은 손절로) ---------- */
export function buildLabels(W, P) {
  const L = {};
  for (const s of W.syms) {
    const x = W.X[s], d = x.d, n = d.c.length, yl = new Array(n).fill(null), ys = new Array(n).fill(null);
    for (let i = 0; i < n - 1 - P.maxBars; i++) {
      if (x.atr[i] == null) continue;
      const e = d.o[i + 1], sd = Math.max(x.atr[i] * P.stopAtr, e * P.minStopPct / 100);
      for (const side of ['long', 'short']) {
        const g = side === 'long' ? 1 : -1, stop = e - g * sd, tp = e + g * sd * P.tpR; let y = 0;
        for (let j = i + 1; j <= i + P.maxBars; j++) {
          const hitS = g > 0 ? d.l[j] <= stop : d.h[j] >= stop, hitT = g > 0 ? d.h[j] >= tp : d.l[j] <= tp;
          if (hitS) { y = 0; break; } if (hitT) { y = 1; break; }
        }
        (side === 'long' ? yl : ys)[i] = y;
      }
    }
    L[s] = { long: yl, short: ys };
  }
  return L;
}

/* ---------- 그래디언트 부스팅 (로지스틱 손실, 히스토그램 분할) ---------- */
const NB = 32;
function binEdges(X, f) { const v = X.map((r) => r[f]).filter((z) => z != null && isFinite(z)).sort((a, b) => a - b); const e = []; for (let k = 1; k < NB; k++) e.push(v[Math.floor(k / NB * (v.length - 1))]); return Array.from(new Set(e)); }
function binOf(edges, z) { let lo = 0, hi = edges.length; while (lo < hi) { const m = (lo + hi) >> 1; if (z > edges[m]) lo = m + 1; else hi = m; } return lo; }
export function trainGBM(X, y, { rounds = 120, depth = 3, lr = 0.06, minLeaf = 150, lambda = 5, sub = 0.5, seed = 7 } = {}) {
  const n = X.length, F = X[0].length, edges = [], B = [];
  for (let f = 0; f < F; f++) edges.push(binEdges(X, f));
  for (let f = 0; f < F; f++) { const col = new Uint8Array(n); for (let i = 0; i < n; i++) col[i] = binOf(edges[f], X[i][f]); B.push(col); }
  const base = Math.log((y.reduce((a, b) => a + b, 0) + 1) / (n - y.reduce((a, b) => a + b, 0) + 1)), raw = new Float64Array(n).fill(base);
  let rs = seed; const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
  const trees = [], gainF = new Float64Array(F);
  for (let r = 0; r < rounds; r++) {
    const g = new Float64Array(n), h = new Float64Array(n);
    for (let i = 0; i < n; i++) { const p = 1 / (1 + Math.exp(-raw[i])); g[i] = p - y[i]; h[i] = Math.max(p * (1 - p), 1e-6); }
    let idx = []; for (let i = 0; i < n; i++) if (rnd() < sub) idx.push(i);
    const tree = [];
    const grow = (rows, lvl) => {
      let G = 0, H = 0; for (const i of rows) { G += g[i]; H += h[i]; }
      const node = { leaf: -G / (H + lambda) * lr }; tree.push(node); const me = tree.length - 1;
      if (lvl >= depth || rows.length < minLeaf * 2) return me;
      let best = null;
      for (let f = 0; f < F; f++) {
        if (rnd() > 0.7) continue;
        const hg = new Float64Array(NB), hh = new Float64Array(NB), hc = new Int32Array(NB), col = B[f];
        for (const i of rows) { const b = col[i]; hg[b] += g[i]; hh[b] += h[i]; hc[b]++; }
        let gl = 0, hl = 0, cl = 0;
        for (let b = 0; b < NB - 1; b++) {
          gl += hg[b]; hl += hh[b]; cl += hc[b];
          if (cl < minLeaf || rows.length - cl < minLeaf) continue;
          const gr = G - gl, hr = H - hl, gain = gl * gl / (hl + lambda) + gr * gr / (hr + lambda) - G * G / (H + lambda);
          if (!best || gain > best.gain) best = { gain, f, b };
        }
      }
      if (!best || best.gain <= 0) return me;
      gainF[best.f] += best.gain;
      const L = [], R = []; for (const i of rows) (B[best.f][i] <= best.b ? L : R).push(i);
      node.f = best.f; node.t = best.b < edges[best.f].length ? edges[best.f][best.b] : Infinity; delete node.leaf;
      node.l = grow(L, lvl + 1); node.r = grow(R, lvl + 1);
      return me;
    };
    grow(idx, 0);
    // 이번 나무를 전체 행에 반영
    for (let i = 0; i < n; i++) raw[i] += evalTree(tree, X[i]);
    trees.push(tree);
  }
  const tot = gainF.reduce((a, b) => a + b, 0) || 1;
  return { base, trees, imp: Array.from(gainF).map((v) => v / tot) };
}
function evalTree(tree, row) { let k = 0; for (;;) { const nd = tree[k]; if (nd.leaf != null) return nd.leaf; const z = row[nd.f]; k = z == null || !isFinite(z) || z <= nd.t ? nd.l : nd.r; } }
export function predict(model, row) { let s = model.base; for (const t of model.trees) s += evalTree(t, row); return 1 / (1 + Math.exp(-s)); }
// 저장 크기 줄이기
const packModel = (m) => ({ base: r2(m.base, 6), imp: m.imp.map((v) => r2(v, 4)), trees: m.trees.map((t) => t.map((nd) => (nd.leaf != null ? { leaf: r2(nd.leaf, 6) } : { f: nd.f, t: r2(nd.t, 6), l: nd.l, r: nd.r }))) });

/* ---------- 학습 데이터 모으기 (기간 [a, b) 의 봉, 2봉에 하나씩 — 붙은 봉은 거의 같은 정보) ---------- */
function collect(W, F, L, side, tA, tB, step = 2) {
  const X = [], y = [];
  for (const s of W.syms) { const d = W.X[s].d, rows = F[s], lab = L[s][side];
    for (let i = 0; i < d.t.length; i += step) { if (d.t[i] < tA || d.t[i] >= tB || !rows[i] || lab[i] == null) continue; X.push(rows[i]); y.push(lab[i]); } }
  return { X, y };
}
export function trainPair(W, F, L, tA, tB, opts) {
  const m = {};
  for (const side of ['long', 'short']) { const { X, y } = collect(W, F, L, side, tA, tB); if (X.length < 2000) return null; m[side] = trainGBM(X, y, opts); m[side].n = X.length; m[side].rate = y.reduce((a, b) => a + b, 0) / y.length; }
  return m;
}
// 확률 → 진입 신호 (기대 손익이 margin R 이상일 때)
// 보정: 시험 기간에 "모델이 p라고 했을 때 실제 성공률"로 바꿈 (모델이 자신을 과신하면 자동으로 덜 들어감)
export function calibrate(cal, p) {
  if (!cal || !cal.length) return p;
  const pts = cal.filter((c) => c.n >= 300 && c.pred != null).map((c) => [c.pred / 100, c.real / 100]);
  if (pts.length < 2) return p;
  if (p <= pts[0][0]) return pts[0][1];
  for (let k = 1; k < pts.length; k++) if (p <= pts[k][0]) { const [a, b] = pts[k - 1], [c, d] = pts[k]; return b + (d - b) * (p - a) / (c - a); }
  return pts[pts.length - 1][1];
}
export function signalOf(m, row, x, i, P, margin, cal) {
  const pl = calibrate(cal, predict(m.long, row)), ps = calibrate(cal, predict(m.short, row)), c = x.d.c[i], sd = Math.max(x.atr[i] * P.stopAtr, c * P.minStopPct / 100);
  const feeR = 2 * (P.taker + P.slipIn) * c / sd, ev = (p) => p * P.tpR - (1 - p) - feeR;
  const el = ev(pl), es = ev(ps), side = el >= es ? 'long' : 'short', e = Math.max(el, es), p = side === 'long' ? pl : ps;
  return { pl, ps, feeR, sig: e >= margin ? { side, p: r2(p, 3), ev: r2(e, 2), why: '학습 모델: ' + (side === 'long' ? '롱' : '숏') + ' 성공 확률 ' + Math.round(p * 100) + '% · 기대 ' + (e >= 0 ? '+' : '') + e.toFixed(2) + 'R (수수료 ' + feeR.toFixed(2) + 'R 뺌)' } : null };
}

/* ---------- 워크포워드 시험 ---------- */
export function walkForward(W, F, L, P, { warmDays = 180, stepDays = 30, margin = 0, log = () => {}, opts } = {}) {
  const t0 = W.T[0], tEnd = W.T[W.T.length - 1], purge = (P.maxBars + 1) * HOUR;
  const sig = {}; W.syms.forEach((s) => { sig[s] = new Array(W.X[s].d.t.length).fill(null); });
  const probs = []; let folds = 0, first = null;
  for (let ts = t0 + warmDays * DAY; ts < tEnd; ts += stepDays * DAY) {
    const m = trainPair(W, F, L, t0, ts - purge, opts); if (!m) continue; folds++; if (first == null) first = ts;
    for (const s of W.syms) { const x = W.X[s], rows = F[s];
      for (let i = 0; i < x.d.t.length; i++) { const t = x.d.t[i]; if (t < ts || t >= ts + stepDays * DAY || !rows[i]) continue;
        const o = signalOf(m, rows[i], x, i, P, margin); sig[s][i] = o.sig;
        const yl = L[s].long[i], ys = L[s].short[i]; if (yl != null) probs.push([o.pl, yl]); if (ys != null) probs.push([o.ps, ys]); } }
    log('  학습 구간 ~' + isoT(ts).slice(0, 10) + ' → 다음 ' + stepDays + '일 시험');
  }
  return { sig, probs, folds, from: first };
}
function runAcc(SC, W, P, sig, iA, iB) {
  W.syms.forEach((s) => { W.X[s].mlSig = sig[s]; });
  const ac = SC.newAccount(P); SC.simulate(W, P, ac, iA, iB); return ac;
}
function calib(probs) { // 예측 확률 구간별 실제 성공률
  const B = [[0, 0.25], [0.25, 0.3], [0.3, 0.35], [0.35, 0.4], [0.4, 0.45], [0.45, 1]];
  return B.map(([a, b]) => { const z = probs.filter(([p]) => p >= a && p < b); return { from: a, to: b, n: z.length, pred: z.length ? r2(z.reduce((s, q) => s + q[0], 0) / z.length * 100, 1) : null, real: z.length ? r2(z.reduce((s, q) => s + q[1], 0) / z.length * 100, 1) : null }; });
}

/* ---------- 시세 ---------- */
async function yahoo1h(sym, fetchImpl) {
  const H = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com']; let err;
  for (let k = 0; k < 4; k++) {
    try {
      const res = await fetchImpl(H[k % 2] + '/v8/finance/chart/' + encodeURIComponent(sym) + '?period1=' + Math.floor((Date.now() - 728 * DAY) / 1000) + '&period2=' + Math.floor(Date.now() / 1000) + '&interval=60m', { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', Accept: 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json(), rr = j.chart.result[0], q = rr.indicators.quote[0], out = { t: [], o: [], h: [], l: [], c: [], v: [] };
      rr.timestamp.forEach((ts, i) => { const c = q.close[i]; if (c == null || !isFinite(c)) return; out.t.push(ts * 1000); out.o.push(q.open[i] ?? c); out.h.push(q.high[i] ?? c); out.l.push(q.low[i] ?? c); out.c.push(c); out.v.push(q.volume[i] || 0); });
      return out;
    } catch (e) { err = e; await sleep(800 * (k + 1)); }
  }
  throw err;
}
function toHour(k, now) {
  const keep = []; k.t.forEach((t, i) => { if (t % HOUR === 0 && t + HOUR <= now && (!keep.length || k.t[keep[keep.length - 1]] < t)) keep.push(i); });
  return cleanTicks({ t: keep.map((i) => k.t[i]), o: keep.map((i) => k.o[i]), h: keep.map((i) => k.h[i]), l: keep.map((i) => k.l[i]), c: keep.map((i) => k.c[i]), v: keep.map((i) => k.v[i]) });
}

/* ---------- 실행 ---------- */
export async function run({ root = ROOT, dir = process.env.MK_DIR || join(ROOT, 'data'), now = new Date(), log = console.log, env = loadEnv(), reset = false, sendPush = true, fetchImpl = fetch, data = null, retrain = false, derivData } = {}) {
  const t0 = Date.now(), SC = require(join(root, 'js', 'scalp.js')), Q = loadQuant(root), P = mkCfg(SC); SC_ = SC._;
  const series = {}, errors = [];
  if (data) Object.assign(series, data);
  else for (const c of MK_COINS) { try { series[c.sym] = toHour(await yahoo1h(c.y, fetchImpl), now.getTime()); } catch (e) { errors.push(c.sym + ': ' + e.message); } await sleep(250); }
  if (!series.BTC || series.BTC.c.length < 3000) throw new Error('BTC 1시간봉 부족 ' + (series.BTC ? series.BTC.c.length : 0) + ' ' + errors.join(' / '));
  let deriv = null;
  if (derivData !== undefined) deriv = derivData;
  else { try { const repo = env.GITHUB_REPOSITORY || process.env.GITHUB_REPOSITORY || env.GITHUB_REPO || 'rudrl09202-bit/sijangnalssi'; const r = await fetchImpl('https://raw.githubusercontent.com/' + repo + '/deriv-data/deriv.json?t=' + Date.now()); if (r.ok) deriv = await r.json(); } catch (e) { /* 아직 없음 */ } }
  const FL = featList(deriv);
  const W = SC.prepare(series, P), last = W.T.length - 1, F = buildFeatures(W, deriv), L = buildLabels(W, P);
  log('재료 ' + FL.list.length + '개' + (FL.useF ? ' (선물 펀딩비 포함' + (FL.useO ? ' · 미결제약정·롱숏 포함' : ' · 미결제약정은 ' + ((deriv.cover && deriv.cover.oiDays) || 0) + '/' + OI_MIN_DAYS + '일 쌓는 중') + ')' : ' (선물 데이터 아직 없음)'));
  log('민경기 봇 1시간봉 ' + W.syms.map((s) => s + ' ' + series[s].c.length).join(', ') + ' · 마지막 ' + isoT(W.T[last]) + ' UTC');

  mkdirSync(dir, { recursive: true });
  const stFile = join(dir, 'mk-state.json');
  let st = !reset && existsSync(stFile) ? JSON.parse(readFileSync(stFile, 'utf8')) : null;
  if (!st) st = { v: 1, inception: W.T[last], acc: null, model: null, wf: null };

  // ── 1) 매주 다시 학습 (+ 워크포워드 시험 다시)
  const age = st.model ? now.getTime() - Date.parse(st.model.at) : Infinity;
  if (retrain || !st.model || st.model.fv !== FL.fv || age > 7 * DAY) {
    const tA = Date.now();
    const wf = walkForward(W, F, L, P, { log });
    const iA = W.T.findIndex((t) => t >= wf.from), half = Math.floor((iA + last) / 2);
    const study = [];
    for (const [name, margin, over] of [['민경기 봇 (기대 +0.1R 이상)', 0.1, {}], ['기준 낮춤 (0R 이상)', 0, {}], ['기준 높임 (+0.3R 이상)', 0.3, {}], ['롱만', 0.1, { only: 'long' }], ['숏만', 0.1, { only: 'short' }]]) {
      const sg = {}; W.syms.forEach((s) => { sg[s] = wf.sig[s].map((g) => { if (!g) return null; if (over.only && g.side !== over.only) return null; return g.ev >= margin ? g : null; }); });
      const row = { name };
      for (const [k, a, b] of [['all', iA, last], ['h1', iA, half], ['h2', half, last]]) {
        const ac = runAcc(SC, W, P, sg, a, b), s2 = SC.stats(ac);
        row[k] = { ret: r2((ac.equity[ac.equity.length - 1][1] / ac.start - 1) * 100, 1), n: s2.trades, win: s2.winRate, pf: s2.pf, avgR: s2.avgR };
        if (k === 'all' && !study.length) { const dc = SC.daily(ac.equity), mt = Q.metrics(dc, ac.trades) || {}; row.mdd = mt.mdd ?? null; row.cagr = mt.cagr ?? null; row.sharpe = mt.sharpe ?? null; row.curve = dc.filter((e, k2, a2) => k2 % 3 === 0 || k2 === a2.length - 1); row.monthly = mt.monthly || null; row.recent = ac.trades.slice(-12).reverse(); row.fees = Math.round(ac.feesPaid); }
      }
      study.push(row);
      log('  시험 ' + name.padEnd(20) + ' ' + row.all.ret + '% (' + row.all.n + '번, 승률 ' + row.all.win + '%, PF ' + row.all.pf + ') · 앞 ' + row.h1.ret + '% · 뒤 ' + row.h2.ret + '%');
    }
    // 처음 시험 결과 대비 기준: 거래 50번↑ · 앞뒤 모두 플러스 · PF 1.2↑ · 최대낙폭 -20% 이내
    const m0 = study[0], pass = { trades: m0.all.n >= 50, halves: m0.h1.ret > 0 && m0.h2.ret > 0, pf: (m0.all.pf || 0) >= 1.2, mdd: m0.mdd != null && m0.mdd > -20 };
    pass.ok = pass.trades && pass.halves && pass.pf && pass.mdd;
    // 최종 모델: 지금까지 정답이 나온 모든 데이터로
    const mFull = trainPair(W, F, L, W.T[0], W.T[last] - (P.maxBars + 1) * HOUR);
    const imp = FL.list.map(([k, label], f) => ({ k, label, v: r2(((mFull.long.imp[f] || 0) + (mFull.short.imp[f] || 0)) / 2 * 100, 1) })).sort((a, b) => b.v - a.v);
    st.model = { at: now.toISOString(), fv: FL.fv, long: packModel(mFull.long), short: packModel(mFull.short), n: mFull.long.n + mFull.short.n, rate: { long: r2(mFull.long.rate * 100, 1), short: r2(mFull.short.rate * 100, 1) }, imp, ver: (st.model ? st.model.ver || 0 : 0) + 1 };
    st.wf = { at: now.toISOString(), folds: wf.folds, from: isoT(wf.from), to: isoT(W.T[last]), study, pass, calib: calib(wf.probs), secs: Math.round((Date.now() - tA) / 1000) };
    log('학습 완료: 모델 ' + st.model.ver + '번째 · 학습 데이터 ' + st.model.n + '개 · 시험 ' + wf.folds + '구간 · ' + st.wf.secs + '초 · 합격 ' + (pass.ok ? 'O' : 'X'));
  }

  // ── 2) 실시간 모의 계좌 (매시간 마감 봉에서 판단)
  const M = { long: st.model.long, short: st.model.short };
  const CAL = st.wf && st.wf.calib; // 실시간은 '보정된 확률'로 판단
  if (st.calV !== 1 && st.acc) { st.acc.pending = st.acc.pending.filter((o) => o.kind !== 'open'); st.calV = 1; log('보정 도입: 보정 전 신호로 걸린 대기 주문 취소'); }
  const liveSig = {}; W.syms.forEach((s) => { liveSig[s] = new Array(W.X[s].d.t.length).fill(null); });
  if (!st.acc) { st.acc = SC.newAccount(P); st.inception = W.T[last]; log('민경기 봇(학습형) 모의 계좌를 새로 엽니다'); }
  const from = st.acc.lastT == null ? last : W.T.findIndex((t) => t > st.acc.lastT);
  const reads = [];
  for (const s of W.syms) { const x = W.X[s], rows = F[s];
    for (let i = from >= 0 ? Math.max(0, x.map[from] < 0 ? x.map[last] : x.map[from]) : x.d.t.length; i < x.d.t.length; i++) { if (!rows[i]) continue; liveSig[s][i] = signalOf(M, rows[i], x, i, P, 0.1, CAL).sig; }
    const j = x.map[last]; if (j >= 0 && rows[j]) { const o = signalOf(M, rows[j], x, j, P, 0.1, CAL); reads.push({ sym: s, name: P.names[s], pl: r2(o.pl * 100, 1), ps: r2(o.ps * 100, 1), feeR: r2(o.feeR, 2), sig: o.sig, price: x.d.c[j] }); } }
  if (from >= 0) { W.syms.forEach((s) => { W.X[s].mlSig = liveSig[s]; }); SC.simulate(W, P, st.acc, from, last, { collect: true }); }
  const fresh = st.acc.events.slice(); st.acc.events = []; st.updatedAt = now.toISOString();
  writeFileSync(stFile, JSON.stringify(st));

  // ── 3) 앱용
  const A = st.acc, eq = A.equity.length ? A.equity[A.equity.length - 1][1] : A.cash, mark = (s) => series[s].c[series[s].c.length - 1];
  const out = {
    v: 1, generatedAt: now.toISOString(), lastBar: isoT(W.T[last]), inception: isoT(st.inception), cfg: { riskPct: P.riskPct, maxPos: P.maxPos, stopAtr: P.stopAtr, minStopPct: P.minStopPct, tpR: P.tpR, maxBars: P.maxBars, dayLoss: P.dayLoss, ddKill: P.ddKill, maxLevTotal: P.maxLevTotal },
    model: { at: st.model.at, ver: st.model.ver, n: st.model.n, rate: st.model.rate, imp: st.model.imp, feats: FL.list.length, coins: W.syms.length, from: isoT(W.T[0]) },
    wf: st.wf,
    live: { equity: eq, start: A.start, ret: r2((eq / A.start - 1) * 100, 2), stats: SC.stats(A), trades: A.trades.slice(-20).reverse(), curve: A.equity.slice(-500).filter((e, k, a) => k % 2 === 0 || k === a.length - 1).map(([t, v]) => [isoT(t), v]),
      status: A.killUntilT > W.T[last] ? 'killed' : A.dayBlock ? 'dayblock' : A.pauseUntilT > W.T[last] ? 'pause' : 'ok',
      positions: Object.values(A.pos).map((p) => { const m = mark(p.sym), u = (p.side === 'long' ? 1 : -1) * (m - p.entry) * p.qty; return { sym: p.sym, name: p.name, side: p.side, entry: p.entry, mark: m, lev: r2(m * p.qty / eq, 2), upnl: Math.round(u), stop: p.stop, tp: p.tp, liq: p.liq, be: p.be, why: p.why, since: isoT(p.t), barsLeft: Math.max(0, P.maxBars - 1 - Math.round((W.T[last] - p.t) / HOUR)) }; }),
      pending: A.pending.filter((o) => o.kind === 'open').map((o) => ({ sym: o.sym, name: o.name, side: o.side, why: o.why, fillAt: isoT(W.T[last] + HOUR) })) },
    read: reads, errors,
    deriv: deriv ? { updatedAt: deriv.updatedAt, cover: deriv.cover, useF: FL.useF, useO: FL.useO, need: OI_MIN_DAYS } : null
  };
  writeFileSync(join(dir, 'mk-live.json'), JSON.stringify(out));
  log('민경기 봇(학습형): 모의 ' + out.live.ret + '% · 거래 ' + out.live.stats.trades + ' · 포지션 ' + out.live.positions.length + ' · 신호 ' + reads.filter((r) => r.sig).map((r) => r.name + ' ' + (r.sig.side === 'long' ? '롱' : '숏')).join(', ') + ' · ' + ((Date.now() - t0) / 1000).toFixed(1) + '초');
  const moves = fresh.filter((e) => e.kind === 'open' || e.kind === 'close');
  if (sendPush && moves.length) {
    const side = (s) => (s === 'long' ? '롱' : '숏');
    await push(env, { title: '민경기 봇 ' + moves.length + '건', body: moves.slice(-4).map((e) => (e.kind === 'open' ? side(e.side) + ' 진입 ' + e.name + ' ' + e.lev + '배' : side(e.side) + ' 청산 ' + e.name + ' ' + (e.pnl >= 0 ? '+' : '') + Math.round(e.pnl / 1e4) + '만')).join('\n'), url: './index.html#mk', tag: 'snw-mk' }, log);
  }
  return out;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run({ reset: process.argv.includes('--reset'), retrain: process.argv.includes('--retrain') }).catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
