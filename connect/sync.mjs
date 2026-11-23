#!/usr/bin/env node
/*
 * 시장날씨 — 계좌 동기화 프로그램 (빗썸 + 토스증권)
 *
 * 하는 일: 내 컴퓨터에서 빗썸·토스증권에 "조회"만 요청해 보유 자산을 받아
 *          ../js/holdings-live.js 파일로 저장합니다. 앱은 이 파일을 읽어 보여 줍니다.
 * 하지 않는 일: 주문·출금 요청은 코드에 아예 없습니다. API 키는 이 컴퓨터의 .env 에만 있고
 *          결과 파일에는 들어가지 않습니다(계좌번호도 저장하지 않음).
 *
 * 실행: Node.js 18 이상 필요.  이 폴더에서  node sync.mjs
 * 키 설정: 같은 폴더의 .env.example 을 .env 로 복사한 뒤 키를 채우세요.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHmac, randomUUID, randomBytes, pbkdf2Sync, createCipheriv } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'js', 'holdings-live.js');
export const PBKDF2_ITER = 310000; // 휴대폰용 잠금 파일의 비밀번호 늘이기 횟수

/* ---------- .env 읽기 ---------- */
function loadEnv() {
  const p = join(HERE, '.env');
  if (!existsSync(p)) return {};
  const env = {};
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}
const env = { ...loadEnv(), ...process.env };

async function http(url, opts = {}, label = '') {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) {
    const msg = body && body.error ? (body.error.code || '') + ' ' + (body.error.message || body.error.name || '') : String(text).slice(0, 200);
    throw new Error(label + ' 실패 (HTTP ' + res.status + '): ' + msg);
  }
  return body;
}
const num = (v) => (v == null || v === '' ? 0 : Number(v));

/* ---------- 빗썸: 전체 계좌 조회 (GET /v1/accounts, JWT HS256) ---------- */
function b64url(input) { return Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'); }
function bithumbJwt(accessKey, secretKey) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ access_key: accessKey, nonce: randomUUID(), timestamp: Date.now() }));
  const sig = createHmac('sha256', secretKey).update(header + '.' + payload).digest('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return header + '.' + payload + '.' + sig;
}
const NOT_COIN = new Set(['P']);
async function syncBithumb() {
  const ak = env.BITHUMB_ACCESS_KEY, sk = env.BITHUMB_SECRET_KEY;
  if (!ak || !sk) return { skipped: '빗썸 키가 .env 에 없어 건너뜀' };
  const rows = await http('https://api.bithumb.com/v1/accounts', {
    headers: { Authorization: 'Bearer ' + bithumbJwt(ak, sk), Accept: 'application/json' }
  }, '빗썸 계좌 조회');
  let cash = 0; const holdings = [];
  for (const r of rows) {
    const qty = num(r.balance) + num(r.locked);
    if (r.currency === 'KRW') { cash += qty; continue; }
    if (NOT_COIN.has(r.currency)) continue; // 빗썸 포인트 등 코인이 아닌 항목
    if (qty <= 0) continue;
    holdings.push({ type: 'coin', source: '빗썸', symbol: r.currency, market: 'KRW-' + r.currency, qty, avg: num(r.avg_buy_price) });
  }
  return { holdings, cashKrw: cash };
}

// 통화가 비어 있으면 나라·종목코드로 추정 (미국 주식을 원화로 잘못 계산하는 일 방지)
export function stockCurrency(it) {
  const c = String(it.currency || '').toUpperCase();
  if (c) return c;
  const country = String(it.marketCountry || '').toUpperCase();
  if (country === 'US' || country === 'USA') return 'USD';
  if (country === 'KR' || country === 'KOR') return 'KRW';
  return /^[A-Z][A-Z.\-]{0,9}$/.test(String(it.symbol || '')) ? 'USD' : 'KRW';
}

