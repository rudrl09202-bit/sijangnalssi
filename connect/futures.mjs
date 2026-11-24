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

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const require = createRequire(import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
const GOAL = 10; // 사용자가 잡은 월 목표(%)

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
  L.events = []; st.updatedAt = now.toISOString();
  mkdirSync(join(root, 'data'), { recursive: true });
  writeFileSync(stateFile, JSON.stringify(st));

  // ── 4) 성적표
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
  const out = {
    v: 1, generatedAt: now.toISOString(), lastBar: isoT(W.T[lastIdx]), inception: isoT(st.inception), goal: GOAL, cfg, preset: P,
    coins: F.COINS.filter((c) => h4[c.sym]).map((c) => ({ sym: c.sym, name: c.name, price: mark(c.sym) })),
    bt: { from: start, split, metrics: full, oos, months, mc, holdBtc, curve: sample(dcurve, 300), recent: btA.trades.slice(-30).reverse(), liq: btA.liquidations, kills: btA.killed,
      funding: Math.round(btA.fundingPaid), fees: Math.round(btA.feesPaid), longs: btA.trades.filter((x) => x.side === 'long').length, shorts: btA.trades.filter((x) => x.side === 'short').length },
    d1: d1r, ladder,
    live: { equity: eqNow, start: L.start, ret: Math.round((eqNow / L.start - 1) * 10000) / 100, days: ldc.length, metrics: lm, curve: L.equity.slice(-540).map(([t, v]) => [isoT(t), v]),
      positions, lev: Math.round(lev * 100) / 100, pending: L.pending.filter((o) => o.kind === 'open').map((o) => ({ sym: o.sym, name: o.name, side: o.side, why: o.why })),
      trades: L.trades.slice(-40).reverse(), status: L.killUntil > lastIdx ? 'killed' : L.dayBlock ? 'dayblock' : L.half ? 'half' : 'ok', liq: L.liquidations, peak: Math.round(L.peak),
      funding: Math.round(L.fundingPaid), fees: Math.round(L.feesPaid), months: F.monthStats(ldc, GOAL) },
    today: fresh.slice(-30),
    errors
  };
  out.ready = F.readiness({ days: ldc.length, trades: L.trades.length, pf: lm && lm.pf, mdd: lm && lm.mdd, liq: L.liquidations }, { mdd: full && full.mdd, oosCagr: oos && oos.cagr, d1Cagr: d1r && d1r.metrics && d1r.metrics.cagr });
  writeFileSync(join(root, 'data', 'futures-live.json'), JSON.stringify(out));
  log('선물 모의: 자산 ' + Math.round(eqNow / 1e4).toLocaleString('ko-KR') + '만 (' + out.live.ret + '%) · 포지션 ' + positions.length + ' · 레버리지 ' + out.live.lev + '배 · 새 이벤트 ' + fresh.length + ' · ' + ((Date.now() - t0) / 1000).toFixed(1) + '초');

  // ── 5) 푸시
  const moves = fresh.filter((e) => e.kind === 'open' || e.kind === 'close' || e.kind === 'vault');
  if (sendPush && moves.length) {
    const side = (s) => (s === 'long' ? '롱' : '숏');
    const lines = moves.slice(-6).map((e) => e.kind === 'open' ? `${side(e.side)} 진입 ${e.name} · ${e.lev}배 · 손절 ${e.stop}` : e.kind === 'close' ? `${side(e.side)} 청산 ${e.name} ${e.pnl >= 0 ? '+' : ''}${Math.round(e.pnl / 1e4).toLocaleString('ko-KR')}만 (${e.reason})` : '금고: ' + e.msg);
    const n = await push(env, { title: 'FLUX 선물 모의 ' + moves.length + '건', body: lines.join('\n'), url: './index.html#futures', tag: 'snw-futures' }, log);
    if (n) log('푸시 ' + n + '건');
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run({ reset: process.argv.includes('--reset') }).catch((e) => { console.error('✗ ' + e.message); process.exit(1); });
}
