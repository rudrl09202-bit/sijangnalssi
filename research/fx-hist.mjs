// 연구용 일봉 받기 (야후, 키 없음): 세계 경제 신호 A~E 재료 + 신흥국·주요 통화 20개 → <MH>/m_<키>.js (market.mjs 와 같은 형식)
// + 나라별 3개월 금리(FRED OECD IR3TIB01<나라>M156N, 월별, %) → <MH>/r_<나라>.csv  (research/fx-strats.mjs 2차용)
// 사용: node research/fx-hist.mjs [폴더]   (기본 /tmp/mh)
import { writeFileSync, mkdirSync } from 'node:fs';
import { chart } from '../connect/market.mjs';
import { FX } from '../connect/fxbreadth.mjs';
const MH = process.argv[2] || process.env.MH || '/tmp/mh';
const BASE = { usdcny: 'CNY=X', dxy: 'DX-Y.NYB', us10y: '^TNX', nasdaq: '^IXIC', vix: '^VIX' };
const day = (ts) => new Date((ts + 9 * 3600) * 1000).toISOString().slice(0, 10); // market.mjs 와 같은 날짜 표기
const sig = (x) => (x == null ? null : Number(x.toPrecision(6)));
mkdirSync(MH, { recursive: true });
const all = { ...BASE, ...Object.fromEntries(FX.map((f) => ['fx_' + f.id, f.sym])) };
for (const [k, sym] of Object.entries(all)) {
  try { const r = await chart(sym, fetch, '10y'); const keep = r.c.map((x, i) => (x != null && x > 0 ? i : -1)).filter((i) => i >= 0);
    const d = { t: keep.map((i) => day(r.t[i])), c: keep.map((i) => sig(r.c[i])) };
    writeFileSync(`${MH}/m_${k}.js`, 'window.SNW_HIST&&window.SNW_HIST(' + JSON.stringify(k) + ',' + JSON.stringify(d) + ');\n');
    console.log(k.padEnd(10), sym.padEnd(10), d.t[0], '~', d.t.at(-1), d.c.length + '개');
  } catch (e) { console.log('✗', k, sym, e.message); }
}
const RATES = ['US', 'KR', 'JP', 'CN', 'MX', 'PL', 'HU', 'CZ', 'IL', 'CL', 'ZA', 'ID'];
for (const c of RATES) { try { const r = await fetch('https://fred.stlouisfed.org/graph/fredgraph.csv?id=IR3TIB01' + c + 'M156N'); if (!r.ok) throw new Error('HTTP ' + r.status); writeFileSync(`${MH}/r_${c}.csv`, await r.text()); console.log('금리', c); } catch (e) { console.log('✗ 금리', c, e.message); } }
