#!/usr/bin/env node
/* 봇 성적표 — 등록부(connect/bots.json)의 모든 봇을 CLAUDE.md 2장 "실제 돈을 넣는 기준"으로 매일 채점
 *  자료: bot-data 브랜치의 *-live.json(코인 봇), data/futures-live.json, data/paper-state.json(주식 봇), data/fx-state.json
 *  기록: data/scorecard-state.json — 봇마다 날짜별 마지막 평가액을 계속 쌓음 (원본 곡선이 잘려도 3개월 기록이 남게)
 *        봇의 시작 시각(inception)이 바뀌면 = 계좌를 새로 시작한 것 → 그 봇 기록을 처음부터 다시
 *  결과: data/scorecard.json (앱 "봇 성적표")
 *  채점: ① 기록 90일 ② 샤프 0.5 이상(일별 수익, 연율: 코인 365일·주식/외환 252일) ③ 최대 낙폭이 백테스트의 1.5배 이내
 *        ④ 거래 수(코인 20번, 월 1회 교체 봇은 교체한 달 3번). 값이 없으면 "판단 보류". 낙폭 한도는 90일 전에도 넘으면 바로 표시
 *  보여 주기·판단용. 봇 동작은 바꾸지 않음
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..');
const r2 = (x, n = 2) => (x == null || !isFinite(x) ? null : +x.toFixed(n));
const day = (s) => String(s).slice(0, 10);
// 원본에서 { inception, points:[[날짜, 평가액]], trades:[{d}] } 로
export async function readBot(b, { root, botdata }) {
  const [type, arg] = b.src.split(':'), J = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
  if (type === 'botdata') { const d = await botdata(arg); if (!d || !d.live) return null; const L = d.live;
    return { inception: d.inception || null, points: (L.curve || []).map(([t, v]) => [day(t), v]), trades: (Array.isArray(L.trades) ? L.trades : []).map((z) => ({ d: day(z.out || z.exitT || z.t || z.in || '') })), equity: L.equity, start: L.start }; }
  if (type === 'futures') { const d = J(join(root, 'data', 'futures-live.json')), L = d && d[arg]; if (!L) return null;
    return { inception: (L.curve && L.curve[0] && L.curve[0][0]) || null, points: (L.curve || []).map(([t, v]) => [day(t), v]), trades: (L.trades || L.recent || []).map((z) => ({ d: day(z.out || z.in || '') })), equity: L.equity, start: L.start, nTrades: L.metrics && L.metrics.trades }; }
  if (type === 'paper') { const d = J(join(root, 'data', 'paper-state.json')), A = d && d.accounts && d.accounts[arg]; if (!A) return null;
    return { inception: A.since || d.inception || null, points: (A.equity || []).map(([t, v]) => [day(t), v]), trades: (A.trades || []).flatMap((z) => [{ d: day(z.in) }, { d: day(z.out) }]).filter((z) => z.d), equity: A.lastEq || A.cash, start: A.start, sells: (A.trades || []).length }; }
  if (type === 'fx') { const d = J(join(root, 'data', 'fx-state.json')); if (!d) return null;
    return { inception: d.startDate, points: (d.curve || []).map(([t, v]) => [day(t), v]), trades: (d.trades || []).map((z) => ({ d: day(z.d) })), equity: d.equity, start: 1e8 }; }
  return null;
}
export function metrics(series, ann) { // series: [[날짜, 평가액]] 날짜순
  if (series.length < 2) return { ret: 0, sharpe: null, mdd: 0 };
  const v = series.map((x) => x[1]), rets = v.slice(1).map((x, i) => x / v[i] - 1); let pk = v[0], mdd = 0; v.forEach((x) => { pk = Math.max(pk, x); mdd = Math.min(mdd, x / pk - 1); });
  const m = rets.reduce((a, b) => a + b, 0) / rets.length, sd = Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / rets.length);
  return { ret: r2((v.at(-1) / v[0] - 1) * 100), sharpe: rets.length >= 20 && sd > 0 ? r2(m / sd * Math.sqrt(ann)) : null, mdd: r2(mdd * 100) };
}
export function judge(b, x, C) {
  const lim = b.btMdd != null ? r2(b.btMdd * C.mddFactor, 1) : null, need = b.monthly ? C.minSwapsMonthly : b.kind === 'coin' ? C.minTradesCoin : null;
  const c = { days: x.days >= C.minDays, sharpe: x.sharpe == null ? null : x.sharpe >= C.minSharpe, mdd: lim == null ? null : x.mdd >= lim, trades: need == null ? null : x.count >= need };
  let verdict, why = '';
  if (b.retired) verdict = '은퇴';
  else if (c.mdd === false) { verdict = '미달'; why = '낙폭 한도(' + lim + '%)를 넘음'; }
  else if (!c.days) verdict = '기록 중';
  else if (Object.values(c).some((v) => v === false)) { verdict = '미달'; why = [c.sharpe === false && '샤프 부족', c.trades === false && '거래 수 부족'].filter(Boolean).join(' · '); }
  else if (Object.values(c).some((v) => v === null)) { verdict = '판단 보류'; why = [c.mdd === null && '백테스트 낙폭 기록 없음', c.sharpe === null && '샤프 계산할 기록 부족'].filter(Boolean).join(' · '); }
  else verdict = '통과';
  return { c, verdict, why, mddLimit: lim, need };
}
export async function run({ root = ROOT, now = new Date(), log = console.log, fetchImpl = fetch, botdata = null } = {}) {
  const REG = JSON.parse(readFileSync(join(HERE, 'bots.json'), 'utf8')), C = REG.criteria, sf = join(root, 'data', 'scorecard-state.json'); mkdirSync(join(root, 'data'), { recursive: true });
  const repo = process.env.GITHUB_REPOSITORY || 'rudrl09202-bit/sijangnalssi';
  const getBD = botdata || (async (f) => { try { const r = await fetchImpl('https://raw.githubusercontent.com/' + repo + '/bot-data/' + f + '?t=' + Math.floor(now.getTime() / 6e5)); return r.ok ? await r.json() : null; } catch (e) { return null; } });
  let st = { v: 1, bots: {} }; try { if (existsSync(sf)) st = JSON.parse(readFileSync(sf, 'utf8')); } catch (e) { /* 새로 */ }
  const today = now.toISOString().slice(0, 10), out = [];
  for (const b of REG.bots) { let x = null; try { x = await readBot(b, { root, botdata: getBD }); } catch (e) { log('✗ ' + b.id + ': ' + e.message); }
    const S = (st.bots[b.id] = st.bots[b.id] || { inception: null, daily: {}, trades: {} });
    if (x) { if (S.inception && x.inception && S.inception !== x.inception) { log('계좌 새로 시작: ' + b.id + ' ' + S.inception + ' → ' + x.inception + ' (기록 처음부터)'); S.daily = {}; S.trades = {}; }
      S.inception = x.inception || S.inception; x.points.forEach(([d, v]) => { if (d && v > 0) S.daily[d] = Math.round(v); }); if (x.equity > 0) S.daily[today] = Math.round(x.equity);
      x.trades.forEach((z, i) => { if (z.d) S.trades[z.d + '#' + i] = 1; }); if (x.nTrades != null) S.nTrades = x.nTrades; if (x.sells != null) S.sells = x.sells; }
    const series = Object.entries(S.daily).sort((p, q) => (p[0] < q[0] ? -1 : 1)), first = series.length ? series[0][0] : null;
    const m = metrics(series, b.kind === 'coin' ? 365 : 252), days = first ? Math.round((Date.parse(today) - Date.parse(first)) / 864e5) : 0;
    const tDates = Object.keys(S.trades).map((k) => k.split('#')[0]), months = new Set(tDates.map((d) => d.slice(0, 7))).size;
    const nTr = b.src.startsWith('paper:') ? (S.sells || 0) : S.nTrades != null ? Math.max(S.nTrades, tDates.length) : tDates.length, count = b.monthly ? months : nTr;
    const row = { id: b.id, name: b.name, kind: b.kind, role: b.role, what: b.what, note: b.note || null, since: first, days, ...m, trades: nTr, swapMonths: b.monthly ? months : null, count, btMdd: b.btMdd, btSharpe: b.btSharpe, found: !!x };
    out.push({ ...row, ...judge(b, row, C) }); }
  writeFileSync(sf, JSON.stringify(st));
  const live = { v: 1, at: now.toISOString(), period: REG.period, criteria: C, bots: out, summary: out.reduce((a, r) => { a[r.verdict] = (a[r.verdict] || 0) + 1; return a; }, {}) };
  writeFileSync(join(root, 'data', 'scorecard.json'), JSON.stringify(live));
  log('성적표: ' + out.length + '개 — ' + Object.entries(live.summary).map(([k, v]) => k + ' ' + v).join(' · ')); out.forEach((r) => log('  ' + r.id.padEnd(8) + String(r.days).padStart(3) + '일 ' + String(r.ret).padStart(7) + '% 샤프 ' + String(r.sharpe).padStart(5) + ' 낙폭 ' + String(r.mdd).padStart(6) + '% 거래 ' + String(r.trades).padStart(3) + ' → ' + r.verdict + (r.why ? ' (' + r.why + ')' : '') + (r.found ? '' : ' [자료 없음]')));
  return live;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run().catch((e) => { console.error('성적표 실패: ' + e.message); process.exit(1); });
