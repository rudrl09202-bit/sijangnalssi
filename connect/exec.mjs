/* 바이낸스 선물 '데모 트레이딩'(가짜 돈) 계좌에 민경기 봇·류신영 봇의 포지션을 실제 주문으로 따라 넣기 — 서울 서버에서 매시간
 *  · 두 봇이 잔고를 반씩 나눠 씀(각 봇의 레버리지 × 잔고의 절반). 같은 코인은 한 봇만: 먼저 들어간 봇이 주인, 다른 봇의 같은 코인 신호는 데모에선 건너뜀
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
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
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
  const call = async (method, path, params = {}, signed = true) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]));
    if (signed) { q.set('recvWindow', '10000'); q.set('timestamp', String(Date.now())); q.set('signature', createHmac('sha256', sec).update(q.toString()).digest('hex')); }
    const url = base + path + (q.toString() ? '?' + q : '');
    const res = await fetchImpl(url, { method, headers: { 'X-MBX-APIKEY': key || '', 'User-Agent': 'sijangnalssi-exec' } });
    const text = await res.text(); let j; try { j = JSON.parse(text); } catch (e) { j = text; }
    if (!res.ok) { const err = new Error((j && j.msg) || String(text).slice(0, 160)); err.code = j && j.code; err.status = res.status; throw err; }
    return j;
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

export const BOTS = [['mk3', '민경기 봇', 'mk3-live.json'], ['rs', '류신영 봇', 'rs-live.json']];
export async function run({ env = {}, fetchImpl = fetch, log = console.log, now = Date.now(), target = null, targets = null } = {}) {
  if (!env.BINANCE_DEMO_KEY || !env.BINANCE_DEMO_SECRET) { log('· 바이낸스 데모: BINANCE_DEMO_KEY·SECRET 이 없어 건너뜀'); return null; }
  const B = client(env, fetchImpl), repo = env.GITHUB_REPO || 'rudrl09202-bit/sijangnalssi';
  let st = { v: 1, map: {}, fills: [], actions: [] }; try { st = JSON.parse(readFileSync(SFILE, 'utf8')); } catch (e) { /* 처음 */ }
  const opened = new Set(), acts = [], note = (m) => { acts.push({ t: new Date(now).toISOString(), m }); log('  ' + m); };
  st.map = st.map || {};

  // 1) 목표: 민경기 봇 3세대 + 류신영 봇 2세대 포지션 (같은 코인은 주인 한 봇만)
  const TG = targets || (target ? { mk3: target } : {}), share = 1 / BOTS.length;
  for (const [id, nm, file] of BOTS) { if (TG[id] !== undefined) continue; try { const r = await fetchImpl('https://raw.githubusercontent.com/' + repo + '/bot-data/' + file + '?t=' + Math.floor(now / 6e4)); TG[id] = r.ok ? await r.json() : null; if (!r.ok) note(nm + ' 결과를 못 읽음 (HTTP ' + r.status + ') — 이번엔 그대로 둠'); } catch (e) { TG[id] = null; note(nm + ' 결과 읽기 실패: ' + e.message); } }
  const M = TG.mk3 || { live: { ret: 0, n: 0, positions: [] } };
  const tgt = {}, botName = Object.fromEntries(BOTS.map(([id, nm]) => [id, nm])), wantBy = {};
  BOTS.forEach(([id]) => { const D = TG[id]; if (!D || !D.live) return; (D.live.positions || []).forEach((p) => { const sym = p.sym + 'USDT'; (wantBy[sym] = wantBy[sym] || []).push({ bot: id, side: p.side, lev: p.lev * share, stop: p.stop, entry: p.entry, name: p.name, since: id + '|' + p.since }); }); });
  // 결과를 못 읽은 봇이 가진 데모 포지션은 건드리지 않음
  const unknown = new Set(BOTS.filter(([id]) => !TG[id] || !TG[id].live).map(([id]) => id));
  for (const [sym, L] of Object.entries(wantBy)) { const own = st.map[sym] && st.map[sym].bot, pick = L.find((x) => x.bot === own) || L[0]; tgt[sym] = pick;
    L.filter((x) => x !== pick).forEach((x) => { const k = 'skip|' + x.since; if (!st.map[k]) { st.map[k] = { skip: true, at: now }; note(sym.replace('USDT', '') + ': ' + botName[x.bot] + ' 신호는 ' + botName[pick.bot] + '이 이미 가진 코인이라 데모에선 건너뜀'); } }); }
  Object.keys(st.map).forEach((k) => { if (k.startsWith('skip|') && now - st.map[k].at > 30 * 864e5) delete st.map[k]; });

  // 2) 데모 계좌 현황
  const info = rules(await B.call('GET', '/fapi/v1/exchangeInfo', {}, false));
  const acct = await B.call('GET', '/fapi/v3/account');
  const eq = Number(acct.totalMarginBalance || acct.totalWalletBalance || 0);
  const posArr = await B.call('GET', '/fapi/v3/positionRisk');
  const cur = {}; (posArr || []).forEach((p) => { const a = Number(p.positionAmt); if (a) cur[p.symbol] = { amt: a, entry: Number(p.entryPrice), mark: Number(p.markPrice), upnl: Number(p.unRealizedProfit), lev: Number(p.leverage) }; });
  let algos = []; try { algos = await B.call('GET', '/fapi/v1/openAlgoOrders'); algos = Array.isArray(algos) ? algos : (algos.orders || []); } catch (e) { note('조건 주문 조회 실패: ' + e.message); }
  try { await B.call('POST', '/fapi/v1/positionSide/dual', { dualSidePosition: 'false' }); } catch (e) { /* 이미 한 방향 모드 */ }

  const cancelStops = async (sym) => { for (const o of algos.filter((x) => x.symbol === sym)) { try { await B.call('DELETE', '/fapi/v1/algoOrder', { symbol: sym, algoId: o.algoId }); } catch (e) { note(sym + ' 조건 주문 취소 실패: ' + e.message); } } };
  const placeStop = async (sym, side, stop) => {
    const R = info[sym]; const px = roundTo(stop, R.tick);
    const o = await B.call('POST', '/fapi/v1/algoOrder', { algoType: 'CONDITIONAL', symbol: sym, side: side === 'long' ? 'SELL' : 'BUY', type: 'STOP_MARKET', triggerPrice: px, closePosition: 'true', workingType: 'MARK_PRICE', priceProtect: 'true' });
    st.map[sym] = Object.assign(st.map[sym] || {}, { stop: px, algoId: o.algoId }); return px;
  };
  const market = async (sym, side, qty, reduce) => { const o = await B.call('POST', '/fapi/v1/order', { symbol: sym, side, type: 'MARKET', quantity: qty, reduceOnly: reduce ? 'true' : null, newOrderRespType: 'RESULT' });
    if (!Number(o.avgPrice) && o.orderId) { try { const q = await B.call('GET', '/fapi/v1/order', { symbol: sym, orderId: o.orderId }); if (Number(q.avgPrice)) o.avgPrice = q.avgPrice; } catch (e) { /* 체결가 조회 실패 — 표시만 빠짐 */ } }
    return o; };

  for (const sym of new Set([...Object.keys(tgt), ...Object.keys(cur), ...Object.keys(st.map).filter((k) => !k.startsWith('skip|'))])) {
    const T = tgt[sym], C = cur[sym], R = info[sym];
    if (!T && st.map[sym] && unknown.has(st.map[sym].bot)) continue;
    if (!R) { note(sym + ': 바이낸스 선물에 없는 종목 — 건너뜀'); continue; }
    const cSide = C ? (C.amt > 0 ? 'long' : 'short') : null;
    // 정리: 봇엔 없는데 데모엔 있음 / 방향이 반대
    if (C && (!T || T.side !== cSide)) {
      try { const o = await market(sym, C.amt > 0 ? 'SELL' : 'BUY', Math.abs(C.amt), true); await cancelStops(sym);
        const px = Number(o.avgPrice) || C.mark; st.fills.push({ t: new Date(now).toISOString(), sym, kind: 'close', side: cSide, qty: Math.abs(C.amt), price: px, pnl: r6((cSide === 'long' ? 1 : -1) * (px - C.entry) * Math.abs(C.amt)) });
        const ob = st.map[sym] && st.map[sym].bot; st.fills[st.fills.length - 1].bot = ob; note(sym + ' ' + (cSide === 'long' ? '롱' : '숏') + ' 정리 @' + px + ' (' + (botName[ob] || '봇') + '에서 정리됨)'); delete st.map[sym]; } catch (e) { note(sym + ' 정리 실패: ' + e.message); }
      if (!T) continue;
    }
    if (!T) { if (!C) { await cancelStops(sym); delete st.map[sym]; } continue; }
    // 진입: 봇엔 있는데 데모엔 없음 (같은 봇 포지션에 한 번만)
    if (!C || T.side !== cSide) {
      if (st.map[sym] && st.map[sym].since === T.since && st.map[sym].stopped) { continue; } // 데모에서 먼저 손절됨 — 같은 포지션에 다시 들어가지 않음
      try {
        try { await B.call('POST', '/fapi/v1/marginType', { symbol: sym, marginType: 'ISOLATED' }); } catch (e) { /* 이미 격리 */ }
        await B.call('POST', '/fapi/v1/leverage', { symbol: sym, leverage: 5 });
        const mk = Number((await B.call('GET', '/fapi/v1/premiumIndex', { symbol: sym }, false)).markPrice);
        let qty = floorTo(T.lev * eq / mk, R.step);
        if (qty < R.minQty || qty * mk < R.minNotional) { note(sym + ' 진입 건너뜀: 데모 잔고 대비 너무 작음 (' + r6(qty * mk) + ' USDT)'); continue; }
        const o = await market(sym, T.side === 'long' ? 'BUY' : 'SELL', qty, false), px = Number(o.avgPrice) || mk;
        const slip = T.entry ? ((T.side === 'long' ? 1 : -1) * (px / T.entry - 1) * 1e4) : null;
        st.fills.push({ t: new Date(now).toISOString(), sym, bot: T.bot, kind: 'open', side: T.side, qty, price: px, botEntry: T.entry, slipBps: slip == null ? null : Math.round(slip * 10) / 10 });
        st.map[sym] = { side: T.side, since: T.since, qty, bot: T.bot }; opened.add(sym);
        const sp = await placeStop(sym, T.side, T.stop);
        note(botName[T.bot] + ' · ' + sym + ' ' + (T.side === 'long' ? '롱' : '숏') + ' 진입 ' + qty + ' @' + px + ' (봇 진입가 ' + T.entry + ', 차이 ' + (slip == null ? '—' : slip.toFixed(1) + 'bp') + ') · 손절 주문 ' + sp);
      } catch (e) { note(sym + ' 진입 실패: ' + e.message + (e.code ? ' (' + e.code + ')' : '')); }
      continue;
    }
    // 유지: 손절 주문이 봇 손절선과 같은지
    const want = roundTo(T.stop, R.tick), have = algos.find((x) => x.symbol === sym);
    const havePx = have ? Number(have.triggerPrice || have.stopPrice) : null;
    if (!have || Math.abs(havePx - want) >= R.tick) {
      try { await cancelStops(sym); const sp = await placeStop(sym, T.side, T.stop); note(sym + ' 손절 주문 ' + (have ? havePx + ' → ' : '새로 ') + sp + (have ? ' (본전·추적 손절 반영)' : '')); } catch (e) { note(sym + ' 손절 주문 실패: ' + e.message); }
    }
  }
  // 데모에서 손절이 먼저 체결됐는지 (봇엔 있는데 데모엔 없고, 우리가 들어갔던 포지션)
  Object.entries(st.map).forEach(([sym, m]) => { if (!opened.has(sym) && tgt[sym] && !cur[sym] && m.since === tgt[sym].since && m.qty && !m.stopped) { m.stopped = true; note(sym + ' 데모에서 손절 주문이 먼저 체결된 것으로 보임 — 같은 포지션엔 다시 들어가지 않음'); } });

  st.actions = (st.actions || []).concat(acts).slice(-80); st.fills = (st.fills || []).slice(-200); st.updatedAt = new Date(now).toISOString();
  mkdirSync(dirname(SFILE), { recursive: true }); writeFileSync(SFILE, JSON.stringify(st));
  // 앱용 (데모 계좌)
  const posNow = await B.call('GET', '/fapi/v3/positionRisk').catch(() => posArr);
  const opens = st.fills.filter((f) => f.kind === 'open' && f.slipBps != null);
  const out = { v: 1, at: new Date(now).toISOString(), base: B.base, equity: r6(eq), wallet: Number(acct.totalWalletBalance || 0), upnl: Number(acct.totalUnrealizedProfit || 0),
    positions: (posNow || []).filter((p) => Number(p.positionAmt)).map((p) => ({ sym: p.symbol, side: Number(p.positionAmt) > 0 ? 'long' : 'short', qty: Math.abs(Number(p.positionAmt)), entry: Number(p.entryPrice), mark: Number(p.markPrice), upnl: Number(p.unRealizedProfit), liq: Number(p.liquidationPrice), stop: st.map[p.symbol] ? st.map[p.symbol].stop : null, bot: st.map[p.symbol] ? st.map[p.symbol].bot : null })),
    fills: st.fills.slice(-40).reverse(), actions: st.actions.slice(-30).reverse(), slip: opens.length ? Math.round(opens.reduce((s, f) => s + f.slipBps, 0) / opens.length * 10) / 10 : null, botLive: { ret: M.live.ret, n: M.live.n, positions: (M.live.positions || []).length },
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
  } else run({ env }).catch((e) => { console.error('✗ ' + e.message); process.exitCode = 1; });
}
