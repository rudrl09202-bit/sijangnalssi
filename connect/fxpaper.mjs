#!/usr/bin/env node
/* 외환 캐리 모의투자 봇 (FX CARRY) — 공개 자료만, 키 필요 없음, 진짜 돈·주문과는 연결 안 됨
 *  규칙 (research/fx-strats.mjs 2차 S3 — 10년 시험 합격: 샤프 0.74 · 표본 안 0.88 · 밖 0.50 · 연 3.6% · 낙폭 −9%):
 *   11개 통화(원·엔·위안·멕시코·폴란드·헝가리·체코·이스라엘·칠레·남아공·인도네시아) 중
 *   매달 첫 거래일, (그 나라 3개월 금리 − 미국 3개월 금리) 상위 3개 매수 · 하위 3개 매도 (모두 달러 상대)
 *   각 비중 = (연 10% / 그 통화 60일 변동성) ÷ 6, 합계 최대 2배 · 바꾼 비중 × 0.10% 비용
 *   매일 수익 = 비중 × (환율 변화 + 이자 차이/252). 금리는 한 달 늦게 씀(발표 지연)
 *  자료: 야후 일봉(환율), FRED IR3TIB01<나라>M156N(OECD 3개월 금리, 월별)
 *  상태: data/fx-state.json · 결과: data/fx-live.json (앱이 읽음)
 *  실행: node connect/fxpaper.mjs   (--reset: 오늘부터 새로 시작)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { chart } from './market.mjs';
const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..');
export const FXC = [
  { id: 'krw', sym: 'KRW=X', c: 'KR', ko: '원화', iso: 'KR' }, { id: 'jpy', sym: 'JPY=X', c: 'JP', ko: '엔화', iso: 'JP' }, { id: 'cny', sym: 'CNY=X', c: 'CN', ko: '위안화', iso: 'CN' },
  { id: 'mxn', sym: 'MXN=X', c: 'MX', ko: '멕시코 페소', iso: 'MX' }, { id: 'pln', sym: 'PLN=X', c: 'PL', ko: '폴란드 즐로티', iso: 'PL' }, { id: 'huf', sym: 'HUF=X', c: 'HU', ko: '헝가리 포린트', iso: 'HU' },
  { id: 'czk', sym: 'CZK=X', c: 'CZ', ko: '체코 코루나', iso: 'CZ' }, { id: 'ils', sym: 'ILS=X', c: 'IL', ko: '이스라엘 셰켈', iso: 'IL' }, { id: 'clp', sym: 'CLP=X', c: 'CL', ko: '칠레 페소', iso: 'CL' },
  { id: 'zar', sym: 'ZAR=X', c: 'ZA', ko: '남아공 랜드', iso: 'ZA' }, { id: 'idr', sym: 'IDR=X', c: 'ID', ko: '인도네시아 루피아', iso: 'ID' }
];
export const CFG = { nLong: 3, nShort: 3, volTarget: 0.10, maxGross: 2, cost: 0.001, start: 100000000 };
export const BT = { from: '2017-11', to: '2026-11', cagr: 3.6, mdd: -9.0, sharpe: 0.74, inS: 0.88, outS: 0.50, note: '표본 밖 샤프가 합격선(0.5)에 딱 걸침 — 지켜볼 것' };
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
async function fredRates(c, fetchImpl) { const r = await fetchImpl('https://fred.stlouisfed.org/graph/fredgraph.csv?id=IR3TIB01' + c + 'M156N', { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; sijangnalssi/1.0)' } }); if (!r.ok) throw new Error('금리 ' + c + ' HTTP ' + r.status);
  return (await r.text()).trim().split('\n').slice(1).map((l) => l.split(',')).filter((x) => x[1] && !isNaN(+x[1])).map(([d, v]) => [d.slice(0, 7), +v]); }
// 날짜 d 에 쓸 수 있는 금리 = 전달까지 발표된 마지막 값
export function rateAt(rows, d) { const [y, m] = d.slice(0, 7).split('-').map(Number), lag = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7); let v = null; for (const [k, x] of rows) { if (k <= lag) v = x; else break; } return v; }
export function vol60(px, i) { let s = 0, s2 = 0, n = 0; for (let k = i - 59; k <= i; k++) { if (k < 1 || !px[k] || !px[k - 1]) continue; const r = px[k - 1] / px[k] - 1; s += r; s2 += r * r; n++; } if (n < 40) return null; const m = s / n; return Math.sqrt(Math.max(s2 / n - m * m, 1e-12)) * Math.sqrt(252); }
// 목표 비중: { id: w } (+ 매수 / − 매도)
export function targetWeights(rows, i, day, rates, rUS) {
  const ok = FXC.map((f) => [f, rateAt(rates[f.c] || [], day), vol60(rows[f.id], i)]).filter(([, r, v]) => r != null && v != null && rUS != null).map(([f, r, v]) => ({ f, diff: r - rUS, v })).sort((a, b) => b.diff - a.diff);
  const W = {}; if (ok.length < CFG.nLong + CFG.nShort) return { W, ok };
  ok.slice(0, CFG.nLong).forEach((x) => { W[x.f.id] = (CFG.volTarget / x.v) / (CFG.nLong + CFG.nShort); });
  ok.slice(-CFG.nShort).forEach((x) => { W[x.f.id] = -(CFG.volTarget / x.v) / (CFG.nLong + CFG.nShort); });
  const g = Object.values(W).reduce((a, b) => a + Math.abs(b), 0); if (g > CFG.maxGross) Object.keys(W).forEach((k) => { W[k] *= CFG.maxGross / g; });
  return { W, ok };
}
export async function run({ root = ROOT, now = new Date(), log = console.log, fetchImpl = fetch, reset = false } = {}) {
  const sf = join(root, 'data', 'fx-state.json'), lf = join(root, 'data', 'fx-live.json'); mkdirSync(join(root, 'data'), { recursive: true });
  let st = null; try { if (!reset && existsSync(sf)) st = JSON.parse(readFileSync(sf, 'utf8')); } catch (e) { st = null; }
  // 1) 자료
  const cut = ymd(now.getTime() - 864e5); // 어제(UTC)까지 마감된 일봉만
  const px = {}, dates = new Set();
  for (const f of FXC) { const r = await chart(f.sym, fetchImpl, '1y'); const m = new Map(); r.t.forEach((t, i) => { const d = ymd(t * 1000); if (d <= cut && r.c[i] > 0) { m.set(d, r.c[i]); dates.add(d); } }); px[f.id] = m; }
  const CAL = [...dates].sort(), rows = {}; FXC.forEach((f) => { let last = null; rows[f.id] = CAL.map((d) => { const v = px[f.id].get(d); if (v) last = v; return last; }); });
  const rates = {}; for (const c of ['US', ...FXC.map((f) => f.c)]) { try { rates[c] = await fredRates(c, fetchImpl); } catch (e) { log('✗ ' + e.message); rates[c] = (st && st.rates && st.rates[c]) || []; } }
  // 2) 계좌 이어서
  if (!st) { st = { v: 1, startDate: CAL.at(-1), equity: CFG.start, W: {}, lastDate: CAL.at(-1), lastMonth: null, trades: [], curve: [[CAL.at(-1), CFG.start]], events: [] }; log('외환 봇: 새 계좌 ' + st.startDate); }
  const i0 = CAL.indexOf(st.lastDate); let newDays = 0;
  const step = (i) => { const d = CAL[i], rUS = rateAt(rates.US, d); let r = 0;
    for (const [id, w] of Object.entries(st.W)) { const p = rows[id], f = FXC.find((x) => x.id === id), rf = rateAt(rates[f.c] || [], d); if (!p[i] || !p[i - 1]) continue; r += w * (p[i - 1] / p[i] - 1 + (rf != null && rUS != null ? (rf - rUS) / 100 / 252 : 0)); }
    st.equity *= 1 + r; st.lastDate = d; st.curve.push([d, Math.round(st.equity)]); newDays++; };
  const rebalance = (i) => { const d = CAL[i], rUS = rateAt(rates.US, d), { W, ok } = targetWeights(rows, i, d, rates, rUS); if (!Object.keys(W).length) return;
    const ids = new Set([...Object.keys(W), ...Object.keys(st.W)]); let turn = 0;
    ids.forEach((id) => { const a = st.W[id] || 0, b = W[id] || 0; turn += Math.abs(b - a); if (Math.sign(a) !== Math.sign(b)) { const f = FXC.find((x) => x.id === id); st.trades.push({ d, id, ko: f.ko, from: Math.sign(a), to: Math.sign(b), diff: +(((ok.find((x) => x.f.id === id) || {}).diff) ?? 0).toFixed(2) }); } });
    st.equity *= 1 - turn * CFG.cost; st.W = Object.fromEntries(Object.entries(W).map(([k, v]) => [k, +v.toFixed(4)])); st.lastMonth = d.slice(0, 7);
    st.view = ok.map((x) => ({ id: x.f.id, ko: x.f.ko, iso: x.f.iso, diff: +x.diff.toFixed(2), vol: +(x.v * 100).toFixed(1) })); };
  if (i0 < 0 && st.lastDate < CAL[0]) log('외환 봇: 마지막 기록이 1년보다 오래돼 이어갈 수 없음 → --reset 필요');
  for (let i = Math.max(1, i0 + 1); i < CAL.length; i++) step(i);
  if (st.lastMonth !== CAL.at(-1).slice(0, 7)) rebalance(CAL.length - 1); // 이달 첫 처리일 = 매달 첫 거래일 (처음 시작할 때도 바로 맞춤)
  st.trades = st.trades.slice(-60); st.curve = st.curve.slice(-800); st.rates = rates;
  writeFileSync(sf, JSON.stringify({ ...st, rates: undefined }));
  const pos = Object.entries(st.W).map(([id, w]) => { const f = FXC.find((x) => x.id === id), v = (st.view || []).find((x) => x.id === id) || {}; return { id, ko: f.ko, iso: f.iso, side: w > 0 ? 'long' : 'short', w: +(w * 100).toFixed(1), diff: v.diff }; }).sort((a, b) => b.w - a.w);
  const live = { v: 1, at: new Date(now).toISOString(), startDate: st.startDate, lastDate: st.lastDate, equity: Math.round(st.equity), ret: +((st.equity / CFG.start - 1) * 100).toFixed(2), positions: pos, view: st.view || [], trades: st.trades.slice(-20).reverse(), curve: st.curve.slice(-260), bt: BT, cfg: CFG };
  writeFileSync(lf, JSON.stringify(live));
  log('외환 봇: ' + st.lastDate + ' · ' + live.ret + '% · 새 거래일 ' + newDays + ' · 보유 ' + pos.map((p) => (p.side === 'long' ? '+' : '−') + p.ko).join(' '));
  return live;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run({ reset: process.argv.includes('--reset') }).catch((e) => { console.error('외환 봇 실패: ' + e.message); process.exit(1); });
