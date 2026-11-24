/* 민경기 봇 3세대 — 추세 돌파(검증된 우위) + 학습 필터(메타 라벨링) · 코인 선물 4시간봉 롱·숏 모의투자
 *
 *  1차 후보: FLUX 와 같은 추세 돌파 규칙 (40봉 고점 돌파 + 50/200 EMA 정배열 / 저점 이탈 + 역배열 + BTC 하락장)
 *  2차 판단: 학습 모델이 "이 후보가 이익으로 끝날 확률"을 계산 → 낮은 후보는 건너뛰고, 높은 후보는 크게
 *  정답: 그 후보를 실제 규칙(2.5ATR 손절 · 3ATR 추적 손절 · 추세 꺾이면 정리)대로 했을 때 이익이었나
 *  데이터: 바이낸스 선물 4시간봉 전체 역사(서울 서버 수집) — 없으면 야후 1시간봉을 4시간으로 묶어 씀
 *  시험: 과거로만 배우고(끝난 거래만 정답으로) 다음 90일을 매매 → 반복. 'FLUX 혼자'와 같은 기간·같은 규칙으로 비교
 *  결과: <dir>/mk3-live.json · <dir>/mk3-state.json
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { loadEnv, loadQuant, push, cleanTicks } from './paper.mjs';
import { trainGBM, predict, MK_COINS } from './mk.mjs';
import { yahoo, to4h } from './futures.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..');
const require = createRequire(import.meta.url);
const H4 = 4 * 3600e3, DAY = 864e5;
const isoT = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
const thin = (eq, n = 500) => { const k = Math.max(1, Math.ceil(eq.length / n)); return eq.filter((e, i) => i % k === 0 || i === eq.length - 1).map(([t, v]) => [isoT(t), v]); }; // 자산 곡선: 처음부터 끝까지 최대 500점
const r2 = (x, n = 2) => (x == null || !isFinite(x) ? null : Math.round(x * 10 ** n) / 10 ** n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const MK3_V = 2; // 2: 기본 정책 = 하위 50% 건너뜀(크게 들어가기 없음) — 6년 시험에서 상위 점수 묶음이 더 낫지 않았음

export const FEATS3 = [
  ['side', '방향 (롱/숏)'], ['str', '돌파 세기'], ['atrP', '변동성(ATR %)'], ['atrR', '변동성 순위'], ['dS', '200EMA 거리 (진행 방향)'], ['slope', '50EMA 기울기 (진행 방향)'],
  ['r6', '하루 수익 (진행 방향)'], ['r18', '3일 수익 (진행 방향)'], ['r42', '7일 수익 (진행 방향)'], ['rsi', 'RSI (진행 방향)'],
  ['mkZ', '파동 정렬 (리만)'], ['mkDev', '균형선 이탈 (리만)'], ['mkReg', '변곡 간격 고름 (리만)'], ['mkEr', '흐름 매끄러움 (나비에-스토크스)'], ['mkTi', '난류 지수 (나비에-스토크스)'],
  ['vol', '거래량 배수'], ['tkb', '테이커 매수 쏠림 (진행 방향)'], ['tkb6', '테이커 쏠림 하루 평균'],
  ['bR6', '비트코인 하루 수익 (진행 방향)'], ['bReg', '비트코인 장기선 거리'], ['bTi', '비트코인 난류'],
  ['fr', '펀딩비 (진행 방향)'], ['fz', '펀딩비 평소 대비 (진행 방향)'], ['nPos', '같은 방향 후보 수 (쏠림)']
];

/* ---------- 데이터 ---------- */
async function loadSeries({ fetchImpl, repo, now, log, data }) {
  if (data) return { series: data, src: '테스트' };
  const series = {}; let src = '바이낸스 선물 4시간봉';
  for (const c of MK_COINS) {
    try { const r = await fetchImpl('https://raw.githubusercontent.com/' + repo + '/deriv-data/k4-' + c.sym + '.json?t=' + Math.floor(now / 6e5)); if (r.ok) { const K = await r.json(); if (K.t && K.t.length > 1500) series[c.sym] = cleanTicks({ t: K.t, o: K.o, h: K.h, l: K.l, c: K.c, v: K.v, tb: K.tb }); } } catch (e) { /* 아래 대체 */ }
  }
  if (!series.BTC) { // 대체: 야후 1시간봉 → 4시간봉 (약 2년)
    src = '야후 1시간봉 → 4시간 (바이낸스 역사 준비 중)';
    for (const c of MK_COINS) { try { series[c.sym] = to4h(await yahoo(c.y, '730d', '60m', fetchImpl), now); } catch (e) { log('  ' + c.sym + ' 시세 실패: ' + e.message); } await sleep(250); }
  }
  // 아직 끝나지 않은 봉 제거
  Object.values(series).forEach((d) => { while (d.t.length && d.t[d.t.length - 1] + H4 > now) Object.keys(d).forEach((k) => Array.isArray(d[k]) && d[k].pop()); });
  return { series, src };
}

