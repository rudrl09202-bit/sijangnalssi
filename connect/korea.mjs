/* 한국 위기 경보 판 (머니 글로브, 보여 주기용 — 봇 판단에는 안 씀)
 *  기준(기획서 7장, 미리 고정): 켜진 신호 개수로 단계 — 0 정상 · 1 주의 · 2 경고 · 3 위험. "예측"이 아니라 "위험 신호"
 *   R 외환보유액이 수입 3개월치 미만   — FRED TRESEGKRM052N(IMF, 금 제외, 백만 달러) ÷ FRED XTIMVA01KRM667S(OECD, 월 수입, 달러) 최근 3달 평균
 *   X 원화 3개월 급락: 원/달러 3개월(91일) 전보다 +15% 이상 — 야후 KRW=X 일봉
 *   C 경상수지 3개월 연속 적자          — 한국은행 ECOS(ECOS_API_KEY 필요, 없으면 "자료 없음")
 *   (단기외채 / 외환보유액은 분기 자료라 다음 단계에서 연결 — 지금은 단계 계산에 안 넣음)
 *  12시간마다만 받음. 어느 하나 실패해도 나머지는 그대로, 이전 값이 있으면 이어서 씀
 */
import { chart } from './market.mjs';
export const KCFG = { resMonths: 3, fx3m: 15, caStreak: 3 };
const DAY = 864e5;
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(what + ' 시간 초과')), ms))]);
async function fredCsv(id, fetchImpl) {
  const r = await withTimeout(fetchImpl('https://fred.stlouisfed.org/graph/fredgraph.csv?id=' + id, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; sijangnalssi/1.0)' } }), 20000, id);
  if (!r.ok) throw new Error(id + ' HTTP ' + r.status);
  return (await r.text()).trim().split('\n').slice(1).map((l) => l.split(',')).filter((x) => x[1] && x[1] !== '.').map(([d, v]) => ({ d, v: +v }));
}
async function ecosCurrentAccount(key, fetchImpl, now) {
  const base = 'https://ecos.bok.or.kr/api/', get = async (u) => { const r = await withTimeout(fetchImpl(u), 20000, 'ECOS'); if (!r.ok) throw new Error('ECOS HTTP ' + r.status); return r.json(); };
  const ym = (d) => d.toISOString().slice(0, 4) + d.toISOString().slice(5, 7);
  for (const stat of ['301Y013', '301Y017']) { // 국제수지 표 (이름으로 '경상수지' 항목을 찾음)
    const il = await get(base + 'StatisticItemList/' + encodeURIComponent(key) + '/json/kr/1/200/' + stat), items = (il.StatisticItemList && il.StatisticItemList.row) || [];
    const it = items.find((r) => String(r.ITEM_NAME).replace(/\s/g, '') === '경상수지' && (!r.CYCLE || r.CYCLE === 'M')); if (!it) continue;
    const j = await get(base + 'StatisticSearch/' + encodeURIComponent(key) + '/json/kr/1/100/' + stat + '/M/' + ym(new Date(now - 800 * DAY)) + '/' + ym(new Date(now)) + '/' + it.ITEM_CODE);
    const rows = ((j.StatisticSearch && j.StatisticSearch.row) || []).map((r) => ({ t: r.TIME.slice(0, 4) + '-' + r.TIME.slice(4, 6), v: +r.DATA_VALUE })).filter((r) => isFinite(r.v));
    if (rows.length) return { stat, item: it.ITEM_CODE, unit: (rows[0] && j.StatisticSearch.row[0].UNIT_NAME) || '백만달러', rows: rows.slice(-12) };
  }
  throw new Error('ECOS 경상수지 항목 없음');
}
export function judge(K, cfg = KCFG) {
  const sig = [];
  const r = K.reserves; sig.push({ id: 'R', label: '외환보유액 (수입 몇 달치)', val: r ? r.months : null, unit: '개월', th: cfg.resMonths + '개월 미만', on: !!r && r.months < cfg.resMonths, src: 'IMF·OECD (FRED)', date: r && r.date });
  const x = K.fx; sig.push({ id: 'X', label: '원화 3개월 급락', val: x ? x.chg3m : null, unit: '%', th: '+' + cfg.fx3m + '% 이상', on: !!x && x.chg3m >= cfg.fx3m, src: '야후 KRW=X', date: x && x.date });
  const c = K.ca; sig.push({ id: 'C', label: '경상수지 연속 적자', val: c ? c.streak : null, unit: '개월', th: cfg.caStreak + '개월 연속', on: !!c && c.streak >= cfg.caStreak, src: '한국은행 ECOS', date: c && c.date });
  const n = sig.filter((s) => s.on).length, have = sig.filter((s) => s.val != null).length;
  return { sig, n, have, stage: n, stageName: ['정상', '주의', '경고', '위험'][Math.min(n, 3)] };
}
export async function loadKorea(prev, now, fetchImpl = fetch, env = process.env) {
  const P = prev && prev.korea; if (P && now - Date.parse(P.at) < 12 * 3600e3) return P;
  const K = { at: new Date(now).toISOString(), errors: [] };
  try { const [res, imp] = await Promise.all([fredCsv('TRESEGKRM052N', fetchImpl), fredCsv('XTIMVA01KRM667S', fetchImpl)]);
    const rl = res.at(-1), im = imp.slice(-3), avg = im.reduce((a, b) => a + b.v, 0) / im.length;
    K.reserves = { usdBn: +(rl.v / 1000).toFixed(1), date: rl.d.slice(0, 7), importsBn: +(avg / 1e9).toFixed(1), importsTo: im.at(-1).d.slice(0, 7), months: +((rl.v * 1e6) / avg).toFixed(2) };
  } catch (e) { K.errors.push('외환보유액: ' + e.message); if (P && P.reserves) K.reserves = P.reserves; }
  try { const r = await withTimeout(chart('KRW=X', fetchImpl, '6mo'), 30000, 'KRW=X'); const T = r.t.map((s) => s * 1000), C = r.c, last = C.length - 1; let j = -1; for (let i = 0; i < last; i++) if (T[i] <= T[last] - 91 * DAY && C[i] > 0) j = i;
    if (j >= 0) K.fx = { now: +C[last].toFixed(2), ago: +C[j].toFixed(2), chg3m: +((C[last] / C[j] - 1) * 100).toFixed(2), date: new Date(T[last]).toISOString().slice(0, 10), agoDate: new Date(T[j]).toISOString().slice(0, 10), series: C.slice(-130).map((v) => +v.toFixed(2)) };
  } catch (e) { K.errors.push('원/달러: ' + e.message); if (P && P.fx) K.fx = P.fx; }
  if (env.ECOS_API_KEY) { try { const ca = await ecosCurrentAccount(env.ECOS_API_KEY, fetchImpl, now); let s = 0; for (let i = ca.rows.length - 1; i >= 0 && ca.rows[i].v < 0; i--) s++;
      K.ca = { streak: s, last: ca.rows.at(-1).v, date: ca.rows.at(-1).t, unit: ca.unit, rows: ca.rows.slice(-6) };
    } catch (e) { K.errors.push('경상수지: ' + e.message); if (P && P.ca) K.ca = P.ca; } }
  else { K.errors.push('경상수지: ECOS 키 없음'); if (P && P.ca) K.ca = P.ca; }
  Object.assign(K, judge(K)); K.use = 'display';
  return K;
}
