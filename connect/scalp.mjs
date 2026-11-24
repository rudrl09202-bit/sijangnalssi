/* 코인 선물 단타 모의투자 실행 (SCALP · Claude가 결정)
 *  1) 야후 15분봉 60일 (BTC·ETH·SOL·XRP·DOGE)
 *  2) 백테스트(엔진만) — 단타는 수수료 영향이 커서 그대로 보여 줌
 *  3) 실시간: 마감된 15분봉만 이어서 처리. 엔진 후보가 나오면 Claude가 "진입/건너뜀" 결정
 *  4) 매 봉마다 "판단 기록"(코인별 상태·왜 안 들어가는지) 저장 → 앱에서 봇이 일하는지 보임
 *  5) 결과 폴더: SCALP_DIR (워크플로가 bot-data 브랜치에 저장 — main 기록을 어지럽히지 않게)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { loadEnv, loadQuant, push, cleanTicks } from './paper.mjs';
import { askClaude } from './council.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..');
const require = createRequire(import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isoT = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
const BAR = 15 * 60e3;

const SYSTEM = `당신은 코인 무기한 선물 단타 트레이더입니다. 15분봉 규칙 엔진이 진입 후보를 올리면, 실제로 들어갈지(enter) 건너뛸지(skip) 결정합니다.
- 손절·익절·크기·레버리지는 규칙으로 고정입니다(손절 1.5 ATR, 익절 2R, 계좌 1% 위험). 당신은 진입 여부만 정합니다.
- 단타는 수수료가 커서 애매하면 건너뛰는 게 이득입니다. 추세 방향과 일치하는지, 직전 봉들의 힘, 과열/추격 여부, BTC 흐름, 최근 손익을 보고 판단하세요.
- 주어진 자료만 근거로 하세요. 이후 가격을 안다고 가정하지 마세요.
반드시 JSON 한 줄로만 답하세요: {"decision":"enter" 또는 "skip","confidence":0~100 정수,"reason":"한국어 한 문장(60자 이내)"}`;

export function parseDecision(text) {
  const m = String(text || '').match(/\{[\s\S]*?\}/); if (!m) throw new Error('JSON 없음: ' + String(text || '(빈 응답)').replace(/\s+/g, ' ').slice(0, 120));
  const j = JSON.parse(m[0]), d = String(j.decision || '').toLowerCase().trim();
  if (d !== 'enter' && d !== 'skip') throw new Error('decision 값 이상');
  return { decision: d, confidence: Math.max(0, Math.min(100, Math.round(Number(j.confidence) || 0))), reason: String(j.reason || '').slice(0, 120) };
}
export function brief(W, P, i, o, acc) {
  const x = W.X[o.sym], j = x.map[i], b = W.X.BTC, bj = b.map[i], r = (v) => (v == null ? null : Number(v.toPrecision(5)));
  const ret = (arr, k, n) => (k - n >= 0 ? Math.round((arr[k] / arr[k - n] - 1) * 1000) / 10 : null);
  const eq = acc.equity.length ? acc.equity[acc.equity.length - 1][1] : acc.cash;
  const last = acc.trades.slice(-5).map((t) => t.name + ' ' + (t.side === 'long' ? '롱' : '숏') + ' ' + (t.R >= 0 ? '+' : '') + t.R + 'R');
  return {
    시각_UTC: new Date(W.T[i]).toISOString().slice(0, 16), 코인: o.name + '(' + o.sym + ')', 방향: o.side === 'long' ? '롱' : '숏', 셋업: o.why,
    현재가: r(x.d.c[j]), EMA20: r(x.eP[j]), EMA50: r(x.eF[j]), EMA200: r(x.eS[j]), RSI: Math.round(x.rsi[j]), ATR_퍼센트: Math.round(x.atr[j] / x.d.c[j] * 1000) / 100,
    수익률_퍼센트: { '1시간': ret(x.d.c, j, 4), '4시간': ret(x.d.c, j, 16), '24시간': ret(x.d.c, j, 96) },
    최근16봉: x.d.c.slice(Math.max(0, j - 15), j + 1).map((v, k, a) => { const jj = j - (a.length - 1) + k; return [r(x.d.o[jj]), r(x.d.h[jj]), r(x.d.l[jj]), r(v)]; }),
    BTC: { '1시간': ret(b.d.c, bj, 4), '4시간': ret(b.d.c, bj, 16), 추세: b.eF[bj] > b.eS[bj] ? '15분 정배열' : '15분 역배열' },
    계좌: { 원금대비_퍼센트: Math.round((eq / acc.start - 1) * 1000) / 10, 최근거래: last, 열린포지션: Object.values(acc.pos).map((p) => p.name + ' ' + (p.side === 'long' ? '롱' : '숏')) }
  };
}

function to15(k, now) {
  const keep = []; k.t.forEach((t, i) => { if (t % BAR === 0 && t + BAR <= now) keep.push(i); });
  return cleanTicks({ t: keep.map((i) => k.t[i]), o: keep.map((i) => k.o[i]), h: keep.map((i) => k.h[i]), l: keep.map((i) => k.l[i]), c: keep.map((i) => k.c[i]), v: keep.map((i) => (k.v ? k.v[i] : 0)) });
}
async function yahoo15(sym, fetchImpl) {
  // futures.mjs 의 yahoo()는 거래량을 버리므로 여기서 거래량까지 받음
  const H = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com']; let err;
  for (let k = 0; k < 4; k++) {
    try {
      const res = await fetchImpl(H[k % 2] + '/v8/finance/chart/' + encodeURIComponent(sym) + '?range=60d&interval=15m', { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', Accept: 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json(), rr = j.chart.result[0], q = rr.indicators.quote[0], out = { t: [], o: [], h: [], l: [], c: [], v: [] };
      rr.timestamp.forEach((ts, i) => { const c = q.close[i]; if (c == null || !isFinite(c)) return; out.t.push(ts * 1000); out.o.push(q.open[i] ?? c); out.h.push(q.high[i] ?? c); out.l.push(q.low[i] ?? c); out.c.push(c); out.v.push(q.volume[i] || 0); });
      return out;
    } catch (e) { err = e; await sleep(800 * (k + 1)); }
  }
  throw err;
}

export async function run({ root = ROOT, dir = process.env.SCALP_DIR || join(ROOT, 'data'), now = new Date(), log = console.log, env = loadEnv(), reset = false, sendPush = true, fetchImpl = fetch, data = null } = {}) {
  const t0 = Date.now(), SC = require(join(root, 'js', 'scalp.js')), Q = loadQuant(root), P = SC.CFG;
  // ── 1) 시세
  const series = {}, errors = [];
  if (data) Object.assign(series, data);
  else for (const c of SC.COINS) { try { series[c.sym] = to15(await yahoo15(c.y, fetchImpl), now.getTime()); } catch (e) { errors.push(c.sym + ': ' + e.message); } await sleep(200); }
  if (!series.BTC || series.BTC.c.length < 800) throw new Error('BTC 15분봉 부족 ' + (series.BTC ? series.BTC.c.length : 0) + ' ' + errors.join(' / '));
  const W = SC.prepare(series, P), last = W.T.length - 1;
  log('15분봉 ' + Object.keys(series).map((s) => s + ' ' + series[s].c.length).join(', ') + ' · 마지막 ' + isoT(W.T[last]) + ' UTC');

  // ── 2) 백테스트 (엔진만)
  const bt = SC.newAccount(P); SC.simulate(W, P, bt, 0, last);
  const bdc = SC.daily(bt.equity), bm = Q.metrics(bdc, bt.trades), bs = SC.stats(bt);
  const days = bdc.length; bs.perDay = days ? Math.round(bs.trades / days * 10) / 10 : null;
  log('백테스트(엔진만, ' + days + '일): 수익 ' + Math.round((bt.equity[bt.equity.length - 1][1] / bt.start - 1) * 1000) / 10 + '% · 최대낙폭 ' + (bm && bm.mdd) + '% · 거래 ' + bs.trades + '번(하루 ' + bs.perDay + ') · 승률 ' + bs.winRate + '% · PF ' + bs.pf + ' · 평균 ' + bs.avgR + 'R · 수수료 ' + Math.round(bs.fees / 1e4) + '만');

  // ── 2-2) 설정 비교 (앞 절반 / 뒤 절반 따로) — 숫자 맞추기가 아니라 어디서 지는지 보기
  const half = Math.floor(W.T.length / 2), study = [];
  const variants = [
    ['기본', {}], ['눌림목만', { only: 'pullback' }], ['돌파만', { only: 'squeeze' }], ['목표 3R', { tpR: 3 }], ['목표 1.5R', { tpR: 1.5 }],
    ['손절 2.5ATR', { stopAtr: 2.5 }], ['본전이동 없음', { beR: 99 }], ['보유 12시간', { maxBars: 48 }], ['1시간 추세 강할 때만', { strong: true }]
  ];
  for (const [name, over] of variants) {
    const PP = Object.assign({}, P, over), row = { name };
    for (const [k, a, b] of [['all', 0, W.T.length - 1], ['h1', 0, half], ['h2', half, W.T.length - 1]]) {
      const ac = SC.newAccount(PP); SC.simulate(W, PP, ac, a, b); const s2 = SC.stats(ac);
      row[k] = { ret: Math.round((ac.equity[ac.equity.length - 1][1] / ac.start - 1) * 1000) / 10, n: s2.trades, win: s2.winRate, pf: s2.pf, avgR: s2.avgR };
    }
    study.push(row);
    log('  비교 ' + name.padEnd(12) + ' 전체 ' + row.all.ret + '% (' + row.all.n + '번, PF ' + row.all.pf + ') · 앞 ' + row.h1.ret + '% · 뒤 ' + row.h2.ret + '%');
  }
  log('  셋업별: ' + Object.entries(bs.byKind).map(([k, v]) => k + ' ' + v.n + '번 승률 ' + v.winRate + '% 평균 ' + v.avgR + 'R').join(' · '));

  // ── 3) 실시간 (Claude 결정)
  mkdirSync(dir, { recursive: true });
  const stFile = join(dir, 'scalp-state.json');
  let st = !reset && existsSync(stFile) ? JSON.parse(readFileSync(stFile, 'utf8')) : null;
  let from;
  if (!st) { st = { v: 1, inception: W.T[last], acc: SC.newAccount(P), decisions: [] }; from = last; log('단타 모의 계좌를 새로 엽니다'); }
  else from = W.T.findIndex((t) => t > st.acc.lastT);
  const A = st.acc; A.events = [];
  const key = env.ANTHROPIC_API_KEY, model = env.SCALP_MODEL || env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
  let asked = 0;
  if (from >= 0) for (let i = from; i <= last; i++) {
    SC.simulate(W, P, A, i, i, { collect: true, vote: true, log: true });
    for (const o of A.pending.filter((x) => x.kind === 'open' && x.needVote && x.approved == null)) {
      const age = now.getTime() - (W.T[i] + BAR), rec = { t: isoT(W.T[i]), sym: o.sym, name: o.name, side: o.side, kind: o.setup, why: o.why, price: o.ref };
      const recent = st.decisions.slice().reverse().find((d) => d.sym === o.sym && d.side === o.side && d.decision !== 'enter');
      if (recent && W.T[i] - Date.parse(recent.t.replace(' ', 'T') + ':00Z') < 60 * 60e3) { o.approved = false; continue; } // 같은 후보는 1시간 안에 다시 안 물음
      if (age > 2 * 3600e3) { o.approved = false; st.decisions.push({ ...rec, decision: 'late', reason: '실행이 늦어 2시간 지난 신호 — 건너뜀' }); continue; }
      if (!key) { o.approved = false; st.decisions.push({ ...rec, decision: 'nokey', reason: 'Claude 키 없음' }); continue; }
      let d;
      try { d = parseDecision(await askClaude(key, model, '후보 자료(JSON):\n' + JSON.stringify(brief(W, P, i, o, A)), fetchImpl, SYSTEM, 300)); }
      catch (e) { d = { decision: 'error', confidence: 0, reason: '응답 실패: ' + String(e.message || e).slice(0, 60) }; }
      asked++;
      o.approved = d.decision === 'enter'; o.ai = { decision: d.decision, confidence: d.confidence, reason: d.reason };
      st.decisions.push({ ...rec, ...d, model });
      log('Claude: ' + o.name + ' ' + (o.side === 'long' ? '롱' : '숏') + ' (' + o.why + ') → ' + d.decision + ' ' + d.confidence + ' · ' + d.reason);
    }
  }
  // 비교용: 같은 엔진 후보를 전부 들어가는 계좌 (Claude 없이)
  if (!st.shadow) { st.shadow = SC.newAccount(P); st.shadowFrom = st.shadowFrom || W.T[last]; }
  const sf = st.shadow.lastT == null ? last : W.T.findIndex((t) => t > st.shadow.lastT);
  if (sf >= 0) SC.simulate(W, P, st.shadow, sf, last, { collect: false });
  st.decisions = st.decisions.slice(-120);
  const fresh = A.events.slice(); A.events = []; st.updatedAt = now.toISOString();
  writeFileSync(stFile, JSON.stringify(st));

  // ── 4) 앱용 결과
  const mark = (s) => { const d = series[s]; return d ? d.c[d.c.length - 1] : null; };
  const eq = A.equity.length ? A.equity[A.equity.length - 1][1] : A.cash;
  const ldc = SC.daily(A.equity), ls = SC.stats(A);
  const positions = Object.values(A.pos).map((p) => { const m = mark(p.sym), u = (p.side === 'long' ? 1 : -1) * (m - p.entry) * p.qty;
    return { sym: p.sym, name: p.name, side: p.side, kind: p.kind, entry: p.entry, mark: m, qty: p.qty, notional: Math.round(m * p.qty), lev: Math.round(m * p.qty / eq * 100) / 100, margin: Math.round(p.margin),
      upnl: Math.round(u), roe: Math.round(u / p.margin * 1000) / 10, stop: p.stop, tp: p.tp, liq: p.liq, be: p.be, toStop: Math.round(Math.abs(m / p.stop - 1) * 1000) / 10, toLiq: Math.round(Math.abs(m / p.liq - 1) * 1000) / 10,
      funding: Math.round(p.funding), since: isoT(p.t), why: p.why, risk: Math.round(p.riskAmt), ai: p.ai, barsLeft: Math.max(0, P.maxBars - 1 - Math.round((W.T[last] - p.t) / BAR)) }; });
  const dec = st.decisions.filter((d) => d.decision === 'enter' || d.decision === 'skip');
  const out = {
    v: 1, generatedAt: now.toISOString(), lastBar: isoT(W.T[last]), inception: isoT(st.inception), cfg: P, model, hasKey: !!key,
    live: { equity: eq, start: A.start, ret: Math.round((eq / A.start - 1) * 10000) / 100, days: ldc.length, stats: ls, curve: A.equity.slice(-400).map(([t, v]) => [isoT(t), v]),
      positions, lev: Math.round(positions.reduce((a, p) => a + p.notional, 0) / (eq || 1) * 100) / 100, trades: A.trades.slice(-40).reverse(),
      status: A.killUntilT > W.T[last] ? 'killed' : A.dayBlock ? 'dayblock' : A.pauseUntilT > W.T[last] ? 'pause' : 'ok', peak: Math.round(A.peak) },
    shadow: (() => { const S2 = st.shadow, e2 = S2.equity.length ? S2.equity[S2.equity.length - 1][1] : S2.cash; return { equity: e2, ret: Math.round((e2 / S2.start - 1) * 10000) / 100, stats: SC.stats(S2), trades: S2.trades.slice(-10).reverse(), open: Object.keys(S2.pos).length }; })(),
    decisions: st.decisions.slice(-30).reverse(), aiStats: { asked: dec.length, enter: dec.filter((d) => d.decision === 'enter').length },
    log: A.log.slice(-12).reverse(),
    study, bt: { days, from: bdc.length ? bdc[0][0] : null, ret: Math.round((bt.equity[bt.equity.length - 1][1] / bt.start - 1) * 1000) / 10, metrics: bm, stats: bs, curve: bdc, recent: bt.trades.slice(-15).reverse() },
    coins: SC.COINS.filter((c) => series[c.sym]).map((c) => ({ sym: c.sym, name: c.name, price: mark(c.sym) })), errors
  };
  writeFileSync(join(dir, 'scalp-live.json'), JSON.stringify(out));
  log('단타 모의: Claude ' + Math.round(eq / 1e4).toLocaleString('ko-KR') + '만 (' + out.live.ret + '%) · 엔진 혼자 ' + out.shadow.ret + '% (' + out.shadow.stats.trades + '번) · 포지션 ' + positions.length + ' · 거래 ' + ls.trades + ' · Claude 판단 ' + asked + '건 · 새 이벤트 ' + fresh.length + ' · ' + ((Date.now() - t0) / 1000).toFixed(1) + '초');

  // ── 5) 푸시
  const moves = fresh.filter((e) => e.kind === 'open' || e.kind === 'close' || e.kind === 'vault');
  if (sendPush && moves.length) {
    const side = (s) => (s === 'long' ? '롱' : '숏');
    const lines = moves.slice(-5).map((e) => e.kind === 'open' ? `${side(e.side)} 진입 ${e.name} ${e.lev}배 · 손절 ${e.stop} · 목표 ${e.tp}` : e.kind === 'close' ? `${side(e.side)} 청산 ${e.name} ${e.pnl >= 0 ? '+' : ''}${Math.round(e.pnl / 1e4).toLocaleString('ko-KR')}만 (${e.reason})` : '금고: ' + e.msg);
    await push(env, { title: '단타 봇 ' + moves.length + '건', body: lines.join('\n'), url: './index.html#scalp', tag: 'snw-scalp' }, log);
  }
  return out;
}
async function ping() {
  const env = loadEnv(), key = env.ANTHROPIC_API_KEY, model = env.SCALP_MODEL || env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
  const sample = { 시각_UTC: '2026-11-24T05:00', 코인: '비트코인(BTC)', 방향: '롱', 셋업: '상승추세 눌림목 반등 (20EMA 지지, RSI 54)', 현재가: 98000, EMA20: 97800, EMA50: 97000, EMA200: 95000, RSI: 54, ATR_퍼센트: 0.45,
    최근16봉: [[97500, 97900, 97400, 97800], [97800, 98100, 97700, 98000]], BTC: { 추세: '15분 정배열' }, 계좌: { 원금대비_퍼센트: 0, 최근거래: [] } };
  const t = await askClaude(key, model, '후보 자료(JSON):\n' + JSON.stringify(sample), fetch, SYSTEM, 300);
  console.log('원문: ' + JSON.stringify(t).slice(0, 400));
  try { console.log('✓ 해석: ' + JSON.stringify(parseDecision(t))); } catch (e) { console.log('✗ ' + e.message); process.exitCode = 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes('--ping')) ping();
else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run({ reset: process.argv.includes('--reset') }).catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
