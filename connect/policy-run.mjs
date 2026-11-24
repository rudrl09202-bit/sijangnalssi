/* 금리·물가 갱신 실행: node connect/policy-run.mjs
 * 4시간마다(선물 작업과 함께) 돌며 → data/policy-live.json (앱이 읽음)
 * 지난번과 값이 바뀌면 "발표"로 보고 푸시 알림. 키가 없으면 아무것도 안 함
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fetchPolicy, policyNews } from './policy.mjs';
import { loadEnv, push } from './paper.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export async function run({ root = ROOT, env = loadEnv(), log = console.log, fetchImpl = fetch, now = new Date(), sendPush = true } = {}) {
  if (!env.FRED_API_KEY && !env.ECOS_API_KEY) { log('ECOS·FRED 키가 없어 금리 자동 갱신을 건너뜁니다'); return null; }
  const cur = await fetchPolicy(env, { fetchImpl, now });
  const stFile = join(root, 'data', 'policy-state.json');
  const prev = existsSync(stFile) ? JSON.parse(readFileSync(stFile, 'utf8')) : null;
  // 이번에 못 받은 값은 지난번 값을 유지 (일시 오류로 화면이 비지 않게)
  const keep = (a, b) => { if (!b) return a; if (!a) return b; const o = { ...b, ...a }; Object.keys(b).forEach((k) => { if (o[k] == null) o[k] = b[k]; }); return o; };
  if (prev) { cur.fred = keep(cur.fred, prev.fred); cur.ecos = keep(cur.ecos, prev.ecos); }
  const news = prev ? policyNews(prev, cur) : [];
  cur.news = news.length ? news.map((t) => ({ t, at: now.toISOString() })).concat((prev && prev.news) || []).slice(0, 10) : (prev && prev.news) || [];
  mkdirSync(join(root, 'data'), { recursive: true });
  writeFileSync(stFile, JSON.stringify(cur));
  writeFileSync(join(root, 'data', 'policy-live.json'), JSON.stringify(cur));
  const f = cur.fred || {}, e = cur.ecos || {};
  log('금리·물가: 연준 ' + (f.fedUpper ? (f.fedLower ? f.fedLower.value + '~' : '') + f.fedUpper.value + '%' : '—') + ' · 한은 ' + (e.bokRate ? e.bokRate.value + '%' : '—')
    + ' · 미국 CPI ' + (f.cpiYoY ? f.cpiYoY.value.toFixed(1) + '%' : '—') + ' · 한국 CPI ' + (e.krCpiYoY ? e.krCpiYoY.value + '%' : '—') + ' · 다가오는 발표 ' + ((f.events || []).length) + '건'
    + ((f.errors || []).length || (e.errors || []).length ? ' · 일부 실패: ' + [].concat(f.errors || [], e.errors || [], cur.fredError || [], cur.ecosError || []).join(' / ') : ''));
  if (news.length) {
    log('새 발표: ' + news.join(' | '));
    if (sendPush) await push(env, { title: '경제 발표 ' + news.length + '건', body: news.join('\n'), url: './index.html#home', tag: 'snw-policy' }, log);
  }
  return cur;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run().catch((e) => { console.error('✗ ' + e.message); process.exitCode = 0; });
