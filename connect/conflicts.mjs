#!/usr/bin/env node
/* 분쟁 지도 목록 제안 (머니 글로브) — Gemini + 구글 검색. 보여 주기용, 봇 판단에는 안 씀
 *  하는 일: 지금 진행 중인 무력 분쟁을 출처와 함께 받아 data/conflicts.json 을 새로 씀
 *  사람 확인: 이 파일은 워크플로(.github/workflows/conflicts.yml)가 PR 로 올림 → 사람이 읽고 합쳐야 앱에 나타남
 *  규칙: 출처(URL) 없는 항목·나라 코드가 이상한 항목은 버림. 이전 목록에 있던 것은 처음 확인일을 이어 씀
 *  검색 필수: 같은 모델이 두 번 모두 구글 검색 없이 답하면 그 답은 버리고 예비 모델로. 모두 그러면 PR 을 안 올리고 실패(빨간 X)
 *   (검색 없이 쓴 답은 출처 링크가 지어낸 주소일 수 있어서)
 *  지금 목록 다시 확인: 질문에 지금 목록을 넣어 하나씩 다시 검색하게 함. "끝남"은 이유·출처와 함께 따로 받음
 *   - 끝남(출처 있음) → 뺌 · 답이 없음 → 마지막 확인 뒤 30일까지는 그대로 둠(검색을 안 해서 빠지는 일 방지), 30일 넘으면 뺌
 *  키: GEMINI_API_KEY (모델 GEMINI_MODEL, 기본은 council.mjs 와 같음)
 *  한도 초과(429)·서버 오류(5xx): 10초 뒤 한 번 더 → 그래도 안 되면 council.mjs 의 예비 모델로. 모두 실패하면 오류로 끝냄(워크플로 빨간 X)
 *  최악(모델 3개 모두 응답 없음)에도 약 3분 안에 끝남
 *  실행: node connect/conflicts.mjs   (--dry: 파일 안 쓰고 결과만 출력)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { loadEnv } from './paper.mjs';
import { VOTERS } from './council.mjs';
const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..');
const KINDS = { war: '나라 사이 전쟁', civil: '내전·무장 충돌', border: '국경 충돌' };
const today = (now) => new Date(now).toISOString().slice(0, 10);
const PROMPT = (d, prev) => `오늘은 ${d} 입니다. 구글 검색으로 확인해서, 지난 30일 안에 실제 전투·공습·포격이 보도된 무력 분쟁만 골라 주세요.
${prev && prev.length ? `먼저 지금 목록의 분쟁을 하나씩 따로 검색해서 아직 진행 중인지 확인하세요: ${prev.map((x) => x.id + ' ' + (x.name || '')).join(', ')}
- 아직 진행 중이면 active 에 최신 출처와 함께 넣고, 끝났거나 30일 넘게 전투 보도가 없으면 ended 에 이유와 근거 출처를 넣으세요
그다음 목록에 없는 새 분쟁도 찾아 active 에 넣으세요.
` : ''}
- 나라 사이 전쟁은 kind "war", 한 나라 안의 내전·무장 충돌은 kind "civil"(b 는 null), 국경 충돌은 kind "border"
- 휴전이 지켜지고 있거나 30일 넘게 전투 보도가 없으면 넣지 마세요. 말싸움·제재·무역 갈등은 넣지 마세요
- 나라는 ISO 3166-1 두 글자 대문자 코드. 공격하는 쪽을 a 에
- 항목마다 오늘 기준 최신 보도 원문 URL 을 1~3개 (언론사 기사 주소)
- 최대 15개, 큰 것부터
JSON 하나만 답하세요. 다른 글은 쓰지 마세요:
{"active":[{"a":"RU","b":"UA","kind":"war","name":"한국어 이름","since":"시작 연도","summary":"지금 상황 한국어 한 문장","sources":["https://..."]}],
 "ended":[{"id":"지금 목록의 id","reason":"한국어 한 문장","sources":["https://..."]}]}`;
export async function askGeminiSearch(key, model, prompt, fetchImpl = fetch) {
  const c = new AbortController(), to = setTimeout(() => c.abort(), 60000); // 검색 포함 1분이면 충분
  try { const r = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', { method: 'POST', signal: c.signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.2 } }) });
    const j = await r.json(); if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + ((j.error && j.error.message) || ''));
    const cand = (j.candidates || [])[0] || {}, gm = cand.groundingMetadata || {};
    // 검색을 실제로 했는지: 검색어·검색 결과 조각·검색 진입점 중 하나라도 있으면 검색함
    const refs = (gm.groundingChunks || []).map((c) => c.web && { title: c.web.title || '', uri: c.web.uri || '' }).filter(Boolean);
    return { text: ((cand.content || { parts: [] }).parts || []).map((p) => p.text || '').join(''), grounded: !!(refs.length || (gm.webSearchQueries || []).length || gm.searchEntryPoint), queries: gm.webSearchQueries || [], refs };
  } finally { clearTimeout(to); }
}
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
    out.push({ id, a, b: kind === 'civil' ? null : b, kind, name: String(x.name || '').slice(0, 40), since: String(x.since || '').slice(0, 10), summary: String(x.summary || '').slice(0, 160), sources: src, first: o ? o.first : d, checked: d });
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
  const g = VOTERS.find((v) => v.id === 'gemini'), models = [model, ...((g && g.backup) || [])].filter((m, i, a) => m && a.indexOf(m) === i), tried = [];
  let res = null, used = null;
  // 검색을 안 하고 답했으면(기억으로 쓴 답 → 링크가 지어낸 것일 수 있음) 한 번 더 물어봄
  const Q = PROMPT(d, (prev && prev.items) || []);
  const ask = async (m) => { let r = await askGeminiSearch(key, m, Q, fetchImpl); if (!r.grounded) { log(m + ': 검색 없이 답함 → 한 번 더'); const r2 = await askGeminiSearch(key, m, Q, fetchImpl); if (r2.grounded) r = r2; }
    if (!r.grounded) throw new Error('두 번 모두 구글 검색 없이 답함'); return r; }; // 검색 없는 답은 쓰지 않음 → 예비 모델로
  for (const m of models) { for (let k = 0; k < 2 && !res; k++) { try { res = await ask(m); used = m; } catch (e) { tried.push(m + ': ' + e.message.slice(0, 90));
        if (!/HTTP (429|5\d\d)/.test(e.message)) break; if (k === 0) await new Promise((ok) => setTimeout(ok, opts.wait ?? 10000)); } } if (res) break; }
  if (!res) throw new Error('Gemini 모두 실패 — ' + tried.join(' / '));
  if (used !== model) log('기본 모델 실패 → 예비 모델 ' + used + ' 사용');
  const { text, grounded } = res;
  log('구글 검색 ' + res.queries.length + '번 · 검색 결과 ' + res.refs.length + '개를 보고 답함: ' + res.refs.slice(0, 8).map((r) => r.title).join(', '));
  const P = parseList(text), r = clean(P.active, prev, d, P.ended);
  const out = { v: 1, updated: d, model: used, grounded, queries: res.queries.slice(0, 10), note: '사람이 PR 을 읽고 합친 목록만 앱에 나타남', items: r.items };
  const summary = `분쟁 ${r.items.length}개 · 새로 ${r.added.length}${r.added.length ? ' (' + r.added.join(', ') + ')' : ''} · 빠짐 ${r.gone.length}${r.gone.length ? ' (' + r.gone.join(' / ') + ')' : ''}${r.kept.length ? ' · 이번에 확인 못 해 그대로 둠 ' + r.kept.length + ' (' + r.kept.join(', ') + ')' : ''}${r.drop.length ? ' · 버림 ' + r.drop.join(' / ') : ''}`;
  // 내용(확인 날짜 빼고)이 같으면 파일을 안 바꿈 → 매일 PR 이 생기지 않게
  const sig = (items) => JSON.stringify((items || []).map((x) => ({ ...x, checked: undefined })));
  const changed = !prev || sig(prev.items) !== sig(out.items);
  if (!dry && changed) writeFileSync(f, JSON.stringify(out, null, 1) + '\n');
  log(changed ? summary : '분쟁 목록: 바뀐 내용 없음 (' + r.items.length + '개)'); return { out, summary, changed };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run({ dry: process.argv.includes('--dry') }).catch((e) => { console.error('분쟁 목록 실패: ' + e.message); process.exitCode = 1; });
