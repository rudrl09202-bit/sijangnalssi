// 플라이트 ③(추세선 지지 + 거래량 증가) 계좌 단위 시험: 1억 · 거래당 위험 1% · 동시 4개 · 총 3배 · 펀딩비
// + 설정 흔들어 보기 · 50배 시드 분산(②) · 수익 출금(⑦) · 류신영 봇과 같이 굴렸을 때
import { readFileSync } from 'node:fs';
import { prepareRS, simulate as rsSim, RCFG, statsOf } from '/home/claude/sijangnalssi/connect/rs.mjs';
const DIR = '/tmp/rd', COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'ADA', 'LINK'], DAY = 864e5;
const deriv = JSON.parse(readFileSync(DIR + '/deriv.json', 'utf8'));
const series = {}; for (const s of COINS) { const r = JSON.parse(readFileSync(`${DIR}/k4-${s}.json`, 'utf8')); series[s] = { t: r.t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }; }
const W = prepareRS(series);
for (const s of COINS) { const x = W.X[s]; let a = 0; x.vA20 = x.d.v.map((v, i) => { a += v; if (i >= 20) a -= x.d.v[i - 20]; return i >= 19 ? a / 20 : null; }); }
function fundRate(s, t) { const f = deriv.coins[s]?.f; if (!f || t < f[0][0]) return 0.0001; let lo = 0, hi = f.length - 1, k = 0; while (lo <= hi) { const m = (lo + hi) >> 1; if (f[m][0] <= t) { k = m; lo = m + 1; } else hi = m - 1; } return f[k][1]; }

const DEF = { tol: 0.3, volx: 1.2, stopA: 1, exitA: 1, trail: 0, maxBars: 30, riskPct: 1, maxPos: 4, maxLev: 3, taker: 0.0005, slipIn: 0.0002, slipStop: 0.0005, lev50: false, skim: false };
function sig(P, s, j) { const x = W.X[s], d = x.d, a = x.atr[j]; if (j < 220 || !x.e200[j] || !a || !x.vA20[j]) return null; const vUp = d.v[j] > P.volx * x.vA20[j];
  if (x.e50[j] > x.e200[j] && d.l[j] <= x.e50[j] + P.tol * a && d.c[j] > x.e50[j] && d.c[j] > d.o[j] && vUp) return { g: 1, stop: Math.min(d.l[j], x.e50[j]) - P.stopA * a };
  if (x.e50[j] < x.e200[j] && d.h[j] >= x.e50[j] - P.tol * a && d.c[j] < x.e50[j] && d.c[j] < d.o[j] && vUp) return { g: -1, stop: Math.max(d.h[j], x.e50[j]) + P.stopA * a };
  return null; }