/* ---------- 지표·후보·재료 ---------- */
export function prepare3(series, F, SC) {
  const P = F.PRESETS.h4, W = F.prepare(series, P);
  const SP = Object.assign({}, SC.CFG, { bar: 240 }), WS = SC.prepare(series, SP); // 리만·나비에-스토크스·RSI 등 (단타 엔진 지표 재사용)
  W.syms.forEach((s) => { const x = W.X[s], y = WS.X[s]; if (!y) return; x.k = y; x.atrR = SC._.pctRank(x.atr.map((a, i) => (a == null ? null : a / x.d.c[i] * 100)), 500); });
  return { W, P };
}
const sgnOf = (side) => (side === 'long' ? 1 : -1);
// FLUX 와 같은 조건 (simulate 안의 후보 조건과 똑같이)
function condAt(W, P, cfg, s, j, i) {
  const x = W.X[s]; if (j < 1 || x.hi[j] == null || x.eS[j] == null || x.atr[j] == null) return null;
  const c = x.d.c[j], a = x.atr[j]; if (a / c * 100 > cfg.atrMaxPct) return null;
  const bj = W.X.BTC.map[i], btcBear = bj >= 0 && W.X.BTC.reg[bj] != null && W.X.BTC.d.c[bj] < W.X.BTC.reg[bj];
  if (x.eF[j] > x.eS[j] && c > x.eS[j] && c > x.hi[j]) return { side: 'long', str: (c - x.hi[j]) / a };
  if (btcBear && x.eF[j] < x.eS[j] && c < x.eS[j] && c < x.lo[j]) return { side: 'short', str: (x.lo[j] - c) / a };
  return null;
}
function fundAt(deriv, s, t) {
  const D = deriv && deriv.coins && deriv.coins[s]; if (!D || !D.f || !D.f.length) return [null, null];
  const f = D.f; let lo = 0, hi = f.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (f[m][0] <= t) { k = m; lo = m + 1; } else hi = m - 1; }
  if (k < 0) return [null, null];
  let z = null; if (k >= 89) { let m = 0; for (let j = k - 89; j <= k; j++) m += f[j][1]; m /= 90; let v = 0; for (let j = k - 89; j <= k; j++) v += (f[j][1] - m) ** 2; v = Math.sqrt(v / 90); z = v ? (f[k][1] - m) / v : 0; }
  return [f[k][1] * 1e4, z];
}
export function featRow(W, s, j, i, cand, deriv, nSame) {
  const x = W.X[s], k = x.k, d = x.d, g = sgnOf(cand.side), c = d.c[j], a = x.atr[j], B = W.X.BTC, bj = B.map[i];
  if (!k || k.mkZ[j] == null || j < 45) return null;
  const lr = (n) => Math.log(c / d.c[j - n]);
  const tk = (jj) => (d.tb && d.v && d.v[jj] ? d.tb[jj] / d.v[jj] - 0.5 : null);
  let t6 = null; if (d.tb) { let sm = 0, n = 0; for (let q = j - 5; q <= j; q++) { const v = tk(q); if (v != null) { sm += v; n++; } } t6 = n ? sm / n * g : null; }
  const [fr, fz] = fundAt(deriv, s, d.t[j] + H4);
  return [g, cand.str, a / c * 100, x.atrR[j], (c - x.eS[j]) / a * g, x.eF[j - 6] ? (x.eF[j] / x.eF[j - 6] - 1) * 100 * g : 0,
    lr(6) * g * 100, lr(18) * g * 100, lr(42) * g * 100, g > 0 ? k.rsi[j] : 100 - k.rsi[j],
    k.mkZ[j] * g, k.mkDev[j] * g, k.mkReg[j], k.mkEr[j], k.mkTi[j],
    k.vAvg[j] ? Math.min((d.v ? d.v[j] : 0) / k.vAvg[j], 6) : null, tk(j) == null ? null : tk(j) * g, t6,
    bj >= 6 ? Math.log(B.d.c[bj] / B.d.c[bj - 6]) * g * 100 : null, B.reg[bj] ? (B.d.c[bj] / B.reg[bj] - 1) * 100 : null, B.k ? B.k.mkTi[bj] : null,
    fr == null ? null : fr * g, fz == null ? null : fz * g, nSame];
}
// 후보 하나를 실제 규칙대로 따로 끝까지 해 봄 → R (수수료·미끄러짐 포함)
export function outcome(W, P, cfg, s, j) {
  const x = W.X[s], d = x.d, n = d.c.length;
  return function (sd) {
    const g = sgnOf(sd); if (j + 1 >= n) return null;
    const e = d.o[j + 1] * (1 + g * cfg.slipIn), R = x.atr[j] * P.stopAtr; let stop = e - g * R, ext = d.o[j + 1], exitPx = null, exitJ = null, pendExit = false;
    for (let q = j + 1; q < n; q++) {
      const o = d.o[q], h = d.h[q], l = d.l[q], c = d.c[q], a = x.atr[q];
      if (pendExit && q > j + 1) { exitPx = o * (1 - g * cfg.slipIn); exitJ = q; break; }
      if (g > 0 ? o <= stop : o >= stop) { exitPx = o * (1 - g * cfg.slipStop); exitJ = q; break; }
      if (g > 0 ? l <= stop : h >= stop) { exitPx = stop * (1 - g * cfg.slipStop); exitJ = q; break; }
      ext = g > 0 ? Math.max(ext, h) : Math.min(ext, l);
      if (a != null && (g > 0 ? c > e + a : c < e - a)) { const tr = ext - g * P.trailAtr * a; stop = g > 0 ? Math.max(stop, tr) : Math.min(stop, tr); }
      if (g > 0 ? x.eF[q] < x.eS[q] : x.eF[q] > x.eS[q]) pendExit = true;
    }
    if (exitPx == null) return null; // 아직 안 끝남
    const bars = exitJ - (j + 1), fee = (e + exitPx) * cfg.taker, fund = e * cfg.fundBase * bars * 4 / 8 * (g > 0 ? 1 : -1);
    return { R: (g * (exitPx - e) - fee - fund) / R, exitT: d.t[exitJ], bars };
  };
}

