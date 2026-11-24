/* 금리·물가·발표 일정 자동 갱신 (ECOS 한국은행 + FRED 미국 연준)
 * 키가 없으면 조용히 건너뜀 → 앱은 기존 스냅샷 값을 그대로 씀
 *  - FRED: 연준 기준금리(상단/하단), 미국 CPI(전년비), 실업률, 2년물, 다가오는 CPI·고용·FOMC 발표일
 *  - ECOS: 한국은행 기준금리, 한국 소비자물가(전년비)
 * 바뀐 값은 "발표"로 판단해 푸시 알림 (data/policy-state.json 과 비교)
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ymd = (d) => d.toISOString().slice(0, 10);
const num = (v) => { const x = parseFloat(v); return isFinite(x) ? x : null; };

async function getJson(url, fetchImpl) {
  let err;
  for (let k = 0; k < 3; k++) {
    try { const r = await fetchImpl(url, { headers: { Accept: 'application/json' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
    catch (e) { err = e; await sleep(700 * (k + 1)); }
  }
  throw err;
}

/* ---------- FRED ---------- */
const FRED = 'https://api.stlouisfed.org/fred/';
async function fredObs(key, id, fetchImpl, extra = '') {
  const j = await getJson(FRED + 'series/observations?series_id=' + id + '&api_key=' + key + '&file_type=json&sort_order=desc&limit=3' + extra, fetchImpl);
  const o = (j.observations || []).filter((x) => num(x.value) != null);
  if (!o.length) throw new Error(id + ' 값 없음');
  return { value: num(o[0].value), date: o[0].date, prev: o[1] ? num(o[1].value) : null };
}
// 발표 일정: CPI(10), 고용보고서(50)
export const FRED_RELEASES = [
  { id: 10, title: '미국 소비자물가(CPI) 발표', when: '밤 10시 30분(한국)', why: '예상보다 높으면 금리 인상 걱정 → 주식·코인에 부담' },
  { id: 50, title: '미국 고용보고서 발표', when: '밤 10시 30분(한국)', why: '일자리가 너무 많으면 금리 인상 걱정, 너무 적으면 경기 걱정' }
  // FOMC(101)는 FRED 일정에 금리 결정이 아닌 발표도 섞여 있어 쓰지 않음 → 앱의 기존 FOMC 일정 사용
];
async function fredDates(key, rel, fetchImpl, today) {
  const j = await getJson(FRED + 'release/dates?release_id=' + rel.id + '&api_key=' + key + '&file_type=json&realtime_start=' + today + '&include_release_dates_with_no_data=true&sort_order=asc&limit=3', fetchImpl);
  return (j.release_dates || []).map((x) => x.date).filter((d) => d >= today);
}
export async function fetchFred(key, { fetchImpl = fetch, now = new Date() } = {}) {
  const today = ymd(now), out = { src: 'FRED', fetchedAt: now.toISOString() }, errors = [];
  const take = async (k, fn) => { try { out[k] = await fn(); } catch (e) { errors.push(k + ': ' + e.message); } };
  await take('fedUpper', () => fredObs(key, 'DFEDTARU', fetchImpl));
  await take('fedLower', () => fredObs(key, 'DFEDTARL', fetchImpl));
  await take('cpiYoY', () => fredObs(key, 'CPIAUCSL', fetchImpl, '&units=pc1'));
  await take('coreCpiYoY', () => fredObs(key, 'CPILFESL', fetchImpl, '&units=pc1'));
  await take('unrate', () => fredObs(key, 'UNRATE', fetchImpl));
  await take('us2y', () => fredObs(key, 'DGS2', fetchImpl));
  const events = [];
  for (const rel of FRED_RELEASES) {
    try {
      const ds = await fredDates(key, rel, fetchImpl, today);
      ds.slice(0, 2).forEach((d) => {
        // FOMC 결과는 미국 오후 2시 = 한국 다음 날 새벽 → 한국 날짜는 +1일
        const kd = rel.id === 101 ? ymd(new Date(Date.parse(d + 'T00:00:00Z') + 864e5)) : d;
        events.push({ date: kd, title: rel.title, when: rel.when, why: rel.why, src: 'FRED' });
      });
    } catch (e) { errors.push('발표일 ' + rel.id + ': ' + e.message); }
  }
  out.events = events; out.errors = errors;
  return out;
}