/* ---------- 토스증권: 토큰 → 계좌 목록 → 보유 주식 ---------- */
async function syncToss() {
  const id = env.TOSS_CLIENT_ID, secret = env.TOSS_CLIENT_SECRET;
  if (!id || !secret) return { skipped: '토스증권 키가 .env 에 없어 건너뜀' };
  const base = 'https://openapi.tossinvest.com';
  const tok = await http(base + '/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret })
  }, '토스증권 토큰 발급');
  const token = tok.access_token || (tok.result && tok.result.access_token);
  if (!token) throw new Error('토스증권 토큰 응답에 access_token 이 없습니다.');
  const auth = { Authorization: 'Bearer ' + token, Accept: 'application/json' };
  const acc = await http(base + '/api/v1/accounts', { headers: auth }, '토스증권 계좌 목록');
  const accounts = acc.result || [];
  console.log('  토스증권 계좌 ' + accounts.length + '개: ' + accounts.map((a) => a.accountType || '종류 미표시').join(', '));
  const holdings = [];
  let shownKeys = false;
  const tossSum = { costKrw: 0, valueKrw: 0 };
  for (const a of accounts) {
    await new Promise((r) => setTimeout(r, 1100)); // 계좌 API는 초당 1회 제한
    const h = await http(base + '/api/v1/holdings', { headers: { ...auth, 'X-Tossinvest-Account': String(a.accountSeq) } }, '토스증권 보유 주식');
    const items = (h.result && h.result.items) || [];
    // 토스가 계산한 계좌 합계(원화 기준 원금·평가금) — 앱 숫자와 맞춰 보는 용도
    try { const tp = h.result.totalPurchaseAmount, mv = h.result.marketValue && h.result.marketValue.amount; tossSum.costKrw += num(tp && tp.krw); tossSum.valueKrw += num(mv && mv.krw); } catch (e) { /* 없으면 생략 */ }
    console.log('  · 계좌(' + (a.accountType || '?') + '): 종목 ' + items.length + '개');
    if (items.length && !shownKeys) { shownKeys = true; console.log('    (토스 응답 항목 이름: ' + Object.keys(items[0]).join(', ') + ')'); }
    for (const it of items) {
      holdings.push({
        type: 'stock', source: '토스증권', symbol: it.symbol, name: it.name,
        country: it.marketCountry, currency: stockCurrency(it),
        qty: num(it.quantity), avg: num(it.averagePurchasePrice), price: num(it.lastPrice),
        rate: it.profitLoss ? num(it.profitLoss.rate) : null
      });
    }
  }
  // 예수금: 미수 제외 현금 매수가능금액(원화·달러)을 계좌별로 더함
  let cashKrw = 0, cashUsd = 0;
  for (const a of accounts) {
    for (const cur of ['KRW', 'USD']) {
      await new Promise((r) => setTimeout(r, 1100));
      try {
        const b = await http(base + '/api/v1/buying-power?currency=' + cur, { headers: { ...auth, 'X-Tossinvest-Account': String(a.accountSeq) } }, '토스증권 ' + cur + ' 예수금');
        const v = num(b.result && b.result.cashBuyingPower);
        if (cur === 'KRW') cashKrw += v; else cashUsd += v;
      } catch (e) { console.log('  · ' + e.message); }
    }
  }
  console.log('  · 토스증권 예수금: 원화 ' + Math.round(cashKrw).toLocaleString('ko-KR') + '원, 달러 $' + cashUsd.toLocaleString('en-US'));
  if (tossSum.costKrw) console.log('  · 토스 계산 기준: 원금 ' + Math.round(tossSum.costKrw).toLocaleString('ko-KR') + '원 · 평가 ' + Math.round(tossSum.valueKrw).toLocaleString('ko-KR') + '원 (토스 앱 "내 투자"와 같아야 함)');
  return { holdings, cashKrw, cashUsd, tossSum };
}