/* ---------- 학습 데이터: 새로 나타난 후보(직전 봉엔 조건 없음)만, 끝난 거래만 ---------- */
export function buildSamples(W, P, cfg, deriv) {
  const all = []; // {s, j, i, t, side, row, R, exitT}
  const iMin = P.emaS + 50;
  for (let i = iMin; i < W.T.length; i++) {
    const day = []; W.syms.forEach((s) => { const j = W.X[s].map[i]; if (j < 1) return; const cd = condAt(W, P, cfg, s, j, i); if (cd) day.push([s, j, cd]); });
    for (const [s, j, cd] of day) {
      const nSame = day.filter((z) => z[2].side === cd.side).length;
      const prev = W.X[s].map[i - 1]; const was = prev >= 1 ? condAt(W, P, cfg, s, prev, i - 1) : null;
      const row = featRow(W, s, j, i, cd, deriv, nSame); if (!row) continue;
      const oc = outcome(W, P, cfg, s, j)(cd.side);
      all.push({ s, j, i, t: W.T[i], side: cd.side, row, fresh: !(was && was.side === cd.side), R: oc ? oc.R : null, exitT: oc ? oc.exitT : null });
    }
  }
  return all;
}
const GB = { rounds: 80, depth: 2, lr: 0.05, minLeaf: 25, lambda: 10, sub: 0.8 };
function trainOn(samples, tCut) {
  const tr = samples.filter((z) => z.fresh && z.R != null && z.exitT < tCut);
  if (tr.length < 120) return null;
  const m = trainGBM(tr.map((z) => z.row), tr.map((z) => (z.R > 0 ? 1 : 0)), GB);
  const ps = tr.map((z) => predict(m, z.row)).sort((a, b) => a - b);
  m.q = (f) => ps[Math.floor(f * (ps.length - 1))]; m.qs = { 20: m.q(0.2), 30: m.q(0.3), 50: m.q(0.5), 70: m.q(0.7) }; m.n = tr.length; m.rate = tr.filter((z) => z.R > 0).length / tr.length;
  return m;
}

