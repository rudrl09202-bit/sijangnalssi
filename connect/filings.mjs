/* 공시 위험 확인 (DART 한국 · SEC EDGAR 미국) — 매일 자동 분석 때 실행
 *  대상: 모의투자 봇의 보유·주문 대기 종목 + 오늘의 매수 후보
 *  최근 30일 공시 중 주가에 나쁠 수 있는 것(유상증자·전환사채·감사의견·상장폐지·횡령 / 8-K 파산·회계 재작성·상장폐지·증자 등)을 표시
 *  결과: data/filings-live.json (앱이 읽음)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { loadEnv } from './paper.mjs';
import { unzipFirst, parseCorpXml } from './fundamentals.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 864e5;

export const KR_BAD = [/유상증자/, /전환사채/, /신주인수권부사채/, /교환사채/, /감자/, /관리종목/, /상장폐지/, /감사의견/, /의견거절/, /횡령|배임/, /불성실공시/, /거래정지|매매거래정지/, /회생절차|파산/, /소송/, /최대주주.*변경/];
export const KR_GOOD = [/자기주식.*취득|자사주.*취득/, /현금.*배당|현물배당/, /무상증자/, /단일판매|공급계약/, /자기주식.*소각/];
export const US_BAD_ITEMS = { '1.03': '파산·회생', '2.06': '자산 손상', '3.01': '상장 유지 기준 미달·상장폐지 통지', '4.01': '감사인 변경', '4.02': '과거 재무제표 신뢰 불가(재작성)', '5.02': '경영진·이사 교체' };
const US_BAD_FORMS = { 'S-1': '신규 주식 발행 신고(희석)', 'S-3': '주식·채권 발행 신고(희석 가능)', '424B5': '증자·채권 발행 확정', 'NT 10-K': '연간 보고서 지연 제출', 'NT 10-Q': '분기 보고서 지연 제출', '25-NSE': '상장폐지' };

export function classifyKr(name) {
  const bad = KR_BAD.find((r) => r.test(name)), good = KR_GOOD.find((r) => r.test(name));
  return bad ? 'bad' : good ? 'good' : 'info';
}
export function classifyUs(form, items) {
  const its = String(items || '').split(',').map((x) => x.trim()).filter(Boolean);
  const badItem = its.find((x) => US_BAD_ITEMS[x]);
  if (form === '8-K' && badItem) return { level: 'bad', note: US_BAD_ITEMS[badItem] };
  if (US_BAD_FORMS[form]) return { level: 'bad', note: US_BAD_FORMS[form] };
  if (form === '10-Q' || form === '10-K') return { level: 'info', note: form === '10-K' ? '연간 실적 보고서' : '분기 실적 보고서' };
  if (form === '8-K' && its.includes('2.02')) return { level: 'info', note: '실적 발표' };
  return null;
}

function loadWindow(file, key) {
  if (!existsSync(file)) return null;
  const ctx = { window: {} }; vm.createContext(ctx); vm.runInContext(readFileSync(file, 'utf8'), ctx);
  return ctx.window[key] || null;
}
export function targets(root) {
  const map = new Map(), add = (id, name, why) => { if (!id) return; const k = String(id).toUpperCase().replace(/^A(?=\d{6})/, '').replace(/[-.](KS|KQ)$/, ''); if (!map.has(k)) map.set(k, { id: k, name, why: [] }); map.get(k).why.push(why); };
  const P = loadWindow(join(root, 'js', 'paper-live.js'), 'SNW_PAPER');
  if (P) P.bots.forEach((b) => { if (!b.live || b.retired) return; (b.live.positions || []).forEach((p) => p.cur !== 'COIN' && !/^C_|^KRW-/.test(p.id) && add(p.id, p.name, b.code + ' 보유')); (b.live.orders || []).forEach((o) => o.cur !== 'COIN' && !/^C_|^KRW-/.test(o.id) && add(o.id, o.name, b.code + ' ' + (o.side === 'buy' ? '매수' : '매도') + ' 대기')); });
  const A = loadWindow(join(root, 'js', 'alerts-live.js'), 'SNW_ALERTS');
  if (A) (A.items || []).filter((x) => x.kind !== 'coin').forEach((x) => add(x.id, x.name, '오늘 매수 후보'));
  if (A) (A.top || []).forEach((x) => add(x.id, x.name, '앱 점수 상위 ' + x.score + '점'));
  return [...map.values()].filter((t) => /^\d{6}$/.test(t.id) || /^[A-Z][A-Z.\-]{0,5}$/.test(t.id));
}

async function dartList(key, list, { fetchImpl, cacheDir, now, log }) {
  const base = 'https://opendart.fss.or.kr/api/', out = {};
  let corp = null; const cf = join(cacheDir, 'dart-corp.json');
  if (existsSync(cf) && Date.now() - statSync(cf).mtimeMs < 7 * DAY) corp = JSON.parse(readFileSync(cf, 'utf8'));
  if (!corp) {
    const buf = Buffer.from(await (await fetchImpl(base + 'corpCode.xml?crtfc_key=' + encodeURIComponent(key))).arrayBuffer());
    if (buf[0] !== 0x50) throw new Error('OpenDART 응답 오류');
    corp = parseCorpXml(unzipFirst(buf).toString('utf8')); mkdirSync(cacheDir, { recursive: true }); writeFileSync(cf, JSON.stringify(corp));
  }
  const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
  for (const t of list) {
    const cc = corp[t.id]; if (!cc) continue;
    try {
      const q = new URLSearchParams({ crtfc_key: key, corp_code: cc, bgn_de: ymd(new Date(now - 30 * DAY)), end_de: ymd(now), page_count: '20' });
      const j = await (await fetchImpl(base + 'list.json?' + q)).json();
      if (j.status === '020') { log('OpenDART 한도 초과'); break; }
      out[t.id] = (j.list || []).map((r) => ({ date: r.rcept_dt.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'), title: r.report_nm.trim(), level: classifyKr(r.report_nm), url: 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=' + r.rcept_no }));
    } catch (e) { /* 이 종목만 건너뜀 */ }
    await sleep(120);
  }
  return out;
}
async function secList(list, { fetchImpl, ua, now, log }) {
  const headers = { 'User-Agent': ua, Accept: 'application/json' }, out = {};
  const t = await (await fetchImpl('https://www.sec.gov/files/company_tickers.json', { headers })).json();
  const map = {}; Object.values(t).forEach((r) => { map[String(r.ticker).toUpperCase()] = String(r.cik_str).padStart(10, '0'); });
  const since = new Date(now - 30 * DAY).toISOString().slice(0, 10);
  for (const it of list) {
    const cik = map[it.id] || map[it.id.replace('-', '.')]; if (!cik) continue;
    try {
      const j = await (await fetchImpl('https://data.sec.gov/submissions/CIK' + cik + '.json', { headers })).json();
      const R = j.filings && j.filings.recent; if (!R) continue;
      const rows = [];
      for (let k = 0; k < R.form.length && rows.length < 20; k++) {
        if (R.filingDate[k] < since) break;
        const c = classifyUs(R.form[k], R.items && R.items[k]); if (!c) continue;
        rows.push({ date: R.filingDate[k], title: R.form[k] + (R.items && R.items[k] ? ' (항목 ' + R.items[k] + ')' : ''), level: c.level, note: c.note,
          url: 'https://www.sec.gov/Archives/edgar/data/' + Number(cik) + '/' + String(R.accessionNumber[k]).replace(/-/g, '') + '/' + (R.primaryDocument[k] || '') });
      }
      out[it.id] = rows;
    } catch (e) { /* 건너뜀 */ }
    await sleep(130);
  }
  return out;
}

