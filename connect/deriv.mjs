/* 선물 시장 데이터 수집 (서울 서버에서 매시간) — 민경기 봇의 학습 재료
 *  바이낸스 USDT 무기한 선물 (공개 데이터, 키 필요 없음 — 미국에서는 막혀 있어 GitHub 대신 이 서버에서 모음)
 *   · 펀딩비 (8시간마다, 과거 2년 전부 받을 수 있음)
 *   · 미결제약정(OI) · 전체 계정 롱숏 비율 · 상위 트레이더 포지션 롱숏 비율 · 테이커 매수/매도 비율 (1시간, 바이낸스는 최근 30일만 줌 → 매시간 쌓아 둠)
 *  저장: connect/.cache/deriv.json (서버) + GitHub 'deriv-data' 브랜치 deriv.json (봇이 읽음, 공개 시세 데이터라 내 정보 없음)
 *  실행: node connect/deriv.mjs   (sync.mjs 가 매시간 끝에 자동으로 부름)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = join(HERE, '.cache', 'deriv.json');
const BASE = 'https://fapi.binance.com';
const HOUR = 3600e3, DAY = 864e5;
export const DERIV_COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'ADA', 'LINK'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJ(url, fetchImpl) {
  for (let k = 0; k < 3; k++) {
    try { const r = await fetchImpl(url, { headers: { 'User-Agent': 'sijangnalssi-deriv' } }); if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 120)); return await r.json(); }
    catch (e) { if (k === 2) throw e; await sleep(1000 * (k + 1)); }
  }
}
// [[t, v], ...] 에 새 값 합치기 (같은 시각은 새 값으로)
function merge(arr, rows) { const m = new Map(arr); rows.forEach(([t, v]) => { if (isFinite(t) && isFinite(v)) m.set(t, v); }); return [...m.entries()].sort((a, b) => a[0] - b[0]); }

// 4시간봉 긴 역사 (바이낸스 선물, 상장 때부터) — 시세 + 거래량 + 테이커 매수량
// 파일: connect/.cache/k4-<코인>.json = { t:[...], o,h,l,c,v,tb } (tb = 테이커 매수 거래량)
const K4 = 4 * HOUR;
export async function collectK4({ now = Date.now(), fetchImpl = fetch, log = console.log, dir = join(HERE, '.cache') } = {}) {
  const out = {}; let ok = 0; const errs = [];
  for (const c of DERIV_COINS) {
    const f = join(dir, 'k4-' + c + '.json');
    let K = { t: [], o: [], h: [], l: [], c: [], v: [], tb: [] }; try { K = JSON.parse(readFileSync(f, 'utf8')); } catch (e) { /* 처음 */ }
    try {
      let st = K.t.length ? K.t[K.t.length - 1] + K4 : Date.UTC(2019, 0, 1);
      for (let k = 0; k < 12 && st < now - K4; k++) {
        const j = await getJ(BASE + '/fapi/v1/klines?symbol=' + c + 'USDT&interval=4h&limit=1500&startTime=' + st, fetchImpl);
        const rows = j.filter((r) => Number(r[6]) < now); // 끝난 봉만
        rows.forEach((r) => { const t = Number(r[0]); if (K.t.length && t <= K.t[K.t.length - 1]) return; K.t.push(t); K.o.push(+r[1]); K.h.push(+r[2]); K.l.push(+r[3]); K.c.push(+r[4]); K.v.push(+r[7]); K.tb.push(+r[10]); });
        if (j.length < 1500) break; st = Number(j[j.length - 1][0]) + K4; await sleep(250);
      }
      mkdirSync(dir, { recursive: true }); writeFileSync(f, JSON.stringify(K)); out[c] = K; ok++;
    } catch (e) { errs.push(c + ': ' + e.message); if (K.t.length) out[c] = K; }
  }
  const b = out.BTC; log('4시간봉 역사: ' + ok + '/' + DERIV_COINS.length + '코인 · 비트코인 ' + (b ? b.t.length + '봉 (' + new Date(b.t[0]).toISOString().slice(0, 10) + '부터)' : '없음') + (errs.length ? ' · 오류 ' + errs.join(' / ') : ''));
  return out;
}
export async function collect({ db, now = Date.now(), fetchImpl = fetch, log = console.log } = {}) {
  db = db || { v: 1, coins: {} };
  let ok = 0; const errs = [];
  for (const c of DERIV_COINS) {
    const s = c + 'USDT', D = db.coins[c] || (db.coins[c] = { f: [], oi: [], ls: [], top: [], tk: [] });
    try {
      // 펀딩비: 마지막 이후부터 (처음이면 2년 전부터) 1000개씩
      let from = D.f.length ? D.f[D.f.length - 1][0] + 1 : now - 730 * DAY;
      for (let k = 0; k < 4 && from < now; k++) {
        const j = await getJ(BASE + '/fapi/v1/fundingRate?symbol=' + s + '&startTime=' + from + '&limit=1000', fetchImpl);
        if (!j.length) break;
        D.f = merge(D.f, j.map((x) => [Number(x.fundingTime), Number(x.fundingRate)]));
        from = Number(j[j.length - 1].fundingTime) + 1; if (j.length < 1000) break; await sleep(250);
      }
      // 1시간 통계 (최근 30일까지만 제공 → 마지막 이후 또는 29일 전부터)
      for (const [key, path, pick] of [
        ['oi', '/futures/data/openInterestHist', (x) => Number(x.sumOpenInterestValue)],
        ['ls', '/futures/data/globalLongShortAccountRatio', (x) => Number(x.longShortRatio)],
        ['top', '/futures/data/topLongShortPositionRatio', (x) => Number(x.longShortRatio)],
        ['tk', '/futures/data/takerlongshortRatio', (x) => Number(x.buySellRatio)]]) {
        // 빈 구간: 앞쪽(29일 전 ~ 처음 기록)과 뒤쪽(마지막 기록 ~ 지금)을 500시간 창으로 끝 시각까지 지정해 받음
        const lo = now - 29 * DAY, A = D[key], wins = [];
        if (!A.length) wins.push([lo, now]);
        else { if (A[0][0] - lo > 2 * HOUR) wins.push([lo, A[0][0] - 1]); wins.push([A[A.length - 1][0] + 1, now]); }
        for (const [a, b] of wins) for (let st = a, k = 0; st < b - HOUR && k < 4; st += 500 * HOUR, k++) {
          const j = await getJ(BASE + path + '?symbol=' + s + '&period=1h&limit=500&startTime=' + st + '&endTime=' + Math.min(b, st + 500 * HOUR), fetchImpl);
          if (j.length) D[key] = merge(D[key], j.map((x) => [Number(x.timestamp), pick(x)]));
          await sleep(200);
        }
        await sleep(150);
      }
      ok++;
    } catch (e) { errs.push(c + ': ' + e.message); }
  }
  db.updatedAt = new Date(now).toISOString();
  const b = db.coins.BTC || { f: [], oi: [] };
  db.cover = { fundFrom: b.f.length ? new Date(b.f[0][0]).toISOString() : null, oiFrom: b.oi.length ? new Date(b.oi[0][0]).toISOString() : null, oiDays: b.oi.length ? Math.round((b.oi[b.oi.length - 1][0] - b.oi[0][0]) / DAY) : 0 };
  log('선물 데이터: ' + ok + '/' + DERIV_COINS.length + '코인 · 펀딩 ' + b.f.length + '개 · OI ' + b.oi.length + '시간(' + db.cover.oiDays + '일)' + (errs.length ? ' · 오류 ' + errs.join(' / ') : ''));
  return { db, ok, errs };
}

