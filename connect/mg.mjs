/* 민경기 매매법 — 류신영 봇(4시간봉) 50% + 상대 모멘텀 50% · 두 쪽 모두 크기 1.25배 · 모의투자 전용
 *  어디서 나왔나: research/portfolio.mjs (2026-11-26) — 6년(2021-03~2026-11) 시험에서
 *    연 34% · 최대 낙폭 −19% · 샤프 1.53 · 기록을 1000번 섞었을 때 낙폭 −25% 넘을 확률 4%
 *  + 세계 경제 필터 (11/26 추가, 시작 전): 위안화 급약세·달러 급등·미 금리 급등·나스닥 약세장 중 2개 이상이면 류신영 몫의 새 롱 쉼 → 6년 연 35% · 샤프 1.56
 *  방식: 두 봇이 각자 1.25배 크기로 1억씩 매매한 결과(rs-live.json·pair-live.json 의 mg)를 4시간마다 반반으로 다시 맞춰 합침
 *  2027-02-25 판정 때 상대 모멘텀이 실제로도 제 몫을 하면 크기 1.375 로 올릴지 정함 (지금은 1.25 고정)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..');
export const MG = { start: Date.parse(process.env.MG_START || '2026-11-26T12:00:00Z'), k: 1.25, w: { rs: 0.5, pr: 0.5 }, cap: 1e8, watchUntil: '2027-02-25' };
const tOf = (s) => Date.parse(String(s).replace(' ', 'T') + (String(s).length <= 16 ? ':00Z' : ''));
const isoT = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
const r2 = (x, n = 2) => (x == null || !isFinite(x) ? null : Math.round(x * 10 ** n) / 10 ** n);
export function combine(subs, now = Date.now()) {
  const ser = Object.fromEntries(Object.entries(subs).map(([id, s]) => [id, (s.curve || []).map(([t, v]) => [tOf(t), v]).filter((x) => isFinite(x[0])).sort((a, b) => a[0] - b[0])]));
  const T = [...new Set(Object.values(ser).flatMap((c) => c.map((x) => x[0])))].filter((t) => t >= MG.start).sort((a, b) => a - b);
  const at = (c, t) => { let v = null; for (const [tt, x] of c) { if (tt <= t) v = x; else break; } return v; };
  let eq = MG.cap; const curve = [[isoT(MG.start), eq]]; let prev = Object.fromEntries(Object.keys(ser).map((id) => [id, at(ser[id], MG.start) ?? subs[id].start ?? MG.cap]));
  for (const t of T) { let r = 0; for (const id of Object.keys(ser)) { const v = at(ser[id], t) ?? prev[id]; r += MG.w[id] * (v / prev[id] - 1); prev[id] = v; } eq *= 1 + r; curve.push([isoT(t), Math.round(eq)]); }
  // 지금 값 (각 봇의 현재 평가 포함)
  { let r = 0; for (const id of Object.keys(ser)) { const v = subs[id].equity ?? prev[id]; r += MG.w[id] * (v / prev[id] - 1); } eq *= 1 + r; }
  const NM = { rs: '류신영', pr: '상대 모멘텀' }, part = (id, x) => ({ ...x, bot: id, botName: NM[id] });
  const trades = Object.entries(subs).flatMap(([id, s]) => (s.trades || []).filter((z) => tOf(z.in) >= MG.start).map((z) => part(id, { ...z, pnl: Math.round(z.pnl * MG.w[id]), qty: undefined }))).sort((a, b) => tOf(b.out) - tOf(a.out));
  const positions = Object.entries(subs).flatMap(([id, s]) => (s.positions || []).map((p) => part(id, { ...p, notional: Math.round((p.notional || 0) * MG.w[id]), upnl: Math.round((p.upnl || 0) * MG.w[id]), lev: r2((p.lev || 0) * MG.w[id], 2) })));
  return { equity: Math.round(eq), start: MG.cap, ret: r2((eq / MG.cap - 1) * 100, 2), curve, trades, n: trades.length, positions, status: 'ok' };
}
export async function run({ dir = process.env.SCALP_DIR || process.env.MK_DIR || join(ROOT, 'data'), now = new Date(), log = console.log } = {}) {
  const rd = (f) => { const p = join(dir, f); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null; };
  const RS = rd('rs-live.json'), PR = rd('pair-live.json');
  if (!RS || !RS.mg || !PR || !PR.mg) { log('민경기 매매법: 두 봇의 1.25배 기록이 아직 없어 건너뜀'); return null; }
  const live = combine({ rs: RS.mg, pr: PR.mg }, now.getTime());
  const out = { v: 1, generatedAt: now.toISOString(), inception: isoT(MG.start), watchUntil: MG.watchUntil, cfg: { k: MG.k, w: MG.w, rsRisk: RS.mg.riskPct, prLev: PR.mg.lev },
    bt: { label: '6년 시험 (2021-03~2026-11)', cagr: 35.1, mdd: -18.7, sharpe: 1.56, pBad: 4, h1: '34%/−11%', h2: '36%/−19%' }, macro: RS.mg.macro || null,
    parts: { rs: { ret: RS.mg.ret, equity: RS.mg.equity }, pr: { ret: PR.mg.ret, equity: PR.mg.equity } }, live };
  writeFileSync(join(dir, 'mg-live.json'), JSON.stringify(out));
  log('민경기 매매법: 모의 ' + live.ret + '% · 거래 ' + live.n + ' · 포지션 ' + live.positions.length);
  return out;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run().catch((e) => { console.error('✗ 민경기 매매법: ' + e.message); process.exitCode = 1; });
