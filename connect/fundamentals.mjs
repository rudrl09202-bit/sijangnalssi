/*
 * 시장날씨 — 공식 재무 데이터 (키는 이 컴퓨터의 .env 에만)
 *
 *  미국: SEC EDGAR (미국 증권거래위원회) — 무료, 키 없음. 연락처가 담긴 User-Agent 필수, 초당 10건 이하.
 *        https://www.sec.gov/files/company_tickers.json  (티커 → CIK)
 *        https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json  (공시 재무 수치 전체)
 *  한국: OpenDART (금융감독원 전자공시) — 무료, 인증키 필요(.env 의 DART_API_KEY).
 *        corpCode.xml(ZIP) → 종목코드별 고유번호, fnlttSinglAcnt(주요계정), stockTotqySttus(주식 총수), alotMatter(배당)
 *
 *  공시 숫자로 직접 계산: PER·PSR·PBR·EV/EBITDA·PEG·배당수익률·ROE·ROA·이익률·성장률·부채비율·유동비율·잉여현금흐름
 *  부채비율은 한국식(부채총계 ÷ 자본총계 × 100)으로 미국·한국을 같은 기준으로 계산합니다.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sig = (x) => (x == null || !isFinite(x) ? null : Number(Number(x).toPrecision(5)));
const DAY = 86400000;
const days = (a, b) => (new Date(b) - new Date(a)) / DAY;

// 공시 수치 → 지표 (모든 금액은 같은 통화, price 도 같은 통화)
export function ratios(x, price) {
  const r = {};
  const mcap = price && x.shares ? price * x.shares : null;
  const put = (k, v) => { if (v != null && isFinite(v)) r[k] = sig(v); };
  if (mcap) put('mcap', mcap);
  if (mcap && x.ni) put('pe', mcap / x.ni); // 적자면 음수
  if (mcap && x.rev > 0) put('ps', mcap / x.rev);
  if (mcap && x.equity > 0) put('pb', mcap / x.equity);
  if (mcap && x.oi != null && x.da != null && x.oi + x.da > 0) put('evEbitda', (mcap + (x.debt || 0) - (x.cash || 0)) / (x.oi + x.da));
  if (x.equity > 0 && x.ni != null) put('roe', x.ni / x.equity);
  if (x.assets > 0 && x.ni != null) put('roa', x.ni / x.assets);
  if (x.rev > 0) { if (x.oi != null) put('opMargin', x.oi / x.rev); if (x.ni != null) put('netMargin', x.ni / x.rev); if (x.gp != null) put('grossMargin', x.gp / x.rev); }
  if (x.rev > 0 && x.revPrev > 0) put('revGrowth', x.rev / x.revPrev - 1);
  if (x.ni != null && x.niPrev > 0) put('epsGrowth', x.ni / x.niPrev - 1);
  if (x.qNi != null && x.qNiPrev > 0) put('qEpsGrowth', x.qNi / x.qNiPrev - 1);
  if (r.pe > 0 && r.epsGrowth > 0) put('peg', r.pe / (r.epsGrowth * 100));
  if (x.equity > 0 && x.liab != null) put('de', x.liab / x.equity * 100);
  if (x.cl > 0 && x.ca != null) put('current', x.ca / x.cl);
  if (x.ocf != null && x.capex != null) put('fcf', x.ocf - Math.abs(x.capex));
  if (x.cash != null) put('cash', x.cash);
  if (x.debt != null) put('debt', x.debt);
  if (x.dps != null && price) put('divYield', x.dps / price);
  if (x.divYieldPct != null) put('divYield', x.divYieldPct / 100);
  return r;
}

/* ================= 미국: SEC EDGAR ================= */
const US_FLOW = {
  rev: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax'],
  ni: ['NetIncomeLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic', 'ProfitLoss'],
  oi: ['OperatingIncomeLoss'], gp: ['GrossProfit'],
  da: ['DepreciationDepletionAndAmortization', 'DepreciationAndAmortization', 'DepreciationAmortizationAndAccretionNet'],
  ocf: ['NetCashProvidedByUsedInOperatingActivities'], capex: ['PaymentsToAcquirePropertyPlantAndEquipment']
};
const US_INSTANT = {
  equity: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'], assets: ['Assets'], liab: ['Liabilities'],
  ca: ['AssetsCurrent'], cl: ['LiabilitiesCurrent'], cash: ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'],
  ltd: ['LongTermDebtNoncurrent', 'LongTermDebt'], std: ['LongTermDebtCurrent', 'DebtCurrent', 'ShortTermBorrowings']
};
function usd(facts, names, unit) {
  for (const n of names) { const c = facts['us-gaap'] && facts['us-gaap'][n]; const arr = c && c.units && c.units[unit || 'USD']; if (arr && arr.length) return arr; }
  return null;
}
// 연간(10-K, 약 1년 기간) 최근 값과 그 1년 전 값
function annual(arr) {
  if (!arr) return {};
  const fy = arr.filter((e) => e.start && /^10-K/.test(e.form) && days(e.start, e.end) > 330 && days(e.start, e.end) < 400).sort((a, b) => (a.end < b.end ? 1 : -1));
  if (!fy.length) return {};
  const cur = fy[0], prev = fy.find((e) => Math.abs(days(e.end, cur.end) - 365) < 25);
  return { v: cur.val, prev: prev ? prev.val : null, end: cur.end };
}
// 최근 분기(약 3개월 기간)와 전년 같은 분기
function quarter(arr) {
  if (!arr) return {};
  const q = arr.filter((e) => e.start && days(e.start, e.end) > 80 && days(e.start, e.end) < 100).sort((a, b) => (a.end < b.end ? 1 : -1));
  if (!q.length) return {};
  const cur = q[0], prev = q.find((e) => Math.abs(days(e.end, cur.end) - 365) < 20);
  return { v: cur.val, prev: prev ? prev.val : null };
}
const latest = (arr) => (arr && arr.length ? arr.slice().sort((a, b) => (a.end < b.end ? 1 : -1))[0].val : null);

