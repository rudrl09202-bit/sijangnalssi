/* 신흥국·주요 통화 동시 약세 (머니 글로브 1호 신호) — 야후 일봉, 키 필요 없음
 *  20개 통화 각각: 달러 대비 20거래일 동안 +2% 이상 약해졌으면 "약세"
 *  G 신호: 약세 통화가 6개(30%) 이상 → 세계적으로 달러로 돈이 빠져나가는 중
 *  기준은 research/fx-breadth.mjs 를 돌리기 전에 고정했다. 시험 결과는 그 파일 머리말 참고.
 *  전날까지 마감된 일봉만 사용 (macro.mjs 와 같은 규칙)
 */
export const FX = [
  { id: 'krw', sym: 'KRW=X', ko: '대한민국', iso: 'KR' }, { id: 'jpy', sym: 'JPY=X', ko: '일본', iso: 'JP' }, { id: 'cny', sym: 'CNY=X', ko: '중국', iso: 'CN' },
  { id: 'twd', sym: 'TWD=X', ko: '대만', iso: 'TW' }, { id: 'inr', sym: 'INR=X', ko: '인도', iso: 'IN' }, { id: 'idr', sym: 'IDR=X', ko: '인도네시아', iso: 'ID' },
  { id: 'thb', sym: 'THB=X', ko: '태국', iso: 'TH' }, { id: 'myr', sym: 'MYR=X', ko: '말레이시아', iso: 'MY' }, { id: 'php', sym: 'PHP=X', ko: '필리핀', iso: 'PH' },
  { id: 'sgd', sym: 'SGD=X', ko: '싱가포르', iso: 'SG' }, { id: 'brl', sym: 'BRL=X', ko: '브라질', iso: 'BR' }, { id: 'mxn', sym: 'MXN=X', ko: '멕시코', iso: 'MX' },
  { id: 'clp', sym: 'CLP=X', ko: '칠레', iso: 'CL' }, { id: 'cop', sym: 'COP=X', ko: '콜롬비아', iso: 'CO' }, { id: 'zar', sym: 'ZAR=X', ko: '남아프리카공화국', iso: 'ZA' },
  { id: 'try', sym: 'TRY=X', ko: '튀르키예', iso: 'TR' }, { id: 'pln', sym: 'PLN=X', ko: '폴란드', iso: 'PL' }, { id: 'huf', sym: 'HUF=X', ko: '헝가리', iso: 'HU' },
  { id: 'czk', sym: 'CZK=X', ko: '체코', iso: 'CZ' }, { id: 'ils', sym: 'ILS=X', ko: '이스라엘', iso: 'IL' }
];
export const FXCFG = { n: 20, weakPct: 2, minWeak: 6 };
const DAY = 864e5;
// d = { T:[ms], c:[] } 에서 t 의 UTC 날짜보다 이전 마지막 칸
export const idxBefore = (d, t) => { const dd = Math.floor(t / DAY) * DAY; let lo = 0, hi = d.T.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (d.T[m] < dd) { k = m; lo = m + 1; } else hi = m - 1; } return k; };
// M = { fx_krw: {T,c}, ... } → 시점 t 의 통화별 상태와 약세 개수
export function breadthAt(M, t, cfg = FXCFG) {
  const rows = []; let weak = 0, have = 0;
  for (const f of FX) { const d = M['fx_' + f.id]; if (!d) continue; const i = idxBefore(d, t); if (i < cfg.n) continue;
    // 오래된 값(10일 넘게 끊김)은 빼기
    if (t - d.T[i] > 10 * DAY) continue;
    const chg = (d.c[i] / d.c[i - cfg.n] - 1) * 100, w = chg >= cfg.weakPct; have++; if (w) weak++;
    rows.push({ id: f.id, ko: f.ko, iso: f.iso, chg: +chg.toFixed(2), weak: w }); }
  return { weak, have, on: have >= 10 && weak >= cfg.minWeak, rows };
}