// 올릴 때는 작게: 1시간 계열은 {t0, v:[매시간 값, 빈 시간은 null]}, 펀딩은 [[t, rate]]
const sig = (x) => (x == null ? null : Number(x.toPrecision(5)));
export function compact(db) {
  const out = { v: 2, updatedAt: db.updatedAt, cover: db.cover, coins: {} };
  for (const [c, D] of Object.entries(db.coins)) {
    const o = { f: D.f.map(([t, v]) => [t, sig(v)]) };
    for (const k of ['oi', 'ls', 'top', 'tk']) { const a = D[k]; if (!a.length) { o[k] = { t0: null, v: [] }; continue; }
      const t0 = Math.floor(a[0][0] / HOUR) * HOUR, n = Math.round((a[a.length - 1][0] - t0) / HOUR) + 1, v = new Array(n).fill(null);
      a.forEach(([t, x]) => { const i = Math.round((t - t0) / HOUR); if (i >= 0 && i < n) v[i] = sig(x); }); o[k] = { t0, v }; }
    out.coins[c] = o;
  }
  return out;
}
// GitHub 'deriv-data' 브랜치에 올리기 (없으면 만듦)
async function upload(db, env, fetchImpl = fetch, log = console.log, k4 = null) {
  const token = env.GITHUB_TOKEN, repo = env.GITHUB_REPO;
  if (!token || !repo) { log('· 선물 데이터: GITHUB_TOKEN·GITHUB_REPO 가 없어 서버에만 저장'); return false; }
  const api = 'https://api.github.com/repos/' + repo, H = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'sijangnalssi-deriv' };
  let r = await fetchImpl(api + '/git/ref/heads/deriv-data', { headers: H });
  if (r.status === 404) {
    const main = await (await fetchImpl(api + '/git/ref/heads/main', { headers: H })).json();
    r = await fetchImpl(api + '/git/refs', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: 'refs/heads/deriv-data', sha: main.object.sha }) });
    if (!r.ok) throw new Error('브랜치 만들기 실패 HTTP ' + r.status);
  }
  const put = async (name, obj) => {
    const url = api + '/contents/' + name;
    let sha; const g = await fetchImpl(url + '?ref=deriv-data', { headers: H }); if (g.ok) sha = (await g.json()).sha;
    const p = await fetchImpl(url, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: name + ' ' + db.updatedAt.slice(0, 16), branch: 'deriv-data', content: Buffer.from(JSON.stringify(obj)).toString('base64'), ...(sha ? { sha } : {}) }) });
    if (!p.ok) throw new Error(name + ' 업로드 실패 HTTP ' + p.status + ' ' + (await p.text()).slice(0, 120));
  };
  await put('deriv.json', compact(db));
  for (const [c, K] of Object.entries(k4 || {})) { try { await put('k4-' + c + '.json', K); } catch (e) { log('✗ ' + e.message); } }
  log('✓ 선물 데이터 올림 (deriv-data 브랜치' + (k4 ? ' · 4시간봉 ' + Object.keys(k4).length + '코인' : '') + ')'); return true;
}

