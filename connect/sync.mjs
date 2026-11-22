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
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'js', 'holdings-live.js');

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
  const accounts = (acc.result || []).filter((a) => !a.accountType || a.accountType === 'BROKERAGE');
  const holdings = [];
  for (const a of accounts) {
    await new Promise((r) => setTimeout(r, 1100)); // 계좌 API는 초당 1회 제한
    const h = await http(base + '/api/v1/holdings', { headers: { ...auth, 'X-Tossinvest-Account': String(a.accountSeq) } }, '토스증권 보유 주식');
    const items = (h.result && h.result.items) || [];
    for (const it of items) {
      holdings.push({
        type: 'stock', source: '토스증권', symbol: it.symbol, name: it.name,
        country: it.marketCountry, currency: it.currency || 'KRW',
        qty: num(it.quantity), avg: num(it.averagePurchasePrice), price: num(it.lastPrice),
        rate: it.profitLoss ? num(it.profitLoss.rate) : null
      });
    }
  }
  return { holdings };
}

/* ---------- 실행 ---------- */
const out = { syncedAt: new Date().toISOString(), sources: [], holdings: [], cashKrw: 0, notes: [] };
for (const [name, fn] of [['빗썸', syncBithumb], ['토스증권', syncToss]]) {
  try {
    const r = await fn();
    if (r.skipped) { out.notes.push(r.skipped); console.log('· ' + r.skipped); continue; }
    out.sources.push(name);
    out.holdings.push(...r.holdings);
    out.cashKrw += r.cashKrw || 0;
    console.log('✓ ' + name + ': ' + r.holdings.length + '개 종목');
  } catch (e) {
    out.notes.push(name + ' 오류: ' + e.message);
    console.error('✗ ' + name + ' — ' + e.message);
  }
}
writeFileSync(OUT, '/* 자동 생성 파일 — connect/sync.mjs 가 만듭니다. 인터넷에 올리지 마세요(내 보유 자산이 들어 있음). */\nwindow.LIVE_HOLDINGS = ' + JSON.stringify(out, null, 2) + ';\n');
console.log('\n저장: ' + OUT + '\n앱을 새로고침하면 "내 자산"에 반영됩니다.');

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