/* ---------- ECOS ---------- */
const ECOS = 'https://ecos.bok.or.kr/api/StatisticSearch/';
async function ecosRows(key, stat, cycle, from, to, item, fetchImpl) {
  const j = await getJson(ECOS + encodeURIComponent(key) + '/json/kr/1/1000/' + stat + '/' + cycle + '/' + from + '/' + to + '/' + item, fetchImpl);
  if (j.RESULT && j.RESULT.CODE && j.RESULT.CODE !== 'INFO-000') throw new Error(j.RESULT.CODE + ' ' + (j.RESULT.MESSAGE || ''));
  const rows = (j.StatisticSearch && j.StatisticSearch.row) || [];
  return rows.map((r) => ({ t: r.TIME, v: num(r.DATA_VALUE) })).filter((r) => r.v != null).sort((a, b) => (a.t < b.t ? -1 : 1));
}
const yyyymmdd = (d) => ymd(d).replace(/-/g, '');
const yyyymm = (d) => ymd(d).slice(0, 7).replace('-', '');
export async function fetchEcos(key, { fetchImpl = fetch, now = new Date() } = {}) {
  const out = { src: 'ECOS', fetchedAt: now.toISOString() }, errors = [];
  try {
    const rows = await ecosRows(key, '722Y001', 'D', yyyymmdd(new Date(now - 400 * 864e5)), yyyymmdd(now), '0101000', fetchImpl); // 일별 → 400일치(1,000줄 안)
    if (!rows.length) throw new Error('값 없음');
    if (rows.length >= 1000) throw new Error('행 수 한도 도달');
    const last = rows[rows.length - 1], prevDiff = rows.slice().reverse().find((r) => r.v !== last.v);
    const chg = prevDiff ? rows[rows.indexOf(prevDiff) + 1] : rows[0]; // 마지막으로 바뀐 날
    out.bokRate = { value: last.v, date: chg.t.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'), asOf: last.t.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'), prev: prevDiff ? prevDiff.v : last.v };
  } catch (e) { errors.push('기준금리: ' + e.message); }
  try {
    const rows = await ecosRows(key, '901Y009', 'M', yyyymm(new Date(now - 430 * 864e5)), yyyymm(now), '0', fetchImpl);
    if (rows.length < 13) throw new Error('개월 수 부족 ' + rows.length);
    const last = rows[rows.length - 1], yago = rows.find((r) => r.t === String(Number(last.t.slice(0, 4)) - 1) + last.t.slice(4));
    if (!yago) throw new Error('1년 전 값 없음');
    const p = rows[rows.length - 2], pyago = rows.find((r) => r.t === String(Number(p.t.slice(0, 4)) - 1) + p.t.slice(4));
    out.krCpiYoY = { value: Math.round((last.v / yago.v - 1) * 1000) / 10, date: last.t.slice(0, 4) + '-' + last.t.slice(4), prev: pyago ? Math.round((p.v / pyago.v - 1) * 1000) / 10 : null };
  } catch (e) { errors.push('물가: ' + e.message); }
  out.errors = errors;
  return out;
}

/* ---------- 묶기 + 바뀐 값 = 발표 알림 ---------- */
export const POLICY_V = 3;
export async function fetchPolicy(env, opts = {}) {
  const res = { v: POLICY_V, fetchedAt: (opts.now || new Date()).toISOString(), keys: { fred: !!env.FRED_API_KEY, ecos: !!env.ECOS_API_KEY } };
  if (env.FRED_API_KEY) { try { res.fred = await fetchFred(env.FRED_API_KEY, opts); } catch (e) { res.fredError = e.message; } }
  if (env.ECOS_API_KEY) { try { res.ecos = await fetchEcos(env.ECOS_API_KEY, opts); } catch (e) { res.ecosError = e.message; } }
  return res;
}
// 지난번 값과 비교해서 새로 발표된 것만 문장으로
export function policyNews(prev, cur) {
  if (!prev || prev.v !== POLICY_V) return []; // 형식이 바뀐 직후엔 비교하지 않음(가짜 발표 알림 방지)
  const out = [], P = prev || {}, f = cur.fred || {}, e = cur.ecos || {}, pf = P.fred || {}, pe = P.ecos || {};
  const changed = (a, b) => a && (!b || a.date !== b.date || a.value !== b.value);
  if (f.fedUpper && pf.fedUpper && f.fedUpper.value !== pf.fedUpper.value) out.push(`미국 기준금리 ${f.fedUpper.value > pf.fedUpper.value ? '인상' : '인하'}: ${f.fedLower ? f.fedLower.value.toFixed(2) + '~' : ''}${f.fedUpper.value.toFixed(2)}%`);
  if (e.bokRate && pe.bokRate && e.bokRate.value !== pe.bokRate.value) out.push(`한국은행 기준금리 ${e.bokRate.value > pe.bokRate.value ? '인상' : '인하'}: ${pe.bokRate.value.toFixed(2)}% → ${e.bokRate.value.toFixed(2)}%`);
  if (changed(f.cpiYoY, pf.cpiYoY) && pf.cpiYoY && f.cpiYoY.date !== pf.cpiYoY.date) out.push(`미국 물가(CPI) ${f.cpiYoY.date.slice(0, 7)}: 전년비 ${f.cpiYoY.value.toFixed(1)}% (직전 ${pf.cpiYoY.value.toFixed(1)}%)`);
  if (changed(f.unrate, pf.unrate) && pf.unrate && f.unrate.date !== pf.unrate.date) out.push(`미국 실업률 ${f.unrate.date.slice(0, 7)}: ${f.unrate.value}% (직전 ${pf.unrate.value}%)`);
  if (changed(e.krCpiYoY, pe.krCpiYoY) && pe.krCpiYoY && e.krCpiYoY.date !== pe.krCpiYoY.date) out.push(`한국 물가 ${e.krCpiYoY.date}: 전년비 ${e.krCpiYoY.value}% (직전 ${pe.krCpiYoY.value}%)`);
  return out.filter(Boolean);
}
