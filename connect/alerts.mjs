#!/usr/bin/env node
/*
 * 시장날씨 — 매수 후보 자동 분석 + 아이폰 푸시 알림
 *
 * 순서: (market.mjs 가 만든) js/market-live.js 를 읽고 → 앱과 같은 규칙(js/rules.js)으로
 *       주식은 월가 스크리너, 코인은 33개 조건 점수를 계산 → 매수 후보를 골라 → 푸시 알림 발송
 * 매수 후보: 주식 스크리너 70점 이상 / 코인 65점 이상 + 행동 가이드가 "분할 매수 검토"(또는 "소량 분할 매수")
 *            같은 종목은 7일 안에 다시 알리지 않음 (data/alerts-state.json 에 기록)
 * 결과: js/alerts-live.js (앱의 "알림" 화면에 표시)
 * 필요한 값(GitHub Secrets 또는 connect/.env): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL, PUSH_SUBSCRIPTIONS
 */
import { telegram } from './notify.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
export const RULE = { stockMin: 70, coinMin: 65, quietDays: 7, buyActions: ['add', 'add-small'] };

function loadEnv() {
  const env = { ...process.env }, p = join(HERE, '.env');
  if (existsSync(p)) for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !line.trim().startsWith('#') && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
  return env;
}
// 앱의 규칙 파일들을 그대로 불러와 같은 계산을 함
export function loadApp(root = ROOT) {
  const ctx = { console, Math, Date, JSON, Number, String, Array, Object, Set, Map, isFinite, isNaN };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of ['snapshot.js', 'rules.js', 'universe.js', 'tickers.js', 'market-live.js']) {
    const p = join(root, 'js', f); if (existsSync(p)) vm.runInContext(readFileSync(p, 'utf8'), ctx, { filename: f });
  }
  return ctx;
}
const nf = (v, d) => Number(v).toLocaleString('ko-KR', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
const pxText = (v, cur) => (cur === 'USD' ? '$' + nf(v, 2) : v >= 100 ? nf(Math.round(v)) + '원' : nf(v, 2) + '원');

async function getJSON(fetchImpl, url) { const r = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': 'sijangnalssi-alerts/1.0' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }

export async function analyze({ app, fetchImpl = fetch, now = new Date() } = {}) {
  const W = app.window || app, SNAP = W.SNAPSHOT, R = W.Rules, U = W.Universe, ML = W.MARKET_LIVE;
  if (!ML || !ML.series) throw new Error('market-live.js 가 없습니다. market.mjs 를 먼저 실행하세요.');
  // 앱과 같게: 거시 숫자를 최신 값으로
  const markets = JSON.parse(JSON.stringify(SNAP.markets));
  Object.entries(ML.macro || {}).forEach(([k, m]) => { if (markets[k] && m.value != null) markets[k] = { ...markets[k], value: m.value, chg: k === 'us10y' ? m.chgBp : m.chgPct }; });
  const usdkrw = markets.usdkrw.value;
  let fng = SNAP.crypto.fng, dom = SNAP.crypto.btcDominance;
  try { const j = await getJSON(fetchImpl, 'https://api.alternative.me/fng/?limit=1'); fng = Number(j.data[0].value); } catch (e) { /* 기본값 */ }
  try { const j = await getJSON(fetchImpl, 'https://api.coingecko.com/api/v3/global'); dom = j.data.market_cap_percentage.btc; } catch (e) { /* 기본값 */ }
  const weather = R.marketWeather(markets, fng);
  const base = { markets, rates: SNAP.rates, sectors: SNAP.sectors, events: SNAP.events, now: now.getTime() };
  const rsMap = {}; Object.entries(ML.series).forEach(([k, v]) => { rsMap[k] = v.c; });
  const rs = R.rsRatings(rsMap);
  const out = [];
  // 주식
  for (const mk of Object.keys(U.LIST)) {
    for (const it of U.LIST[mk]) {
      const k = ML.series[it.s]; if (!k || out.some((x) => x.id === it.s)) continue;
      const candles = { c: k.c, h: k.h, l: k.l, v: k.v.map((x) => x * (k.cur === 'USD' ? usdkrw : 1)) };
      const sc = R.screenStock({ ...base, candles, bench: ML.bench && ML.bench[mk], fund: ML.fund && ML.fund[it.s], rs: rs[it.s], sectorId: it.sec, currency: it.cur });
      const act = R.actionFor({ score: sc, candles, held: false, fng });
      out.push({ kind: 'stock', id: it.s, name: it.n, market: U.MARKETS[mk], cur: it.cur, score: sc.total, grade: sc.grade, action: act, reasons: sc.strengths, price: k.c[k.c.length - 1] });
    }
  }
  // 코인 (업비트 일봉 200개)
  const coinCandles = {};
  for (const m of SNAP.rankCoins) {
    try {
      const rows = (await getJSON(fetchImpl, 'https://api.upbit.com/v1/candles/days?market=' + m + '&count=200')).slice().reverse();
      coinCandles[m] = { c: rows.map((x) => x.trade_price), h: rows.map((x) => x.high_price), l: rows.map((x) => x.low_price), v: rows.map((x) => x.candle_acc_trade_price) };
    } catch (e) { /* 이 코인만 건너뜀 */ }
    await new Promise((r) => setTimeout(r, 120));
  }
  for (const m of SNAP.rankCoins) {
    const k = coinCandles[m]; if (!k) continue;
    const sc = R.scoreCoin2({ ...base, symbol: m.slice(4), candles: k, btc: coinCandles['KRW-BTC'], etfFlow: SNAP.crypto.etfFlowMonth, fng, btcDominance: dom });
    const act = R.actionFor({ score: sc, candles: k, held: false, fng });
    const names = { BTC: '비트코인', ETH: '이더리움', XRP: '엑스알피(리플)', SOL: '솔라나', DOGE: '도지코인', ADA: '에이다', LINK: '체인링크', AVAX: '아발란체', SUI: '수이', TRX: '트론' };
    out.push({ kind: 'coin', id: m, name: names[m.slice(4)] || m.slice(4), market: '코인', cur: 'KRW', score: sc.score100, grade: sc.grade, action: act, reasons: (sc.plus || []).map((c) => c.label + ' — ' + String(c.note).split(' · ').pop()), price: k.c[k.c.length - 1] });
  }
  return { all: out, weather, fng };
}

export function pickCandidates(all, state, now = new Date(), rule = RULE) {
  const quiet = rule.quietDays * 86400000;
  return all.filter((x) => x.score != null && x.score >= (x.kind === 'coin' ? rule.coinMin : rule.stockMin) && x.action && rule.buyActions.includes(x.action.action))
    .filter((x) => !(state.sent && state.sent[x.id] && now - new Date(state.sent[x.id]) < quiet))
    .sort((a, b) => b.score - a.score);
}
export function lineOf(x) {
  const p = x.action && x.action.plan || [], first = p.find((q) => q.k === '1차'), stop = p.find((q) => q.stop);
  return [x.grade + ' · ' + (x.action ? x.action.label : ''), x.reasons && x.reasons[0], first ? '1차 ' + pxText(first.px, x.cur) : '', stop ? '손절 ' + pxText(stop.px, x.cur) : ''].filter(Boolean).join(' · ');
}
export function message(cands, weather) {
  const top = cands.slice(0, 4);
  return {
    title: '매수 후보 ' + cands.length + '개 · 시장날씨 ' + weather.title,
    body: top.map((x) => x.name + ' ' + x.score + '점' + (x.action.plan && x.action.plan[0] ? ' · 1차 ' + pxText(x.action.plan[0].px, x.cur) : '')).join('\n') + (cands.length > 4 ? '\n외 ' + (cands.length - 4) + '개' : ''),
    url: './index.html#alerts', tag: 'snw-buy'
  };
}

export async function run({ fetchImpl = fetch, sendImpl, env = loadEnv(), now = new Date(), root = ROOT, log = console.log } = {}) {
  const app = loadApp(root);
  const { all, weather } = await analyze({ app, fetchImpl, now });
  const stateFile = join(root, 'data', 'alerts-state.json');
  const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { sent: {}, history: [] };
  const cands = pickCandidates(all, state, now);
  log('분석 ' + all.length + '종목 · 매수 후보 ' + cands.length + '개 · 시장날씨 ' + weather.title);
  let sent = 0, failed = 0;
  if (cands.length) {
    const subs = (() => { try { return JSON.parse(env.PUSH_SUBSCRIPTIONS || '[]'); } catch (e) { log('PUSH_SUBSCRIPTIONS 형식 오류'); return []; } })();
    const list = Array.isArray(subs) ? subs : [subs];
    if (list.length && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
      let send = sendImpl;
      if (!send) {
        const wp = (await import('web-push')).default;
        wp.setVapidDetails('mailto:' + (env.VAPID_EMAIL || 'admin@example.com'), env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
        send = (sub, payload) => wp.sendNotification(sub, payload, { TTL: 12 * 3600, urgency: 'normal' });
      }
      const payload = JSON.stringify(message(cands, weather));
      for (const sub of list) {
        try { await send(sub, payload); sent++; } catch (e) { failed++; log('알림 실패' + (e.statusCode === 404 || e.statusCode === 410 ? ' — 이 휴대폰 연결이 만료됨. 앱에서 "알림 다시 연결" 후 코드를 새로 넣으세요.' : ': ' + (e.statusCode || e.message))); }
      }
    } else log('알림 대상(PUSH_SUBSCRIPTIONS)이나 키(VAPID_*)가 없어 보내지 않았습니다.');
    { const m = message(cands, weather); if (await telegram(env, m, log)) log('텔레그램 1건'); }
    cands.forEach((x) => { state.sent[x.id] = now.toISOString(); });
    state.history = cands.map((x) => ({ at: now.toISOString(), id: x.id, kind: x.kind, name: x.name, market: x.market, score: x.score, line: lineOf(x) })).concat(state.history || []).slice(0, 60);
  }
  mkdirSync(join(root, 'data'), { recursive: true });
  writeFileSync(stateFile, JSON.stringify(state, null, 1));
  const items = cands.length ? cands.map((x) => ({ kind: x.kind, id: x.id, name: x.name, market: x.market, score: x.score, line: lineOf(x) })) : [];
  writeFileSync(join(root, 'js', 'alerts-live.js'), '/* 자동 생성 — connect/alerts.mjs */\nwindow.SNW_ALERTS = ' + JSON.stringify({ generatedAt: now.toISOString(), note: '시장날씨 ' + weather.title + ' · 오늘 후보 ' + items.length + '개', items, history: state.history.slice(0, 30), top: all.filter((x) => x.kind !== 'coin' && x.score != null).sort((a, b) => b.score - a.score).slice(0, 20).map((x) => ({ id: x.id, name: x.name, market: x.market, score: x.score })) }) + ';\n');
  log('알림 ' + sent + '건 발송' + (failed ? ' · 실패 ' + failed + '건' : ''));
  return { all, cands, sent, failed, weather };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
}