export function secFacts(json) {
  const f = json && json.facts; if (!f || !f['us-gaap']) return null;
  const x = {};
  for (const [k, names] of Object.entries(US_FLOW)) { const a = annual(usd(f, names)); if (a.v != null) { x[k] = a.v; if (a.prev != null) x[k + 'Prev'] = a.prev; if (k === 'rev' || k === 'ni') x.periodEnd = x.periodEnd || a.end; } }
  const q = quarter(usd(f, US_FLOW.ni)); if (q.v != null) { x.qNi = q.v; x.qNiPrev = q.prev; }
  for (const [k, names] of Object.entries(US_INSTANT)) { const v = latest(usd(f, names)); if (v != null) x[k] = v; }
  if (x.ltd != null || x.std != null) x.debt = (x.ltd || 0) + (x.std || 0);
  const sh = f.dei && f.dei.EntityCommonStockSharesOutstanding && f.dei.EntityCommonStockSharesOutstanding.units.shares;
  x.shares = latest(sh) || latest(usd(f, ['WeightedAverageNumberOfDilutedSharesOutstanding'], 'shares'));
  const dps = annual(usd(f, ['CommonStockDividendsPerShareDeclared', 'CommonStockDividendsPerShareCashPaid'], 'USD/shares')); if (dps.v != null) x.dps = dps.v;
  return x;
}

export async function fetchSec(list, { fetchImpl = fetch, ua, log = () => {} } = {}) {
  const headers = { 'User-Agent': ua || 'sijangnalssi-app/1.0 (personal research)', Accept: 'application/json' };
  const map = {};
  const t = await (await fetchImpl('https://www.sec.gov/files/company_tickers.json', { headers })).json();
  Object.values(t).forEach((r) => { map[String(r.ticker).toUpperCase()] = String(r.cik_str).padStart(10, '0'); });
  const out = {};
  let ok = 0;
  for (const it of list) {
    const cik = map[it.s.toUpperCase()] || map[it.s.toUpperCase().replace('-', '.')];
    if (!cik) continue;
    try {
      const res = await fetchImpl('https://data.sec.gov/api/xbrl/companyfacts/CIK' + cik + '.json', { headers });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const x = secFacts(await res.json());
      if (x && x.shares) { const r = ratios(x, it.price); if (Object.keys(r).length > 4) { out[it.s] = { ...r, src: 'SEC EDGAR', period: x.periodEnd }; ok++; } }
    } catch (e) { /* 이 종목만 건너뜀 */ }
    await sleep(130); // 초당 10건 이하
  }
  log('SEC EDGAR 재무 ' + ok + '/' + list.length + ' 종목');
  return out;
}