export async function run({ env = {}, fetchImpl = fetch, log = console.log } = {}) {
  let db = null; try { db = JSON.parse(readFileSync(FILE, 'utf8')); } catch (e) { /* 처음 */ }
  const r = await collect({ db, fetchImpl, log });
  mkdirSync(dirname(FILE), { recursive: true }); writeFileSync(FILE, JSON.stringify(r.db));
  // 4시간봉은 새 봉이 생길 때만(4시간마다) 올림
  let k4 = null; try { k4 = await collectK4({ fetchImpl, log }); } catch (e) { log('✗ 4시간봉: ' + e.message); }
  const h = new Date().getUTCHours(), first = !existsSync(join(HERE, '.cache', 'k4-uploaded'));
  if (k4 && !(first || h % 4 === 0)) k4 = null;
  if (r.ok) { try { await upload(r.db, env, fetchImpl, log, k4); if (k4) writeFileSync(join(HERE, '.cache', 'k4-uploaded'), new Date().toISOString()); } catch (e) { log('✗ 선물 데이터 올리기: ' + e.message); } }
  return r;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = { ...process.env }; try { readFileSync(join(HERE, '.env'), 'utf8').split('\n').forEach((l) => { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }); } catch (e) { /* 없음 */ }
  run({ env }).catch((e) => { console.error('✗ ' + e.message); process.exitCode = 1; });
}
