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
import { askClaude, askGemini, askGpt, VOTERS } from './council.mjs';
import { headlines, upcomingEvents, newsBrief } from './news.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..');
const require = createRequire(import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isoT = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
const BAR = 15 * 60e3;
const thin = (eq, n = 500) => { const k = Math.max(1, Math.ceil(eq.length / n)); return eq.filter((e, i) => i % k === 0 || i === eq.length - 1).map(([t, v]) => [isoT(t), v]); }; // 자산 곡선: 처음부터 끝까지 최대 500점

const SYSTEM = `당신은 코인 무기한 선물 단타 트레이더입니다. 15분봉 규칙 엔진이 진입 후보를 올리면, 실제로 들어갈지(enter) 건너뛸지(skip) 결정합니다.
- 손절·익절·크기·레버리지는 규칙으로 고정입니다(손절 1.5 ATR, 익절 2R, 계좌 1% 위험). 당신은 진입 여부만 정합니다.
- 단타는 수수료가 커서 애매하면 건너뛰는 게 이득입니다. 추세 방향과 일치하는지, 직전 봉들의 힘, 과열/추격 여부, BTC 흐름, 최근 손익을 보고 판단하세요.
- 주어진 자료만 근거로 하세요. 이후 가격을 안다고 가정하지 마세요.
- '최근_뉴스'에 큰 악재(⚠ 표시: 해킹·규제·소송·대량 청산 등)가 있거나, '48시간_안_큰_발표'(FOMC·CPI 등)가 몇 시간 안이면 건너뛰는 쪽으로 판단하세요. '장세'도 참고하세요.
반드시 JSON 한 줄로만 답하세요: {"decision":"enter" 또는 "skip","confidence":0~100 정수,"reason":"한국어 한 문장(60자 이내)"}`;

const SYSTEM_BOLD = `당신은 코인 무기한 선물 단타 트레이더(적극형)입니다. 15분봉 규칙 엔진이 진입 후보를 올리면, 실제로 들어갈지(enter) 건너뛸지(skip) 결정합니다.
- 손절·익절·크기·레버리지는 규칙으로 고정입니다(손절 1.5 ATR, 익절 2R, 계좌 1% 위험). 당신은 진입 여부만 정합니다.
- 기본은 진입입니다. 셋업이 성립하면 들어가고, 명확히 나쁜 근거(뚜렷한 역방향 흐름, 바로 앞의 강한 지지/저항, 과열 추격 등)가 있을 때만 건너뛰세요.
- 주어진 자료만 근거로 하세요. 이후 가격을 안다고 가정하지 마세요.
- '최근_뉴스'에 큰 악재(⚠ 표시: 해킹·규제·소송·대량 청산 등)가 있거나, '48시간_안_큰_발표'(FOMC·CPI 등)가 몇 시간 안이면 건너뛰는 쪽으로 판단하세요. '장세'도 참고하세요.
반드시 JSON 한 줄로만 답하세요: {"decision":"enter" 또는 "skip","confidence":0~100 정수,"reason":"한국어 한 문장(60자 이내)"}`;

const SYSTEM_MID = `당신은 코인 무기한 선물 단타 트레이더입니다. 15분봉 규칙 엔진이 진입 후보를 올리면, 실제로 들어갈지(enter) 건너뛸지(skip) 결정합니다.
- 손절·익절·크기·레버리지는 규칙으로 고정입니다(손절 1.5 ATR, 익절 2R, 계좌 1% 위험). 당신은 진입 여부만 정합니다.
- 셋업이 추세 방향과 맞고, 목표까지 가는 길에 큰 장애물이 없고, 기대 이익이 왕복 수수료를 충분히 넘으면 진입하세요. 그렇지 않으면 건너뛰세요.
- 주어진 자료만 근거로 하세요. 이후 가격을 안다고 가정하지 마세요.
- '최근_뉴스'에 큰 악재(⚠ 표시: 해킹·규제·소송·대량 청산 등)가 있거나, '48시간_안_큰_발표'(FOMC·CPI 등)가 몇 시간 안이면 건너뛰는 쪽으로 판단하세요. '장세'도 참고하세요.
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
    현재가: r(x.d.c[j]), EMA20: r(x.eP[j]), EMA50: r(x.eF[j]), EMA200: r(x.eS[j]), RSI: Math.round(x.rsi[j]), ATR_퍼센트: Math.round(x.atr[j] / x.d.c[j] * 10000) / 100,
    ...(() => { const c = x.d.c[j], sd = Math.max(x.atr[j] * P.stopAtr, c * P.minStopPct / 100), sg = o.side === 'long' ? 1 : -1;
      return { 손절가: r(c - sg * sd), 목표가: r(c + sg * sd * P.tpR), 손절_퍼센트: Math.round(sd / c * 10000) / 100, 목표_퍼센트: Math.round(sd * P.tpR / c * 10000) / 100, 왕복수수료_퍼센트: Math.round((P.taker * 2 + P.slipIn + P.slipStop) * 10000) / 100 }; })(),
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
    ['손절 2.5ATR', { stopAtr: 2.5 }], ['본전이동 없음', { beR: 99 }], ['보유 12시간', { maxBars: 48 }], ['1시간 추세 강할 때만', { strong: true }], ['긴급 탈출 켬', { panic: true }]
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

  // ── 2-3) 민경기 봇(MK): 리만·나비에-스토크스 착안 지표 — 같은 15분봉·같은 수수료·같은 안전 규칙으로 따로 검증
  const MP = SC.MK_CFG, mkStudy = [];
  const mkVariants = [['민경기 봇', {}], ['층류 추세만', { mkOnly: 'flow' }], ['균형선 복귀만', { mkOnly: 'revert' }], ['난류 필터 끔', { mkTiMax: 1.01, mkNoSize: true }], ['정렬 문턱 0.5', { mkZ: 0.5 }], ['목표 3R', { tpR: 3 }], ['느리게 (3ATR·3R·24시간)', { stopAtr: 3, tpR: 3, maxBars: 96 }], ['반대로 진입', { mkFlip: true }], ['반대로 + 느리게', { mkFlip: true, stopAtr: 3, tpR: 3, maxBars: 96 }]];
  for (const [name, over] of mkVariants) {
    const PP = Object.assign({}, MP, over), row = { name };
    for (const [k, a, b] of [['all', 0, W.T.length - 1], ['h1', 0, half], ['h2', half, W.T.length - 1]]) {
      const ac = SC.newAccount(PP); SC.simulate(W, PP, ac, a, b); const s2 = SC.stats(ac);
      row[k] = { ret: Math.round((ac.equity[ac.equity.length - 1][1] / ac.start - 1) * 1000) / 10, n: s2.trades, win: s2.winRate, pf: s2.pf, avgR: s2.avgR };
      if (k === 'all' && name === '민경기 봇') { row.byKind = s2.byKind; const dc = SC.daily(ac.equity); row.curve = dc; row.mdd = (Q.metrics(dc, ac.trades) || {}).mdd ?? null; row.recent = ac.trades.slice(-10).reverse(); }
    }
    mkStudy.push(row);
    log('  민경기 ' + name.padEnd(10) + ' 전체 ' + row.all.ret + '% (' + row.all.n + '번, 승률 ' + row.all.win + '%, PF ' + row.all.pf + ') · 앞 ' + row.h1.ret + '% · 뒤 ' + row.h2.ret + '%');
  }
  // 합격 기준(실전 전 확인): 거래 30번 이상 · 앞·뒤 절반 모두 플러스 · PF 1.15 이상 · 최대낙폭 -15% 이내
  const mk0 = mkStudy[0], mkPass = { trades: mk0.all.n >= 30, halves: mk0.h1.ret > 0 && mk0.h2.ret > 0, pf: (mk0.all.pf || 0) >= 1.15, mdd: mk0.mdd == null || mk0.mdd > -15 };
  mkPass.ok = mkPass.trades && mkPass.halves && mkPass.pf && mkPass.mdd;

  // ── 3) 실시간 (Claude 결정)
  mkdirSync(dir, { recursive: true });
  const stFile = join(dir, 'scalp-state.json');
  let st = !reset && existsSync(stFile) ? JSON.parse(readFileSync(stFile, 'utf8')) : null;
  let from;
  if (!st) { st = { v: 1, inception: W.T[last], acc: SC.newAccount(P), decisions: [] }; from = last; log('단타 모의 계좌를 새로 엽니다'); }
  else from = W.T.findIndex((t) => t > st.acc.lastT);
  // 뉴스·일정 (한 번만) + 장세 분류
  let NEWS = [], EVENTS = [];
  if (!data) { try { NEWS = await headlines({ fetchImpl, now: now.getTime(), log }); } catch (e) { log('뉴스 실패: ' + e.message); } }
  try { EVENTS = upcomingEvents(root, now.getTime()); } catch (e) { /* 무시 */ }
  const NB = newsBrief(NEWS, EVENTS);
  function regimeAt(i) {
    const b = W.X.BTC, j = b.map[i]; if (j < 300) return { label: '판단 중' };
    const c = b.d.c[j], up = b.eF[j] > b.eS[j] && c > b.eS[j], dn = b.eF[j] < b.eS[j] && c < b.eS[j];
    const slope = (b.eS[j] / b.eS[j - 96] - 1) * 100; // 하루 동안 200EMA 기울기
    const atrs = []; for (let k = Math.max(0, j - 2000); k <= j; k++) if (b.atr[k] != null) atrs.push(b.atr[k] / b.d.c[k]);
    const cur = b.atr[j] / c, rank = atrs.filter((v) => v < cur).length / Math.max(1, atrs.length);
    const trend = up && slope > 0.1 ? '상승 추세' : dn && slope < -0.1 ? '하락 추세' : '횡보';
    const vol = rank >= 0.8 ? '변동성 높음' : rank <= 0.2 ? '변동성 낮음' : '변동성 보통';
    return { label: trend + ' · ' + vol, trend, vol, volPct: Math.round(rank * 100) };
  }
  const key = env.ANTHROPIC_API_KEY, model = env.SCALP_MODEL || env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
  let asked = 0;
  // Claude 계좌 하나를 마감된 봉마다 진행 (조심형·적극형 공통)
  // Claude 혼자 결정 (빈 응답이면 같은 모델 한 번 더 → 상위 모델)
  async function claudeSays(system, msg, label) {
    const models = [model, model, env.SCALP_BACKUP_MODEL || 'claude-opus-5-5'];
    let lastErr = '';
    for (let k = 0; k < models.length; k++) {
      try { const d = parseDecision(await askClaude(key, models[k], msg, fetchImpl, system, 4000)); if (models[k] !== model) d.reason += ' (' + models[k] + ')'; return d; }
      catch (e) { lastErr = String(e.message || e); log(label + ' Claude 시도 ' + (k + 1) + ' 실패: ' + lastErr.slice(0, 120)); await sleep(1500); }
    }
    return { decision: 'error', confidence: 0, reason: '응답 실패: ' + lastErr.slice(0, 100) };
  }
  async function otherSays(v, msg) {
    const k2 = env[v.key]; if (!k2) return { decision: 'error', confidence: 0, reason: '키 없음' };
    const m0 = env[v.model] || v.def, tries = [m0, m0].concat((v.backup || []).filter((m) => m !== m0));
    let lastErr = '';
    for (const m of tries) {
      try { return parseDecision(await (v.id === 'gemini' ? askGemini : askGpt)(k2, m, msg, fetchImpl, SYSTEM_MID, 4000)); }
      catch (e) { lastErr = String(e.message || e); if (/HTTP 40[13]/.test(lastErr)) break; await sleep(2000); }
    }
    return { decision: 'error', confidence: 0, reason: '응답 실패: ' + lastErr.slice(0, 80) };
  }
  // 세 AI 다수결 (2명 이상 진입이면 진입)
  async function majoritySays(msg, label) {
    const [c, g, o] = await Promise.all([claudeSays(SYSTEM_MID, msg, label), otherSays(VOTERS[1], msg), otherSays(VOTERS[2], msg)]);
    const votes = [['claude', 'Claude', c], ['gemini', 'Gemini', g], ['gpt', 'GPT', o]].map(([ai, name, d]) => ({ ai, name, decision: d.decision, confidence: d.confidence, reason: d.reason }));
    const yes = votes.filter((v) => v.decision === 'enter').length, ok = votes.filter((v) => v.decision !== 'error').length;
    return { decision: ok < 2 ? 'error' : yes >= 2 ? 'enter' : 'skip', confidence: Math.round(votes.reduce((a, v) => a + (v.confidence || 0), 0) / 3), reason: yes + '/3 진입 찬성' + (ok < 3 ? ' (' + (3 - ok) + '명 응답 실패)' : ''), votes };
  }
  async function runClaudeAcc(A, decisions, system, label, fromIdx) {
    const decide = system === 'majority' ? majoritySays : (msg, lb) => claudeSays(system, msg, lb);
    A.events = [];
    if (fromIdx < 0) return;
    for (let i = fromIdx; i <= last; i++) {
      SC.simulate(W, P, A, i, i, { collect: true, vote: true, log: true });
      for (const o of A.pending.filter((x) => x.kind === 'open' && x.needVote && x.approved == null)) {
        const age = now.getTime() - (W.T[i] + BAR), rec = { t: isoT(W.T[i]), sym: o.sym, name: o.name, side: o.side, kind: o.setup, why: o.why, price: o.ref };
        const recent = decisions.slice().reverse().find((d) => d.sym === o.sym && d.side === o.side && d.decision === 'skip'); // 건너뜀만 1시간 쉼 (실패는 바로 다시)
        if (recent && W.T[i] - Date.parse(recent.t.replace(' ', 'T') + ':00Z') < 60 * 60e3) { o.approved = false; continue; }
        if (age > 2 * 3600e3) { o.approved = false; decisions.push({ ...rec, decision: 'late', reason: '실행이 늦어 2시간 지난 신호 — 건너뜀' }); continue; }
        if (!key) { o.approved = false; decisions.push({ ...rec, decision: 'nokey', reason: 'Claude 키 없음' }); continue; }
        const msg = '후보 자료(JSON):\n' + JSON.stringify({ ...brief(W, P, i, o, A), 장세: regimeAt(i).label, ...NB });
        const d = await decide(msg, label);
        asked++;
        o.approved = d.decision === 'enter'; o.ai = { decision: d.decision, confidence: d.confidence, reason: d.reason, votes: d.votes };
        decisions.push({ ...rec, ...d, model });
        log(label + ': ' + o.name + ' ' + (o.side === 'long' ? '롱' : '숏') + ' (' + o.why + ') → ' + d.decision + ' ' + d.confidence + ' · ' + d.reason);
      }
    }
  }
  const A = st.acc;
  await runClaudeAcc(A, st.decisions, SYSTEM, '조심형', from);
  // 적극형 Claude 계좌 (처음이면 지금부터)
  if (!st.bold) { st.bold = { inception: W.T[last], acc: SC.newAccount(P), decisions: [] }; log('적극형 Claude 계좌를 새로 엽니다'); }
  const B2 = st.bold, bfrom = B2.acc.lastT == null ? last : W.T.findIndex((t) => t > B2.acc.lastT);
  await runClaudeAcc(B2.acc, B2.decisions, SYSTEM_BOLD, '적극형', bfrom);
  B2.decisions = B2.decisions.slice(-120);
  // 다수결 계좌 (Claude·Gemini·GPT 중 2명 이상 진입 찬성)
  if (!st.major) { st.major = { inception: W.T[last], acc: SC.newAccount(P), decisions: [] }; log('다수결 계좌를 새로 엽니다'); }
  const M3 = st.major, mfrom = M3.acc.lastT == null ? last : W.T.findIndex((t) => t > M3.acc.lastT);
  await runClaudeAcc(M3.acc, M3.decisions, 'majority', '다수결', mfrom);
  M3.decisions = M3.decisions.slice(-120);
  // 비교용: 같은 엔진 후보를 전부 들어가는 계좌 (Claude 없이)
  if (!st.shadow) { st.shadow = SC.newAccount(P); st.shadowFrom = st.shadowFrom || W.T[last]; }
  const sf = st.shadow.lastT == null ? last : W.T.findIndex((t) => t > st.shadow.lastT);
  if (sf >= 0) SC.simulate(W, P, st.shadow, sf, last, { collect: false });
  // 민경기 봇 실시간 모의 계좌 (엔진 규칙대로, AI 없이)
  if (!st.mk) { st.mk = { inception: W.T[last], acc: SC.newAccount(MP) }; log('민경기 봇 모의 계좌를 새로 엽니다'); }
  const mkf = st.mk.acc.lastT == null ? last : W.T.findIndex((t) => t > st.mk.acc.lastT);
  if (mkf >= 0) SC.simulate(W, MP, st.mk.acc, mkf, last, { collect: true });
  st.decisions = st.decisions.slice(-120);
  const fresh = A.events.slice().map((e) => ({ ...e, who: '조심형' })).concat(B2.acc.events.map((e) => ({ ...e, who: '적극형' }))).concat(M3.acc.events.map((e) => ({ ...e, who: '다수결' }))).concat(st.mk.acc.events.map((e) => ({ ...e, who: '민경기' }))); A.events = []; B2.acc.events = []; M3.acc.events = []; st.mk.acc.events = []; st.updatedAt = now.toISOString();
  writeFileSync(stFile, JSON.stringify(st));

  // ── 4) 앱용 결과
  const pendOf = (acc) => acc.pending.filter((o) => o.kind === 'open' && (!o.needVote || o.approved)).map((o) => ({ sym: o.sym, name: o.name, side: o.side, kind: o.setup, why: o.why, decidedBar: o.t, fillAt: isoT(W.T[last] + BAR), ai: o.ai ? { confidence: o.ai.confidence, reason: o.ai.reason } : null }));
  function summarize(X) {
    const BA = X.acc, e2 = BA.equity.length ? BA.equity[BA.equity.length - 1][1] : BA.cash, dd = X.decisions.filter((d) => d.decision === 'enter' || d.decision === 'skip');
    const pos = Object.values(BA.pos).map((p) => { const m = series[p.sym].c[series[p.sym].c.length - 1], u = (p.side === 'long' ? 1 : -1) * (m - p.entry) * p.qty;
      return { sym: p.sym, name: p.name, side: p.side, kind: p.kind, entry: p.entry, mark: m, lev: Math.round(m * p.qty / e2 * 100) / 100, upnl: Math.round(u), stop: p.stop, tp: p.tp, liq: p.liq, be: p.be,
        toStop: Math.round(Math.abs(m / p.stop - 1) * 1000) / 10, toLiq: Math.round(Math.abs(m / p.liq - 1) * 1000) / 10, ai: p.ai, barsLeft: Math.max(0, P.maxBars - 1 - Math.round((W.T[last] - p.t) / BAR)) }; });
    return { inception: isoT(X.inception), equity: e2, start: BA.start, ret: Math.round((e2 / BA.start - 1) * 10000) / 100, stats: SC.stats(BA), positions: pos, pending: pendOf(BA), trades: BA.trades.slice(-300).reverse(), curve: thin(BA.equity),
      decisions: X.decisions.slice(-20).reverse(), aiStats: { asked: dd.length, enter: dd.filter((d) => d.decision === 'enter').length } };
  }
  // AI별 성적표: 다수결 계좌의 끝난 거래에서 각 AI가 찬성했을 때/반대했을 때 결과
  function aiScore(X) {
    const tr = X.acc.trades.filter((t) => t.ai && t.ai.votes);
    return ['claude', 'gemini', 'gpt'].map((id) => {
      const y = tr.filter((t) => (t.ai.votes.find((v) => v.ai === id) || {}).decision === 'enter'), n = tr.filter((t) => (t.ai.votes.find((v) => v.ai === id) || {}).decision === 'skip');
      const dec = X.decisions.filter((d) => d.votes).map((d) => d.votes.find((v) => v.ai === id)).filter(Boolean);
      const r = (a) => (a.length ? Math.round(a.reduce((s2, t) => s2 + t.R, 0) / a.length * 100) / 100 : null);
      return { ai: id, name: { claude: 'Claude', gemini: 'Gemini', gpt: 'GPT' }[id], asked: dec.length, yes: dec.filter((v) => v.decision === 'enter').length, errors: dec.filter((v) => v.decision === 'error').length,
        yesTrades: y.length, yesWin: y.length ? Math.round(y.filter((t) => t.pnl > 0).length / y.length * 100) : null, yesR: r(y), noTrades: n.length, noR: r(n) };
    });
  }
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
    live: { equity: eq, start: A.start, ret: Math.round((eq / A.start - 1) * 10000) / 100, days: ldc.length, stats: ls, curve: thin(A.equity),
      positions, pending: pendOf(A), lev: Math.round(positions.reduce((a, p) => a + p.notional, 0) / (eq || 1) * 100) / 100, trades: A.trades.slice(-300).reverse(),
      status: A.killUntilT > W.T[last] ? 'killed' : A.dayBlock ? 'dayblock' : A.pauseUntilT > W.T[last] ? 'pause' : 'ok', peak: Math.round(A.peak) },
    shadow: (() => { const S2 = st.shadow, e2 = S2.equity.length ? S2.equity[S2.equity.length - 1][1] : S2.cash; return { equity: e2, ret: Math.round((e2 / S2.start - 1) * 10000) / 100, stats: SC.stats(S2), curve: thin(S2.equity), start: S2.start, trades: S2.trades.slice(-300).reverse(), open: Object.keys(S2.pos).length }; })(),
    major: summarize(M3),
    mk: (() => { const X = summarize({ inception: st.mk.inception, acc: st.mk.acc, decisions: [] }); delete X.decisions; delete X.aiStats;
      X.curve = st.mk.acc.equity.slice(-400).filter((e, k, a) => k % 4 === 0 || k === a.length - 1).map(([t, v]) => [isoT(t), v]);
      X.status = st.mk.acc.killUntilT > W.T[last] ? 'killed' : st.mk.acc.dayBlock ? 'dayblock' : 'ok';
      X.read = SC.COINS.filter((c) => W.X[c.sym]).map((c) => { const x = W.X[c.sym], j = x.map[last]; const r = j >= 0 ? SC.mkRead(x, j) : null; return r ? { sym: c.sym, name: c.name, ...r } : null; }).filter(Boolean);
      X.study = mkStudy; X.pass = mkPass; return X; })(),
    aiCard: aiScore(M3),
    bold: summarize(B2),
    decisions: st.decisions.slice(-30).reverse(), aiStats: { asked: dec.length, enter: dec.filter((d) => d.decision === 'enter').length },
    log: A.log.slice(-12).reverse(),
    regime: regimeAt(last), news: NEWS.slice(0, 8), events: EVENTS,
    study, bt: { days, from: bdc.length ? bdc[0][0] : null, ret: Math.round((bt.equity[bt.equity.length - 1][1] / bt.start - 1) * 1000) / 10, metrics: bm, stats: bs, curve: bdc, recent: bt.trades.slice(-15).reverse() },
    coins: SC.COINS.filter((c) => series[c.sym]).map((c) => ({ sym: c.sym, name: c.name, price: mark(c.sym) })), errors
  };
  writeFileSync(join(dir, 'scalp-live.json'), JSON.stringify(out));
  log('단타 모의: 조심형 ' + out.live.ret + '% · 적극형 ' + out.bold.ret + '% (' + out.bold.stats.trades + '번) · 다수결 ' + out.major.ret + '% (' + out.major.stats.trades + '번) · 엔진 혼자 ' + out.shadow.ret + '% (' + out.shadow.stats.trades + '번) · 민경기 ' + out.mk.ret + '% (' + out.mk.stats.trades + '번) · 포지션 ' + positions.length + ' · 거래 ' + ls.trades + ' · Claude 판단 ' + asked + '건 · 새 이벤트 ' + fresh.length + ' · ' + ((Date.now() - t0) / 1000).toFixed(1) + '초');

  // ── 5) 푸시
  const moves = fresh.filter((e) => e.kind === 'open' || e.kind === 'close' || e.kind === 'vault');
  if (sendPush && moves.length) {
    const side = (s) => (s === 'long' ? '롱' : '숏');
    const lines = moves.slice(-5).map((e) => (e.who ? e.who + ' ' : '') + (e.kind === 'open' ? `${side(e.side)} 진입 ${e.name} ${e.lev}배 · 손절 ${e.stop} · 목표 ${e.tp}` : e.kind === 'close' ? `${side(e.side)} 청산 ${e.name} ${e.pnl >= 0 ? '+' : ''}${Math.round(e.pnl / 1e4).toLocaleString('ko-KR')}만 (${e.reason})` : '금고: ' + e.msg));
    await push(env, { title: '단타 봇 ' + moves.length + '건', body: lines.join('\n'), url: './index.html#scalp', tag: 'snw-scalp' }, log);
  }
  return out;
}
async function ping() {
  const env = loadEnv(), key = env.ANTHROPIC_API_KEY, model = env.SCALP_MODEL || env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
  const sample = { 시각_UTC: '2026-11-24T05:00', 코인: '비트코인(BTC)', 방향: '롱', 셋업: '상승추세 눌림목 반등 (20EMA 지지, RSI 54)', 현재가: 98000, EMA20: 97800, EMA50: 97000, EMA200: 95000, RSI: 54, ATR_퍼센트: 0.45,
    최근16봉: [[97500, 97900, 97400, 97800], [97800, 98100, 97700, 98000]], BTC: { 추세: '15분 정배열' }, 계좌: { 원금대비_퍼센트: 0, 최근거래: [] } };
  const t = await askClaude(key, model, '후보 자료(JSON):\n' + JSON.stringify(sample), fetch, SYSTEM, 4000);
  console.log('원문: ' + JSON.stringify(t).slice(0, 400));
  try { console.log('✓ 해석: ' + JSON.stringify(parseDecision(t))); } catch (e) { console.log('✗ ' + e.message); process.exitCode = 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes('--ping')) ping();
else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run({ reset: process.argv.includes('--reset') }).catch((e) => { console.error('✗ ' + e.message); process.exitCode = 1; }).then(async () => {
    // 예전 루프(민경기 봇을 따로 부르지 않는 버전)가 돌고 있을 때를 위해: 매시간 첫 15분이거나 결과가 없으면 여기서 민경기 봇도 실행
    if (process.env.MK_SEPARATE) return;
    const dir = process.env.SCALP_DIR || join(ROOT, 'data');
    if (new Date().getUTCMinutes() < 15 || !existsSync(join(dir, 'mk-live.json'))) {
      try { const { run: mk } = await import('./mk.mjs'); await mk({ dir }); } catch (e) { console.error('✗ 민경기 봇: ' + e.message); }
    }
  });
}
