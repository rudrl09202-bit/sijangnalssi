#!/usr/bin/env node
/*
 * 시장날씨 — 모의투자 봇 실행기 (키 필요 없음, 공개 시세만 사용)
 *
 * 순서
 *  1) market.mjs 가 받아 둔 10년치 시세(js/history)를 읽음 — 주식 170여 개, 지수, 금, 코인 10개, 원/달러
 *  2) 백테스트: 봇 5개를 지난 10년에 그대로 돌려 성적표를 만듦 (앞 70% = 표본 안, 뒤 30% = 표본 밖)
 *  3) 모의투자: data/paper-state.json 에 저장된 가상 계좌를 이어서, 새로 확정된 거래일만 처리
 *  4) 결과 → js/paper-live.js (앱의 "모의투자" 화면), 새 체결이 있으면 휴대폰 푸시
 *
 * 체결 규칙: 신호는 종가 → 다음 거래일 시가 체결. 아직 끝나지 않은 날의 시세는 쓰지 않음(UTC 어제까지만).
 * 실행: node connect/paper.mjs        (GitHub Actions 가 매일 자동 실행)
 *       node connect/paper.mjs --reset (가상 계좌를 오늘부터 새로 시작)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { loadApp } from './alerts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const fileKey = (key) => String(key).replace(/[^A-Za-z0-9_-]/g, '_');

function loadEnv() {
  const env = { ...process.env }, p = join(HERE, '.env');
  if (existsSync(p)) for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !line.trim().startsWith('#') && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
  return env;
}
export function loadQuant(root = ROOT) {
  const ctx = { console, Math, Date, JSON, Number, String, Array, Object, Set, Map, isFinite, isNaN };
  ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(readFileSync(join(root, 'js', 'quant.js'), 'utf8'), ctx, { filename: 'quant.js' });
  return ctx.Quant;
}
// js/history/<키>.js 읽기
export function readHist(root, key) {
  const p = join(root, 'js', 'history', fileKey(key) + '.js'); if (!existsSync(p)) return null;
  let out = null; const ctx = { window: { SNW_HIST: (k, d) => { out = d; } } };
  vm.runInNewContext(readFileSync(p, 'utf8'), ctx); return out;
}
// 끝나지 않은 날 잘라내기: 'UTC 어제'까지만 확정으로 봄 (코인 일봉은 UTC 하루, 미국장은 한국 아침에 끝남)
export function cutoffDate(now = new Date()) { const d = new Date(now.getTime() - 86400000); return d.toISOString().slice(0, 10); }
function clip(h, cutoff) {
  let n = h.t.length; while (n > 0 && h.t[n - 1] > cutoff) n--;
  const o = { t: h.t.slice(0, n) }; ['o', 'h', 'l', 'c', 'v'].forEach((k) => { if (h[k]) o[k] = h[k].slice(0, n).map((x, i) => (x == null ? (h.c[i] ?? null) : x)); });
  // 빈 값 메우기
  for (let i = 0; i < n; i++) { if (o.c[i] == null) o.c[i] = i ? o.c[i - 1] : o.o[i]; ['o', 'h', 'l'].forEach((k) => { if (o[k][i] == null) o[k][i] = o.c[i]; }); }
  return cleanTicks(o);
}
// 잘못 찍힌 시세(하루만 튀었다 돌아오는 값, 0 이하) 바로잡기 + 고가·저가가 시가·종가를 감싸게
export function cleanTicks(o) {
  const n = o.c.length;
  for (let i = 1; i < n; i++) {
    const p = o.c[i - 1], c = o.c[i], nx = i + 1 < n ? o.c[i + 1] : null;
    const spike = c <= 0 || (p > 0 && Math.abs(c / p - 1) > 0.6 && nx != null && Math.abs(nx / p - 1) < 0.25);
    if (spike) { o.c[i] = p; o.o[i] = p; o.h[i] = p; o.l[i] = p; }
    if (!(o.o[i] > 0) || Math.abs(o.o[i] / o.c[i] - 1) > 0.6) o.o[i] = p > 0 ? p : o.c[i];
    o.h[i] = Math.max(o.h[i], o.o[i], o.c[i]); o.l[i] = Math.min(o.l[i] > 0 ? o.l[i] : Infinity, o.o[i], o.c[i]);
  }
  return o;
}
const COIN_NAME = { BTC: '비트코인', ETH: '이더리움', XRP: '엑스알피', SOL: '솔라나', DOGE: '도지코인', ADA: '에이다', LINK: '체인링크', AVAX: '아발란체', TRX: '트론', SUI: '수이' };

export function loadAssets(root, app, cutoff) {
  const W = app.window || app, U = W.Universe, T = W.Tickers;
  const assets = [], seen = new Set();
  const addH = (meta, key) => { const h = readHist(root, key); if (!h || !h.c || h.c.length < 60) return null; const x = { ...meta, ...clip(h, cutoff) }; if (x.c.length < 60) return null; assets.push(x); return x; };
  for (const mk of Object.keys(U.LIST)) for (const it of U.LIST[mk]) {
    if (seen.has(it.s)) continue; seen.add(it.s);
    addH({ id: it.s, name: it.n, kind: 'stock', cur: it.cur, market: mk, sec: it.sec || (T && T.sectorOf(it.s)) || '' }, it.s);
  }
  addH({ id: 'IDX_spx', name: 'S&P 500', kind: 'index', cur: 'USD' }, 'm_spx');
  addH({ id: 'IDX_nasdaq', name: '나스닥', kind: 'index', cur: 'USD' }, 'm_nasdaq');
  addH({ id: 'IDX_kospi', name: '코스피', kind: 'index', cur: 'KRW' }, 'm_kospi');
  addH({ id: 'IDX_kosdaq', name: '코스닥', kind: 'index', cur: 'KRW' }, 'm_kosdaq');
  addH({ id: 'GOLD', name: '금(선물)', kind: 'gold', cur: 'USD' }, 'm_gold');
  Object.keys(COIN_NAME).forEach((s) => addH({ id: 'C_' + s, sym: s, name: COIN_NAME[s], kind: 'coin', cur: 'USD' }, 'c_' + s));
  const fx = readHist(root, 'm_usdkrw'), usdkrw = {};
  if (fx) fx.t.forEach((d, i) => { if (fx.c[i]) usdkrw[d] = fx.c[i]; });
  return { assets, usdkrw };
}

// CHIEF 봇의 판단: 앱의 스크리너(R.screenStock) + 행동 가이드(R.actionFor)를 그 날까지의 데이터로
function makeChief(app, Q, getW, liveFrom) {
  const W0 = app.window || app, R = W0.Rules, SNAP = W0.SNAPSHOT, ML = W0.MARKET_LIVE;
  const markets = JSON.parse(JSON.stringify(SNAP.markets));
  const base = { markets, rates: SNAP.rates, sectors: SNAP.sectors, events: [], now: Date.now() };
  const rsCache = {}, cache = {};
  return function judge(a, i, d, held, pnl) {
    const key = a.id + d + (held ? 'h' : '');
    if (cache[key]) return cache[key];
    const W = getW(), s = Math.max(0, i - 259);
    const sl = (x) => x.slice(s, i + 1);
    const candles = { c: sl(a.c), h: sl(a.h), l: sl(a.l), v: sl(a.v || a.c.map(() => 0)).map((x) => x * (a.cur === 'USD' ? W.fx[d] : 1)) };
    const ridx = W.A[W.regimeOf[a.market]]; let bench = null;
    if (ridx) { const bi = Q.lastIdx(ridx, d); if (bi > 0) bench = ridx.c.slice(Math.max(0, bi - 259), bi + 1); }
    const rs = (rsCache[d] = rsCache[d] || Q.rsRanks(W, d))[a.id];
    const fund = liveFrom && d >= liveFrom && ML && ML.fund ? ML.fund[a.id] : undefined; // 과거 날짜엔 그때의 재무를 모르므로 쓰지 않음
    let sc;
    try { sc = R.screenStock({ ...base, candles, bench, fund, rs, sectorId: a.sec, currency: a.cur }); } catch (e) { return null; }
    const act = R.actionFor({ score: sc, candles, held, pnlPct: pnl, fng: null });
    return (cache[key] = { score: sc.total, action: act.action, label: act.label, plan: act.plan });
  };
}

const sampleCurve = (eq, every) => eq.filter((x, i) => i % every === 0 || i === eq.length - 1);
const sliceByDate = (eq, from, to) => eq.filter(([d]) => (!from || d >= from) && (!to || d <= to));
function benchCurve(W, id, from, krw) {
  const a = W.A[id]; if (!a) return null;
  const out = []; a.t.forEach((d, i) => { if (d >= from) out.push([d, a.c[i] * (krw && a.cur === 'USD' ? W.fx[d] : 1)]); });
  return out.length > 1 ? out.map(([d, v]) => [d, Math.round(v / out[0][1] * 1e8)]) : null;
}

function humanOrder(W, o) {
  const a = W.A[o.id], px = (v) => (a.cur === 'USD' ? '$' + v.toFixed(2) : Math.round(v).toLocaleString('ko-KR') + '원');
  const kind = o.side === 'sell' ? (o.frac ? '일부 매도(' + Math.round(o.frac * 100) + '%)' : '전량 매도') + ' · 다음 시가' : o.type === 'moo' ? '매수 · 다음 시가' : o.type === 'limit' ? '지정가 매수 ' + px(o.limit) + ' 이하' : '불타기 ' + px(o.trigger) + ' 넘으면';
  return { id: o.id, name: a.name, cur: a.cur, kind, side: o.side, why: o.reason, ttl: o.ttl };
}
function positionsView(W, acc, d) {
  const eq = Math.max(1, acc.lastEq || 1);
  return Object.values(acc.pos).map((p) => {
    const a = W.A[p.id], i = W.A[p.id] ? (a.idx[d] != null ? a.idx[d] : a.t.length - 1) : 0, cur = a.c[Math.min(i, a.c.length - 1)], fx = a.cur === 'USD' ? W.fx[d] || 1400 : 1;
    const val = p.qty * cur * fx;
    return { id: p.id, name: a.name, kind: a.kind, cur: a.cur, qty: Number(p.qty.toPrecision(8)), avg: p.avg, price: cur, val: Math.round(val), w: Math.round(val / eq * 1000) / 10,
      pct: Math.round((cur / p.avg - 1) * 1000) / 10, R: p.risk0 ? Math.round((cur - p.entry) / p.risk0 * 100) / 100 : null, stop: p.stop || null, stopWhy: p.stopWhy || null,
      since: p.entryDate, units: p.units || 1, why: p.reason };
  }).sort((x, y) => y.val - x.val);
}

async function push(env, payload, log) {
  let subs; try { subs = JSON.parse(env.PUSH_SUBSCRIPTIONS || '[]'); } catch (e) { return 0; }
  const list = Array.isArray(subs) ? subs : [subs];
  if (!list.length || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return 0;
  const wp = (await import('web-push')).default;
  wp.setVapidDetails('mailto:' + (env.VAPID_EMAIL || 'admin@example.com'), env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  let n = 0; for (const s of list) { try { await wp.sendNotification(s, JSON.stringify(payload), { TTL: 12 * 3600 }); n++; } catch (e) { log('푸시 실패: ' + (e.statusCode || e.message)); } }
  return n;
}

export async function run({ root = ROOT, now = new Date(), log = console.log, env = loadEnv(), reset = false, sendPush = true, btEvery = 3 } = {}) {
  const t0 = Date.now();
  const app = loadApp(root), Q = loadQuant(root);
  const cutoff = cutoffDate(now);
  const { assets, usdkrw } = loadAssets(root, app, cutoff);
  if (assets.filter((a) => a.kind === 'stock').length < 10) throw new Error('10년치 시세(js/history)가 없습니다. market.mjs 를 먼저 실행하세요.');
  const stateFile = join(root, 'data', 'paper-state.json');
  let state = !reset && existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : null;
  let W = null;
  const chief = makeChief(app, Q, () => W, state ? state.inception : cutoff);
  W = Q.buildWorld(assets, { usdkrw, regimeOf: { spx: 'IDX_spx', nasdaq: 'IDX_spx', kospi: 'IDX_kospi', kosdaq: 'IDX_kospi', coin: 'C_BTC' }, chief });
  const last = W.cal[W.cal.length - 1];
  log('시세 ' + assets.length + '개 · ' + W.cal[0] + ' ~ ' + last + ' (확정일 ' + cutoff + ')');

  // ── 1) 백테스트
  const btFrom = W.cal[Math.min(W.cal.length - 1, 260)];
  const bt = Q.backtest(W, { from: btFrom });
  const split = W.cal[Math.floor(W.cal.indexOf(btFrom) + (W.cal.length - W.cal.indexOf(btFrom)) * 0.7)];
  log('백테스트 ' + btFrom + ' ~ ' + last + ' · 표본 밖 시작 ' + split + ' · ' + ((Date.now() - t0) / 1000).toFixed(1) + '초');

  // ── 2) 모의투자 (이어서)
  if (!state) { state = { v: 1, inception: last, accounts: {} }; log('모의투자 계좌를 새로 엽니다: ' + last + ' 종가부터 판단, 다음 거래일 시가부터 체결'); }
  const todo = W.cal.filter((d) => d >= state.inception);
  const events = Q.run(W, state, todo, { collect: true });
  const fresh = events.filter((e) => e.side === 'buy' || e.side === 'sell' || e.side === 'vault');
  state.updatedAt = now.toISOString();
  mkdirSync(join(root, 'data'), { recursive: true });
  writeFileSync(stateFile, JSON.stringify(state));

  // ── 3) 성적표
  const benches = {
    spx: benchCurve(W, 'IDX_spx', btFrom, true), kospi: benchCurve(W, 'IDX_kospi', btFrom, false), btc: benchCurve(W, 'C_BTC', btFrom, true)
  };
  const benchFor = (b) => (b.kinds.includes('coin') ? 'btc' : 'spx');
  const bots = Q.BOTS.map((b) => {
    const a = bt.accounts[b.id], L = state.accounts[b.id];
    if (!a || !a.equity.length) return { id: b.id, code: b.code, name: b.name, role: b.role, method: b.method, edge: b.edge, empty: true };
    const full = Q.metrics(a.equity, a.trades);
    const isM = Q.metrics(sliceByDate(a.equity, null, split), a.trades.filter((x) => x.out < split));
    const oos = Q.metrics(sliceByDate(a.equity, split, null), a.trades.filter((x) => x.out >= split));
    const vs = Q.versus(a.equity, benches[benchFor(b)]);
    const mc = Q.monteCarlo(a.equity, 500);
    const liveM = L && L.equity.length > 1 ? Q.metrics(L.equity, L.trades) : null;
    const live = L ? {
      cash: Math.round(L.cash), equity: L.equity.length ? L.equity[L.equity.length - 1][1] : Math.round(L.cash), start: L.start,
      ret: L.equity.length ? Math.round((L.equity[L.equity.length - 1][1] / L.start - 1) * 10000) / 100 : 0,
      days: L.equity.length, curve: L.equity.slice(-400), metrics: liveM,
      positions: positionsView(W, L, L.lastDate || last), orders: L.orders.map((o) => humanOrder(W, o)),
      trades: L.trades.slice(-40).reverse(), status: L.paused ? 'paused' : L.probation ? 'probation' : L.dayBlock ? 'dayblock' : L.halve ? 'halve' : 'ok', streak: L.streak, peak: Math.round(L.peak), lastDate: L.lastDate
    } : null;
    return {
      id: b.id, code: b.code, name: b.name, role: b.role, method: b.method, edge: b.edge, kinds: b.kinds, bench: benchFor(b),
      bt: { full, is: isM, oos, vs, mc, curve: sampleCurve(a.equity, btEvery), recent: a.trades.slice(-25).reverse() },
      live,
      ready: Q.readiness(liveM ? { days: L.equity.length, trades: L.trades.length, pf: liveM.pf, mdd: liveM.mdd } : { days: L ? L.equity.length : 0, trades: 0 }, { mdd: full && full.mdd, oosCagr: oos && oos.cagr, sharpe: full && full.sharpe })
    };
  });
  const teamBt = Q.combine(Q.BOTS.map((b) => bt.accounts[b.id] && bt.accounts[b.id].equity));
  const teamLive = Q.combine(Q.BOTS.map((b) => state.accounts[b.id] && state.accounts[b.id].equity));
  const team = { bt: { full: Q.metrics(teamBt, []), oos: Q.metrics(sliceByDate(teamBt, split, null), []), vs: Q.versus(teamBt, benches.spx), mc: Q.monteCarlo(teamBt, 500), curve: sampleCurve(teamBt, btEvery) },
    live: teamLive.length > 1 ? { metrics: Q.metrics(teamLive, []), curve: teamLive.slice(-400) } : null };
  const benchOut = {}; Object.entries(benches).forEach(([k, c]) => { if (c) benchOut[k] = { curve: sampleCurve(c, btEvery * 2), metrics: Q.metrics(c, []) }; });
  const out = {
    v: 1, generatedAt: now.toISOString(), asOf: last, cutoff, inception: state.inception, split, btFrom,
    universe: { stocks: assets.filter((a) => a.kind === 'stock').length, coins: assets.filter((a) => a.kind === 'coin').length },
    vault: Q.VAULT, costs: Q.COST, startCash: Q.START_CASH, bots, team, bench: benchOut,
    today: fresh.slice(-60).map((e) => ({ ...e, botCode: (Q.BOTS.find((b) => b.id === e.bot) || {}).code })),
    caveats: [
      '종목 목록은 "지금" 대표 종목이라, 지난 10년 동안 사라지거나 추락한 종목이 빠져 있습니다(생존 편향) — 백테스트가 실제보다 좋게 나올 수 있습니다.',
      'CHIEF 봇의 백테스트는 과거 재무제표를 모르므로 가격·추세 점수만으로 채점했습니다(실시간 모의투자부터는 재무 포함).',
      '코인은 달러 시세 × 원/달러 환율로 계산했습니다(김치 프리미엄 제외).',
      '수수료·세금·슬리피지를 넣었지만 실제 체결은 더 나쁠 수 있습니다. 과거 성적은 미래 수익을 보장하지 않습니다.'
    ]
  };
  writeFileSync(join(root, 'js', 'paper-live.js'), '/* 자동 생성 — connect/paper.mjs (가상 계좌, 공개 시세만) */\nwindow.SNW_PAPER = ' + JSON.stringify(out) + ';\n');
  log('봇 ' + bots.length + '개 · 오늘 새 체결 ' + fresh.filter((e) => e.side !== 'vault').length + '건 · ' + ((Date.now() - t0) / 1000).toFixed(1) + '초');
  bots.forEach((b) => { if (b.bt && b.bt.full) log('  ' + b.code.padEnd(6) + ' 10년 CAGR ' + b.bt.full.cagr + '% · MDD ' + b.bt.full.mdd + '% · 샤프 ' + b.bt.full.sharpe + ' · 표본 밖 ' + (b.bt.oos ? b.bt.oos.cagr + '%' : '—') + ' · 모의 ' + (b.live ? b.live.ret + '%' : '—')); });

  // ── 4) 푸시: 새 체결 요약
  const fills = fresh.filter((e) => e.side === 'buy' || e.side === 'sell');
  if (sendPush && fills.length) {
    const code = (id) => (Q.BOTS.find((b) => b.id === id) || {}).code;
    const lines = fills.slice(-6).map((e) => code(e.bot) + ' ' + (e.side === 'buy' ? '매수 ' : '매도 ') + e.name + (e.pnl != null ? ' (' + (e.pnl >= 0 ? '+' : '') + Math.round(e.pnl / 10000).toLocaleString('ko-KR') + '만)' : ''));
    const n = await push(env, { title: '모의투자 체결 ' + fills.length + '건', body: lines.join('\n'), url: './index.html#paper', tag: 'snw-paper' }, log);
    if (n) log('푸시 ' + n + '건');
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run({ reset: process.argv.includes('--reset') }).catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
}
