#!/usr/bin/env node
/* 오늘의 추천 TOP 10 (나스닥·S&P 500·코스피·코스닥 통합) — 매일
 *  순위 규칙 = ORBIT(모멘텀 순환) 봇의 선정 규칙 그대로 (10년 시험: 연 24.8% · 샤프 1.01 · 표본 밖 1.48)
 *   ① 12-1 모멘텀(최근 12개월 수익률, 마지막 1개월 제외) 순서
 *   ② 거르기: 12-1 모멘텀 > 0 · 종가 > 200일선 (절대 모멘텀) · 그 시장 지수가 200일선 위 (시장 필터)
 *   ③ 제안 비중: 60일 변동성에 반비례 (ORBIT 과 같음, 한 종목 최대 15%)
 *  시장 필터에 걸리면(지수 200일선 아래) ORBIT 은 그 시장 종목을 사지 않음 → 목록은 "관찰 TOP 10"(시장 필터만 뺀 순위)으로 보여 주고
 *   종목마다 buy(시장 필터 통과 = 지금 규칙상 매수 후보) 여부를 표시. 모두 막히면 "오늘은 매수 추천 없음" + 금 보유 여부(금이 200일선 위면 금)
 *  세부 점수는 "검증 정도"를 함께 표시: 점수 검증(paper.mjs scoreStudy, 10년)에서 상대강도·추세 템플릿·모멘텀은 맞는 방향,
 *   앱 종합 점수는 약함, 가치·성장·퀄리티는 과거 재무 자료가 없어 검증 못 함 → 참고로만
 *  결과: data/top10-live.json (앱) · data/top10-state.json (어제 목록, 기록) · 휴대폰/텔레그램 알림(tag snw-top10)
 *  투자 권유가 아니라 규칙이 고른 목록. 진짜 주문과 연결 안 됨
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { loadQuant, loadAssets, cutoffDate, loadEnv, push } from './paper.mjs';
import { loadApp } from './alerts.mjs';
const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..');
export const BT = { bot: 'ORBIT', cagr: 24.75, mdd: -29.1, sharpe: 1.01, inS: 0.73, outS: 1.48, from: '2017-08', to: '2026-11' };
const MKT = { nasdaq: '나스닥', spx: 'S&P 500', kospi: '코스피', kosdaq: '코스닥' };
const r1 = (x, n = 1) => (x == null || !isFinite(x) ? null : +x.toFixed(n));
export function rank({ app, Q, W, d }) {
  const R = (app.window || app).Rules, SNAP = (app.window || app).SNAPSHOT, rs = Q.rsRanks(W, d), dd = Q._.dayDiff;
  const base = { markets: JSON.parse(JSON.stringify(SNAP.markets)), rates: SNAP.rates, sectors: SNAP.sectors, events: [], now: Date.now() };
  const regime = {}; for (const [m, id] of Object.entries(W.regimeOf)) { const r = W.A[id]; if (!r) continue; const i = Q.lastIdx(r, d); regime[m] = i > 200 ? r.c[i] > r.ind.sma200[i] : true; }
  const all = [], out = [];
  for (const id in W.A) { const a = W.A[id]; if (a.kind !== 'stock') continue; const i = Q.lastIdx(a, d); if (i < 260 || dd(a.t[i], d) > 7) continue;
    const I = a.ind, c = a.c[i], m = a.c[i - 21] / a.c[i - 252] - 1; all.push({ id, a, i, m, c, I }); }
  const ms = all.map((x) => x.m).sort((p, q) => p - q), pct = (v) => Math.round(ms.filter((x) => x <= v).length / ms.length * 100);
  for (const x of all) { const { a, i, m, c, I } = x, absOk = m > 0 && c > I.sma200[i], mktOk = regime[a.market] !== false;
    x.ok = absOk && mktOk; x.abs = absOk; x.checks = { abs: m > 0, ma200: c > I.sma200[i], market: mktOk }; }
  // 매수 후보(시장 필터까지 통과)를 먼저, 모자라면 시장 필터만 걸린 관찰 종목으로 10개 채움 — 각자 모멘텀 순
  const elig = all.filter((x) => x.ok).sort((p, q) => q.m - p.m), watch = all.filter((x) => x.abs && !x.ok).sort((p, q) => q.m - p.m), pick = elig.concat(watch).slice(0, 10);
  pick.forEach((x, k) => { const { a, i, c, I } = x, sl = (v) => v.slice(i - 259, i + 1);
    let sc = null; try { const ridx = W.A[W.regimeOf[a.market]]; let bench = null; if (ridx) { const bi = Q.lastIdx(ridx, d); if (bi > 0) bench = ridx.c.slice(Math.max(0, bi - 259), bi + 1); }
      sc = R.screenStock({ ...base, candles: { c: sl(a.c), h: sl(a.h), l: sl(a.l), v: sl(a.v || a.c.map(() => 0)) }, bench, rs: rs[a.id], sectorId: a.sec, currency: a.cur }); } catch (e) { sc = null; }
    const axes = {}; ((sc && sc.axes) || []).forEach((z) => { axes[z.key] = z.score; }); const scr = {}; ((sc && sc.screens) || []).forEach((z) => { if (z.total) scr[z.id] = { name: z.name || z.id, pass: z.pass, total: z.total }; });
    const tmpl = Object.values(scr).find((z) => /미너비니|트렌드/.test(z.name));
    out.push({ rank: k + 1, id: a.id, name: a.name, market: MKT[a.market] || a.market, cur: a.cur, sector: a.sec || null, price: r1(c, a.cur === 'USD' ? 2 : 0), date: a.t[i],
      mom: r1(x.m * 100), momPct: pct(x.m), ret1m: r1((c / a.c[i - 21] - 1) * 100), ret3m: r1((c / a.c[i - 63] - 1) * 100),
      ma200: r1((c / I.sma200[i] - 1) * 100), hi52: r1((c / I.hi252[i] - 1) * 100), vol: r1(I.vol60[i]),
      rs: rs[a.id] == null ? null : Math.round(rs[a.id]), tmpl: tmpl ? { pass: tmpl.pass, total: tmpl.total } : null,
      app: sc ? { total: sc.total, value: r1(axes.value, 0), growth: r1(axes.growth, 0), quality: r1(axes.quality, 0), momentum: r1(axes.momentum, 0), risk: r1(axes.risk, 0) } : null,
      checks: x.checks, buy: x.ok, stop: r1(c * 0.75, a.cur === 'USD' ? 2 : 0) }); });
  // 비중은 매수 후보끼리만 (ORBIT: 후보가 10개보다 적으면 그만큼만 투자, 나머지는 금 또는 현금)
  const buys = out.filter((x) => x.buy), invB = buys.map((x) => 1 / Math.max(10, x.vol || 30)), sB = invB.reduce((t, v) => t + v, 0);
  out.forEach((x) => { const k = buys.indexOf(x); x.weight = k >= 0 ? r1(Math.min(15, invB[k] / sB * Math.min(1, buys.length / 10) * 97)) : null; });
  const g = Object.values(W.A).find((a) => a.kind === 'gold'); let gold = null; if (g) { const gi = Q.lastIdx(g, d); if (gi > 200) gold = { above: g.c[gi] > g.ind.sma200[gi], gap: r1((g.c[gi] / g.ind.sma200[gi] - 1) * 100) }; }
  const used = out.reduce((t, x) => t + (x.weight || 0), 0), regimeGap = {};
  // 시장 필터에 실제로 쓰는 지수: 나스닥·S&P 종목 → S&P 500, 코스피·코스닥 종목 → 코스피
  for (const [nm, id] of [['S&P 500', 'IDX_spx'], ['코스피', 'IDX_kospi']]) { const r = W.A[id]; if (!r) continue; const i = Q.lastIdx(r, d); if (i > 200) regimeGap[nm] = r1((r.c[i] / r.ind.sma200[i] - 1) * 100); }
  return { list: out, n: all.length, elig: elig.length, regime, regimeGap, gold, plan: { stocks: r1(used), gold: gold && gold.above && used < 90 ? r1(Math.min(97 - used, 50)) : 0 } };
}
export async function run({ root = ROOT, dataRoot = root, now = new Date(), log = console.log, env = loadEnv(), send = true } = {}) {
  const app = loadApp(dataRoot), Q = loadQuant(ROOT), { assets, usdkrw } = loadAssets(dataRoot, app, cutoffDate(now));
  if (assets.filter((a) => a.kind === 'stock').length < 10) throw new Error('10년치 시세(js/history)가 없습니다. market.mjs 를 먼저 실행하세요.');
  const W = Q.buildWorld(assets, { usdkrw, regimeOf: { spx: 'IDX_spx', nasdaq: 'IDX_spx', kospi: 'IDX_kospi', kosdaq: 'IDX_kospi', coin: 'C_BTC' } }), d = W.cal[W.cal.length - 1];
  const R = rank({ app, Q, W, d }), sf = join(root, 'data', 'top10-state.json'); mkdirSync(join(root, 'data'), { recursive: true });
  let st = { v: 1, history: [] }; try { if (existsSync(sf)) st = JSON.parse(readFileSync(sf, 'utf8')); } catch (e) { /* 새로 */ }
  const prev = st.history.length ? st.history[st.history.length - 1] : null, prevIds = new Set(prev ? prev.ids : []), ids = R.list.map((x) => x.id);
  const added = R.list.filter((x) => !prevIds.has(x.id)).map((x) => x.name), dropped = prev ? prev.ids.filter((id) => !ids.includes(id)).map((id) => (W.A[id] || {}).name || id) : [];
  if (!prev || prev.d !== d) { st.history.push({ d, ids, px: R.list.map((x) => x.price) }); st.history = st.history.slice(-400); writeFileSync(sf, JSON.stringify(st)); }
  const live = { v: 1, at: now.toISOString(), date: d, universe: R.n, eligible: R.elig, regime: R.regime, regimeGap: R.regimeGap, gold: R.gold, plan: R.plan, list: R.list, added: prev ? added : [], dropped, bt: BT };
  writeFileSync(join(root, 'data', 'top10-live.json'), JSON.stringify(live));
  log('TOP 10 (' + d + ', 대상 ' + R.n + ' · 매수 후보 ' + R.elig + ' · 금 ' + JSON.stringify(R.gold) + '): ' + R.list.map((x) => x.rank + '.' + x.name + ' ' + x.mom + '%').join(' · ') + (added.length && prev ? ' | 새로: ' + added.join(', ') : ''));
  if (send && R.list.length && (!prev || prev.d !== d)) {
    const head = R.elig ? `매수 후보 ${Math.min(10, R.elig)}개 (규칙: 주식 ${R.plan.stocks}%${R.plan.gold ? ' · 금 ' + R.plan.gold + '%' : ''})` : `오늘은 매수 추천 없음 — 지수 200일선 아래 (${Object.entries(R.regimeGap).map(([m, v]) => m + ' ' + v + '%').join(', ')})${R.plan.gold ? ' · 규칙상 금 ' + R.plan.gold + '%' : ' · 규칙상 현금'}\n관찰 TOP 10:`;
    const body = head + '\n' + R.list.slice(0, 10).map((x) => `${x.rank}. ${x.buy ? '' : '(관찰) '}${x.name} (${x.market}) 모멘텀 ${x.mom > 0 ? '+' : ''}${x.mom}%`).join('\n') + (prev && added.length ? '\n새로 들어옴: ' + added.join(', ') : '') + (dropped.length ? '\n빠짐: ' + dropped.join(', ') : '');
    await push(env, { title: '오늘의 추천 TOP 10 · ' + d, body, url: './index.html#top10', tag: 'snw-top10' }, log); }
  return live;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run({ send: !process.argv.includes('--no-send') }).catch((e) => { console.error('TOP 10 실패: ' + e.message); process.exit(1); });