/* ================= 한국: OpenDART ================= */
// ZIP 안의 첫 파일을 꺼내기 (중앙 디렉터리 기준, 외부 라이브러리 없이)
export function unzipFirst(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('ZIP 형식이 아님');
  const cd = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cd) !== 0x02014b50) throw new Error('ZIP 목차 오류');
  const method = buf.readUInt16LE(cd + 10), csize = buf.readUInt32LE(cd + 20), lho = buf.readUInt32LE(cd + 42);
  const nlen = buf.readUInt16LE(lho + 26), elen = buf.readUInt16LE(lho + 28), start = lho + 30 + nlen + elen;
  const data = buf.subarray(start, start + csize);
  return method === 8 ? inflateRawSync(data) : Buffer.from(data);
}
export function parseCorpXml(xml) {
  const map = {};
  const re = /<list>\s*<corp_code>(\d+)<\/corp_code>\s*<corp_name>([^<]*)<\/corp_name>(?:\s*<corp_eng_name>[^<]*<\/corp_eng_name>)?\s*<stock_code>\s*([0-9A-Z]*)\s*<\/stock_code>/g;
  let m; while ((m = re.exec(xml))) if (m[3]) map[m[3]] = m[1];
  return map;
}
const num = (s) => { if (s == null) return null; const v = Number(String(s).replace(/,/g, '').trim()); return s === '' || s === '-' || !isFinite(v) ? null : v; };
// 주요계정 응답 → 연결(CFS) 우선 값
export function dartAccounts(list) {
  const rows = (list || []).filter((r) => r.fs_div === 'CFS').length ? list.filter((r) => r.fs_div === 'CFS') : (list || []);
  const get = (names, f) => { for (const n of names) { const r = rows.find((x) => x.account_nm && x.account_nm.replace(/\s/g, '') === n); if (r) return num(r[f]); } return null; };
  return {
    rev: get(['매출액', '수익(매출액)', '영업수익'], 'thstrm_amount'), revPrev: get(['매출액', '수익(매출액)', '영업수익'], 'frmtrm_amount'),
    oi: get(['영업이익', '영업이익(손실)'], 'thstrm_amount'), ni: get(['당기순이익', '당기순이익(손실)'], 'thstrm_amount'), niPrev: get(['당기순이익', '당기순이익(손실)'], 'frmtrm_amount'),
    assets: get(['자산총계'], 'thstrm_amount'), liab: get(['부채총계'], 'thstrm_amount'), equity: get(['자본총계'], 'thstrm_amount'),
    ca: get(['유동자산'], 'thstrm_amount'), cl: get(['유동부채'], 'thstrm_amount')
  };
}
export async function fetchDart(list, { key, fetchImpl = fetch, cacheDir, log = () => {}, now = new Date() } = {}) {
  if (!key) { log('OpenDART 키(DART_API_KEY)가 .env 에 없어 한국 종목 재무는 건너뜀'); return {}; }
  const base = 'https://opendart.fss.or.kr/api/';
  // 1) 고유번호 목록 (7일 캐시)
  let corp = null; const cf = cacheDir && join(cacheDir, 'dart-corp.json');
  if (cf && existsSync(cf) && Date.now() - statSync(cf).mtimeMs < 7 * DAY) corp = JSON.parse(readFileSync(cf, 'utf8'));
  if (!corp) {
    const res = await fetchImpl(base + 'corpCode.xml?crtfc_key=' + encodeURIComponent(key));
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf[0] !== 0x50) throw new Error('OpenDART 응답 오류: ' + buf.toString('utf8').slice(0, 120));
    corp = parseCorpXml(unzipFirst(buf).toString('utf8'));
    if (cf) { mkdirSync(cacheDir, { recursive: true }); writeFileSync(cf, JSON.stringify(corp)); }
  }
  const year = now.getMonth() >= 3 ? now.getFullYear() - 1 : now.getFullYear() - 2; // 사업보고서는 3월 말까지 나옴
  const call = async (api, params) => {
    const q = new URLSearchParams({ crtfc_key: key, ...params });
    const j = await (await fetchImpl(base + api + '.json?' + q)).json();
    if (j.status === '020') throw new Error('OpenDART 하루 요청 한도 초과');
    return j.status === '000' ? j.list || [] : [];
  };
  const out = {}; let ok = 0;
  for (const it of list) {
    const cc = corp[it.s]; if (!cc) continue;
    try {
      const a = dartAccounts(await call('fnlttSinglAcnt', { corp_code: cc, bsns_year: String(year), reprt_code: '11011' }));
      if (a.rev == null && a.ni == null) continue;
      // 최근 분기(3분기 → 반기 → 1분기 순) 당기순이익 전년 동기 대비
      for (const [y, rc] of [[year + 1, '11014'], [year + 1, '11012'], [year + 1, '11013']]) {
        const q = await call('fnlttSinglAcnt', { corp_code: cc, bsns_year: String(y), reprt_code: rc });
        if (q.length) { const qa = dartAccounts(q); if (qa.ni != null) { a.qNi = qa.ni; a.qNiPrev = qa.niPrev; } if (qa.assets) Object.assign(a, { assets: qa.assets, liab: qa.liab, equity: qa.equity, ca: qa.ca, cl: qa.cl }); break; }
      }
      const st = await call('stockTotqySttus', { corp_code: cc, bsns_year: String(year), reprt_code: '11011' });
      const tot = st.find((r) => r.se === '합계') || st.find((r) => r.se === '보통주');
      if (tot) a.shares = (num(tot.istc_totqy) || 0) - (num(tot.tesstk_co) || 0);
      const al = await call('alotMatter', { corp_code: cc, bsns_year: String(year), reprt_code: '11011' });
      const dy = al.find((r) => r.se && r.se.includes('현금배당수익률') && (!r.stock_knd || r.stock_knd.includes('보통')));
      if (dy) a.divYieldPct = num(dy.thstrm);
      const r = ratios(a, it.price);
      if (Object.keys(r).length > 3) { out[it.s] = { ...r, src: 'OpenDART', period: year + '년 사업보고서' }; ok++; }
    } catch (e) { if (/한도/.test(e.message)) { log(e.message); break; } }
    await sleep(120);
  }
  log('OpenDART 재무 ' + ok + '/' + list.length + ' 종목');
  return out;
}
