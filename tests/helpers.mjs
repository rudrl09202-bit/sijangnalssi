// 시험용 가짜 시세 — 씨앗이 정해진 난수라 언제 돌려도 똑같음 (네트워크·키 필요 없음)
export function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
const gauss = (r) => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
// 4시간봉 코인: 추세가 가끔 바뀌는 랜덤워크 + 거래량 급증
export function coinSeries(seed, n = 3000, t0 = Date.UTC(2022, 0, 1), px = 100) {
  const r = rng(seed), H4 = 4 * 3600e3, d = { t: [], o: [], h: [], l: [], c: [], v: [] }; let p = px, drift = 0;
  for (let i = 0; i < n; i++) { if (r() < 0.01) drift = (r() - 0.5) * 0.004; const o = p, c = Math.max(0.01, o * (1 + drift + gauss(r) * 0.012)), hi = Math.max(o, c) * (1 + Math.abs(gauss(r)) * 0.004), lo = Math.min(o, c) * (1 - Math.abs(gauss(r)) * 0.004);
    d.t.push(t0 + i * H4); d.o.push(o); d.h.push(hi); d.l.push(lo); d.c.push(c); d.v.push(1000 * (1 + Math.abs(gauss(r))) * (r() < 0.08 ? 3 : 1)); p = c; }
  return d;
}
// 일봉 자산 (주식·지수·금·코인): 주말 빼고(코인은 매일)
export function dailyAsset(id, kind, seed, { n = 1500, cur = 'USD', market = 'spx', px = 50, drift = 0.0004, vol = 0.018 } = {}) {
  const r = rng(seed), a = { id, name: id, kind, cur, market, sec: 'tech', t: [], o: [], h: [], l: [], c: [], v: [] }; let p = px, day = Date.UTC(2019, 0, 1), dr = drift;
  while (a.t.length < n) { day += 864e5; const wd = new Date(day).getUTCDay(); if (kind !== 'coin' && (wd === 0 || wd === 6)) continue; if (r() < 0.004) dr = drift + (r() - 0.5) * 0.003;
    const o = p * (1 + gauss(r) * 0.003), c = Math.max(0.01, o * (1 + dr + gauss(r) * vol)), hi = Math.max(o, c) * (1 + Math.abs(gauss(r)) * 0.005), lo = Math.min(o, c) * (1 - Math.abs(gauss(r)) * 0.005);
    a.t.push(new Date(day).toISOString().slice(0, 10)); a.o.push(o); a.h.push(hi); a.l.push(lo); a.c.push(c); a.v.push(1e6 * (1 + Math.abs(gauss(r))) * (r() < 0.1 ? 2.5 : 1)); p = c; }
  return a;
}
export const cut = (d, n) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, Array.isArray(v) ? v.slice(0, n) : v]));
export function world() { // 주식 24개(미국 16 · 한국 8) + 지수 2 + 금 + 코인 3
  const A = []; for (let i = 0; i < 16; i++) A.push(dailyAsset('US' + i, 'stock', 100 + i, { market: i % 2 ? 'nasdaq' : 'spx', drift: 0.0002 + i * 0.00005 }));
  for (let i = 0; i < 8; i++) A.push(dailyAsset('KR' + i, 'stock', 300 + i, { cur: 'KRW', market: i % 2 ? 'kosdaq' : 'kospi', px: 50000, drift: 0.0001 + i * 0.00006 }));
  A.push(dailyAsset('IDX_spx', 'index', 7, { vol: 0.01 }), dailyAsset('IDX_kospi', 'index', 8, { cur: 'KRW', market: 'kospi', vol: 0.011, px: 2500 }), dailyAsset('GOLD', 'gold', 9, { vol: 0.009, px: 1800 }));
  ['BTC', 'ETH', 'SOL'].forEach((s, i) => A.push({ ...dailyAsset('C_' + s, 'coin', 500 + i, { vol: 0.035, px: 1000 * (i + 1), market: 'coin' }), sym: s }));
  return A;
}
export const REGIME = { spx: 'IDX_spx', nasdaq: 'IDX_spx', kospi: 'IDX_kospi', kosdaq: 'IDX_kospi', coin: 'C_BTC' };
