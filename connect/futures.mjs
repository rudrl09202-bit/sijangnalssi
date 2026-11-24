/* 코인 선물 모의투자 실행 (FLUX)
 * 하는 일:
 *  1) 야후 공개 시세: 1시간봉 2년 → 4시간봉으로 묶음, 일봉 10년 (BTC·ETH·SOL·XRP·DOGE)
 *  2) 백테스트: 4시간봉 2년(최근 30%는 표본 밖) + 일봉 10년 교차 검증 + 위험 크기별 비교
 *  3) 실시간 모의투자: data/futures-state.json 에서 이어서, 마감된 4시간봉만 처리
 *  4) 결과: data/futures-live.json (앱이 읽음) · 새 진입/청산은 푸시 알림
 * 실행: node connect/futures.mjs   (처음부터: --reset)
 * 진짜 돈·거래소 주문과는 연결되어 있지 않습니다(공개 시세만 사용).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { loadEnv, loadQuant, push, cleanTicks } from './paper.mjs';
import { vote as councilVote, keyStatus, VOTERS } from './council.mjs';
import { headlines, upcomingEvents, newsBrief } from './news.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require = createRequire(import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
const GOAL = 10; // 사용자가 잡은 월 목표(%)
const COUNCIL_RISK = 2.5; // AI 3명 만장일치일 때 한 번에 거는 위험(%)

const thin = (eq, n = 500) => { const k = Math.max(1, Math.ceil(eq.length / n)); return eq.filter((e, i) => i % k === 0 || i === eq.length - 1).map(([t, v]) => [isoT(t), v]); }; // 자산 곡선: 처음부터 끝까지 최대 500점
export async function yahoo(sym, range, interval, fetchImpl = fetch) {
  let lastErr;
  for (let k = 0; k < 4; k++) {
    try {
      const res = await fetchImpl(HOSTS[k % 2] + '/v8/finance/chart/' + encodeURIComponent(sym) + '?range=' + range + '&interval=' + interval, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', Accept: 'application/json' } });
      if (res.status === 429) { lastErr = new Error('429'); await sleep(1500 * (k + 1)); continue; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json(), r = j && j.chart && j.chart.result && j.chart.result[0];
      if (!r || !r.timestamp) throw new Error((j && j.chart && j.chart.error && j.chart.error.description) || '데이터 없음');
      const q = r.indicators.quote[0], out = { t: [], o: [], h: [], l: [], c: [] };
      r.timestamp.forEach((ts, i) => { const c = q.close[i]; if (c == null || !isFinite(c)) return; out.t.push(ts * 1000); out.o.push(q.open[i] ?? c); out.h.push(q.high[i] ?? c); out.l.push(q.low[i] ?? c); out.c.push(c); });
      return out;
    } catch (e) { lastErr = e; await sleep(500); }
  }
  throw lastErr;
}
// 1시간봉 → 4시간봉 (UTC 00·04·08·12·16·20 시작). 끝나지 않은 봉은 버림
export function to4h(k, now = Date.now()) {
  const B = 4 * 3600e3, g = new Map();
  k.t.forEach((t, i) => { const s = Math.floor(t / B) * B; let x = g.get(s); if (!x) { x = { t: s, o: k.o[i], h: k.h[i], l: k.l[i], c: k.c[i], n: 0 }; g.set(s, x); } x.h = Math.max(x.h, k.h[i]); x.l = Math.min(x.l, k.l[i]); x.c = k.c[i]; x.n++; });
  const bars = [...g.values()].filter((x) => x.t + B <= now && x.n >= 3).sort((a, b) => a.t - b.t);
  return cleanTicks({ t: bars.map((x) => x.t), o: bars.map((x) => x.o), h: bars.map((x) => x.h), l: bars.map((x) => x.l), c: bars.map((x) => x.c) });
}
export function toDaily(k, now = Date.now()) { // 야후 코인 일봉: 00:00 UTC 시작. 오늘(진행 중) 봉 제외
  const keep = k.t.map((t, i) => i).filter((i) => k.t[i] + 864e5 <= now);
  return cleanTicks({ t: keep.map((i) => Math.floor(k.t[i] / 864e5) * 864e5), o: keep.map((i) => k.o[i]), h: keep.map((i) => k.h[i]), l: keep.map((i) => k.l[i]), c: keep.map((i) => k.c[i]) });
}
const sample = (a, n) => { if (a.length <= n) return a; const step = a.length / n, out = []; for (let i = 0; i < n; i++) out.push(a[Math.floor(i * step)]); out.push(a[a.length - 1]); return out; };
const isoT = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');

// AI에게 줄 자료: 그 봉까지의 데이터만 (미래 없음)
export function brief(W, P, i, o, acc, cfg) {
  const x = W.X[o.sym], j = x.map[i], b = W.X.BTC, bj = b.map[i];
  const r = (v, n) => (v == null ? null : Number(v.toPrecision(n || 5)));
  const ret = (arr, k, n) => (k - n >= 0 ? Math.round((arr[k] / arr[k - n] - 1) * 1000) / 10 : null);
  const c = x.d.c[j], a = x.atr[j], stopDist = a * P.stopAtr;
  const eq = acc.equity.length ? acc.equity[acc.equity.length - 1][1] : acc.cash;
  return {
    시각_UTC: new Date(W.T[i]).toISOString().slice(0, 16), 코인: o.name + '(' + o.sym + ')', 방향: o.side === 'long' ? '롱' : '숏', 신호: o.why,
    현재가: r(c), 손절가: r(o.side === 'long' ? c - stopDist : c + stopDist), 손절거리_퍼센트: Math.round(stopDist / c * 1000) / 10,
    돌파_기준: r(o.side === 'long' ? x.hi[j] : x.lo[j]), EMA50: r(x.eF[j]), EMA200: r(x.eS[j]), ATR_퍼센트: Math.round(a / c * 1000) / 10,
    수익률_퍼센트: { '1일': ret(x.d.c, j, 6), '7일': ret(x.d.c, j, 42), '30일': ret(x.d.c, j, 180) },
    최근7일_4시간봉_종가: x.d.c.slice(Math.max(0, j - 41), j + 1).map((v) => r(v, 5)),
    BTC: { 가격: r(b.d.c[bj]), '200일평균': r(b.reg[bj]), 장세: b.d.c[bj] > b.reg[bj] ? '상승장(200일선 위)' : '하락장(200일선 아래)', '7일': ret(b.d.c, bj, 42), '30일': ret(b.d.c, bj, 180) },
    계좌: { 원금대비_퍼센트: Math.round((eq / acc.start - 1) * 1000) / 10, 고점대비_퍼센트: Math.round((eq / acc.peak - 1) * 1000) / 10, 열린_포지션: Object.values(acc.pos).map((p) => p.name + ' ' + (p.side === 'long' ? '롱' : '숏')) },
    고정_규칙: { 이번_위험: COUNCIL_RISK + '%', 전체_레버리지_상한: cfg.maxLevTotal + '배', 격리: cfg.isoLev + '배' }
  };
}
async function runCouncil({ F, W, P, cfg, acc, from, to, env, fetchImpl, log, votes, NB = {} }) {
  for (let i = from; i <= to; i++) {
    F.simulate(W, P, cfg, acc, i, i, { collect: true, vote: true });
    const need = acc.pending.filter((o) => o.kind === 'open' && o.needVote && o.approved == null);
    for (const o of need) {
      // 같은 코인·방향이 24시간 안에 거절(또는 키 없음)됐으면 다시 묻지 않음 — "찬성 나올 때까지 묻기" 방지
      const tNow = W.T[i], recent = votes.slice().reverse().find((v) => v.sym === o.sym && v.side === o.side && v.result !== 'approved');
      if (recent && tNow - Date.parse(recent.t.replace(' ', 'T') + ':00Z') < 24 * 3600e3) { o.approved = false; continue; }
      const bf = { ...brief(W, P, i, o, acc, cfg), ...NB };
      const v = await councilVote(env, bf, fetchImpl);
      o.approved = v.result === 'approved'; o.risk = COUNCIL_RISK;
      votes.push({ t: bf.시각_UTC.replace('T', ' '), sym: o.sym, name: o.name, side: o.side, price: bf.현재가, stop: bf.손절가, why: o.why, result: v.result, votes: v.votes });
      if (v.result !== 'nokey') log('AI 회의: ' + o.name + ' ' + (o.side === 'long' ? '롱' : '숏') + ' → ' + v.votes.map((x) => x.name + ' ' + x.vote).join(', ') + ' = ' + (o.approved ? '진입' : '보류'));
    }
  }
}
function liveView(F, Q, W, L, h4, lastIdx) {
  const mark = (s) => { const d = h4[s]; return d ? d.c[d.c.length - 1] : null; };
  const eqNow = L.equity.length ? L.equity[L.equity.length - 1][1] : L.cash;
  const ldc = F.daily(L.equity), lm = ldc.length > 1 ? Q.metrics(ldc, L.trades) : null;
  const positions = Object.values(L.pos).map((p) => {
    const m = mark(p.sym), u = (p.side === 'long' ? 1 : -1) * (m - p.entry) * p.qty;
    return { sym: p.sym, name: p.name, side: p.side, entry: p.entry, mark: m, qty: p.qty, notional: Math.round(m * p.qty), lev: Math.round(m * p.qty / eqNow * 100) / 100,
      margin: Math.round(p.margin), upnl: Math.round(u), roe: Math.round(u / p.margin * 1000) / 10, stop: p.stop, liq: p.liq,
      toStop: Math.round(Math.abs(m / p.stop - 1) * 1000) / 10, toLiq: Math.round(Math.abs(m / p.liq - 1) * 1000) / 10, funding: Math.round(p.funding), since: isoT(p.t), why: p.why, risk: Math.round(p.riskAmt) };
  });
  const lev = positions.reduce((a, p) => a + p.notional, 0) / (eqNow || 1);
  return { equity: eqNow, start: L.start, ret: Math.round((eqNow / L.start - 1) * 10000) / 100, days: ldc.length, metrics: lm, curve: thin(L.equity),
    positions, lev: Math.round(lev * 100) / 100, pending: L.pending.filter((o) => o.kind === 'open' && (!o.needVote || o.approved)).map((o) => ({ sym: o.sym, name: o.name, side: o.side, why: o.why })),
    trades: L.trades.slice(-300).reverse(), status: (L.killUntilT || 0) > W.T[lastIdx] ? 'killed' : L.dayBlock ? 'dayblock' : L.half ? 'half' : 'ok', liq: L.liquidations, peak: Math.round(L.peak),
    funding: Math.round(L.fundingPaid), fees: Math.round(L.feesPaid), months: F.monthStats(ldc, GOAL) };
}

export async function run({ root = ROOT, now = new Date(), log = console.log, env = loadEnv(), reset = false, sendPush = true, fetchImpl = fetch, data = null } = {}) {
  const t0 = Date.now(), F = require(join(root, 'js', 'futures.js')), Q = loadQuant(root);
  // ── 1) 시세
  const h4 = {}, d1 = {}, errors = [];
  if (data) { Object.assign(h4, data.h4); Object.assign(d1, data.d1); }
  else for (const c of F.COINS) {
    try { let k; try { k = await yahoo(c.y, '730d', '1h', fetchImpl); } catch (e) { k = await yahoo(c.y, '365d', '1h', fetchImpl); } h4[c.sym] = to4h(k, now.getTime()); } catch (e) { errors.push(c.sym + ' 4h: ' + e.message); }
    try { d1[c.sym] = toDaily(await yahoo(c.y, '10y', '1d', fetchImpl), now.getTime()); } catch (e) { errors.push(c.sym + ' 1d: ' + e.message); }
    await sleep(250);
  }
  if (!h4.BTC || h4.BTC.c.length < 1500) throw new Error('BTC 4시간봉이 부족합니다 (' + (h4.BTC ? h4.BTC.c.length : 0) + '봉) ' + errors.join(' / '));
  log('4시간봉 ' + Object.keys(h4).map((s) => s + ' ' + h4[s].c.length).join(', ') + ' · 일봉 ' + Object.keys(d1).map((s) => s + ' ' + d1[s].c.length).join(', '));

  // ── 2) 백테스트
  const P = F.PRESETS.h4, cfg = Object.assign({}, F.BASE);
  const W = F.prepare(h4, P);
  const btA = F.newAccount(cfg); F.simulate(W, P, cfg, btA, 0, W.T.length - 1);
  const dcurve = F.daily(btA.equity);
  const start = dcurve.length ? dcurve[0][0] : null, split = dcurve.length ? dcurve[Math.floor(dcurve.length * 0.7)][0] : null;
  const full = Q.metrics(dcurve, btA.trades);
  const oos = Q.metrics(dcurve.filter((x) => x[0] >= split), btA.trades.filter((x) => x.out.slice(0, 10) >= split));
  const months = F.monthStats(dcurve, GOAL);
  const mc = Q.monteCarlo(dcurve, 500);
  const holdBtc = (() => { const b = h4.BTC, i0 = b.t.findIndex((t) => new Date(t).toISOString().slice(0, 10) >= start); return i0 < 0 ? null : Math.round((b.c[b.c.length - 1] / b.c[i0] - 1) * 10000) / 100; })();
  let d1r = null;
  if (d1.BTC && d1.BTC.c.length > 400) {
    const r = F.backtest(d1, 'd1'), dc = F.daily(r.acc.equity), m = Q.metrics(dc, r.acc.trades), ms = F.monthStats(dc, GOAL);
    d1r = { metrics: m, months: { avg: ms.avg, median: ms.median, hit: ms.hit, neg: ms.neg, worst: ms.worst, best: ms.best }, yearly: m && m.yearly, curve: sample(dc, 260), liq: r.acc.liquidations, kills: r.acc.killed };
  }
  const ladder = F.riskLadder(h4, 'h4', [0.5, 1, 1.5, 2, 3, 5], (dc, tr) => Q.metrics(dc, tr), GOAL);
  log('백테스트 4h ' + start + '~ · CAGR ' + (full && full.cagr) + '% · MDD ' + (full && full.mdd) + '% · PF ' + (full && full.pf) + ' · 월평균 ' + months.avg + '% · 월10% 달성 ' + months.hit + '% · 표본 밖 ' + (oos && oos.cagr) + '% · 일봉10년 ' + (d1r && d1r.metrics ? d1r.metrics.cagr + '% / MDD ' + d1r.metrics.mdd + '%' : '—'));
  ladder.forEach((x) => log('  위험 ' + x.risk + '%: CAGR ' + x.cagr + '% · MDD ' + x.mdd + '% · 월평균 ' + x.avgMonth + '% · 월10% 달성 ' + x.hit + '% · 최악의 달 ' + x.worstMonth + '% · 강제청산 ' + x.liq));

  // ── 3) 실시간 모의투자 (이어서)
  const stateFile = join(root, 'data', 'futures-state.json');
  let st = !reset && existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : null;
  const lastIdx = W.T.length - 1;
  let from;
  if (!st) { st = { v: 1, inception: W.T[lastIdx], acc: F.newAccount(cfg) }; from = lastIdx; log('선물 모의 계좌를 새로 엽니다: ' + isoT(W.T[lastIdx]) + ' 봉 마감부터 판단, 다음 봉 시가부터 체결'); }
  else from = W.T.findIndex((t) => t > st.acc.lastT);
  const L = st.acc; L.events = [];
  if (from >= 0) F.simulate(W, P, cfg, L, from, lastIdx, { collect: true });
  const fresh = L.events.slice();
  L.events = [];
  // ── 3-2) AI 회의 계좌 (COUNCIL): 같은 엔진 후보 + 세 AI 만장일치일 때만, 위험 2.5%
  let cfrom;
  if (!st.council) { st.council = { inception: W.T[lastIdx], acc: F.newAccount(cfg), votes: [] }; cfrom = lastIdx; log('AI 회의 계좌를 새로 엽니다'); }
  else cfrom = W.T.findIndex((t) => t > st.council.acc.lastT);
  const C = st.council.acc; C.events = [];
  const keys = keyStatus(env);
  let NB = {};
  if (!data) { try { NB = newsBrief(await headlines({ fetchImpl, now: now.getTime(), log }), upcomingEvents(root, now.getTime())); } catch (e) { log('뉴스 실패: ' + e.message); } }
  if (cfrom >= 0) await runCouncil({ F, W, P, cfg, acc: C, from: cfrom, to: lastIdx, env, fetchImpl, log, votes: st.council.votes, NB });
  st.council.votes = st.council.votes.slice(-150);
  const cfresh = C.events.slice(); C.events = [];
  st.updatedAt = now.toISOString();
  mkdirSync(join(root, 'data'), { recursive: true });
  writeFileSync(stateFile, JSON.stringify(st));

  // ── 4) 성적표
  const mark = (s) => { const d = h4[s]; return d ? d.c[d.c.length - 1] : null; };
  const live = liveView(F, Q, W, L, h4, lastIdx), cl = liveView(F, Q, W, C, h4, lastIdx);
  const vs = st.council.votes, decided = vs.filter((v) => v.result !== 'nokey');
  const aiStats = VOTERS.map((v) => { const mine = decided.map((x) => x.votes.find((y) => y.ai === v.id)).filter(Boolean); return { ai: v.id, name: v.name, key: keys[v.id], model: (mine[mine.length - 1] || {}).model || env[v.model] || v.def, votes: mine.length, yes: mine.filter((y) => y.vote === 'yes').length, errors: mine.filter((y) => y.vote === 'error').length }; });
  const out = {
    v: 1, generatedAt: now.toISOString(), lastBar: isoT(W.T[lastIdx]), inception: isoT(st.inception), goal: GOAL, cfg, preset: P,
    coins: F.COINS.filter((c) => h4[c.sym]).map((c) => ({ sym: c.sym, name: c.name, price: mark(c.sym) })),
    bt: { from: start, split, metrics: full, oos, months, mc, holdBtc, curve: sample(dcurve, 300), recent: btA.trades.slice(-30).reverse(), liq: btA.liquidations, kills: btA.killed,
      funding: Math.round(btA.fundingPaid), fees: Math.round(btA.feesPaid), longs: btA.trades.filter((x) => x.side === 'long').length, shorts: btA.trades.filter((x) => x.side === 'short').length },
    d1: d1r, ladder,
    live,
    council: { ...cl, inception: isoT(st.council.inception), risk: COUNCIL_RISK, keys, ai: aiStats, votes: vs.slice(-30).reverse(), asked: decided.length, approved: decided.filter((v) => v.result === 'approved').length, waiting: vs.filter((v) => v.result === 'nokey').length },
    today: fresh.slice(-30),
    errors
  };
  out.ready = F.readiness({ days: live.days, trades: L.trades.length, pf: live.metrics && live.metrics.pf, mdd: live.metrics && live.metrics.mdd, liq: L.liquidations }, { mdd: full && full.mdd, oosCagr: oos && oos.cagr, d1Cagr: d1r && d1r.metrics && d1r.metrics.cagr });
  writeFileSync(join(root, 'data', 'futures-live.json'), JSON.stringify(out));
  log('선물 모의: FLUX ' + Math.round(live.equity / 1e4).toLocaleString('ko-KR') + '만 (' + live.ret + '%) · 포지션 ' + live.positions.length + ' · 레버리지 ' + live.lev + '배 · 새 이벤트 ' + fresh.length + ' | COUNCIL ' + cl.ret + '% · 투표 ' + decided.length + '건(키 대기 ' + out.council.waiting + ') · 키 ' + JSON.stringify(keys) + ' · ' + ((Date.now() - t0) / 1000).toFixed(1) + '초');

  // ── 5) 푸시
  const moves = fresh.filter((e) => e.kind === 'open' || e.kind === 'close' || e.kind === 'vault').map((e) => ({ ...e, who: 'FLUX' }))
    .concat(cfresh.filter((e) => e.kind === 'open' || e.kind === 'close' || e.kind === 'vault').map((e) => ({ ...e, who: 'AI회의' })));
  if (sendPush && moves.length) {
    const side = (s) => (s === 'long' ? '롱' : '숏');
    const lines = moves.slice(-6).map((e) => e.who + ' ' + (e.kind === 'open' ? `${side(e.side)} 진입 ${e.name} · ${e.lev}배 · 손절 ${e.stop}` : e.kind === 'close' ? `${side(e.side)} 청산 ${e.name} ${e.pnl >= 0 ? '+' : ''}${Math.round(e.pnl / 1e4).toLocaleString('ko-KR')}만 (${e.reason})` : '금고: ' + e.msg));
    const n = await push(env, { title: '선물 모의 ' + moves.length + '건', body: lines.join('\n'), url: './index.html#futures', tag: 'snw-futures' }, log);
    if (n) log('푸시 ' + n + '건');
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run({ reset: process.argv.includes('--reset') }).catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
}