export async function run({ root = ROOT, env = loadEnv(), now = Date.now(), log = console.log, fetchImpl = fetch } = {}) {
  const list = targets(root);
  const kr = list.filter((t) => /^\d{6}$/.test(t.id)), us = list.filter((t) => !/^\d{6}$/.test(t.id));
  let a = {}, b = {};
  if (kr.length && env.DART_API_KEY) { try { a = await dartList(env.DART_API_KEY, kr, { fetchImpl, cacheDir: join(HERE, '.cache'), now, log }); } catch (e) { log('DART 공시 실패: ' + e.message); } }
  if (us.length) { try { b = await secList(us, { fetchImpl, ua: 'sijangnalssi-app/1.0 (' + (env.SEC_CONTACT || 'personal research') + ')', now, log }); } catch (e) { log('SEC 공시 실패: ' + e.message); } }
  const items = list.map((t) => { const f = (a[t.id] || b[t.id] || []); const bad = f.filter((x) => x.level === 'bad'), good = f.filter((x) => x.level === 'good');
    return { id: t.id, name: t.name, why: t.why, src: /^\d{6}$/.test(t.id) ? 'DART' : 'SEC', checked: !!(a[t.id] || b[t.id]), bad: bad.length, good: good.length, filings: f.slice(0, 8) }; });
  const out = { generatedAt: new Date(now).toISOString(), items: items.sort((x, y) => y.bad - x.bad || y.good - x.good) };
  mkdirSync(join(root, 'data'), { recursive: true });
  writeFileSync(join(root, 'data', 'filings-live.json'), JSON.stringify(out));
  items.filter((x) => x.bad).forEach((x) => log('  주의 ' + x.name + ' (' + x.id + '): ' + x.filings.filter((f) => f.level === 'bad').map((f) => f.date + ' ' + (f.note ? f.note + ' · ' : '') + f.title).join(' | ')));
  log('공시 확인: ' + items.length + '종목 (한국 ' + kr.length + ' · 미국 ' + us.length + ') · 위험 공시 있는 종목 ' + items.filter((x) => x.bad).length + '개');
  return out;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run().catch((e) => { console.error('✗ ' + e.message); process.exitCode = 0; });