/* ---------- 실행 ---------- */
const out = { syncedAt: new Date().toISOString(), sources: [], holdings: [], cashKrw: 0, notes: [], repo: env.GITHUB_REPO || null }; // repo: 컴퓨터 앱이 모의투자 결과를 GitHub 에서 불러올 때 씀
for (const [name, fn] of [['빗썸', syncBithumb], ['토스증권', syncToss]]) {
  try {
    const r = await fn();
    if (r.skipped) { out.notes.push(r.skipped); console.log('· ' + r.skipped); continue; }
    out.sources.push(name);
    out.holdings.push(...r.holdings);
    out.cashKrw += r.cashKrw || 0;
    if (r.cashKrw) (out.cashParts = out.cashParts || {})[name + ' 원화'] = r.cashKrw;
    if (r.cashUsd) out.cashUsd = (out.cashUsd || 0) + r.cashUsd;
    console.log('✓ ' + name + ': ' + r.holdings.length + '개 종목');
  } catch (e) {
    out.notes.push(name + ' 오류: ' + e.message);
    console.error('✗ ' + name + ' — ' + e.message);
  }
}
await printSummary(out); // 동기화 시점 가격·환율·총액을 결과에 함께 저장 (앱에서 시세를 못 받을 때 대신 씀)
writeFileSync(OUT, '/* 자동 생성 파일 — connect/sync.mjs 가 만듭니다. 인터넷에 올리지 마세요(내 보유 자산이 들어 있음). */\nwindow.LIVE_HOLDINGS = ' + JSON.stringify(out, null, 2) + ';\n');
console.log('\n저장: ' + OUT + '\n앱을 새로고침하면 "내 자산"에 반영됩니다.');
await sendToPhone(out);

/* ---------- 휴대폰으로 보내기: 비밀번호로 잠근 파일만 GitHub 에 올림 ----------
 * - 키(빗썸·토스)는 절대 올리지 않습니다. 보유 내역만 AES-256-GCM 으로 암호화합니다.
 * - 비밀번호(SNW_PHONE_PASSWORD)는 이 컴퓨터 .env 와 휴대폰에만 있습니다.
 * - GITHUB_TOKEN: 이 저장소 하나, Contents 읽기·쓰기만 허락한 토큰 */
export function encryptForPhone(obj, password, keepSalt) {
  // 소금(salt)은 처음 한 번 정한 걸 계속 씀 → 휴대폰이 비밀번호를 기억해 두면 매번 다시 안 넣어도 됨. iv 는 매번 새로.
  const salt = keepSalt ? Buffer.from(keepSalt, 'base64') : randomBytes(16), iv = randomBytes(12);
  const key = pbkdf2Sync(password, salt, PBKDF2_ITER, 32, 'sha256');
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final(), c.getAuthTag()]);
  return { v: 1, alg: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iter: PBKDF2_ITER, salt: salt.toString('base64'), iv: iv.toString('base64'), ct: ct.toString('base64'), at: new Date().toISOString() };
}
async function sendToPhone(o) {
  const pw = env.SNW_PHONE_PASSWORD;
  if (!pw) { console.log('\n· 휴대폰 보내기: .env 에 SNW_PHONE_PASSWORD 가 없어 건너뜀'); return; }
  if (pw.length < 10) { console.log('\n✗ 휴대폰 보내기: 비밀번호가 너무 짧습니다(10자 이상). 건너뜀'); return; }
  const local = join(HERE, '..', 'data', 'holdings.enc.json');
  let keepSalt = null; try { keepSalt = JSON.parse(readFileSync(local, 'utf8')).salt; } catch (e) { /* 처음 */ }
  const box = encryptForPhone(o, pw, keepSalt);
  mkdirSync(dirname(local), { recursive: true });
  writeFileSync(local, JSON.stringify(box));
  const token = env.GITHUB_TOKEN, repo = env.GITHUB_REPO; // 예: rudrl09202-bit/sijangnalssi
  if (!token || !repo) { console.log('\n· 휴대폰 보내기: 잠근 파일만 만들었습니다(GITHUB_TOKEN·GITHUB_REPO 가 없어 업로드는 건너뜀)'); return; }
  const url = 'https://api.github.com/repos/' + repo + '/contents/data/holdings.enc.json';
  const head = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'sijangnalssi-sync' };
  try {
    let sha;
    try { sha = (await http(url, { headers: head }, '기존 파일 확인')).sha; } catch (e) { /* 처음 올림 */ }
    await http(url, { method: 'PUT', headers: { ...head, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '내 자산(암호화) 갱신', content: Buffer.from(JSON.stringify(box)).toString('base64'), ...(sha ? { sha } : {}) }) }, 'GitHub 업로드');
    console.log('\n✓ 휴대폰 보내기: 잠근 자산 파일을 올렸습니다. 휴대폰 앱에서 1~5분 뒤 새로고침하세요.');
  } catch (e) { console.log('\n✗ 휴대폰 보내기 실패: ' + e.message); }
}