export function sim(o = {}, tA = -Infinity) {
  const P = { ...DEF, ...o }, { X, T } = W; let cash = 1e8, out = 0, skimMark = 1e8; const pos = {}, trades = [], eqs = []; let pend = [], prev = null;
  const eqAt = (t) => { let e = cash; for (const s in pos) { const p = pos[s], j = X[s].m.get(t), c = j != null ? X[s].d.c[j] : p.last; e += p.g * (c - p.e) * p.q - p.fund; } return e; };
  const close = (s, px, t) => { const p = pos[s], gross = p.g * (px - p.e) * p.q, fee = px * p.q * P.taker; cash += gross - fee - p.fund; trades.push({ s, t0: p.t0, pnl: gross - fee - p.fee0 - p.fund, R: (gross - fee - p.fee0 - p.fund) / p.risk }); delete pos[s]; };
  for (const t of T) {
    for (const o2 of pend) { if (pos[o2.s] || Object.keys(pos).length >= P.maxPos) continue; const x = X[o2.s], j = x.m.get(t); if (j == null) continue;
      const eq = eqAt(prev), e = x.d.o[j] * (1 + o2.g * P.slipIn), Rd = Math.abs(e - o2.stop); if (!(Rd > 0) || o2.g * (e - o2.stop) <= 0) continue;
      let q, liq = null;
      if (P.lev50) { const margin = eq * 0.2; q = margin * 50 / e; liq = e * (1 - o2.g * (1 / 50 - 0.005)); } // ② 시드의 20%를 50배로 (격리, 청산가)
      else { q = eq * P.riskPct / 100 / Rd; const used = Object.values(pos).reduce((a, p) => a + p.e * p.q, 0); q = Math.min(q, Math.max(0, (eq * P.maxLev - used) / e)); }
      if (q * e < eq * 0.01) continue; const fee0 = e * q * P.taker; cash -= fee0;
      pos[o2.s] = { g: o2.g, e, q, stop: o2.stop, liq, best: e, t0: t, j0: j, risk: P.lev50 ? eq * 0.2 : Rd * q, fee0, fund: 0, last: e }; }
    pend = [];
    for (const s of Object.keys(pos)) { const x = X[s], j = x.m.get(t); if (j == null) continue; const p = pos[s], g = p.g, d = x.d, o = d.o[j], h = d.h[j], l = d.l[j], c = d.c[j];
      if (new Date(t).getUTCHours() % 8 === 0) p.fund += g * fundRate(s, t) * o * p.q;
      if (p.liq != null && (g > 0 ? l <= p.liq : h >= p.liq)) { const loss = p.q * p.e / 50; cash -= loss + p.fund - 0; trades.push({ s, t0: p.t0, pnl: -loss - p.fee0 - p.fund, R: -1, liq: true }); delete pos[s]; continue; }
      if (j > p.j0 && (g > 0 ? o <= p.stop : o >= p.stop)) { close(s, o * (1 - g * P.slipStop), t); continue; }
      if (g > 0 ? l <= p.stop : h >= p.stop) { close(s, p.stop * (1 - g * P.slipStop), t); continue; }
      p.best = g > 0 ? Math.max(p.best, h) : Math.min(p.best, l); p.last = c;
      if (P.trail && x.atr[j]) { const ns = p.best - g * x.atr[j] * P.trail; if (g > 0 ? ns > p.stop : ns < p.stop) p.stop = ns; }
      const brk = g > 0 ? c < x.e50[j] - P.exitA * x.atr[j] : c > x.e50[j] + P.exitA * x.atr[j];
      if (brk || j - p.j0 >= P.maxBars - 1) close(s, c * (1 - g * P.slipIn), t); }
    if (t >= tA) { const cand = []; for (const s of COINS) { if (pos[s]) continue; const j = X[s].m.get(t); if (j == null) continue; const z = sig(P, s, j); if (z) cand.push({ s, ...z }); } pend = cand; }
    let e = eqAt(t);
    if (P.skim && !Object.keys(pos).length && e > skimMark * 1.5) { const w = (e - skimMark) * 0.2; cash -= w; out += w; e -= w; skimMark = e; } // ⑦ 50% 벌 때마다 번 돈의 20% 출금
    eqs.push([t, e, out]); prev = t;
    if (e <= 1e6) { break; }
  }
  return { trades, eqs, out };
}
const F0 = Date.parse('2020-06-01'), T1 = W.T.at(-1) + 1, mid = (F0 + T1) / 2;
const st = (r, a = F0, b = T1, tot = false) => { const eq = r.eqs.filter(([t]) => t >= a && t < b).map(([t, v, o]) => [t, tot ? v + o : v]); return statsOf(eq, r.trades.filter((z) => z.t0 >= a && z.t0 < b), {}) || {}; };
const show = (name, o) => { const r = sim(o, F0), A = st(r), h1 = st(r, F0, mid), h2 = st(r, mid, T1); console.log(name.padEnd(28), '연', A.cagr + '%', '낙폭', A.mdd + '%', '샤프', A.sharpe, 'PF', A.pf, '거래', A.n, '| 앞', h1.ret + '%', '뒤', h2.ret + '%'); return r; };
console.log('기간', new Date(F0).toISOString().slice(0, 10), '~', new Date(T1).toISOString().slice(0, 10));
const base = show('③ 기본 (지지0.3ATR·거래량1.2배)', {});
show('거래량 1.0배', { volx: 1.0 }); show('거래량 1.5배', { volx: 1.5 }); show('지지 범위 0.5ATR', { tol: 0.5 }); show('지지 범위 0.1ATR', { tol: 0.1 });
show('추세 이탈 기준 0.5ATR', { exitA: 0.5 }); show('추세 이탈 기준 2ATR', { exitA: 2 }); show('+ 추적 손절 3ATR', { trail: 3 }); show('보유 최대 60봉', { maxBars: 60 });
show('비용 2배', { taker: 0.001, slipIn: 0.0004, slipStop: 0.001 }); show('위험 0.75%', { riskPct: 0.75 });
const L = show('② 시드 20% × 50배', { lev50: true }); console.log('   50배 청산 횟수', L.trades.filter((z) => z.liq).length, '/', L.trades.length, '· 마지막 자산', Math.round(L.eqs.at(-1)[1] / 1e4) + '만');
const S = sim({ skim: true }, F0); const a = st(S, F0, T1, true), e = st(S); console.log('⑦ 수익 출금(50%마다 20%)'.padEnd(28), '계좌+출금 합계 연', a.cagr + '%', '낙폭', a.mdd + '%', '| 계좌만 낙폭', e.mdd + '%', '· 출금 누계', Math.round(S.out / 1e4) + '만');
// 류신영 봇과 섞기 (각 5천만): 일별 수익률 상관
const R = rsSim(W, { ...RCFG, riskPct: 1 }, deriv, { tA: F0 });
const day = (eq) => { const m = new Map(); eq.forEach(([t, v]) => m.set(Math.floor(t / DAY), v)); return m; };
const dA = day(base.eqs.map(([t, v]) => [t, v])), dB = day(R.equity), ks = [...dA.keys()].filter((k) => dB.has(k) && dA.has(k - 1) && dB.has(k - 1));
const ra = ks.map((k) => dA.get(k) / dA.get(k - 1) - 1), rb = ks.map((k) => dB.get(k) / dB.get(k - 1) - 1), ma = ra.reduce((s, v) => s + v, 0) / ra.length, mb = rb.reduce((s, v) => s + v, 0) / rb.length;
const cor = ra.reduce((s, v, i) => s + (v - ma) * (rb[i] - mb), 0) / Math.sqrt(ra.reduce((s, v) => s + (v - ma) ** 2, 0) * rb.reduce((s, v) => s + (v - mb) ** 2, 0));
const mix = ks.map((k, i) => [k * DAY, 0]); let va = 5e7, vb = 5e7; mix.forEach((m, i) => { va *= 1 + ra[i]; vb *= 1 + rb[i]; m[1] = va + vb; });
const M = statsOf(mix, [], {}), RS0 = statsOf(R.equity.filter(([t]) => t >= F0), R.trades, {});
console.log('류신영 봇 혼자 (위험1%)'.padEnd(28), '연', RS0.cagr + '%', '낙폭', RS0.mdd + '%', '샤프', RS0.sharpe);
console.log('③ + 류신영 반반'.padEnd(28), '연', M.cagr + '%', '낙폭', M.mdd + '%', '샤프', M.sharpe, '· 하루 수익 상관', cor.toFixed(2));
const yrs = {}; for (let y = 2020; y <= 2026; y++) { const s2 = st(base, Date.UTC(y, 0, 1), Date.UTC(y + 1, 0, 1)); if (s2.n != null) yrs[y] = s2.ret; } console.log('③ 연도별 수익%', JSON.stringify(yrs));