/* ---------- 계좌 시뮬레이션: FLUX 엔진에 '학습 판단'을 끼워 넣음 ---------- */
export function runWith(F, W, P, cfg, iA, iB, judge, collect) {
  const acc = F.newAccount(cfg); acc.why3 = [];
  for (let i = iA; i <= iB; i++) {
    F.simulate(W, P, cfg, acc, i, i, { collect: !!collect, vote: true });
    acc.pending.forEach((o) => { if (o.kind !== 'open' || !o.needVote || o.approved != null) return; const r = judge(o, i); o.approved = r.ok; if (r.risk != null) o.risk = r.risk; if (r.why) o.why = r.why; if (r.p != null) o.p = r.p; });
  }
  return acc;
}

export async function run({ root = ROOT, dir = process.env.MK_DIR || join(ROOT, 'data'), now = new Date(), log = console.log, env = loadEnv(), reset = false, sendPush = true, fetchImpl = fetch, data = null, derivData, retrain = false } = {}) {
  const t0 = Date.now(), F = require(join(root, 'js', 'futures.js')), SC = require(join(root, 'js', 'scalp.js')), Q = loadQuant(root);
  const repo = env.GITHUB_REPOSITORY || process.env.GITHUB_REPOSITORY || env.GITHUB_REPO || 'rudrl09202-bit/sijangnalssi';
  const { series, src } = await loadSeries({ fetchImpl, repo, now: now.getTime(), log, data });
  if (!series.BTC || series.BTC.c.length < 1500) throw new Error('BTC 4시간봉 부족');
  let deriv = derivData; if (deriv === undefined) { try { const r = await fetchImpl('https://raw.githubusercontent.com/' + repo + '/deriv-data/deriv.json?t=' + Math.floor(now.getTime() / 6e5)); deriv = r.ok ? await r.json() : null; } catch (e) { deriv = null; } }
  const cfg = Object.assign({}, F.BASE), { W, P } = prepare3(series, F, SC), last = W.T.length - 1;
  W.syms.forEach((s) => { if (!F.COINS.find((c) => c.sym === s)) F.COINS.push({ sym: s, name: (MK_COINS.find((c) => c.sym === s) || {}).name || s }); });
  log('민경기 봇 3세대: ' + src + ' · ' + W.syms.map((s) => s + ' ' + series[s].c.length).join(', ') + ' · 마지막 ' + isoT(W.T[last]) + ' UTC');

  mkdirSync(dir, { recursive: true });
  const stFile = join(dir, 'mk3-state.json');
  let st = !reset && existsSync(stFile) ? JSON.parse(readFileSync(stFile, 'utf8')) : null;
  if (!st) st = { v: 1, acc: null, model: null, wf: null };
  const samples = buildSamples(W, P, cfg, deriv), keyOf = (s, i, side) => s + '|' + i + '|' + side;
  const sIdx = new Map(samples.map((z) => [keyOf(z.s, z.i, z.side), z]));

  // ── 1) 매주 다시 배우고 다시 시험
  const age = st.model ? now.getTime() - Date.parse(st.model.at) : Infinity;
  if (retrain || !st.model || st.model.v !== MK3_V || st.model.src !== src || age > 7 * DAY) {
    const tA = Date.now(), iStart = Math.max(P.regime + 2, 0), tStart = W.T[iStart];
    const warm = Math.max(tStart + 365 * DAY, W.T[0] + 540 * DAY), step = 90 * DAY;
    // 펀딩비는 2024-11 부터만 있어서, 펀딩비 재료를 뺀 모델도 같이 시험 (펀딩비가 진짜 도움이 되는지 확인)
    const FI = [FEATS3.findIndex((f) => f[0] === 'fr'), FEATS3.findIndex((f) => f[0] === 'fz')];
    const noF = samples.map((z) => ({ ...z, row: z.row.map((v, k) => (FI.includes(k) ? null : v)) }));
    const pred = new Map(), predNF = new Map(), folds = [];
    for (let ts = warm; ts < W.T[last]; ts += step) {
      const m = trainOn(samples, ts), m2 = trainOn(noF, ts); if (!m) continue;
      folds.push({ from: isoT(ts).slice(0, 10), n: m.n, rate: r2(m.rate * 100, 1) });
      samples.forEach((z, k) => { if (z.t >= ts && z.t < ts + step) { pred.set(keyOf(z.s, z.i, z.side), { p: predict(m, z.row), qs: m.qs }); if (m2) predNF.set(keyOf(z.s, z.i, z.side), { p: predict(m2, noF[k].row), qs: m2.qs }); } });
    }
    const iA = W.T.findIndex((t) => t >= (folds.length ? Date.parse(folds[0].from) : warm)), half = Math.floor((iA + last) / 2);
    const mkJudge = (skipQ, boost, PM) => (o, i) => { const z = (PM || pred).get(keyOf(o.sym, i, o.side)); if (!z) return { ok: false };
      const thr = skipQ ? z.qs[skipQ] : -1, ok = z.p >= thr; return { ok, p: z.p, risk: ok ? cfg.riskPct * (boost && z.p >= z.qs[70] ? 1.5 : 1) : null }; };
    const study = [];
    for (const [name, judge] of [['FLUX 혼자 (비교 기준)', () => ({ ok: true })], ['민경기 봇 (하위 50% 건너뜀)', mkJudge(50, false)], ['하위 30% 건너뜀', mkJudge(30, false)], ['하위 30% 건너뜀 + 상위 크게', mkJudge(30, true)], ['하위 20% 건너뜀', mkJudge(20, false)], ['펀딩비 재료 빼고 (하위 50%)', mkJudge(50, false, predNF)]]) {
      const row = { name };
      for (const [k, a, b] of [['all', iA, last], ['h1', iA, half], ['h2', half, last]]) {
        const ac = runWith(F, W, P, cfg, a, b, judge), dc = F.daily(ac.equity), mt = Q.metrics(dc, ac.trades) || {};
        row[k] = { ret: r2(mt.total, 1), cagr: r2(mt.cagr, 1), mdd: r2(mt.mdd, 1), sharpe: r2(mt.sharpe, 2), n: ac.trades.length, win: r2(mt.winRate, 1), pf: r2(mt.pf, 2) };
        if (k === 'all') { row.curve = dc.filter((e, q, arr) => q % 5 === 0 || q === arr.length - 1); row.yearly = mt.yearly || null; row.recent = ac.trades.slice(-10).reverse().map((t) => ({ ...t, qty: undefined })); }
      }
      study.push(row);
      log('  시험 ' + name.padEnd(26) + ' 연 ' + row.all.cagr + '% · 낙폭 ' + row.all.mdd + '% · 샤프 ' + row.all.sharpe + ' · 거래 ' + row.all.n + ' · PF ' + row.all.pf + ' | 앞 ' + row.h1.ret + '% 뒤 ' + row.h2.ret + '%');
    }
    const B0 = study[0].all, M0 = study[1];
    const pass = { beats: (M0.all.sharpe || 0) > (B0.sharpe || 0) && (M0.all.cagr || 0) >= (B0.cagr || 0) * 0.9, halves: M0.h1.ret > 0 && M0.h2.ret > 0, pf: (M0.all.pf || 0) >= 1.3, mdd: M0.all.mdd != null && M0.all.mdd > -25, trades: M0.all.n >= 40 };
    pass.ok = pass.beats && pass.halves && pass.pf && pass.mdd && pass.trades;
    // 판단 품질: 모델 점수 구간별 실제 평균 R (시험 기간)
    const scored = samples.filter((z) => z.fresh && z.R != null && pred.has(keyOf(z.s, z.i, z.side))).map((z) => [pred.get(keyOf(z.s, z.i, z.side)).p, z.R]).sort((a, b) => a[0] - b[0]);
    const buckets = [0, 0.2, 0.4, 0.6, 0.8, 1].slice(0, 5).map((f, q, arr) => { const a = Math.floor(f * scored.length), b = Math.floor((q === arr.length - 1 ? 1 : arr[q + 1]) * scored.length), z = scored.slice(a, b);
      return { q: Math.round(f * 100), n: z.length, avgR: z.length ? r2(z.reduce((s2, x) => s2 + x[1], 0) / z.length, 2) : null, win: z.length ? r2(z.filter((x) => x[1] > 0).length / z.length * 100, 0) : null }; });
    const mFull = trainOn(samples, now.getTime() + 1);
    st.model = { v: MK3_V, src, at: now.toISOString(), trees: mFull.trees, base: mFull.base, qs: mFull.qs, n: mFull.n, rate: r2(mFull.rate * 100, 1), ver: (st.model ? st.model.ver || 0 : 0) + 1,
      imp: FEATS3.map(([k, label], f) => ({ k, label, v: r2((mFull.imp[f] || 0) * 100, 1) })).sort((a, b) => b.v - a.v) };
    st.wf = { at: now.toISOString(), from: isoT(W.T[iA]), to: isoT(W.T[last]), folds, study, pass, buckets, secs: Math.round((Date.now() - tA) / 1000), samples: samples.filter((z) => z.fresh && z.R != null).length };
    log('3세대 학습: 모델 ' + st.model.ver + '번째 · 끝난 후보 ' + st.model.n + '개 (이익 ' + st.model.rate + '%) · 시험 ' + folds.length + '구간 · 합격 ' + (pass.ok ? 'O' : 'X') + ' · ' + st.wf.secs + '초');
  }

  // ── 2) 실시간 모의 계좌 (새 4시간봉마다)
  const M = st.model, liveJudge = (o, i) => { const z = sIdx.get(keyOf(o.sym, i, o.side)); if (!z) return { ok: false };
    const p = predict(M, z.row), ok = p >= M.qs[50];
    return { ok, p, risk: ok ? cfg.riskPct : null, why: o.why + ' · 학습 점수 ' + Math.round(p * 100) + (ok ? ' (상위 절반 — 진입)' : ' (하위 절반 — 건너뜀)') }; };
  const decisions = st.decisions || [];
  if (!st.acc) { st.acc = F.newAccount(cfg); st.acc.lastT = W.T[last]; st.inception = W.T[last]; log('민경기 봇 3세대 모의 계좌를 새로 엽니다'); }
  const from = W.T.findIndex((t) => t > st.acc.lastT);
  if (from >= 0) for (let i = from; i <= last; i++) {
    F.simulate(W, P, cfg, st.acc, i, i, { collect: true, vote: true });
    st.acc.pending.forEach((o) => { if (o.kind !== 'open' || !o.needVote || o.approved != null) return; const r = liveJudge(o, i); o.approved = r.ok; o.risk = r.risk; o.why = r.why || o.why; o.p = r.p;
      decisions.push({ t: isoT(W.T[i]), sym: o.sym, name: o.name, side: o.side, p: r.p == null ? null : r2(r.p * 100, 0), ok: r.ok, big: r.risk > cfg.riskPct }); });
  }
  st.decisions = decisions.slice(-60);
  const fresh = st.acc.events.slice(); st.acc.events = []; st.updatedAt = now.toISOString();
  writeFileSync(stFile, JSON.stringify(st));

  // ── 3) 앱용
  const A = st.acc, eq = A.equity.length ? A.equity[A.equity.length - 1][1] : A.cash, mark = (s) => series[s].c[series[s].c.length - 1];
  // 지금 조건에 걸린 후보 (다음 봉 판단 미리보기)
  const watch = W.syms.map((s) => { const x = W.X[s], j = x.map[last]; if (j < 1) return null; const c = x.d.c[j], a = x.atr[j];
    const up = x.eF[j] > x.eS[j], toHi = x.hi[j] ? (x.hi[j] / c - 1) * 100 : null, toLo = x.lo[j] ? (1 - x.lo[j] / c) * 100 : null;
    return { sym: s, name: (MK_COINS.find((k) => k.sym === s) || {}).name || s, price: c, trend: up ? '상승 추세' : '하락 추세', toHi: r2(toHi, 1), toLo: r2(toLo, 1), z: x.k ? r2(x.k.mkZ[j], 2) : null, ti: x.k ? r2(x.k.mkTi[j], 2) : null }; }).filter(Boolean);
  const out = {
    v: 1, generatedAt: now.toISOString(), lastBar: isoT(W.T[last]), src, inception: isoT(st.inception), cfg: { riskPct: cfg.riskPct, maxPos: cfg.maxPos, maxLevTotal: cfg.maxLevTotal, stopAtr: P.stopAtr, trailAtr: P.trailAtr, brk: P.brk, dayLoss: cfg.dayLoss, ddHalve: cfg.ddHalve, ddKill: cfg.ddKill },
    model: { ver: M.ver, at: M.at, n: M.n, rate: M.rate, imp: M.imp.slice(0, 10), src: M.src }, wf: st.wf,
    live: { equity: eq, start: A.start, ret: r2((eq / A.start - 1) * 100, 2), trades: A.trades.slice(-300).reverse(), n: A.trades.length, win: A.trades.length ? r2(A.trades.filter((t) => t.pnl > 0).length / A.trades.length * 100, 0) : null,
      curve: thin(A.equity), status: A.killUntilT > W.T[last] ? 'killed' : A.dayBlock ? 'dayblock' : A.half ? 'half' : 'ok',
      positions: Object.values(A.pos).map((p) => { const m = mark(p.sym), u = (p.side === 'long' ? 1 : -1) * (m - p.entry) * p.qty; return { sym: p.sym, name: p.name, side: p.side, entry: p.entry, mark: m, stop: p.stop, liq: p.liq, lev: r2(m * p.qty / eq, 2), upnl: Math.round(u), since: isoT(p.t), why: p.why, trail: Math.abs(p.stop - p.stop0) > 1e-12 }; }),
      pending: A.pending.filter((o) => o.kind === 'open' && o.approved).map((o) => ({ sym: o.sym, name: o.name, side: o.side, why: o.why, fillAt: isoT(W.T[last] + H4) })) },
    decisions: st.decisions.slice(-20).reverse(), watch
  };
  writeFileSync(join(dir, 'mk3-live.json'), JSON.stringify(out));
  log('민경기 봇 3세대: 모의 ' + out.live.ret + '% · 거래 ' + out.live.n + ' · 포지션 ' + out.live.positions.length + ' · ' + ((Date.now() - t0) / 1000).toFixed(1) + '초');
  const moves = fresh.filter((e) => e.kind === 'open' || e.kind === 'close' || e.kind === 'vault');
  if (sendPush && moves.length) {
    const sd = (s) => (s === 'long' ? '롱' : '숏');
    await push(env, { title: '민경기 봇 ' + moves.length + '건', body: moves.slice(-4).map((e) => (e.kind === 'open' ? sd(e.side) + ' 진입 ' + e.name + ' ' + e.lev + '배' : e.kind === 'close' ? sd(e.side) + ' 청산 ' + e.name + ' ' + (e.pnl >= 0 ? '+' : '') + Math.round(e.pnl / 1e4) + '만' : '금고: ' + e.msg)).join('\n'), url: './index.html#mk', tag: 'snw-mk' }, log);
  }
  return out;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run({ reset: process.argv.includes('--reset'), retrain: process.argv.includes('--retrain') }).catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
