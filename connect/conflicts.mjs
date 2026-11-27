#!/usr/bin/env node
/* 분쟁 지도 목록 제안 (머니 글로브) — 구글 뉴스 RSS 로 기사를 직접 모으고, Gemini 는 그 기사만 보고 정리. 보여 주기용, 봇 판단에는 안 씀
 *  왜 이렇게: Gemini 의 구글 검색 도구는 모델이 쓸지 말지 스스로 정하고 강제할 수 없음 — 11/27 에 24번 연속 검색 없이 기억으로 답함
 *   (진단: serviceTier standard · groundingMetadata 없음 · 생각 토큰 2,106). 그래서 기사 수집은 우리가 하고, 출처는 모은 기사 링크만 씀 → 링크를 지어낼 수 없음
 *  하는 일: ① 지금 목록의 분쟁마다 "이름 when:30d" 뉴스 검색 ② 새 분쟁 찾기용 검색(한국어·영어) ③ 기사 제목 목록을 번호와 함께 Gemini 에 주고
 *   "진행 중인지 + 근거 기사 번호", "새 분쟁 + 근거 기사 번호"를 JSON 으로 받음 ④ 근거 번호가 실제 기사일 때만 씀
 *  사람 확인: 결과 data/conflicts.json 은 워크플로(.github/workflows/conflicts.yml)가 PR 로 올림 → 사람이 읽고 합쳐야 앱에 나타남
 *  규칙: 근거 기사 없는 항목·나라 코드가 이상한 항목은 버림. 끝남(근거 기사 있음) → 뺌, 답 없음 → 마지막 확인 뒤 30일까지 그대로 둠
 *  키: GEMINI_API_KEY (모델 GEMINI_MODEL, 실패하면 council.mjs 의 예비 모델)
 *  실행: node connect/conflicts.mjs   (--dry: 파일 안 쓰고 결과만 출력)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { loadEnv } from './paper.mjs';
import { VOTERS, askGemini } from './council.mjs';
const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..');
const KINDS = { war: '나라 사이 전쟁', civil: '내전·무장 충돌', border: '국경 충돌' };
const today = (now) => new Date(now).toISOString().slice(0, 10);
// 구글 뉴스 RSS: 제목·링크·날짜·언론사
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; sijangnalssi/1.0)' };
const dec = (x) => String(x || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
export function parseFeed(xml) { const out = [];
  for (const m of String(xml).matchAll(/<item[\s>][\s\S]*?<\/item>/g)) { const it = m[0], g = (re) => dec((it.match(re) || [])[1]);
    const title = g(/<title[^>]*>([\s\S]*?)<\/title>/), link = g(/<link[^>]*>([\s\S]*?)<\/link>/), t = Date.parse(g(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/)), src = g(/<source[^>]*>([\s\S]*?)<\/source>/);
    if (title && /^https?:\/\//.test(link)) out.push({ title: title.slice(0, 160), link, t: isFinite(t) ? t : null, src }); }
  return out; }
// 연달아 보내면 429(너무 잦은 요청)가 나서: 검색 사이 1.5초 쉬고, 429 면 5초 뒤 한 번 더
export async function news(q, lang, fetchImpl = fetch, wait = 1500) {
  await new Promise((ok) => setTimeout(ok, wait));
  try { return await news1(q, lang, fetchImpl); } catch (e) { if (!/429/.test(e.message)) throw e; await new Promise((ok) => setTimeout(ok, wait * 3.3)); return news1(q, lang, fetchImpl); } }
async function news1(q, lang, fetchImpl) {
  const L = lang === 'en' ? 'hl=en-US&gl=US&ceid=US:en' : 'hl=ko&gl=KR&ceid=KR:ko', c = new AbortController(), to = setTimeout(() => c.abort(), 15000);
  try { const r = await fetchImpl('https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&' + L, { headers: UA, signal: c.signal }); if (!r.ok) throw new Error('뉴스 HTTP ' + r.status); return parseFeed(await r.text()); } finally { clearTimeout(to); } }
const FIND = [['공습 OR 교전 OR 무력충돌 OR 포격 when:7d', 'ko'], ['내전 OR 반군 교전 when:7d', 'ko'], ['airstrike OR shelling OR "armed clashes" when:7d', 'en'], ['"civil war" OR insurgents fighting when:7d', 'en']];
const SYSTEM = `당신은 국제 분쟁 뉴스를 정리하는 편집자입니다. 반드시 사용자가 준 기사 제목 목록만 근거로 판단하고, 목록에 없는 사실은 쓰지 마세요.
- 근거로 쓴 기사는 번호(E 뒤 숫자)로만 적으세요. 근거가 없으면 그 항목은 빼세요.
- 실제 전투·공습·포격·교전 보도만 인정합니다. 외교 회담·제재·무역 갈등·재판·과거 회고 기사는 근거가 아닙니다.
- 나라는 ISO 3166-1 두 글자 대문자 코드. 나라 사이 전쟁 kind "war", 한 나라 안 내전·무장 충돌 kind "civil"(b 는 null), 국경 충돌 kind "border". 공격하는 쪽을 a 에.
- 한국어로, JSON 하나만 답하세요.`;
const PROMPT = (d, items, ev) => `오늘은 ${d} 입니다. 아래는 구글 뉴스에서 모은 최근 30일 기사 제목입니다.
${ev.map((e, i) => 'E' + (i + 1) + ' [' + (e.t ? new Date(e.t).toISOString().slice(0, 10) : '날짜?') + ' · ' + (e.src || '?') + '] ' + e.title).join('\n')}

1) 지금 목록의 분쟁마다, 위 기사에 최근 30일 전투 보도가 있으면 active true, 휴전·종전이 보도됐으면 active false, 기사가 없으면 빼세요:
${items.map((x) => x.id + ' ' + (x.name || '')).join('\n') || '(없음)'}
2) 위 기사에 나온 새 무력 분쟁(지금 목록에 없는 것)을 최대 5개, 큰 것부터.
답 모양:
{"existing":[{"id":"RU-UA","active":true,"summary":"지금 상황 한 문장","reason":"끝났다면 이유","evidence":[3,7]}],
 "new":[{"a":"SD","b":null,"kind":"civil","name":"한국어 이름","since":"시작 연도","summary":"지금 상황 한 문장","evidence":[12]}]}`;
export function parseObj(text) { const o = text.indexOf('{'), e = text.lastIndexOf('}'); if (o < 0 || e < o) throw new Error('JSON 없음'); return JSON.parse(text.slice(o, e + 1)); }
// 답: { active:[...], ended:[...] } (예전 형식인 배열만 와도 받음)
export function parseList(text) {
  const o = text.indexOf('{'), a = text.indexOf('[');
  if (o >= 0 && (a < 0 || o < a)) { const j = JSON.parse(text.slice(o, text.lastIndexOf('}') + 1)); return { active: Array.isArray(j.active) ? j.active : [], ended: Array.isArray(j.ended) ? j.ended : [] }; }
  const e = text.lastIndexOf(']'); if (a < 0 || e < a) throw new Error('JSON 없음'); return { active: JSON.parse(text.slice(a, e + 1)), ended: [] };
}
const ISO = /^[A-Z]{2}$/, URLRE = /^https?:\/\/[^\s]+$/;
export function clean(list, prev, d, endedList = []) {
  const old = new Map(((prev && prev.items) || []).map((x) => [x.id, x])), out = [], drop = [];
  for (const x of Array.isArray(list) ? list : []) {
    const a = String(x.a || '').toUpperCase(), b = x.b ? String(x.b).toUpperCase() : null, kind = KINDS[x.kind] ? x.kind : null;
    const src = (Array.isArray(x.sources) ? x.sources : []).map(String).filter((u) => URLRE.test(u)).slice(0, 3);
    const why = !ISO.test(a) ? '나라 코드' : b && !ISO.test(b) ? '상대 나라 코드' : !kind ? '종류' : kind !== 'civil' && !b ? '상대 없음' : !src.length ? '출처 없음' : null;
    if (why) { drop.push((x.name || a) + ': ' + why); continue; }
    const id = kind === 'civil' ? a : [a, b].sort().join('-'), o = old.get(id);
    if (out.some((y) => y.id === id)) continue;
    out.push({ id, a, b: kind === 'civil' ? null : b, kind, name: String(x.name || '').slice(0, 40), since: String(x.since || '').slice(0, 10), summary: String(x.summary || '').slice(0, 160), sources: src, outlets: (Array.isArray(x.outlets) ? x.outlets : []).slice(0, 3).map((o) => String(o).slice(0, 40)), first: o ? o.first : d, checked: d });
  }
  // 지금 목록 중 답에 없는 것: 끝남(출처 있음) → 뺌, 답 없음 → 마지막 확인 30일 안이면 그대로 둠
  const ended = new Map((Array.isArray(endedList) ? endedList : []).map((x) => [String(x.id || '').toUpperCase(), x]).filter(([, x]) => (x.sources || []).some((u) => URLRE.test(String(u)))));
  const age = (c) => (Date.parse(d) - Date.parse(c || d)) / 864e5, gone = [], kept = [];
  for (const [k, o] of old) { if (out.some((y) => y.id === k)) continue;
    if (ended.has(k)) { gone.push((o.name || k) + ' — 끝남: ' + String(ended.get(k).reason || '').slice(0, 80) + ' (' + ended.get(k).sources[0] + ')'); continue; }
    if (age(o.checked) <= 30) { out.push(o); kept.push((o.name || k) + ' (마지막 확인 ' + o.checked + ')'); } else gone.push((o.name || k) + ' — 30일 넘게 확인 못 함'); }
  return { items: out, drop, gone, kept, added: out.filter((y) => !old.has(y.id)).map((y) => y.name || y.id) };
}
export async function run({ root = ROOT, now = Date.now(), env = loadEnv(), fetchImpl = fetch, log = console.log, dry = false, ...opts } = {}) {
  const key = env.GEMINI_API_KEY; if (!key) { log('분쟁 목록: GEMINI_API_KEY 없음 → 건너뜀'); return null; }
  const model = env.GEMINI_MODEL || VOTERS.find((v) => v.id === 'gemini').def, f = join(root, 'data', 'conflicts.json'), d = today(now);
  let prev = null; try { if (existsSync(f)) prev = JSON.parse(readFileSync(f, 'utf8')); } catch (e) { prev = null; }
  const g = VOTERS.find((v) => v.id === 'gemini'), models = [model, ...((g && g.backup) || [])].filter((m, i, a) => m && a.indexOf(m) === i);
  const items0 = (prev && prev.items) || [], cut = now - 30 * 864e5, ev = [], seen = new Set(), errs = [];
  const add = (list, n) => { let k = 0; for (const e of list) { if (k >= n) break; if (e.t && e.t < cut) continue; const key = e.title.slice(0, 40); if (seen.has(key)) continue; seen.add(key); ev.push(e); k++; } };
  // ① 지금 목록 분쟁마다 6개 ② 새 분쟁 찾기 검색마다 12개
  for (const x of items0) { try { add(await news((x.name || x.id).replace(/\s*(분쟁|전쟁)$/, '') + ' when:30d', 'ko', fetchImpl, opts.newsWait), 6); } catch (e) { errs.push((x.name || x.id) + ': ' + e.message); } }
  for (const [q, l] of FIND) { try { add(await news(q, l, fetchImpl, opts.newsWait), 12); } catch (e) { errs.push('찾기 ' + l + ': ' + e.message); } }
  if (errs.length) log('뉴스 못 받은 검색 ' + errs.length + '개: ' + errs.join(' / '));
  if (ev.length < 10) throw new Error('뉴스 기사를 ' + ev.length + '개밖에 못 모음 — 구글 뉴스 RSS 확인 필요');
  let text = null, used = null; const tried = [];
  for (const m of models) { try { text = await askGemini(key, m, PROMPT(d, items0, ev), fetchImpl, SYSTEM); used = m; break; } catch (e) { tried.push(m + ': ' + e.message.slice(0, 90)); } }
  if (!text) throw new Error('Gemini 모두 실패 — ' + tried.join(' / '));
  const j = parseObj(text), pick = (nums) => [...new Set((Array.isArray(nums) ? nums : []).map((n) => parseInt(String(n).replace(/\D/g, ''), 10)).filter((n) => n >= 1 && n <= ev.length))].slice(0, 3).map((n) => ev[n - 1]);
  const active = [], ended = [];
  for (const x of Array.isArray(j.existing) ? j.existing : []) { const o = items0.find((y) => y.id === String(x.id || '').toUpperCase()), E = pick(x.evidence); if (!o || !E.length) continue;
    if (x.active === true) active.push({ a: o.a, b: o.b, kind: o.kind, name: o.name, since: o.since, summary: x.summary || o.summary, sources: E.map((e) => e.link), outlets: E.map((e) => e.src || '') });
    else if (x.active === false) ended.push({ id: o.id, reason: x.reason, sources: E.map((e) => e.link) }); }
  for (const x of Array.isArray(j.new) ? j.new : []) { const E = pick(x.evidence); if (!E.length) continue; active.push({ ...x, sources: E.map((e) => e.link), outlets: E.map((e) => e.src || '') }); }
  log('기사 ' + ev.length + '개 (지금 목록 ' + items0.length + '개 검색 + 새 분쟁 찾기 ' + FIND.length + '개) → Gemini(' + used + ')가 근거 기사 번호와 함께 정리');
  const r = clean(active, prev, d, ended);
  const out = { v: 2, updated: d, model: used, method: '구글 뉴스 RSS 기사 + Gemini 정리(근거 기사 번호)', articles: ev.length, note: '사람이 PR 을 읽고 합친 목록만 앱에 나타남', items: r.items };
  const summary = `분쟁 ${r.items.length}개 · 새로 ${r.added.length}${r.added.length ? ' (' + r.added.join(', ') + ')' : ''} · 빠짐 ${r.gone.length}${r.gone.length ? ' (' + r.gone.join(' / ') + ')' : ''}${r.kept.length ? ' · 이번에 확인 못 해 그대로 둠 ' + r.kept.length + ' (' + r.kept.join(', ') + ')' : ''}${r.drop.length ? ' · 버림 ' + r.drop.join(' / ') : ''}`;
  // 내용(확인 날짜 빼고)이 같으면 파일을 안 바꿈 → 매일 PR 이 생기지 않게
  const sig = (items) => JSON.stringify((items || []).map((x) => ({ ...x, checked: undefined })));
  const changed = !prev || sig(prev.items) !== sig(out.items);
  if (!dry && changed) writeFileSync(f, JSON.stringify(out, null, 1) + '\n');
  log(changed ? summary : '분쟁 목록: 바뀐 내용 없음 (' + r.items.length + '개)'); return { out, summary, changed };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run({ dry: process.argv.includes('--dry') }).catch((e) => { console.error('분쟁 목록 실패: ' + e.message); process.exitCode = 1; });
