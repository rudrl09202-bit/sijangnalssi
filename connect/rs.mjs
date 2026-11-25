/* 류신영 봇 — 15분봉 코인 선물 단타 + 학습 필터(메타 라벨링) · 롱·숏 모의투자
 *
 *  1차 후보: 단타 엔진의 15분봉 셋업 (눌림목 · 수축 돌파)
 *  2차 판단: 학습 모델이 "이 후보가 이익으로 끝날 확률"을 매겨 하위 절반은 건너뜀
 *  정답: 그 후보를 단타 규칙(손절 1.5ATR·최소 0.6% · 목표 2R · 1R 가면 본전 · 6시간 정리)대로 했을 때의 결과(R, 수수료 포함)
 *  학습 데이터: 바이낸스 선물 15분봉 약 540일 (서울 서버가 모아 deriv-data 브랜치 k15-*.json 에 하루 한 번 올림)
 *  시험: 과거로만 배우고(끝난 거래만 정답) 다음 30일을 매매 → 반복. '단타 엔진 혼자'와 같은 기간·같은 규칙으로 비교
 *  실시간: 야후 15분봉(60일)으로 15분마다 판단 (테이커 매수량처럼 실시간에 없는 재료는 쓰지 않음)
 *  결과: <dir>/rs-live.json · <dir>/rs-state.json
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { loadEnv, loadQuant, push, cleanTicks } from './paper.mjs';
import { trainGBM, predict } from './mk.mjs';
import { to15, yahoo15 } from './scalp.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..');
const require = createRequire(import.meta.url);
const BAR = 15 * 60e3, DAY = 864e5;
const isoT = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
const thin = (eq, n = 500) => { const k = Math.max(1, Math.ceil(eq.length / n)); return eq.filter((e, i) => i % k === 0 || i === eq.length - 1).map(([t, v]) => [isoT(t), v]); };
const r2 = (x, n = 2) => (x == null || !isFinite(x) ? null : Math.round(x * 10 ** n) / 10 ** n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const RS_V = 1;

export const FEATS_RS = [
  ['side', '방향 (롱/숏)'], ['setup', '셋업 (눌림목/수축 돌파)'], ['atrP', '변동성(ATR %)'], ['atrR', '변동성 순위'], ['dP', '20EMA 거리 (진행 방향)'], ['dS', '200EMA 거리 (진행 방향)'],
  ['slope', '200EMA 기울기 (진행 방향)'], ['r1', '15분 수익 (진행 방향)'], ['r4', '1시간 수익 (진행 방향)'], ['r16', '4시간 수익 (진행 방향)'], ['r96', '하루 수익 (진행 방향)'],
  ['rsi', 'RSI (진행 방향)'], ['bwR', '볼린저 폭 순위'], ['vol', '거래량 배수'], ['rng', '하루 범위 안 위치 (진행 방향)'],
  ['mkZ', '파동 정렬 (리만)'], ['mkDev', '균형선 이탈 (리만)'], ['mkEr', '흐름 매끄러움 (나비에-스토크스)'], ['mkTi', '난류 지수 (나비에-스토크스)'],
  ['bR16', '비트코인 4시간 수익 (진행 방향)'], ['bTrend', '비트코인 추세 (진행 방향)'], ['bTi', '비트코인 난류'],
  ['hs', '시간대(sin)'], ['hc', '시간대(cos)'], ['wkd', '주말'], ['fr', '펀딩비 (진행 방향)'], ['fz', '펀딩비 평소 대비 (진행 방향)'], ['nSame', '같은 방향 후보 수']
];
const sgnOf = (s) => (s === 'long' ? 1 : -1);
function fundAt(deriv, s, t) {
  const D = deriv && deriv.coins && deriv.coins[s]; if (!D || !D.f || !D.f.length) return [null, null];
  const f = D.f; let lo = 0, hi = f.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (f[m][0] <= t) { k = m; lo = m + 1; } else hi = m - 1; }
  if (k < 0) return [null, null];
  let z = null; if (k >= 89) { let m = 0; for (let j = k - 89; j <= k; j++) m += f[j][1]; m /= 90; let v = 0; for (let j = k - 89; j <= k; j++) v += (f[j][1] - m) ** 2; v = Math.sqrt(v / 90); z = v ? (f[k][1] - m) / v : 0; }
  return [f[k][1] * 1e4, z];
}
export function featRow(W, s, j, i, c, deriv, nSame, SC) {
  const x = W.X[s], d = x.d, g = sgnOf(c.side), p = d.c[j], a = x.atr[j], B = W.X.BTC, bj = B.map[i];
  if (j < 100 || a == null || x.eS[j] == null || x.mkZ[j] == null || x.mkTi[j] == null || bj < 20) return null;
  if (!x.atrR) x.atrR = SC._.pctRank(x.atr.map((v, q) => (v == null ? null : v / d.c[q] * 100)), 960);
  const lr = (n) => Math.log(p / d.c[j - n]) * 100 * g;
  let hi = -Infinity, lo = Infinity; for (let q = j - 95; q <= j; q++) { if (d.h[q] > hi) hi = d.h[q]; if (d.l[q] < lo) lo = d.l[q]; }
  const pos = hi > lo ? (p - lo) / (hi - lo) : 0.5, hr = new Date(d.t[j]).getUTCHours() + new Date(d.t[j]).getUTCMinutes() / 60, dw = new Date(d.t[j]).getUTCDay();
  const [fr, fz] = fundAt(deriv, s, d.t[j] + BAR);
  return [g, c.setup === 'squeeze' ? 1 : 0, a / p * 100, x.atrR[j], (p - x.eP[j]) / a * g, (p - x.eS[j]) / a * g, x.eS[j - 16] ? (x.eS[j] / x.eS[j - 16] - 1) * 100 * g : 0,
    lr(1), lr(4), lr(16), lr(96), g > 0 ? x.rsi[j] : 100 - x.rsi[j], x.bwR[j], x.vAvg[j] ? Math.min((d.v ? d.v[j] : 0) / x.vAvg[j], 8) : null, g > 0 ? pos : 1 - pos,
    x.mkZ[j] * g, x.mkDev[j] * g, x.mkEr[j], x.mkTi[j],
    Math.log(B.d.c[bj] / B.d.c[bj - 16]) * 100 * g, (B.eF[bj] > B.eS[bj] ? 1 : -1) * g, B.mkTi[bj],
    Math.sin(hr / 24 * 2 * Math.PI), Math.cos(hr / 24 * 2 * Math.PI), dw === 0 || dw === 6 ? 1 : 0, fr == null ? null : fr * g, fz == null ? null : fz * g, nSame];
}
// 후보 하나를 단타 규칙대로 끝까지 따로 해 봄 → R (수수료·미끄러짐 포함)
export function outcome(W, P, s, j, side) {
  const x = W.X[s], d = x.d, n = d.c.length, g = sgnOf(side);
  if (j + 1 >= n || x.atr[j] == null) return null;
  const e = d.o[j + 1] * (1 + g * P.slipIn), R = Math.max(x.atr[j] * P.stopAtr, e * P.minStopPct / 100), tp = e + g * R * P.tpR;
  let stop = e - g * R, be = false, ex = null, exJ = null, timeOut = false;
  for (let q = j + 1; q < n; q++) {
    const o = d.o[q], h = d.h[q], l = d.l[q], c = d.c[q];
    if (timeOut) { ex = o * (1 - g * P.slipIn); exJ = q; break; }
    if (g > 0 ? o <= stop : o >= stop) { ex = o * (1 - g * P.slipStop); exJ = q; break; }
    if (g > 0 ? o >= tp : o <= tp) { ex = o; exJ = q; break; }
    if (g > 0 ? l <= stop : h >= stop) { ex = stop * (1 - g * P.slipStop); exJ = q; break; }
    if (g > 0 ? h >= tp : l <= tp) { ex = tp; exJ = q; break; }
    if (!be && (g > 0 ? c >= e + R * P.beR : c <= e - R * P.beR)) { stop = e; be = true; }
    if (q - (j + 1) >= P.maxBars - 1) timeOut = true;
  }
  if (ex == null) return null;
  const fee = (e + ex) * P.taker;
  return { R: (g * (ex - e) - fee) / R, exitT: d.t[exJ] };
}
// 모든 후보(엔진이 그 봉에서 낼 셋업) + 재료 + 결과
export function buildSamples(W, P, SC, deriv) {
  const all = [];
  for (let i = P.emaS + P.sqzLook + 2; i < W.T.length; i++) {
    const day = [];
    W.syms.forEach((s) => { const x = W.X[s], j = x.map[i]; if (j < 2) return; SC.setups(x, j, P).forEach((c) => day.push([s, j, c])); });
    for (const [s, j, c] of day) {
      const row = featRow(W, s, j, i, c, deriv, day.filter((z) => z[2].side === c.side).length, SC); if (!row) continue;
      const oc = outcome(W, P, s, j, c.side);
      all.push({ s, j, i, t: W.T[i], side: c.side, setup: c.setup, row, R: oc ? oc.R : null, exitT: oc ? oc.exitT : null });
    }
  }
  return all;
}
const GB = { rounds: 100, depth: 3, lr: 0.05, minLeaf: 40, lambda: 10, sub: 0.7 };
function trainOn(samples, tCut) {
  const tr = samples.filter((z) => z.R != null && z.exitT < tCut);
  if (tr.length < 300) return null;
  const m = trainGBM(tr.map((z) => z.row), tr.map((z) => (z.R > 0 ? 1 : 0)), GB);
  const ps = tr.map((z) => predict(m, z.row)).sort((a, b) => a - b), q = (f) => ps[Math.floor(f * (ps.length - 1))];
  m.qs = { 30: q(0.3), 50: q(0.5), 70: q(0.7) }; m.n = tr.length; m.rate = tr.filter((z) => z.R > 0).length / tr.length;
  return m;
}
function runWith(SC, W, P, iA, iB, judge, collect) {
  const acc = SC.newAccount(P);
  for (let i = iA; i <= iB; i++) {
    SC.simulate(W, P, acc, i, i, { collect: !!collect, vote: true });
    acc.pending.forEach((o) => { if (o.kind !== 'open' || !o.needVote || o.approved != null) return; const r = judge(o, i); o.approved = r.ok; if (r.why) o.why = r.why; });
  }
  return acc;
}
async function loadK15(repo, fetchImpl, now, syms) {
  const out = {};
  for (const s of syms) {
    try { const r = await fetchImpl('https://raw.githubusercontent.com/' + repo + '/deriv-data/k15-' + s + '.json?t=' + Math.floor(now / 36e5)); if (!r.ok) continue;
      const K = await r.json(); if (K.t && K.t.length > 20000) out[s] = cleanTicks({ t: K.t, o: K.o, h: K.h, l: K.l, c: K.c, v: K.v }); } catch (e) { /* 없음 */ }
  }
  return out;
}

