// 월가식 주식 선택: 절대 점수(70점↑) 대신 "팩터 순위로 상위 20% · 매월 교체 · 변동성 낮은 쪽 가중 · 시장 추세 필터"
// 같은 10년(같은 종목 묶음)에서: 지수 그대로 / 묶음 전체 같은 비중 / 앱 점수(CHIEF) / 팩터 포트폴리오들 비교
// 실행(GitHub research.yml): node connect/market.mjs && node research/factor.mjs
import { writeFileSync } from 'node:fs';
import { loadQuant, loadAssets, cutoffDate, makeChief, scoreStudy } from '../connect/paper.mjs';
import { loadApp } from '../connect/alerts.mjs';
const root = new URL('..', import.meta.url).pathname, app = loadApp(root), Q = loadQuant(root);
const { assets, usdkrw } = loadAssets(root, app, cutoffDate());
const r2 = (x, n = 2) => (x == null || !isFinite(x) ? null : Math.round(x * 10 ** n) / 10 ** n);
const OUT = { markets: {} };

function curve(vals, dates) { // 월말 자산 → 지표
  const r = vals.slice(1).map((v, i) => v / vals[i] - 1), yrs = (Date.parse(dates.at(-1)) - Date.parse(dates[0])) / (365.25 * 864e5);
  const m = r.reduce((a, b) => a + b, 0) / r.length, sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / r.length); let pk = -Infinity, mdd = 0; vals.forEach((v) => { pk = Math.max(pk, v); mdd = Math.min(mdd, v / pk - 1); });
  return { cagr: r2((Math.pow(vals.at(-1) / vals[0], 1 / yrs) - 1) * 100, 1), mdd: r2(mdd * 100, 1), sharpe: r2(sd ? (m - 0.025 / 12) / sd * Math.sqrt(12) : null), total: r2((vals.at(-1) / vals[0] - 1) * 100, 0) };
}
for (const [mk, cur, idxId, cost] of [['미국', 'USD', 'IDX_spx', 0.001], ['한국', 'KRW', 'IDX_kospi', 0.0025]]) {
  const idx = assets.find((a) => a.id === idxId), cal = idx.t, S = assets.filter((a) => a.kind === 'stock' && a.cur === cur);
  const px = S.map((a) => { const m = new Map(a.t.map((d, i) => [d, a.c[i]])); let last = null; return cal.map((d) => { const v = m.get(d); if (v) last = v; return v ? v : null; }); });
  // 월말 인덱스
  const ends = []; for (let i = 1; i < cal.length; i++) if (cal[i].slice(0, 7) !== cal[i - 1].slice(0, 7)) ends.push(i - 1); ends.push(cal.length - 1);
  const sma200 = (arr, i) => { let s = 0, n = 0; for (let k = i - 199; k <= i; k++) if (arr[k]) { s += arr[k]; n++; } return n > 150 ? s / n : null; };
  const fac = (k, i) => { const p = px[k]; if (!p[i] || !p[i - 21] || !p[i - 252]) return null; const rs = []; for (let q = i - 125; q <= i; q++) if (p[q] && p[q - 1]) rs.push(Math.log(p[q] / p[q - 1])); if (rs.length < 100) return null;
    const m = rs.reduce((a, b) => a + b, 0) / rs.length, vol = Math.sqrt(rs.reduce((a, b) => a + (b - m) ** 2, 0) / rs.length); let hi = 0; for (let q = i - 251; q <= i; q++) if (p[q] > hi) hi = p[q];
    return { mom: p[i - 21] / p[i - 252] - 1, vol, hi52: p[i] / hi, up: p[i] > (sma200(p, i) || Infinity) }; };
  const z = (arr) => { const v = arr.filter((x) => x != null), m = v.reduce((a, b) => a + b, 0) / v.length, s = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) || 1; return arr.map((x) => (x == null ? null : (x - m) / s)); };
  const run = (pick, { regime = false, invVol = false } = {}) => {
    let v = 1, w = {}; const vals = [1], ds = [cal[ends[12]]];
    for (let e = 12; e < ends.length - 1; e++) { const i = ends[e], j = ends[e + 1];
      let nw = {};
      const risk = !regime || idx.c[i] > (sma200(idx.c, i) || 0);
      if (risk) { const F = S.map((_, k) => fac(k, i)), sel = pick(F); if (sel.length) { const ws = sel.map((k) => (invVol ? 1 / F[k].vol : 1)), tot = ws.reduce((a, b) => a + b, 0); sel.forEach((k, n) => { nw[k] = ws[n] / tot; }); } }
      const keys = new Set([...Object.keys(w), ...Object.keys(nw)]); let turn = 0; keys.forEach((k) => { turn += Math.abs((nw[k] || 0) - (w[k] || 0)); });
      v *= 1 - turn * cost; // 매매 비용 (사고판 비중만큼)
      let ret = 0; Object.entries(nw).forEach(([k, ww]) => { const p = px[k]; const a = p[i + 1] || p[i], b = p[j]; if (a && b) ret += ww * (b / a - 1); }); // 다음 날부터 보유 (하루 늦춤)
      v *= 1 + ret; w = nw; vals.push(v); ds.push(cal[j]); }
    const mid = Math.floor(vals.length / 2);
    return { all: curve(vals, ds), h1: curve(vals.slice(0, mid + 1), ds.slice(0, mid + 1)), h2: curve(vals.slice(mid), ds.slice(mid)), from: ds[0], to: ds.at(-1) };
  };
  const top = (score, frac = 0.2) => (F) => { const sc = score(F), ok = F.map((f, k) => (f && sc[k] != null ? k : -1)).filter((k) => k >= 0).sort((a, b) => sc[b] - sc[a]); return ok.slice(0, Math.max(5, Math.round(ok.length * frac))); };
  const all = (F) => F.map((f, k) => (f ? k : -1)).filter((k) => k >= 0);
  const rows = [
    ['묶음 전체 같은 비중 (비교 기준)', all, {}],
    ['① 모멘텀 상위 20% (12-1개월)', top((F) => z(F.map((f) => f && f.mom))), {}],
    ['② 모멘텀 + 저변동성', top((F) => { const a = z(F.map((f) => f && f.mom)), b = z(F.map((f) => f && -f.vol)); return a.map((x, k) => (x == null ? null : x + b[k])); }), {}],
    ['③ ② + 52주 고점 근접', top((F) => { const a = z(F.map((f) => f && f.mom)), b = z(F.map((f) => f && -f.vol)), c = z(F.map((f) => f && f.hi52)); return a.map((x, k) => (x == null ? null : x + b[k] + c[k])); }), {}],
    ['④ ③ + 변동성 역가중 + 시장 추세 필터', top((F) => { const a = z(F.map((f) => f && f.mom)), b = z(F.map((f) => f && -f.vol)), c = z(F.map((f) => f && f.hi52)); return a.map((x, k) => (x == null ? null : x + b[k] + c[k])); }), { regime: true, invVol: true }],
  ];
  const res = rows.map(([name, pick, o]) => ({ name, ...run(pick, o) }));
  // 지수 그대로 (같은 기간)
  const iv = ends.slice(12).map((i) => idx.c[i]), idxRow = { name: idx.name + ' 지수 그대로', all: curve(iv, ends.slice(12).map((i) => cal[i])) };
  OUT.markets[mk] = { stocks: S.length, rows: [idxRow, ...res] };
  console.log('\n[' + mk + '] 종목 ' + S.length + '개 · ' + res[0].from + ' ~ ' + res[0].to);
  [idxRow, ...res].forEach((r) => console.log(r.name.padEnd(30), '연', r.all.cagr + '%', '낙폭', r.all.mdd + '%', '샤프', r.all.sharpe, r.h1 ? '| 앞 연' + r.h1.cagr + '% 뒤 연' + r.h2.cagr + '%' : ''));
}
// 앱 점수(지금 알림 기준)가 이후 수익을 맞히는지: IC
try { let W = null; const chief = makeChief(app, Q, () => W, cutoffDate()); W = Q.buildWorld(assets, { usdkrw, regimeOf: { spx: 'IDX_spx', nasdaq: 'IDX_spx', kospi: 'IDX_kospi', kosdaq: 'IDX_kospi', coin: 'C_BTC' }, chief });
  const st = scoreStudy(app, Q, W); OUT.appScore = st; console.log('\n[앱 점수 검증] IC 상위', JSON.stringify(st.factors.slice(0, 12).map((f) => [f.name, f.ic60, f.t60])), '\n알림(70점↑) 이후 60일 초과수익', st.alert.x60 + '% (나머지 ' + st.alert.restX60 + '%) · 승률', st.alert.win60 + '%');
} catch (e) { console.log('앱 점수 검증 실패: ' + e.message); }
writeFileSync(new URL('../data/chief-compare.json', import.meta.url).pathname, JSON.stringify(OUT, null, 1));
