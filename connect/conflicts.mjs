#!/usr/bin/env node
/* 분쟁 지도 목록 제안 (머니 글로브) — Gemini + 구글 검색. 보여 주기용, 봇 판단에는 안 씀
 *  하는 일: 지금 진행 중인 무력 분쟁을 출처와 함께 받아 data/conflicts.json 을 새로 씀
 *  사람 확인: 이 파일은 워크플로(.github/workflows/conflicts.yml)가 PR 로 올림 → 사람이 읽고 합쳐야 앱에 나타남
 *  규칙: 출처(URL) 없는 항목·나라 코드가 이상한 항목은 버림. 이전 목록에 있던 것은 처음 확인일을 이어 씀
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
const PROMPT = (d) => `오늘은 ${d} 입니다. 구글 검색으로 확인해서, 지난 30일 안에 실제 전투·공습·포격이 보도된 무력 분쟁만 골라 주세요.
- 나라 사이 전쟁은 kind "war", 한 나라 안의 내전·무장 충돌은 kind "civil"(b 는 null), 국경 충돌은 kind "border"
- 휴전이 지켜지고 있거나 30일 넘게 전투 보도가 없으면 넣지 마세요. 말싸움·제재·무역 갈등은 넣지 마세요
- 나라는 ISO 3166-1 두 글자 대문자 코드. 공격하는 쪽을 a 에
- 항목마다 오늘 기준 최신 보도 원문 URL 을 1~3개 (언론사 기사 주소)
- 최대 15개, 큰 것부터
JSON 배열 하나만 답하세요. 다른 글은 쓰지 마세요:
[{"a":"RU","b":"UA","kind":"war","name":"한국어 이름","since":"시작 연도","summary":"지금 상황 한국어 한 문장","sources":["https://..."]}]`;
export async function askGeminiSearch(key, model, prompt, fetchImpl = fetch) {
  const c = new AbortController(), to = setTimeout(() => c.abort(), 60000); // 검색 포함 1분이면 충분
  try { const r = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', { method: 'POST', signal: c.signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.2 } }) });
    const j = await r.json(); if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + ((j.error && j.error.message) || ''));
    const cand = (j.candidates || [])[0] || {}; return { text: ((cand.content || { parts: [] }).parts || []).map((p) => p.text || '').join(''), grounded: !!(cand.groundingMetadata && (cand.groundingMetadata.groundingChunks || []).length) };
  } finally { clearTimeout(to); }
}
export function parseList(text) { const s = text.indexOf('['), e = text.lastIndexOf(']'); if (s < 0 || e < s) throw new Error('JSON 배열 없음'); return JSON.parse(text.slice(s, e + 1)); }
const ISO = /^[A-Z]{2}$/, URLRE = /^https?:\/\/[^\s]+$/;
export function clean(list, prev, d) {
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
  const gone = [...old.keys()].filter((k) => !out.some((y) => y.id === k)).map((k) => old.get(k).name || k);
  return { items: out, drop, gone, added: out.filter((y) => !old.has(y.id)).map((y) => y.name || y.id) };
}
export async function run({ root = ROOT, now = Date.now(), env = loadEnv(), fetchImpl = fetch, log = console.log, dry = false, ...opts } = {}) {
  const key = env.GEMINI_API_KEY; if (!key) { log('분쟁 목록: GEMINI_API_KEY 없음 → 건너뜀'); return null; }
  const model = env.GEMINI_MODEL || VOTERS.find((v) => v.id === 'gemini').def, f = join(root, 'data', 'conflicts.json'), d = today(now);
  let prev = null; try { if (existsSync(f)) prev = JSON.parse(readFileSync(f, 'utf8')); } catch (e) { prev = null; }
  const g = VOTERS.find((v) => v.id === 'gemini'), models = [model, ...((g && g.backup) || [])].filter((m, i, a) => m && a.indexOf(m) === i), tried = [];
  let res = null, used = null;
  for (const m of models) { for (let k = 0; k < 2 && !res; k++) { try { res = await askGeminiSearch(key, m, PROMPT(d), fetchImpl); used = m; } catch (e) { tried.push(m + ': ' + e.message.slice(0, 90));
        if (!/HTTP (429|5\d\d)/.test(e.message)) break; if (k === 0) await new Promise((ok) => setTimeout(ok, opts.wait ?? 10000)); } } if (res) break; }
  if (!res) throw new Error('Gemini 모두 실패 — ' + tried.join(' / '));
  if (used !== model) log('기본 모델 실패 → 예비 모델 ' + used + ' 사용');
  const { text, grounded } = res;
  if (!grounded) log('주의: 검색 근거(grounding)가 없는 답 — 사람 확인 때 출처를 꼭 열어 볼 것');
  const r = clean(parseList(text), prev, d);
  const out = { v: 1, updated: d, model: used, grounded, note: '사람이 PR 을 읽고 합친 목록만 앱에 나타남', items: r.items };
  const summary = `분쟁 ${r.items.length}개 · 새로 ${r.added.length}${r.added.length ? ' (' + r.added.join(', ') + ')' : ''} · 빠짐 ${r.gone.length}${r.gone.length ? ' (' + r.gone.join(', ') + ')' : ''}${r.drop.length ? ' · 버림 ' + r.drop.join(' / ') : ''}`;
  // 내용(확인 날짜 빼고)이 같으면 파일을 안 바꿈 → 매일 PR 이 생기지 않게
  const sig = (items) => JSON.stringify((items || []).map((x) => ({ ...x, checked: undefined })));
  const changed = !prev || sig(prev.items) !== sig(out.items);
  if (!dry && changed) writeFileSync(f, JSON.stringify(out, null, 1) + '\n');
  log(changed ? summary : '분쟁 목록: 바뀐 내용 없음 (' + r.items.length + '개)'); return { out, summary, changed };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run({ dry: process.argv.includes('--dry') }).catch((e) => { console.error('분쟁 목록 실패: ' + e.message); process.exitCode = 1; });