/* ---------- 확인용 요약: 앱과 증권사 앱의 총액을 비교할 수 있게 ---------- */
async function printSummary(o) {
  let usd = 0;
  try { const r = await http('https://quotation-api-cdn.dunamu.com/v1/forex/recent?codes=FRX.KRWUSD', {}, '환율'); usd = num(r[0] && r[0].basePrice); } catch (e) { /* 아래 기본값 */ }
  if (!usd) usd = 1400;
  const coins = o.holdings.filter((h) => h.type === 'coin');
  const px = {};
  if (coins.length) {
    try {
      const r = await http('https://api.bithumb.com/v1/ticker?markets=' + coins.map((c) => c.market).join(','), {}, '빗썸 시세');
      (Array.isArray(r) ? r : []).forEach((t) => { px[t.market] = num(t.trade_price); });
    } catch (e) { /* 시세 없으면 평단으로 */ }
  }
  const man = (v) => (Math.round(v / 10000)).toLocaleString('ko-KR') + '만원';
  const bySrc = {}; let total = o.cashKrw || 0;
  console.log('\n──── 확인용 요약 (원/달러 ' + usd.toLocaleString('ko-KR') + '원) ────');
  for (const h of o.holdings) {
    const fx = h.currency === 'USD' ? usd : 1;
    const price = h.type === 'coin' ? (px[h.market] || h.avg) : (h.price || h.avg);
    const v = price * h.qty * fx;
    if (h.type === 'coin' && px[h.market]) h.syncPrice = px[h.market];
    h.syncValue = Math.round(v);
    total += v; bySrc[h.source] = (bySrc[h.source] || 0) + v;
    const tag = h.type === 'coin' ? (px[h.market] ? '' : ' (시세 못 받음·평단 기준)') : (h.currency === 'USD' ? ' (달러)' : '');
    console.log('  ' + (h.name || h.symbol) + ' ' + h.qty + '주/개 × ' + price.toLocaleString('ko-KR') + tag + ' = ' + man(v));
  }
  Object.keys(bySrc).forEach((k) => console.log('  [' + k + ' 합계] ' + man(bySrc[k])));
  if (o.cashUsd) { // 달러 예수금은 원화로 바꿔 예수금에 합침
    const k = Math.round(o.cashUsd * usd); o.cashKrw += k; total += k;
    (o.cashParts = o.cashParts || {})['토스증권 달러'] = k;
  }
  Object.keys(o.cashParts || {}).forEach((k) => console.log('  [예수금 · ' + k + '] ' + man(o.cashParts[k])));
  o.usdkrw = usd; o.totalKrw = Math.round(total);
  console.log('  ▶ 총합 ' + man(total) + '  ← 빗썸·토스 앱의 총자산과 비교해 보세요');
}

/* ---------- 시장 데이터(종목 순위·거시 숫자)도 같이 받기 ---------- */
if (!process.env.SNW_SKIP_MARKET) {
  console.log('\n시장 데이터 받는 중… (1~3분, 키 필요 없음)');
  try {
    const { run } = await import('./market.mjs');
    const r = await run();
    if (!Object.keys(r.series).length) console.error('✗ 시장 데이터를 받지 못했습니다: ' + (r.errors[0] || '알 수 없음'));
    else console.log('✓ 시장 데이터: 종목 ' + Object.keys(r.series).length + '개 · 거시 지표 ' + Object.keys(r.macro).length + '개');
  } catch (e) { console.error('✗ 시장 데이터 실패: ' + e.message); }
}
