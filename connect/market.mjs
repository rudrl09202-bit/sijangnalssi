#!/usr/bin/env node
/*
 * 시장날씨 — 시장 데이터 받기 (키 필요 없음)
 *
 * 하는 일: 야후 파이낸스 공개 차트에서 아래를 받아 ../js/market-live.js 로 저장합니다.
 *   1) 나스닥·S&P500·코스피·코스닥 대표 종목들의 10년치 일봉 (js/universe.js 목록)
 *      - 최근 260거래일 → ../js/market-live.js (앱이 열릴 때 바로 읽음, 점수 계산용)
 *      - 10년 전체 → ../js/history/종목.js (차트에서 3·5·10년을 고를 때만 읽음)
 *   2) 지수·금리·달러·유가·금·VIX·원/달러 (앱의 거시 숫자를 자동으로 새로 고침)
 *   3) 종목별 재무 지표 — 공식 공시에서 계산: 미국 SEC EDGAR(키 없음), 한국 OpenDART(.env 의 DART_API_KEY)
 *      .env 의 SEC_CONTACT 에 이메일을 적어 두면 SEC 요청에 연락처로 씁니다(SEC 규칙).
 * 개인 정보나 계좌와는 상관없는 공개 시세만 받습니다.
 *
 * 실행: 이 폴더에서  node market.mjs   (node sync.mjs 를 실행해도 마지막에 같이 실행됩니다)
 * 시간: 종목 약 170개 × 10년치라 2~5분 걸립니다.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { existsSync as exists } from 'node:fs';
import { fetchSec, fetchDart } from './fundamentals.mjs';

function loadEnv() {
  const env = { ...process.env }; // GitHub Actions 에서는 비밀값이 환경변수로 들어옴
  const p = join(HERE, '.env'); if (!exists(p)) return env;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
  return env;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'js', 'market-live.js');
const KEEP = 260; // market-live.js 에 넣을 최근 거래일 수 (1년 차트 + 200일 평균선)
const HIST_DIR = join(HERE, '..', 'js', 'history');

// 거시 지표: 앱 키 → 야후 기호
export const MACRO = {
  us10y: '^TNX', dxy: 'DX-Y.NYB', brent: 'BZ=F', gold: 'GC=F', vix: '^VIX', usdkrw: 'KRW=X',
  spx: '^GSPC', nasdaq: '^IXIC', kospi: '^KS11', kosdaq: '^KQ11',
  silver: 'SI=F', usdjpy: 'JPY=X', usdcny: 'CNY=X', eurusd: 'EURUSD=X'
};

function loadUniverse() {
  const ctx = { window: {} };
  vm.runInNewContext(readFileSync(join(HERE, '..', 'js', 'universe.js'), 'utf8'), ctx);
  return ctx.window.Universe;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];

// 일봉 1년: { t[], c[], h[], l[], v[](거래대금, 현지 통화), cur }
export async function chart(sym, fetchImpl = fetch, range = '10y') {
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    const host = HOSTS[attempt % 2];
    try {
      const res = await fetchImpl(host + '/v8/finance/chart/' + encodeURIComponent(sym) + '?range=' + range + '&interval=1d&includePrePost=false', {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', Accept: 'application/json' }
      });
      if (res.status === 429) { lastErr = new Error('요청이 너무 많음(429)'); await sleep(1500 * (attempt + 1)); continue; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      const r = j && j.chart && j.chart.result && j.chart.result[0];
      if (!r || !r.timestamp) throw new Error((j && j.chart && j.chart.error && j.chart.error.description) || '데이터 없음');
      const q = r.indicators.quote[0];
      const out = { t: [], o: [], c: [], h: [], l: [], v: [], cur: r.meta && r.meta.currency };
      r.timestamp.forEach((ts, i) => {
        const c = q.close[i];
        if (c == null || !isFinite(c)) return;
        out.t.push(ts); out.o.push(q.open && q.open[i] != null ? q.open[i] : c); out.c.push(c); out.h.push(q.high[i] ?? c); out.l.push(q.low[i] ?? c); out.v.push((q.volume[i] || 0) * c);
      });
      if (out.c.length < 2) throw new Error('가격이 2일 미만');
      return out;
    } catch (e) { lastErr = e; await sleep(400); }
  }
  throw lastErr;
}

const sig = (x) => (x == null ? null : Number(x.toPrecision(6)));
export const fileKey = (key) => String(key).replace(/[^A-Za-z0-9_-]/g, '_');
const day = (ts) => { const d = new Date((ts + 9 * 3600) * 1000); return d.toISOString().slice(0, 10); };
function trim(k) { const n = k.c.length, s = Math.max(0, n - KEEP); return { t: k.t.slice(s).map(day), o: k.o.slice(s).map(sig), c: k.c.slice(s).map(sig), h: k.h.slice(s).map(sig), l: k.l.slice(s).map(sig), v: k.v.slice(s).map((x) => Math.round(x)), cur: k.cur, last: k.t[n - 1] }; }

function writeHist(dir, key, k, scale) {
  const f = (x) => (x == null ? null : sig(scale ? x / scale : x));
  const data = { t: k.t.map(day), o: k.o.map(f), h: k.h.map(f), l: k.l.map(f), c: k.c.map(f), v: k.v.some((x) => x) ? k.v.map((x) => Number(x.toPrecision(4))) : undefined, cur: k.cur };
  writeFileSync(join(dir, fileKey(key) + '.js'), 'window.SNW_HIST&&window.SNW_HIST(' + JSON.stringify(key) + ',' + JSON.stringify(data) + ');\n');
}
const retN = (c, n) => (c.length > n ? (c[c.length - 1] / c[c.length - 1 - n] - 1) * 100 : null);

export async function run({ fetchImpl = fetch, log = console.log, out = OUT, histDir = HIST_DIR, env = loadEnv() } = {}) {
  mkdirSync(histDir, { recursive: true });
  const U = loadUniverse();
  const result = { fetchedAt: new Date().toISOString(), macro: {}, macroSeries: {}, bench: {}, series: {}, errors: [] };

  // 1) 거시 지표
  for (const [key, sym] of Object.entries(MACRO)) {
    try {
      const k = await chart(sym, fetchImpl);
      const n = k.c.length;
      let v = k.c[n - 1], p = k.c[n - 2];
      const scale = key === 'us10y' && v > 20 ? 10 : 0; // 예전 형식(45.0 = 4.50%) 대비
      if (scale) { v /= 10; p /= 10; }
      result.macro[key] = { value: sig(v), prev: sig(p), chgPct: sig((v / p - 1) * 100), chgBp: key === 'us10y' ? Math.round((v - p) * 100) : null,
        y1: sig(retN(k.c, 252)), y3: sig(retN(k.c, 756)), y5: sig(retN(k.c, 1260)), y10: sig(retN(k.c, 2510) ?? (k.c.length > 2000 ? (k.c[n - 1] / k.c[0] - 1) * 100 : null)), since: day(k.t[0]), date: day(k.t[n - 1]) };
      writeHist(histDir, 'm_' + key, k, scale);
      const tk = trim(k);
      if (key === 'us10y' && tk.c[tk.c.length - 1] > 20) ['o', 'c', 'h', 'l'].forEach((f) => { tk[f] = tk[f].map((x) => sig(x / 10)); });
      result.macroSeries[key] = { ...tk, v: undefined };
      if (['spx', 'nasdaq', 'kospi', 'kosdaq'].includes(key)) result.bench[key] = tk.c;
    } catch (e) { result.errors.push(key + ': ' + e.message); }
    await sleep(150);
  }
  log('거시 지표 ' + Object.keys(result.macro).length + '/' + Object.keys(MACRO).length);

  // 2) 종목 (시장 간 중복은 한 번만)
  const jobs = [];
  for (const mk of Object.keys(U.LIST)) for (const it of U.LIST[mk]) if (!jobs.some((j) => j.s === it.s)) jobs.push({ s: it.s, y: U.yahooSymbol(it.s, mk) });
  let done = 0, fail = 0;
  const workers = Array.from({ length: 4 }, async (_, w) => {
    for (let i = w; i < jobs.length; i += 4) {
      const j = jobs[i];
      try {
        const k = await chart(j.y, fetchImpl);
        result.series[j.s] = { ...trim(k), y3: sig(retN(k.c, 756)), y5: sig(retN(k.c, 1260)), y10: sig(retN(k.c, 2510)), since: day(k.t[0]) };
        writeHist(histDir, j.s, k);
      } catch (e) { fail++; result.errors.push(j.s + ': ' + e.message); }
      done++;
      if (done % 25 === 0) log('종목 ' + done + '/' + jobs.length);
      await sleep(120);
    }
  });
  await Promise.all(workers);
  // 3) 재무 지표: 공식 공시 (실패해도 가격·거시 점수는 그대로)
  result.fund = {};
  const priced = (mk) => U.LIST[mk].filter((it) => result.series[it.s]).map((it) => ({ s: it.s, price: result.series[it.s].c[result.series[it.s].c.length - 1] }));
  const uniq = (arr) => arr.filter((x, i) => arr.findIndex((y) => y.s === x.s) === i);
  try {
    const ua = 'sijangnalssi-app/1.0 (' + (env.SEC_CONTACT || 'personal research') + ')';
    Object.assign(result.fund, await fetchSec(uniq(priced('nasdaq').concat(priced('spx'))), { fetchImpl, ua, log }));
  } catch (e) { result.errors.push('SEC: ' + e.message); log('SEC EDGAR 재무를 받지 못했습니다(' + e.message + ')'); }
  try {
    Object.assign(result.fund, await fetchDart(uniq(priced('kospi').concat(priced('kosdaq'))), { key: env.DART_API_KEY, fetchImpl, cacheDir: join(HERE, '.cache'), log }));
  } catch (e) { result.errors.push('DART: ' + e.message); log('OpenDART 재무를 받지 못했습니다(' + e.message + ')'); }

  const dates = Object.values(result.series).map((x) => x.last).filter(Boolean).sort();
  result.asOf = dates.length ? new Date(dates[dates.length - 1] * 1000).toISOString().slice(0, 10) : null;
  log('종목 ' + (jobs.length - fail) + '/' + jobs.length + ' 받음' + (fail ? ' (실패 ' + fail + '개는 순위에서 빠짐)' : ''));

  writeFileSync(out, '/* 자동 생성 파일 — connect/market.mjs 가 만듭니다. 공개 시세만 들어 있습니다. */\nwindow.MARKET_LIVE = ' + JSON.stringify(result) + ';\n');
  log('저장: ' + out);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('시장 데이터 받는 중… (1~3분)');
  run().then((r) => {
    if (!Object.keys(r.series).length) console.error('\n✗ 종목 데이터를 하나도 받지 못했습니다. 인터넷 연결을 확인하고, 잠시 뒤 다시 실행해 보세요.\n  첫 오류: ' + (r.errors[0] || '알 수 없음'));
    else console.log('\n✓ 완료. 앱을 새로고침하면 "순위"와 거시 숫자에 반영됩니다.');
  }).catch((e) => { console.error('✗ 실패: ' + e.message); process.exit(1); });
}
