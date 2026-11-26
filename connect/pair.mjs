/* 상대 모멘텀 봇 (민경기 봇 4세대 후보) — BTC·ETH 가격 비율이 크게 벌어지면 벌어지는 쪽으로 따라감 · 모의투자 전용
 *
 *  어디서 나왔나: '용수철(되돌림)' 페어 시험이 크게 손실 → 정반대 방향이 6년 시험에서 플러스 (사후 발견).
 *    결과를 보고 만든 규칙이라 3개월 실시간 모의로 따로 확인한 뒤 채택 여부를 정함 (2026-11-25 ~ 2027-02-25).
 *  규칙 (고정, 바꾸지 않음):
 *    스프레드 s = ln(ETH) − β·ln(BTC), β 는 지난 30일(180봉) 회귀. z = (s − 20일 평균) / 20일 표준편차
 *    z > 2 → ETH 롱 + BTC 숏 · z < −2 → ETH 숏 + BTC 롱 (금액 비율 1 : β, 합계 = 자산 1배)
 *    OU 반감기(지난 20일)가 1~10일일 때만 진입 · z 가 0 을 지나면 정리 · 최대 5일(30봉)
 *    판단은 4시간봉 종가, 체결은 다음 봉 시가. 수수료 0.05% + 미끄러짐 0.02% (다리마다·진입/청산마다) + 실제 펀딩비
 *  결과: <dir>/pair-live.json · 바이낸스 데모에는 넣지 않음
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { loadEnv, push } from './paper.mjs';
import { MG } from './mg.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..'), H4 = 4 * 3600e3, DAY = 864e5;
const isoT = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
const r2 = (x, n = 2) => (x == null || !isFinite(x) ? null : Math.round(x * 10 ** n) / 10 ** n);
export const PCFG = { A: 'ETH', B: 'BTC', betaN: 180, zN: 120, zIn: 2, maxBars: 30, hlMin: 6, hlMax: 60, lev: 1, taker: 0.0005, slip: 0.0002, start: 1e8 };
const NAME = { ETH: '이더리움', BTC: '비트코인' };

function fundAt(deriv, s, t) { const f = deriv && deriv.coins && deriv.coins[s] && deriv.coins[s].f; if (!f || !f.length || t < f[0][0]) return 0.0001; let lo = 0, hi = f.length - 1, k = 0; while (lo <= hi) { const m = (lo + hi) >> 1; if (f[m][0] <= t) { k = m; lo = m + 1; } else hi = m - 1; } return f[k][1]; }
// 두 코인을 같은 시간축으로
export function align(SA, SB) { const mB = new Map(SB.t.map((t, i) => [t, i])), o = { t: [], ao: [], ac: [], bo: [], bc: [] }; SA.t.forEach((t, i) => { const j = mB.get(t); if (j == null) return; o.t.push(t); o.ao.push(SA.o[i]); o.ac.push(SA.c[i]); o.bo.push(SB.o[j]); o.bc.push(SB.c[j]); }); return o; }
// 봉마다 z·β·반감기
export function signals(D, P) {
  const n = D.t.length, la = D.ac.map(Math.log), lb = D.bc.map(Math.log), out = new Array(n).fill(null);
  for (let i = P.betaN + P.zN; i < n; i++) {
    let sx = 0, sy = 0, sxx = 0, sxy = 0; for (let j = i - P.betaN + 1; j <= i; j++) { sx += lb[j]; sy += la[j]; sxx += lb[j] * lb[j]; sxy += lb[j] * la[j]; }
    const k = P.betaN, be = (k * sxy - sx * sy) / (k * sxx - sx * sx); if (!(be > 0)) continue;
    const S = []; for (let j = i - P.zN + 1; j <= i; j++) S.push(la[j] - be * lb[j]);
    const m = S.reduce((a, b) => a + b, 0) / S.length, sd = Math.sqrt(S.reduce((a, b) => a + (b - m) ** 2, 0) / S.length); if (!sd) continue;
    let ax = 0, ay = 0, axx = 0, axy = 0; for (let j = 1; j < S.length; j++) { const x = S[j - 1], y = S[j] - S[j - 1]; ax += x; ay += y; axx += x * x; axy += x * y; } const q = S.length - 1, sl = (q * axy - ax * ay) / (q * axx - ax * ax), hl = sl < 0 ? Math.log(2) / -sl : Infinity;
    out[i] = { z: (S.at(-1) - m) / sd, beta: be, hl };
  }
  return out;
}
// 계좌 재생: tA 부터 진입 허용. 포지션 들고 있는 동안 β 는 진입 때 값으로 고정
export function simulate(D, Z, P, deriv, { tA = -Infinity, tB = Infinity } = {}) {
  let cash = P.start, pos = null, pend = null; const trades = [], equity = [], events = [];
  const mark = (i) => { if (!pos) return cash; const vA = pos.qA * D.ac[i], vB = pos.qB * D.bc[i]; return cash + pos.gA * (vA - pos.nA) + pos.gB * (vB - pos.nB) - pos.fund; };
  for (let i = 0; i < D.t.length; i++) {
    const t = D.t[i];
    if (pend) { // 다음 봉 시가 체결
      if (pend.kind === 'open') { const E = mark(i - 1), wA = 1 / (1 + pend.beta), wB = pend.beta / (1 + pend.beta), g = pend.g;
        const pa = D.ao[i] * (1 + g * P.slip), pb = D.bo[i] * (1 - g * P.slip), nA = E * P.lev * wA, nB = E * P.lev * wB;
        pos = { g, gA: g, gB: -g, pa, pb, qA: nA / pa, qB: nB / pb, nA, nB, beta: pend.beta, i0: i, t0: t, fund: 0, z0: pend.z, eq0: E }; const fee = (nA + nB) * P.taker; cash -= fee; pos.fee0 = fee;
        events.push({ kind: 'open', t, g, z: pend.z }); }
      else if (pend.kind === 'close' && pos) { const g = pos.g, pa = D.ao[i] * (1 - g * P.slip), pb = D.bo[i] * (1 + g * P.slip), vA = pos.qA * pa, vB = pos.qB * pb;
        const gross = pos.gA * (vA - pos.nA) + pos.gB * (vB - pos.nB), fee = (vA + vB) * P.taker, pnl = gross - fee - pos.fee0 - pos.fund; cash += gross - fee - pos.fund;
        trades.push({ sym: 'ETH/BTC', name: '이더리움↔비트코인', side: g > 0 ? 'long' : 'short', legs: (g > 0 ? 'ETH 롱 · BTC 숏' : 'ETH 숏 · BTC 롱'), in: isoT(pos.t0), out: isoT(t), entry: r2(pos.pa, 2), exit: r2(pa, 2), pnl: Math.round(pnl), pct: r2(pnl / pos.eq0 * 100, 2), days: r2((t - pos.t0) / DAY, 2), funding: Math.round(-pos.fund), reason: pend.why, z0: r2(pos.z0, 2) });
        events.push({ kind: 'close', t, g, pnl: Math.round(pnl), why: pend.why }); pos = null; }
      pend = null;
    }
    if (pos && new Date(t).getUTCHours() % 8 === 0) pos.fund += pos.gA * fundAt(deriv, P.A, t) * pos.qA * D.ao[i] + pos.gB * fundAt(deriv, P.B, t) * pos.qB * D.bo[i];
    const z = Z[i];
    if (pos && z) { const done = pos.g > 0 ? z.z <= 0 : z.z >= 0, old = i - pos.i0 >= P.maxBars - 1; if (done || old) pend = { kind: 'close', why: done ? '비율 제자리 (z 0 통과)' : '5일 정리' }; }
    else if (!pos && z && t >= tA && t < tB && Math.abs(z.z) > P.zIn && z.hl >= P.hlMin && z.hl <= P.hlMax) pend = { kind: 'open', g: z.z > 0 ? 1 : -1, beta: z.beta, z: z.z };
    equity.push([t, mark(i)]);
  }
  return { cash, pos, pend, trades, equity, events };
}
export function statsOf(eq, tr) {
  if (eq.length < 30) return null; const d = new Map(); eq.forEach(([t, v]) => d.set(Math.floor(t / DAY), v)); const daily = [...d.values()];
  const r = daily.slice(1).map((v, i) => v / daily[i] - 1), m = r.reduce((a, b) => a + b, 0) / r.length, sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / r.length); let pk = 0, mdd = 0; daily.forEach((v) => { pk = Math.max(pk, v); mdd = Math.min(mdd, v / pk - 1); });
  const yrs = (eq.at(-1)[0] - eq[0][0]) / (365.25 * DAY), ret = daily.at(-1) / daily[0] - 1, gw = tr.filter((z) => z.pnl > 0).reduce((a, z) => a + z.pnl, 0), gl = -tr.filter((z) => z.pnl <= 0).reduce((a, z) => a + z.pnl, 0);
  return { ret: r2(ret * 100, 1), cagr: r2((Math.pow(1 + ret, 1 / Math.max(yrs, 0.1)) - 1) * 100, 1), mdd: r2(mdd * 100, 1), sharpe: r2(sd ? m / sd * Math.sqrt(365.25) : 0), pf: r2(gl ? gw / gl : null), n: tr.length, win: r2(tr.filter((z) => z.pnl > 0).length / (tr.length || 1) * 100, 0) };
}
export function study(D, Z, P, deriv) {
  const F0 = D.t[P.betaN + P.zN + 1], T1 = D.t.at(-1) + 1, mid = Math.floor((F0 + T1) / 2), rows = [];
  for (const [name, over] of [['상대 모멘텀 BTC·ETH', {}], ['비용 2배 (스트레스)', { taker: P.taker * 2, slip: P.slip * 2 }], ['반감기 조건 없이', { hlMin: 0, hlMax: Infinity }]]) {
    const PP = { ...P, ...over }, row = { name };
    for (const [k, a, b] of [['all', F0, T1], ['h1', F0, mid], ['h2', mid, T1]]) { const r = simulate(D, Z, PP, deriv, { tA: a, tB: b }); row[k] = statsOf(r.equity.filter(([t]) => t >= a && t < b), r.trades.filter((z) => Date.parse(z.in.replace(' ', 'T') + 'Z') >= a && Date.parse(z.in.replace(' ', 'T') + 'Z') < b)) || {}; }
    rows.push(row);
  }
  return { from: isoT(F0), to: isoT(T1 - 1), study: rows };
}
async function loadK4(fetchImpl, repo, s, now) { const r = await fetchImpl('https://raw.githubusercontent.com/' + repo + '/deriv-data/k4-' + s + '.json?t=' + Math.floor(now / 6e5)); if (!r.ok) return null; const K = await r.json(); const d = { t: K.t, o: K.o, c: K.c }; while (d.t.length && d.t.at(-1) + H4 > now) { d.t.pop(); d.o.pop(); d.c.pop(); } return d; }

export async function run({ dir = process.env.SCALP_DIR || process.env.MK_DIR || join(ROOT, 'data'), now = new Date(), log = console.log, env = loadEnv(), sendPush = true, fetchImpl = fetch, data = null, derivData, reset = false } = {}) {
  const P = PCFG, nowT = now.getTime(), repo = env.GITHUB_REPOSITORY || process.env.GITHUB_REPOSITORY || 'rudrl09202-bit/sijangnalssi';
  mkdirSync(dir, { recursive: true }); const stF = join(dir, 'pair-state.json'), outF = join(dir, 'pair-live.json');
  let st = !reset && existsSync(stF) ? JSON.parse(readFileSync(stF, 'utf8')) : {};
  if (!data && st.lastBar && existsSync(outF) && nowT < st.lastBar + 2 * H4 + 10 * 60e3) { const o = JSON.parse(readFileSync(outF, 'utf8')); o.generatedAt = now.toISOString(); writeFileSync(outF, JSON.stringify(o)); log('상대 모멘텀: 새 4시간봉 없음 — 그대로'); return o; }
  let deriv = derivData; if (deriv === undefined) { try { const r = await fetchImpl('https://raw.githubusercontent.com/' + repo + '/deriv-data/deriv.json?t=' + Math.floor(nowT / 6e5)); deriv = r.ok ? await r.json() : null; } catch (e) { deriv = null; } }
  const SA = data ? data[P.A] : await loadK4(fetchImpl, repo, P.A, nowT), SB = data ? data[P.B] : await loadK4(fetchImpl, repo, P.B, nowT);
  if (!SA || !SB) { log('상대 모멘텀: 4시간봉을 못 받아 건너뜀'); return null; }
  const D = align(SA, SB), Z = signals(D, P), last = D.t.at(-1);
  if (!st.inception) { st.inception = last; log('상대 모멘텀 모의 계좌를 새로 엽니다 (1억) — 3개월 관찰'); }
  if (!st.wf || nowT - Date.parse(st.wf.at || 0) > 7 * DAY) { const W = study(D, Z, P, deriv), M = W.study[0], S2 = W.study[1];
    W.pass = { halves: M.h1.ret > 0 && M.h2.ret > 0, pf: (M.all.pf || 0) >= 1.3, mdd: M.all.mdd > -25, trades: M.all.n >= 40, stress: S2.all.ret > 0 }; W.pass.ok = Object.values(W.pass).every(Boolean); W.at = now.toISOString(); st.wf = W;
    log('상대 모멘텀 시험: 연 ' + M.all.cagr + '% · 낙폭 ' + M.all.mdd + '% · 샤프 ' + M.all.sharpe + ' · PF ' + M.all.pf + ' · 앞 ' + M.h1.ret + '% 뒤 ' + M.h2.ret + '%'); }
  const L = simulate(D, Z, P, deriv, { tA: st.inception }), eqL = L.equity.filter(([t]) => t >= st.inception), trL = L.trades.filter((z) => Date.parse(z.in.replace(' ', 'T') + 'Z') >= st.inception);
  const fresh = L.events.filter((e) => e.t > (st.lastBar || 0) && e.t >= st.inception); st.lastBar = last; writeFileSync(stF, JSON.stringify(st));
  const eq = Math.round(eqL.length ? eqL.at(-1)[1] : P.start), zNow = Z.at(-1), iL = D.t.length - 1;
  const positions = L.pos ? [
    { sym: P.A, name: NAME[P.A], side: L.pos.gA > 0 ? 'long' : 'short', entry: r2(L.pos.pa, 2), mark: D.ac[iL], notional: Math.round(L.pos.qA * D.ac[iL]), lev: r2(L.pos.qA * D.ac[iL] / eq, 2), upnl: Math.round(L.pos.gA * (L.pos.qA * D.ac[iL] - L.pos.nA) - L.pos.fund / 2), since: isoT(L.pos.t0), why: '비율 z ' + r2(L.pos.z0, 2) + ' — 벌어지는 쪽 따라감', barsLeft: Math.max(0, P.maxBars - 1 - (iL - L.pos.i0)) },
    { sym: P.B, name: NAME[P.B], side: L.pos.gB > 0 ? 'long' : 'short', entry: r2(L.pos.pb, 2), mark: D.bc[iL], notional: Math.round(L.pos.qB * D.bc[iL]), lev: r2(L.pos.qB * D.bc[iL] / eq, 2), upnl: Math.round(L.pos.gB * (L.pos.qB * D.bc[iL] - L.pos.nB) - L.pos.fund / 2), since: isoT(L.pos.t0), why: '반대쪽 다리 (시장 방향 상쇄)', barsLeft: Math.max(0, P.maxBars - 1 - (iL - L.pos.i0)) }] : [];
  // 민경기 매매법용: 같은 규칙, 레버리지만 1.25배 · 민경기 매매법 시작 시점부터
  const PM = { ...P, lev: P.lev * MG.k }, LM = simulate(D, Z, PM, deriv, { tA: MG.start }), eqM = LM.equity.filter(([t]) => t >= MG.start), mEq = Math.round(eqM.length ? eqM.at(-1)[1] : P.start);
  const posM = LM.pos ? [['A', P.A, 'ac', 'gA', 'qA', 'nA', 'pa'], ['B', P.B, 'bc', 'gB', 'qB', 'nB', 'pb']].map(([, sym, cK, gK, qK, nK, pK]) => ({ sym, name: NAME[sym], side: LM.pos[gK] > 0 ? 'long' : 'short', entry: r2(LM.pos[pK], 2), mark: D[cK][iL], notional: Math.round(LM.pos[qK] * D[cK][iL]), lev: r2(LM.pos[qK] * D[cK][iL] / mEq, 2), upnl: Math.round(LM.pos[gK] * (LM.pos[qK] * D[cK][iL] - LM.pos[nK]) - LM.pos.fund / 2), since: isoT(LM.pos.t0), why: '상대 모멘텀 (ETH↔BTC)' })) : [];
  const thin = (e, n = 400) => { const k = Math.max(1, Math.ceil(e.length / n)); return e.filter((x, i) => i % k === 0 || i === e.length - 1).map(([t, v]) => [isoT(t), Math.round(v)]); };
  const out = { v: 1, generatedAt: now.toISOString(), lastBar: isoT(last), inception: isoT(st.inception), tf: '4시간봉', watchUntil: '2027-02-25', cfg: P,
    now: zNow ? { z: r2(zNow.z, 2), beta: r2(zNow.beta, 3), hlDays: r2(zNow.hl / 6, 1), near: r2(Math.abs(zNow.z) / P.zIn * 100, 0) } : null,
    wf: st.wf, live: { equity: eq, start: P.start, ret: r2((eq / P.start - 1) * 100, 2), trades: trL.slice(-200).reverse(), n: trL.length, curve: thin(eqL.length ? eqL : [[last, P.start]]), positions, pending: L.pend ? [L.pend] : [], status: 'ok' },
    mg: { k: MG.k, lev: PM.lev, start: P.start, equity: mEq, ret: r2((mEq / P.start - 1) * 100, 2), curve: thin(eqM.length ? eqM : [[MG.start, P.start]]), trades: LM.trades.filter((z) => Date.parse(z.in.replace(' ', 'T') + 'Z') >= MG.start).slice(-200).reverse(), positions: posM } };
  writeFileSync(outF, JSON.stringify(out));
  log('상대 모멘텀: 모의 ' + out.live.ret + '% · 거래 ' + out.live.n + ' · ' + (L.pos ? '포지션 있음' : '대기') + ' · 지금 z ' + (out.now ? out.now.z : '—'));
  if (sendPush && fresh.length) await push(env, { title: '상대 모멘텀 ' + fresh.length + '건', body: fresh.slice(-3).map((e) => (e.kind === 'open' ? (e.g > 0 ? 'ETH 롱 · BTC 숏' : 'ETH 숏 · BTC 롱') + ' 진입 (z ' + r2(e.z, 1) + ')' : '정리 ' + (e.pnl >= 0 ? '+' : '') + Math.round(e.pnl / 1e4) + '만 · ' + e.why)).join('\n'), url: './index.html#bot/pr', tag: 'snw-pair' }, log);
  return out;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run({ reset: process.argv.includes('--reset') }).catch((e) => { console.error('✗ 상대 모멘텀: ' + e.message); process.exitCode = 1; });