export async function run({ root = ROOT, dir = process.env.SCALP_DIR || process.env.MK_DIR || join(ROOT, 'data'), now = new Date(), log = console.log, env = loadEnv(), reset = false, sendPush = true, fetchImpl = fetch, hist = null, live = null, derivData, retrain = false } = {}) {
  const t0 = Date.now(), SC = require(join(root, 'js', 'scalp.js')), Q = loadQuant(root), P = SC.CFG;
  const repo = env.GITHUB_REPOSITORY || process.env.GITHUB_REPOSITORY || env.GITHUB_REPO || 'rudrl09202-bit/sijangnalssi';
  let deriv = derivData; if (deriv === undefined) { try { const r = await fetchImpl('https://raw.githubusercontent.com/' + repo + '/deriv-data/deriv.json?t=' + Math.floor(now.getTime() / 6e5)); deriv = r.ok ? await r.json() : null; } catch (e) { deriv = null; } }
  mkdirSync(dir, { recursive: true });
  const stFile = join(dir, 'rs-state.json');
  let st = !reset && existsSync(stFile) ? JSON.parse(readFileSync(stFile, 'utf8')) : null;
  if (!st) st = { v: 1, acc: null, model: null, wf: null, decisions: [] };

  // ── 1) 매주 다시 학습 (바이낸스 15분봉 역사)
  const age = st.model ? now.getTime() - Date.parse(st.model.at) : Infinity;
  if (retrain || !st.model || st.model.v !== RS_V || age > 7 * DAY) {
    const H = hist || await loadK15(repo, fetchImpl, now.getTime(), SC.COINS.map((c) => c.sym));
    if (!H.BTC) log('류신영 봇: 바이낸스 15분봉 역사가 아직 없어 학습을 미룸 (서울 서버가 모으는 중)');
    else {
      const tA = Date.now(), WH = SC.prepare(H, P), lastH = WH.T.length - 1, samples = buildSamples(WH, P, SC, deriv), key = (s, i, sd) => s + '|' + i + '|' + sd;
      log('류신영 봇 학습: 15분봉 ' + WH.syms.map((s) => s + ' ' + H[s].c.length).join(', ') + ' · 후보 ' + samples.length + '개 (끝난 것 ' + samples.filter((z) => z.R != null).length + ')');
      const warm = WH.T[0] + 150 * DAY, step = 30 * DAY, pred = new Map(), folds = [];
      for (let ts = warm; ts < WH.T[lastH]; ts += step) {
        const m = trainOn(samples, ts); if (!m) continue;
        folds.push({ from: isoT(ts).slice(0, 10), n: m.n, rate: r2(m.rate * 100, 1) });
        samples.forEach((z) => { if (z.t >= ts && z.t < ts + step) pred.set(key(z.s, z.i, z.side), { p: predict(m, z.row), qs: m.qs }); });
      }
      if (folds.length) {
        const iA = WH.T.findIndex((t) => t >= Date.parse(folds[0].from)), half = Math.floor((iA + lastH) / 2);
        const J = (q) => (o, i) => { if (!q) return { ok: true }; const z = pred.get(key(o.sym, i, o.side)); return { ok: !!z && z.p >= z.qs[q] }; };
        const study = [];
        for (const [name, judge] of [['단타 엔진 혼자 (비교 기준)', J(0)], ['류신영 봇 (하위 50% 건너뜀)', J(50)], ['하위 30% 건너뜀', J(30)], ['하위 70% 건너뜀 (상위 30%만)', J(70)]]) {
          const row = { name };
          for (const [k, a, b] of [['all', iA, lastH], ['h1', iA, half], ['h2', half, lastH]]) {
            const ac = runWith(SC, WH, P, a, b, judge), s2 = SC.stats(ac), dc = SC.daily(ac.equity), mt = Q.metrics(dc, ac.trades) || {};
            row[k] = { ret: r2((ac.equity[ac.equity.length - 1][1] / ac.start - 1) * 100, 1), n: s2.trades, win: s2.winRate, pf: s2.pf, avgR: s2.avgR, mdd: r2(mt.mdd, 1), sharpe: r2(mt.sharpe, 2), perDay: dc.length ? r2(s2.trades / dc.length, 1) : null };
            if (k === 'all') { row.curve = dc.filter((e, q, arr) => q % 3 === 0 || q === arr.length - 1); row.monthly = mt.monthly || null; row.fees = Math.round(ac.feesPaid); }
          }
          study.push(row);
          log('  시험 ' + name.padEnd(22) + ' ' + row.all.ret + '% · 낙폭 ' + row.all.mdd + '% · 거래 ' + row.all.n + ' (하루 ' + row.all.perDay + ') · 승률 ' + row.all.win + '% · PF ' + row.all.pf + ' | 앞 ' + row.h1.ret + '% 뒤 ' + row.h2.ret + '%');
        }
        const B0 = study[0].all, M0 = study[1];
        const pass = { beats: M0.all.ret > B0.ret && (M0.all.sharpe || 0) > (B0.sharpe || 0), halves: M0.h1.ret > 0 && M0.h2.ret > 0, pf: (M0.all.pf || 0) >= 1.2, mdd: M0.all.mdd != null && M0.all.mdd > -20, trades: M0.all.n >= 60 };
        pass.ok = pass.beats && pass.halves && pass.pf && pass.mdd && pass.trades;
        const sc = samples.filter((z) => z.R != null && pred.has(key(z.s, z.i, z.side))).map((z) => [pred.get(key(z.s, z.i, z.side)).p, z.R]).sort((a, b) => a[0] - b[0]);
        const buckets = [0, 0.2, 0.4, 0.6, 0.8].map((f, q, arr) => { const a = Math.floor(f * sc.length), b = Math.floor((q === arr.length - 1 ? 1 : arr[q + 1]) * sc.length), z = sc.slice(a, b);
          return { q: Math.round(f * 100), n: z.length, avgR: z.length ? r2(z.reduce((s2, x) => s2 + x[1], 0) / z.length, 2) : null, win: z.length ? r2(z.filter((x) => x[1] > 0).length / z.length * 100, 0) : null }; });
        const mF = trainOn(samples, now.getTime() + 1);
        st.model = { v: RS_V, at: now.toISOString(), trees: mF.trees, base: mF.base, qs: mF.qs, n: mF.n, rate: r2(mF.rate * 100, 1), ver: (st.model ? st.model.ver || 0 : 0) + 1,
          imp: FEATS_RS.map(([k2, label], f) => ({ k: k2, label, v: r2((mF.imp[f] || 0) * 100, 1) })).sort((a, b) => b.v - a.v) };
        st.wf = { at: now.toISOString(), from: isoT(WH.T[iA]), to: isoT(WH.T[lastH]), folds, study, pass, buckets, samples: samples.filter((z) => z.R != null).length, secs: Math.round((Date.now() - tA) / 1000) };
        log('류신영 봇 학습 완료: 모델 ' + st.model.ver + '번째 · 후보 ' + st.model.n + '개 (이익 ' + st.model.rate + '%) · 시험 ' + folds.length + '구간 · 합격 ' + (pass.ok ? 'O' : 'X') + ' · ' + st.wf.secs + '초');
      }
    }
  }

  // ── 2) 실시간 모의 계좌 (야후 15분봉, 15분마다)
  const series = live || {};
  if (!live) for (const c of SC.COINS) { try { series[c.sym] = to15(await yahoo15(c.y, fetchImpl), now.getTime()); } catch (e) { log('  ' + c.sym + ' 시세 실패: ' + e.message); } await sleep(150); }
  if (!series.BTC || series.BTC.c.length < 800) throw new Error('BTC 15분봉 부족');
  const W = SC.prepare(series, P), last = W.T.length - 1;
  if (!st.acc) { st.acc = SC.newAccount(P); st.acc.lastT = W.T[last]; st.inception = W.T[last]; log('류신영 봇 모의 계좌를 새로 엽니다'); }
  const M = st.model, from = W.T.findIndex((t) => t > st.acc.lastT);
  if (from >= 0) for (let i = from; i <= last; i++) {
    SC.simulate(W, P, st.acc, i, i, { collect: true, vote: true });
    const cands = st.acc.pending.filter((o) => o.kind === 'open' && o.needVote && o.approved == null);
    for (const o of cands) {
      const x = W.X[o.sym], j = x.map[i], nSame = cands.filter((z) => z.side === o.side).length;
      const row = j >= 0 ? featRow(W, o.sym, j, i, o, deriv, nSame, SC) : null;
      if (!M) { o.approved = false; st.decisions.push({ t: isoT(W.T[i]), sym: o.sym, name: o.name, side: o.side, kind: o.setup, p: null, ok: false, why: '아직 학습 전 — 건너뜀' }); continue; }
      const p = row ? predict(M, row) : 0, ok = p >= M.qs[50];
      o.approved = ok; o.why = o.why + ' · 학습 점수 ' + Math.round(p * 100) + (ok ? ' (상위 절반 — 진입)' : ' (하위 절반 — 건너뜀)');
      st.decisions.push({ t: isoT(W.T[i]), sym: o.sym, name: o.name, side: o.side, kind: o.setup, p: r2(p * 100, 0), ok });
    }
  }
  st.decisions = st.decisions.slice(-80);
  const fresh = st.acc.events.slice(); st.acc.events = []; st.updatedAt = now.toISOString();
  writeFileSync(stFile, JSON.stringify(st));

  // ── 3) 앱용
  const A = st.acc, mark = (s) => series[s].c[series[s].c.length - 1], eq = Math.round(A.cash + Object.values(A.pos).reduce((t, p) => t + (p.side === 'long' ? 1 : -1) * (mark(p.sym) - p.entry) * p.qty, 0));
  const out = {
    v: 1, generatedAt: now.toISOString(), lastBar: isoT(W.T[last]), inception: isoT(st.inception), cfg: { riskPct: P.riskPct, maxPos: P.maxPos, stopAtr: P.stopAtr, minStopPct: P.minStopPct, tpR: P.tpR, beR: P.beR, maxBars: P.maxBars, bar: P.bar, dayLoss: P.dayLoss, ddKill: P.ddKill },
    model: M ? { ver: M.ver, at: M.at, n: M.n, rate: M.rate, imp: M.imp.slice(0, 10) } : null, wf: st.wf,
    live: { equity: eq, start: A.start, ret: r2((eq / A.start - 1) * 100, 2), trades: A.trades.slice(-300).reverse(), n: A.trades.length, curve: thin(A.equity),
      status: A.killUntilT > W.T[last] ? 'killed' : A.dayBlock ? 'dayblock' : A.pauseUntilT > W.T[last] ? 'pause' : 'ok',
      positions: Object.values(A.pos).map((p) => { const m = mark(p.sym), u = (p.side === 'long' ? 1 : -1) * (m - p.entry) * p.qty; return { sym: p.sym, name: p.name, side: p.side, kind: p.kind, entry: p.entry, mark: m, lev: r2(m * p.qty / eq, 2), notional: Math.round(m * p.qty), upnl: Math.round(u), stop: p.stop, tp: p.tp, liq: p.liq, be: p.be, why: p.why, since: isoT(p.t), barsLeft: Math.max(0, P.maxBars - 1 - Math.round((W.T[last] - p.t) / BAR)) }; }),
      pending: A.pending.filter((o) => o.kind === 'open' && o.approved).map((o) => ({ sym: o.sym, name: o.name, side: o.side, why: o.why })) },
    decisions: st.decisions.slice(-20).reverse()
  };
  writeFileSync(join(dir, 'rs-live.json'), JSON.stringify(out));
  log('류신영 봇: 모의 ' + out.live.ret + '% · 거래 ' + out.live.n + ' · 포지션 ' + out.live.positions.length + (M ? '' : ' · 학습 전') + ' · ' + ((Date.now() - t0) / 1000).toFixed(1) + '초');
  const moves = fresh.filter((e) => e.kind === 'open' || e.kind === 'close' || e.kind === 'vault');
  if (sendPush && moves.length) {
    const sd = (s) => (s === 'long' ? '롱' : '숏');
    await push(env, { title: '류신영 봇 ' + moves.length + '건', body: moves.slice(-4).map((e) => (e.kind === 'open' ? sd(e.side) + ' 진입 ' + e.name + ' ' + e.lev + '배' : e.kind === 'close' ? sd(e.side) + ' 청산 ' + e.name : '금고: ' + e.msg)).join('\n'), url: './index.html#bot/rs', tag: 'snw-rs' }, log);
  }
  return out;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run({ reset: process.argv.includes('--reset'), retrain: process.argv.includes('--retrain') }).catch((e) => { console.error('✗ ' + e.message); process.exitCode = 1; });
