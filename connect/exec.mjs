/* 바이낸스 선물 '데모 트레이딩'(가짜 돈) 계좌에 자동매매 봇들의 포지션을 실제 주문으로 따라 넣기 — 서울 서버에서 매시간
 *  · 봇 5개(민경기·류신영·단타 조심형·AI 다수결·적극형)가 잔고를 똑같이 나눠 씀(각 봇의 레버리지 × 잔고의 1/5)
 *  · 봇별 다리(leg): 같은 코인·같은 방향이면 몫을 합쳐 한 포지션, 손절·목표가는 봇마다 자기 수량만큼(reduceOnly) 따로 → 봇 하나가 정리하면 그 몫만 줄임. 반대 방향이면 나중 봇은 건너뜀
 *  · 안전장치: 429·5xx·끊김은 기다렸다 재시도, 주문은 고유 번호로 중복 방지, 손절을 못 걸면 바로 정리, 손절 이동은 새 주문 먼저,
 *    호가 차이 15bp 넘으면 진입 보류(최대 4번), 동시 실행 잠금. 서버가 죽어도 손절은 거래소에 걸려 있음 + GitHub 감시자(watch.mjs)가 90분 무응답이면 알림
 *  · 단타 봇의 목표가는 거래소에 TAKE_PROFIT_MARKET 으로 걸어 둠. 매시 5분(sync) + 봇 결과가 바뀔 때마다 40초 안에(--loop) 맞춤
 *
 *  · 진짜 돈이 아닌 데모 계좌 전용: 주소가 demo-fapi(데모)가 아니면 아예 실행하지 않음
 *  · 민경기 봇(3세대) 모의 계좌의 포지션을 목표로 삼아 데모 계좌를 맞춤
 *      - 봇에 있고 데모에 없으면: 시장가로 진입 + 거래소에 손절 조건 주문(STOP_MARKET, 전량 청산)을 걸어 둠
 *      - 봇의 손절선이 바뀌면(본전·추적 손절): 거래소 손절 주문을 새 가격으로 바꿈
 *      - 봇에서 정리됐으면: 데모에서도 시장가로 정리 + 남은 조건 주문 취소
 *  · 크기: 봇의 레버리지(포지션 금액 ÷ 계좌)를 그대로 데모 잔고에 적용, 격리 마진
 *  · 결과: connect/.cache/exec-state.json (서버) + GitHub deriv-data 브랜치 exec-live.json (앱이 읽음, 데모 계좌라 개인 정보 없음)
 *  키: connect/.env 의 BINANCE_DEMO_KEY · BINANCE_DEMO_SECRET (데모 트레이딩에서 만든 키. 실제 계좌 키는 넣지 마세요)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createHmac } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const SFILE = join(HERE, '.cache', 'exec-state.json');
const r6 = (x) => Math.round(x * 1e6) / 1e6;

export function client(env, fetchImpl = fetch) {
  const base = env.BINANCE_DEMO_BASE || 'https://demo-fapi.binance.com';
  if (!/demo-fapi\.binance\.com|testnet\.binancefuture\.com/.test(base)) throw new Error('데모(가짜 돈) 주소가 아니라서 멈춤: ' + base);
  const key = env.BINANCE_DEMO_KEY, sec = env.BINANCE_DEMO_SECRET;
  // 거래소 호출 제한·일시 오류 대비: 429(너무 잦음)·5xx·네트워크 끊김·시간 어긋남(-1021)은 기다렸다 다시 (최대 4번)
  //  · 418(IP 차단)은 즉시 멈춤 · 사용량(분당 가중치)이 한도 75%를 넘으면 다음 분까지 쉼
  //  · 주문(POST /order)은 같은 주문 번호(newClientOrderId)로만 재시도 → 같은 주문이 두 번 들어가지 않음 (market() 에서 확인)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); let used = 0;
  const call = async (method, path, params = {}, signed = true, { retries = 4 } = {}) => {
    for (let k = 0; ; k++) {
      if (used > 1800) { await sleep(61e3 - (Date.now() % 60e3)); used = 0; }
      const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null).map(([kk, v]) => [kk, String(v)]));
      if (signed) { q.set('recvWindow', '10000'); q.set('timestamp', String(Date.now())); q.set('signature', createHmac('sha256', sec).update(q.toString()).digest('hex')); }
      const url = base + path + (q.toString() ? '?' + q : '');
      let res, text, j;
      try { res = await fetchImpl(url, { method, headers: { 'X-MBX-APIKEY': key || '', 'User-Agent': 'sijangnalssi-exec' }, signal: AbortSignal.timeout ? AbortSignal.timeout(15e3) : undefined }); text = await res.text(); }
      catch (e) { const isOrder = method === 'POST' && path === '/fapi/v1/order'; if (k < retries && !isOrder) { await sleep(1000 * 2 ** k); continue; } const err = new Error('거래소 연결 실패: ' + e.message); err.network = true; throw err; }
      try { j = JSON.parse(text); } catch (e) { j = text; }
      const w = res.headers && res.headers.get ? Number(res.headers.get('x-mbx-used-weight-1m')) : 0; if (w) used = w;
      if (res.ok) return j;
      const code = j && j.code, err = new Error((j && j.msg) || String(text).slice(0, 160)); err.code = code; err.status = res.status;
      if (res.status === 418) { err.message = '거래소가 이 서버 IP를 잠시 차단함(418) — 이번엔 멈춤'; err.fatal = true; throw err; }
      const again = res.status === 429 || res.status >= 500 || code === -1021 || code === -1003 || code === -1001;
      if (again && k < retries) { const ra = res.headers && res.headers.get ? Number(res.headers.get('retry-after')) : 0; err.unknown = res.status >= 500; if (err.unknown && path === '/fapi/v1/order' && method === 'POST') throw err; await sleep(ra ? ra * 1000 : 1000 * 2 ** k); continue; }
      if (res.status >= 500) err.unknown = true;
      throw err;
    }
  };
  return { call, base };
}
// 수량·가격을 거래소 규칙(최소 단위)에 맞춤
function rules(info) {
  const R = {};
  (info.symbols || []).forEach((s) => { const f = (t) => (s.filters || []).find((x) => x.filterType === t) || {};
    R[s.symbol] = { step: Number(f('MARKET_LOT_SIZE').stepSize || f('LOT_SIZE').stepSize || 0.001), minQty: Number(f('MARKET_LOT_SIZE').minQty || f('LOT_SIZE').minQty || 0), tick: Number(f('PRICE_FILTER').tickSize || 0.01), minNotional: Number(f('MIN_NOTIONAL').notional || 5) }; });
  return R;
}
const dec = (x) => { const s = String(x); return s.includes('e-') ? Number(s.split('e-')[1]) : (s.split('.')[1] || '').replace(/0+$/, '').length; };
const floorTo = (v, st) => Number((Math.floor(v / st + 1e-9) * st).toFixed(dec(st)));
const roundTo = (v, st) => Number((Math.round(v / st) * st).toFixed(dec(st)));

// [id, 이름, bot-data 파일, 포지션 꺼내기, 결과가 이 시간보다 오래되면 '못 읽음'으로 보고 건드리지 않음]
export const BOTS = [
  ['mk3', '민경기 봇', 'mk3-live.json', (D) => D.live, 6], ['rs', '류신영 봇', 'rs-live.json', (D) => D.live, 6],
  ['sc1', '단타 조심형', 'scalp-live.json', (D) => D.live, 1], ['sc3', '단타 AI 다수결', 'scalp-live.json', (D) => D.major, 1], ['sc2', '단타 적극형', 'scalp-live.json', (D) => D.bold, 1]];
// 동시에 두 번 돌지 않게 잠금 (매시 5분 sync 와 20·35·50분 확인이 겹칠 때). 10분 넘은 잠금은 죽은 것으로 보고 무시
const LOCK = join(HERE, '.cache', 'exec.lock');
export async function run(opts = {}) {
  if (!opts.targets && !opts.target) { try { if (Date.now() - statSync(LOCK).mtimeMs < 10 * 60e3) { (opts.log || console.log)('바이낸스 데모: 다른 실행이 진행 중 — 이번엔 건너뜀'); return null; } } catch (e) { /* 잠금 없음 */ }
    mkdirSync(dirname(LOCK), { recursive: true }); writeFileSync(LOCK, String(process.pid)); }
  try { return await runOnce(opts); } finally { if (!opts.targets && !opts.target) { try { unlinkSync(LOCK); } catch (e) { /* 없음 */ } } }
}
async function runOnce({ env = {}, fetchImpl = fetch, log = console.log, now = Date.now(), target = null, targets = null } = {}) {
  if (!env.BINANCE_DEMO_KEY || !env.BINANCE_DEMO_SECRET) { log('· 바이낸스 데모: BINANCE_DEMO_KEY·SECRET 이 없어 건너뜀'); return null; }
  const B = client(env, fetchImpl), repo = env.GITHUB_REPO || 'rudrl09202-bit/sijangnalssi';
  let st = { v: 1, map: {}, fills: [], actions: [] }; try { st = JSON.parse(readFileSync(SFILE, 'utf8')); } catch (e) { /* 처음 */ }
  const opened = new Set(), acts = [], note = (m) => { acts.push({ t: new Date(now).toISOString(), m }); log('  ' + m); };
  st.map = st.map || {};

  // 1) 목표: 민경기 봇 3세대 + 류신영 봇 2세대 포지션 (같은 코인은 주인 한 봇만)
  const TG = targets || (target ? { mk3: target } : {}), share = 1 / BOTS.length;
  const files = {};
  for (const [id, nm, file, pick, maxH] of BOTS) {
    if (TG[id] !== undefined) continue;
    if (!(file in files)) { try { const r = await fetchImpl('https://raw.githubusercontent.com/' + repo + '/bot-data/' + file + '?t=' + Math.floor(now / 6e4)); files[file] = r.ok ? await r.json() : null; if (!r.ok) note(file + ' 를 못 읽음 (HTTP ' + r.status + ') — 이번엔 그대로 둠'); } catch (e) { files[file] = null; note(file + ' 읽기 실패: ' + e.message); } }
    const D = files[file], L = D ? pick(D) : null, age = D && D.generatedAt ? now - Date.parse(D.generatedAt) : 0;
    if (L && age > maxH * 3600e3) { if (!st.map['stale|' + id]) note(nm + ' 결과가 ' + Math.round(age / 36e5) + '시간째 그대로 — 갱신될 때까지 그 봇 포지션은 건드리지 않음'); st.map['stale|' + id] = { at: now }; TG[id] = null; }
    else { delete st.map['stale|' + id]; TG[id] = L ? { live: L } : null; }
  }
  const M = TG.mk3 || { live: { ret: 0, n: 0, positions: [] } };
  const botName = Object.fromEntries(BOTS.map(([id, nm]) => [id, nm]));
  // 봇별 '다리(leg)': 같은 코인·같은 방향이면 여러 봇 몫을 한 포지션에 합침. 손절·목표가는 봇마다 자기 수량만큼 따로(reduceOnly)
  const want = {}; // key = bot|SYM
  BOTS.forEach(([id]) => { const D = TG[id]; if (!D || !D.live) return; (D.live.positions || []).forEach((p) => { const sym = p.sym + 'USDT'; want[id + '|' + sym] = { key: id + '|' + sym, bot: id, sym, side: p.side, lev: p.lev * share, stop: p.stop, tp: p.tp || null, entry: p.entry, since: id + '|' + p.since }; }); });
  const unknown = new Set(BOTS.filter(([id]) => !TG[id] || !TG[id].live).map(([id]) => id));
  const isMeta = (k) => /^(skip|stale|hold|condqty)\|/.test(k);
  Object.keys(st.map).forEach((k) => { if ((k.startsWith('skip|') && now - st.map[k].at > 30 * 864e5) || (k.startsWith('hold|') && now - (st.map[k].at || 0) > 864e5)) delete st.map[k]; });
  st.legs = st.legs || {};
  // 예전 방식(코인당 한 봇) 기록 → 다리로 옮김. 기존 '전량 손절' 주문은 아래에서 수량 손절로 바뀜
  Object.keys(st.map).filter((k) => !isMeta(k)).forEach((sym) => { const m = st.map[sym]; if (m && m.bot && !st.legs[m.bot + '|' + sym]) st.legs[m.bot + '|' + sym] = { bot: m.bot, sym, side: m.side, since: m.since, qty: m.qty || null, stop: null, stopId: m.algoId || null, tpId: m.tpId || null, late: m.late, stopped: m.stopped, legacy: true }; delete st.map[sym]; });
  // 2) 데모 계좌 현황
  const info = rules(await B.call('GET', '/fapi/v1/exchangeInfo', {}, false));
  const acct = await B.call('GET', '/fapi/v3/account');
  const eq = Number(acct.totalMarginBalance || acct.totalWalletBalance || 0);
  const posArr = await B.call('GET', '/fapi/v3/positionRisk');
  const cur = {}; (posArr || []).forEach((p) => { const a = Number(p.positionAmt); if (a) cur[p.symbol] = { amt: a, entry: Number(p.entryPrice), mark: Number(p.markPrice), upnl: Number(p.unRealizedProfit), lev: Number(p.leverage) }; });
  let algos = []; try { algos = await B.call('GET', '/fapi/v1/openAlgoOrders'); algos = Array.isArray(algos) ? algos : (algos.orders || []); } catch (e) { note('조건 주문 조회 실패: ' + e.message); }
  try { await B.call('POST', '/fapi/v1/positionSide/dual', { dualSidePosition: 'false' }); } catch (e) { /* 이미 한 방향 모드 */ }

  const cancelAlgo = async (sym, id) => { if (!id) return; try { await B.call('DELETE', '/fapi/v1/algoOrder', { symbol: sym, algoId: id }); } catch (e) { /* 이미 없음·체결됨 */ } };
  // 봇 한 개 몫(qty)만 닫는 조건 주문. type: STOP_MARKET(손절) / TAKE_PROFIT_MARKET(목표가)
  // 거래소가 '수량 지정 + reduceOnly' 조건 주문을 거절하면(형식 오류): 그 코인에 다리가 하나뿐일 때만 '전량' 조건 주문으로 대신 걸음
  const placeCond = async (sym, side, type, price, qty, self) => { const R = info[sym], px = roundTo(price, R.tick), base = { algoType: 'CONDITIONAL', symbol: sym, side: side === 'long' ? 'SELL' : 'BUY', type, triggerPrice: px, workingType: 'MARK_PRICE', priceProtect: 'true' };
    try { const o = await B.call('POST', '/fapi/v1/algoOrder', { ...base, quantity: qty, reduceOnly: 'true' }); return { px, id: o.algoId }; }
    catch (e) { if (e.network || e.unknown || e.code === -2021) throw e;
      const others = Object.values(st.legs).filter((L) => L !== self && L.sym === sym && L.qty > 0 && !L.stopped).length;
      if (others > 0) throw e; // 다른 봇 몫이 이미 있으면 전량 주문은 위험 → 이 몫은 들어가지 않음(호출한 쪽에서 정리)
      if (!st.map['condqty|warn']) { st.map['condqty|warn'] = { at: now }; note('수량 지정 조건 주문이 거절됨(' + e.message + ') — 다리가 하나인 코인은 전량 조건 주문으로 대신'); }
      const o = await B.call('POST', '/fapi/v1/algoOrder', { ...base, closePosition: 'true' }); return { px, id: o.algoId }; } };
  // 시장가 주문: 주문 번호를 미리 정해 두고, 결과를 모를 때(연결 끊김·5xx)는 그 번호로 조회해서 들어갔는지 확인 → 없을 때만 다시
  const market = async (sym, side, qty, reduce) => {
    const cid = 'snw' + now.toString(36) + Math.random().toString(36).slice(2, 8); let o = null;
    for (let k = 0; k < 3 && !o; k++) {
      try { o = await B.call('POST', '/fapi/v1/order', { symbol: sym, side, type: 'MARKET', quantity: qty, reduceOnly: reduce ? 'true' : null, newOrderRespType: 'RESULT', newClientOrderId: cid }, true, { retries: 2 }); }
      catch (e) { if (!(e.network || e.unknown)) throw e; await new Promise((r) => setTimeout(r, 1500 * (k + 1)));
        try { o = await B.call('GET', '/fapi/v1/order', { symbol: sym, origClientOrderId: cid }); note(sym + ' 주문 응답이 끊겼지만 거래소에 들어간 것 확인 (중복 주문 없음)'); } catch (e2) { if (k === 2) throw e; } }
    }
    if (!Number(o.avgPrice) && o.orderId) { try { const q = await B.call('GET', '/fapi/v1/order', { symbol: sym, orderId: o.orderId }); if (Number(q.avgPrice)) o.avgPrice = q.avgPrice; } catch (e) { /* 체결가 조회 실패 — 표시만 빠짐 */ } }
    return o; };
  // 호가 확인: 매수·매도 호가 차이(스프레드)가 너무 벌어졌거나 맨 앞 호가가 너무 얇으면 이번엔 진입 보류 (다음 15분에 다시)
  const MAX_SPREAD_BP = Number(env.EXEC_MAX_SPREAD_BP || 15);
  const book = async (sym) => { const b = await B.call('GET', '/fapi/v1/ticker/bookTicker', { symbol: sym }, false); const bid = Number(b.bidPrice), ask = Number(b.askPrice), mid = (bid + ask) / 2;
    return { bid, ask, mid, bp: mid ? (ask - bid) / mid * 1e4 : null, bidUsd: bid * Number(b.bidQty), askUsd: ask * Number(b.askQty) }; };

  const LATE_BP = Number(env.EXEC_LATE_BP || 30), openIds = new Set(algos.map((x) => String(x.algoId)));
  const legSum = (sym) => Object.values(st.legs).filter((L) => L.sym === sym && L.qty > 0 && !L.stopped).reduce((a, L) => a + (L.side === 'long' ? 1 : -1) * L.qty, 0);
  const closeLeg = async (L, why) => { // 그 봇 몫만 시장가로 닫고 그 봇의 조건 주문 취소
    const C = cur[L.sym], R = info[L.sym]; await cancelAlgo(L.sym, L.stopId); await cancelAlgo(L.sym, L.tpId);
    const have = C && (C.amt > 0 ? 'long' : 'short') === L.side ? Math.abs(C.amt) : 0, q = floorTo(Math.min(L.qty || have, have), R.step);
    if (q > 0) { try { const o = await market(L.sym, L.side === 'long' ? 'SELL' : 'BUY', q, true), px = Number(o.avgPrice) || (C && C.mark);
        st.fills.push({ t: new Date(now).toISOString(), sym: L.sym, bot: L.bot, kind: 'close', side: L.side, qty: q, price: px, pnl: C ? r6((L.side === 'long' ? 1 : -1) * (px - (L.entry || C.entry)) * q) : null });
        cur[L.sym] = C ? Object.assign(C, { amt: C.amt - (L.side === 'long' ? q : -q) }) : C; if (cur[L.sym] && Math.abs(cur[L.sym].amt) < R.step / 2) delete cur[L.sym];
        note(botName[L.bot] + ' · ' + L.sym + ' ' + (L.side === 'long' ? '롱' : '숏') + ' ' + q + ' 정리 @' + px + ' (' + why + ')'); } catch (e) { note(L.sym + ' ' + botName[L.bot] + ' 몫 정리 실패: ' + e.message); return false; } }
    return true; };
  // ① 거래소에서 먼저 체결된 다리 찾기: 그 봇의 손절·목표가 주문이 사라졌으면 체결된 것 → 남은 짝 주문 취소, 같은 포지션엔 다시 안 들어감
  for (const L of Object.values(st.legs)) { if (L.stopped || L.late || !L.qty || L.legacy) continue;
    const sGone = L.stopId && !openIds.has(String(L.stopId)), tGone = L.tpId && !openIds.has(String(L.tpId));
    if (sGone || tGone) { L.stopped = true; await cancelAlgo(L.sym, sGone ? L.tpId : L.stopId); note(botName[L.bot] + ' · ' + L.sym + ' 데모에서 ' + (sGone ? '손절' : '목표가') + ' 주문이 먼저 체결됨 — 이 포지션엔 다시 들어가지 않음'); L.qty = 0; } }
  // ② 봇에서 끝난 다리 정리 (그 봇 결과를 못 읽었으면 건드리지 않음)
  for (const [k, L] of Object.entries(st.legs)) { const W = want[k];
    if (unknown.has(L.bot)) continue;
    if (!W || W.since !== L.since) { if (L.qty > 0 && !L.stopped && !L.late) { if (!(await closeLeg(L, '봇에서 정리됨'))) continue; } delete st.legs[k]; } }
  // ③ 새 다리 진입 / 기존 다리 손절·목표가 맞추기
  for (const W of Object.values(want)) {
    const R = info[W.sym]; if (!R) { if (!st.map['skip|' + W.since]) { st.map['skip|' + W.since] = { at: now }; note(W.sym + ': 바이낸스 선물에 없는 종목 — 건너뜀'); } continue; }
    let L = st.legs[W.key];
    if (L && (L.stopped || L.late)) continue;
    const net = legSum(W.sym), C = cur[W.sym];
    if (!L) {
      // 반대 방향 다리가 이미 있으면 (한 방향 모드라 상쇄됨) 건너뜀
      if ((W.side === 'long' && net < 0) || (W.side === 'short' && net > 0)) { const k = 'skip|' + W.since; if (!st.map[k]) { st.map[k] = { at: now }; note(W.sym.replace('USDT', '') + ': ' + botName[W.bot] + ' 신호가 다른 봇과 반대 방향이라 데모에선 건너뜀'); } continue; }
      try {
        try { await B.call('POST', '/fapi/v1/marginType', { symbol: W.sym, marginType: 'ISOLATED' }); } catch (e) { /* 이미 격리 */ }
        await B.call('POST', '/fapi/v1/leverage', { symbol: W.sym, leverage: 5 });
        const mk = Number((await B.call('GET', '/fapi/v1/premiumIndex', { symbol: W.sym }, false)).markPrice), g = W.side === 'long' ? 1 : -1, ahead = W.entry ? g * (mk / W.entry - 1) * 1e4 : 0;
        const late = g * (mk - W.stop) <= 0 ? '이미 봇 손절선을 지남' : W.tp && g * (W.tp - mk) <= 0 ? '이미 봇 목표가를 지남' : ahead > LATE_BP ? '봇 진입가보다 ' + ahead.toFixed(0) + 'bp 유리하게 움직임(기준 ' + LATE_BP + 'bp)' : null;
        if (late) { st.legs[W.key] = { bot: W.bot, sym: W.sym, side: W.side, since: W.since, qty: 0, late: true }; note(botName[W.bot] + ' · ' + W.sym + ' 늦어서 따라가지 않음: ' + late); continue; }
        const qty = floorTo(W.lev * eq / mk, R.step);
        if (st.map['condqty|warn'] && Object.values(st.legs).some((x) => x.sym === W.sym && x.qty > 0 && !x.stopped)) { const k = 'skip|' + W.since; if (!st.map[k]) { st.map[k] = { at: now }; note(W.sym + ' ' + botName[W.bot] + ': 이 거래소는 봇별 손절을 못 걸어 같은 코인에 두 번째 봇은 건너뜀'); } continue; }
        if (qty < R.minQty || qty * mk < R.minNotional) { const k = 'skip|' + W.since; if (!st.map[k]) { st.map[k] = { at: now }; note(W.sym + ' ' + botName[W.bot] + ' 진입 건너뜀: 데모 잔고 대비 너무 작음 (' + r6(qty * mk) + ' USDT)'); } continue; }
        let bk = null; try { bk = await book(W.sym); } catch (e) { /* 호가 조회 실패 — 그냥 진행 */ }
        const hold = st.map['hold|' + W.since] || { n: 0 };
        if (bk && bk.bp != null && bk.bp > MAX_SPREAD_BP && hold.n < 4) { hold.n++; hold.at = now; st.map['hold|' + W.since] = hold; note(W.sym + ' 진입 보류: 호가 차이 ' + bk.bp.toFixed(1) + 'bp (기준 ' + MAX_SPREAD_BP + 'bp) — 다음 확인 때 다시 (' + hold.n + '/4)'); continue; }
        delete st.map['hold|' + W.since];
        const thin = bk && (W.side === 'long' ? bk.askUsd : bk.bidUsd) < qty * mk * 0.5;
        const o = await market(W.sym, W.side === 'long' ? 'BUY' : 'SELL', qty, false), px = Number(o.avgPrice) || mk, slip = W.entry ? g * (px / W.entry - 1) * 1e4 : null;
        st.fills.push({ t: new Date(now).toISOString(), sym: W.sym, bot: W.bot, kind: 'open', side: W.side, qty, price: px, botEntry: W.entry, slipBps: slip == null ? null : Math.round(slip * 10) / 10, spreadBp: bk && bk.bp != null ? Math.round(bk.bp * 10) / 10 : null, thin: thin || undefined });
        L = st.legs[W.key] = { bot: W.bot, sym: W.sym, side: W.side, since: W.since, qty, entry: px, stop: null, stopId: null, tp: null, tpId: null };
        if (cur[W.sym]) cur[W.sym].amt += g * qty; else cur[W.sym] = { amt: g * qty, entry: px, mark: mk };
        // 손절 없는 다리는 두지 않음
        try { const r = await placeCond(W.sym, W.side, 'STOP_MARKET', W.stop, qty, L); L.stop = r.px; L.stopId = r.id; }
        catch (e) { note(W.sym + ' ' + botName[W.bot] + ' 손절 주문 실패(' + e.message + ') — 보호 없는 몫이라 바로 정리'); await closeLeg(L, '손절 주문 실패'); L.qty = 0; L.stopped = true; continue; }
        if (W.tp) { try { const r = await placeCond(W.sym, W.side, 'TAKE_PROFIT_MARKET', W.tp, qty, L); L.tp = r.px; L.tpId = r.id; } catch (e) { note(W.sym + ' 목표가 주문 실패: ' + e.message); } }
        note(botName[W.bot] + ' · ' + W.sym + ' ' + (W.side === 'long' ? '롱' : '숏') + ' 진입 ' + qty + ' @' + px + ' (봇 진입가 ' + W.entry + ', 차이 ' + (slip == null ? '—' : slip.toFixed(1) + 'bp') + ') · 손절 ' + L.stop + (L.tp ? ' · 목표 ' + L.tp : ''));
      } catch (e) { note(W.sym + ' 진입 실패: ' + e.message + (e.code ? ' (' + e.code + ')' : '')); }
      continue;
    }
    // 기존 다리: 수량 모르면(예전 기록) 지금 포지션에서 채움
    if (!L.qty) { const have = C && (C.amt > 0 ? 'long' : 'short') === L.side ? Math.abs(C.amt) : 0; if (!have) { L.stopped = true; continue; } L.qty = floorTo(have - Math.abs(legSum(W.sym)), R.step) || have; }
    const want2 = roundTo(W.stop, R.tick), tpWant = W.tp ? roundTo(W.tp, R.tick) : null;
    const needStop = L.legacy || !L.stopId || !openIds.has(String(L.stopId)) || Math.abs((L.stop || 0) - want2) >= R.tick;
    const needTp = !!tpWant && (L.legacy || !L.tpId || !openIds.has(String(L.tpId)) || Math.abs((L.tp || 0) - tpWant) >= R.tick);
    if (needStop) { const old = L.stopId; // 새 손절 먼저 → 옛 주문 취소
      try { const r = await placeCond(W.sym, W.side, 'STOP_MARKET', W.stop, L.qty, L); await cancelAlgo(W.sym, old); note(botName[W.bot] + ' · ' + W.sym + ' 손절 ' + (L.stop ? L.stop + ' → ' : '새로 ') + r.px); L.stop = r.px; L.stopId = r.id; }
      catch (e) { if (!old || !openIds.has(String(old))) { note(W.sym + ' ' + botName[W.bot] + ' 손절이 없고 다시 걸기도 실패(' + e.message + ') — 그 몫 정리'); await closeLeg(L, '손절 주문 실패'); L.qty = 0; L.stopped = true; continue; } else note(W.sym + ' 손절 이동 실패(기존 ' + L.stop + ' 유지): ' + e.message); } }
    if (needTp) { const old = L.tpId; try { const r = await placeCond(W.sym, W.side, 'TAKE_PROFIT_MARKET', W.tp, L.qty, L); await cancelAlgo(W.sym, old); L.tp = r.px; L.tpId = r.id; } catch (e) { note(W.sym + ' 목표가 주문 실패: ' + e.message); } }
    if (L.legacy) { // 예전 '전량' 조건 주문 정리 (다리별 주문이 아닌 것)
      const mine = new Set(Object.values(st.legs).filter((x) => x.sym === W.sym).flatMap((x) => [String(x.stopId), String(x.tpId)]));
      for (const o of algos.filter((x) => x.symbol === W.sym && !mine.has(String(x.algoId)))) await cancelAlgo(W.sym, o.algoId);
      delete L.legacy; }
  }
  // ④ 거래소 포지션과 다리 합계가 크게 어긋나면(수동 조작·예전 잔여) 다리 없는 수량만큼 정리
  for (const [sym, C] of Object.entries(cur)) { const R = info[sym]; if (!R) continue; const diff = C.amt - legSum(sym);
    if (Math.abs(diff) >= R.step && Math.abs(diff) * C.mark > R.minNotional && !Object.values(st.legs).some((L) => L.sym === sym && unknown.has(L.bot))) {
      try { await market(sym, diff > 0 ? 'SELL' : 'BUY', floorTo(Math.abs(diff), R.step), true); note(sym + ' 봇 몫과 안 맞는 ' + r6(Math.abs(diff)) + ' 정리 (기록 맞춤)'); } catch (e) { note(sym + ' 잔여 정리 실패: ' + e.message); } } }
  Object.keys(st.legs).forEach((k) => { const L = st.legs[k]; if ((L.stopped || L.late) && !want[k]) delete st.legs[k]; });

  // 오늘(한국 날짜) 시작 잔고 — 앱의 '오늘 손익'
  const today = new Date(now + 9 * 3600e3).toISOString().slice(0, 10);
  if (!st.day || st.day.date !== today) st.day = { date: today, start: r6(eq) };
  st.actions = (st.actions || []).concat(acts).slice(-80); st.fills = (st.fills || []).slice(-200); st.updatedAt = new Date(now).toISOString();
  mkdirSync(dirname(SFILE), { recursive: true }); writeFileSync(SFILE, JSON.stringify(st));
  // 앱용 (데모 계좌)
  const posNow = await B.call('GET', '/fapi/v3/positionRisk').catch(() => posArr);
  const opens = st.fills.filter((f) => f.kind === 'open' && f.slipBps != null);
  const out = { v: 1, at: new Date(now).toISOString(), base: B.base, equity: r6(eq), wallet: Number(acct.totalWalletBalance || 0), upnl: Number(acct.totalUnrealizedProfit || 0),
    positions: (posNow || []).filter((p) => Number(p.positionAmt)).map((p) => ({ sym: p.symbol, side: Number(p.positionAmt) > 0 ? 'long' : 'short', qty: Math.abs(Number(p.positionAmt)), entry: Number(p.entryPrice), mark: Number(p.markPrice), upnl: Number(p.unRealizedProfit), liq: Number(p.liquidationPrice), stop: (Object.values(st.legs).find((L) => L.sym === p.symbol && L.qty > 0 && !L.stopped) || {}).stop || null, bot: Object.values(st.legs).filter((L) => L.sym === p.symbol && L.qty > 0 && !L.stopped).map((L) => L.bot).join(',') || null,
      legs: Object.values(st.legs).filter((L) => L.sym === p.symbol && L.qty > 0 && !L.stopped).map((L) => ({ bot: L.bot, qty: L.qty, stop: L.stop, tp: L.tp })) })),
    day: st.day, fills: st.fills.slice(-40).reverse(), actions: st.actions.slice(-30).reverse(), slip: opens.length ? Math.round(opens.reduce((s, f) => s + f.slipBps, 0) / opens.length * 10) / 10 : null, botLive: { ret: M.live.ret, n: M.live.n, positions: (M.live.positions || []).length },
    bots: BOTS.map(([id, nm]) => { const D = TG[id]; return { id, name: nm, share: Math.round(share * 100), ok: !!(D && D.live), ret: D && D.live ? D.live.ret : null, positions: D && D.live ? (D.live.positions || []).length : 0 }; }) };
  await upload(out, env, fetchImpl, log);
  log('바이낸스 데모: 잔고 ' + r6(eq) + ' USDT · 포지션 ' + out.positions.length + ' · 이번에 한 일 ' + acts.length + '건');
  return out;
}
async function upload(obj, env, fetchImpl, log) {
  const token = env.GITHUB_TOKEN, repo = env.GITHUB_REPO; if (!token || !repo) return;
  const H = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'sijangnalssi-exec' }, url = 'https://api.github.com/repos/' + repo + '/contents/exec-live.json';
  try {
    let sha; const g = await fetchImpl(url + '?ref=deriv-data', { headers: H }); if (g.ok) sha = (await g.json()).sha;
    const p = await fetchImpl(url, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '바이낸스 데모 ' + obj.at.slice(0, 16), branch: 'deriv-data', content: Buffer.from(JSON.stringify(obj)).toString('base64'), ...(sha ? { sha } : {}) }) });
    if (!p.ok) log('✗ 데모 결과 올리기 실패 HTTP ' + p.status);
  } catch (e) { log('✗ 데모 결과 올리기: ' + e.message); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = { ...process.env }; try { readFileSync(join(HERE, '.env'), 'utf8').split('\n').forEach((l) => { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }); } catch (e) { /* 없음 */ }
  if (process.argv.includes('--check')) {
    // 연결 확인만: 잔고·포지션 조회 (주문 안 함)
    (async () => { const B = client(env); const a = await B.call('GET', '/fapi/v3/account'); console.log('✓ 바이낸스 데모 연결 성공 · 잔고 ' + Number(a.totalMarginBalance || a.totalWalletBalance).toFixed(2) + ' USDT');
      // 선물 주문 권한 확인: 시험 주문(실제로 체결되지 않음)
      try { await B.call('POST', '/fapi/v1/order/test', { symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', quantity: '0.002' }); console.log('✓ 선물 주문 권한 확인 (시험 주문 통과 — 실제 주문 아님)'); }
      catch (e) { console.log('✗ 선물 주문 권한 없음: ' + e.message + (e.code ? ' (코드 ' + e.code + ')' : '') + ' → 데모 API 관리에서 Enable Futures 를 켜 주세요'); process.exitCode = 1; } })().catch((e) => { console.error('✗ 연결 실패: ' + e.message + (e.code ? ' (코드 ' + e.code + ')' : '')); process.exitCode = 1; });
  } else if (process.argv.includes('--selftest')) {
    // 주문 점검: 아주 작은 BTC 롱 → 거래소 손절 조건 주문 → 확인 → 취소 → 정리 (데모 계좌, 몇 초 안에 끝)
    (async () => {
      const B = client(env), sym = 'BTCUSDT', R = rules(await B.call('GET', '/fapi/v1/exchangeInfo', {}, false))[sym];
      const step = (n, m) => console.log((n ? '✓ ' : '✗ ') + m);
      try { await B.call('POST', '/fapi/v1/positionSide/dual', { dualSidePosition: 'false' }); } catch (e) { /* 이미 */ }
      try { await B.call('POST', '/fapi/v1/marginType', { symbol: sym, marginType: 'ISOLATED' }); } catch (e) { /* 이미 */ }
      await B.call('POST', '/fapi/v1/leverage', { symbol: sym, leverage: 5 }); step(1, '레버리지 5배 · 격리 마진 설정');
      const mk = Number((await B.call('GET', '/fapi/v1/premiumIndex', { symbol: sym }, false)).markPrice);
      const qty = Math.max(R.minQty, Number((Math.ceil(R.minNotional * 1.2 / mk / R.step) * R.step).toFixed(dec(R.step))));
      const o = await B.call('POST', '/fapi/v1/order', { symbol: sym, side: 'BUY', type: 'MARKET', quantity: qty, newOrderRespType: 'RESULT' });
      step(1, '시장가 롱 진입 ' + qty + ' BTC @' + (Number(o.avgPrice) || mk) + ' (약 ' + Math.round(qty * mk) + ' USDT)');
      const sp = roundTo(mk * 0.95, R.tick);
      const a = await B.call('POST', '/fapi/v1/algoOrder', { algoType: 'CONDITIONAL', symbol: sym, side: 'SELL', type: 'STOP_MARKET', triggerPrice: sp, closePosition: 'true', workingType: 'MARK_PRICE', priceProtect: 'true' });
      step(1, '거래소 손절 조건 주문 ' + sp + ' (번호 ' + a.algoId + ')');
      let L = await B.call('GET', '/fapi/v1/openAlgoOrders', { symbol: sym }); L = Array.isArray(L) ? L : (L.orders || []);
      step(L.some((x) => String(x.algoId) === String(a.algoId)), '거래소에 손절 주문이 걸려 있는지 확인');
      await B.call('DELETE', '/fapi/v1/algoOrder', { symbol: sym, algoId: a.algoId }); step(1, '손절 주문 취소');
      const c = await B.call('POST', '/fapi/v1/order', { symbol: sym, side: 'SELL', type: 'MARKET', quantity: qty, reduceOnly: 'true', newOrderRespType: 'RESULT' });
      if (!Number(c.avgPrice) && c.orderId) { try { await new Promise((r) => setTimeout(r, 500)); c.avgPrice = (await B.call('GET', '/fapi/v1/order', { symbol: sym, orderId: c.orderId })).avgPrice; } catch (e) { /* 표시만 */ } }
      step(1, '시장가 정리 @' + (Number(c.avgPrice) || '?'));
      const P = (await B.call('GET', '/fapi/v3/positionRisk')).filter((p) => p.symbol === sym && Number(p.positionAmt));
      step(!P.length, '포지션이 깨끗하게 정리됐는지 확인');
      console.log('주문 점검 끝 — 민경기 봇이 들어갈 때 이 순서대로 자동으로 주문해요.');
    })().catch((e) => { console.error('✗ 주문 점검 실패: ' + e.message + (e.code ? ' (코드 ' + e.code + ')' : '')); process.exitCode = 1; });
  } else if (process.argv.includes('--loop')) {
    // 단타 봇은 15분봉이라: 매시 20·35·50분에 한 번씩 더 맞춤 (서버 cron 이 매시 5분에 sync 뒤 이걸 부름, 55분 전에 끝)
    // 장이 열린 시간(한국 평일 09:00~15:30 · 미국 평일 09:30~16:00 뉴욕 시간)에는 보유 주식 가격도 같이 갱신 (빠른 동기화: 공시 확인·선물 데이터 생략)
    const open = (d = new Date()) => { const at = (tz) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d).map((x) => [x.type, x.value])); return { wd: p.weekday, m: (+p.hour % 24) * 60 + +p.minute }; };
      const k = at('Asia/Seoul'), u = at('America/New_York'), wk = (w) => !['Sat', 'Sun'].includes(w);
      return (wk(k.wd) && k.m >= 9 * 60 && k.m <= 15 * 60 + 40) || (wk(u.wd) && u.m >= 9 * 60 + 30 && u.m <= 16 * 60 + 10); };
    // 봇 결과가 바뀌면 바로 따라감: bot-data 브랜치의 최신 커밋을 40초마다 확인(토큰 없으면 75초) → 바뀌었으면 즉시 데모 맞춤. 54분에 끝(다음 cron 이 이어받음)
    //  + 15분마다는 바뀐 게 없어도 한 번 맞춤(손절 이동 누락 방지) + 장 시간엔 5분마다 주식 가격 빠른 동기화
    (async () => { const { spawnSync } = await import('node:child_process');
      const repo = env.GITHUB_REPOSITORY || env.GITHUB_REPO || 'rudrl09202-bit/sijangnalssi', tok = env.GITHUB_TOKEN || env.GH_TOKEN || '';
      const head = async () => { try { const r = await fetch('https://api.github.com/repos/' + repo + '/commits/bot-data', { headers: Object.assign({ 'User-Agent': 'sijangnalssi-exec', Accept: 'application/vnd.github.sha' }, tok ? { Authorization: 'Bearer ' + tok } : {}) }); return r.ok ? (await r.text()).trim() : null; } catch (e) { return null; } };
      const step = tok ? 40e3 : 75e3, t0 = Date.now(); let last = await head(), lastRun = Date.now(), lastSync = Date.now();
      while (new Date().getMinutes() < 54 && Date.now() - t0 < 50 * 60e3) {
        await new Promise((r) => setTimeout(r, step)); const mm = new Date().getMinutes();
        // 장 시간엔 5분마다 보유 자산(주식 가격) 빠른 동기화 → 앱 새로고침 때 최대 5분 전 가격
        const q = mm; if (open() && !env.SNW_NO_FAST_SYNC && Date.now() - lastSync >= 5 * 60e3) { lastSync = Date.now(); { const r = spawnSync(process.execPath, ['--dns-result-order=ipv4first', join(HERE, 'sync.mjs')], { cwd: HERE, env: { ...process.env, SNW_FAST: '1', SNW_SKIP_DERIV: '1', SNW_SKIP_EXEC: '1', SNW_SKIP_MARKET: '1' }, stdio: 'inherit', timeout: 300e3 }); if (r.status !== 0) console.log('✗ 빠른 동기화 (' + q + '분) 실패'); } }
        const h = await head(), changed = h && h !== last;
        if (changed || Date.now() - lastRun > 15 * 60e3) { if (h) last = h; lastRun = Date.now();
          try { await run({ env }); } catch (e) { console.log('✗ 바이낸스 데모 (' + mm + '분): ' + e.message); } }
      } })();
  } else run({ env }).catch((e) => { console.error('✗ ' + e.message); process.exitCode = 1; });
}
