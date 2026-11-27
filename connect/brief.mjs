#!/usr/bin/env node
/* 오늘의 브리핑 — 이미 모으고 있는 자료를 한 장으로 (보여 주기·기록용. 봇 판단에는 쓰지 않음 — CLAUDE.md 1장)
 *  읽는 것: bot-data 의 macro-live.json(세계 경제 신호·통화 약세·한국 경보·뉴스), data/conflicts.json(분쟁),
 *           data/policy-live.json(발표 일정), data/top10-live.json(시장 필터·순위 변화), data/scorecard.json(봇 성적)
 *  쓰는 것: data/brief.json — 앱 홈 "오늘의 브리핑" (줄마다 구분·글·중요도)
 *           data/brief-log.json — 하루 한 줄 기록(신호 개수·분쟁 목록 등, 최근 400일). 2027-02-27 검토 때
 *           "이 이슈들이 봇 성적과 관계가 있었나"를 시험할 재료. 관계가 확인되기 전에는 봇에 넣지 않음
 *  실행: node connect/brief.mjs   (daily.yml 이 매일)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..');
const sg = (v, d = 1) => (v == null ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(d));
export function build({ macro, conflicts, policy, top10, score, now, prev }) {
  const L = [], add = (tag, text, level = 'info', href = null) => L.push({ tag, text, level, href }), today = new Date(now).toISOString().slice(0, 10), snap = { d: today };
  // 1) 코인 봇: 세계 경제 신호
  const R = macro && macro.now; if (R && R.S) { const on = ['A', 'B', 'C', 'D'].filter((k) => R.S[k] && R.S[k].on); snap.macroN = R.n; snap.macroOn = on; snap.block = !!R.blockLongs;
    add('코인', `세계 경제 신호 ${R.n}/4${on.length ? ' (' + on.map((k) => R.S[k].label).join(' · ') + ')' : ''} — ${R.blockLongs ? '새 롱 쉼' : '새 롱 허용'}`, R.blockLongs ? 'warn' : 'info', '#macro');
    if (prev && prev.macroN != null && prev.macroN !== R.n) add('변화', `세계 경제 신호 ${prev.macroN}/4 → ${R.n}/4`, 'warn', '#macro'); }
  // 2) 주식 봇: 시장 필터
  if (top10 && top10.regimeGap) { const g = top10.regimeGap, below = Object.entries(g).filter(([, v]) => v < 0); snap.gap = g; snap.buys = top10.eligible;
    add('주식', `시장 필터 ${Object.entries(g).map(([k, v]) => k + ' ' + sg(v) + '%').join(' · ')} (200일선 대비) — ${top10.eligible ? '매수 후보 ' + Math.min(10, top10.eligible) + '개' : 'ORBIT 매수 없음'}`, below.length ? 'warn' : 'info', '#top10');
    if (top10.added && top10.added.length) add('변화', 'TOP 10 새로: ' + top10.added.join(', '), 'info', '#top10'); if (top10.dropped && top10.dropped.length) add('변화', 'TOP 10 빠짐: ' + top10.dropped.join(', '), 'info', '#top10'); }
  // 3) 달러 쏠림 · 한국
  const F = macro && macro.fx; if (F) { snap.fxWeak = F.weak; snap.fxOn = !!F.on; add('환율', `통화 ${F.have}개 중 ${F.weak}개가 달러 대비 약세${F.on ? ' — 달러로 돈이 몰리는 중' : ''}`, F.on ? 'warn' : 'info', '#macro'); }
  const K = macro && macro.korea; if (K && K.sig) { snap.koreaN = K.n; const r = K.reserves, x = K.fx; add('한국', `위기 경보 ${K.stageName} ${K.n}/3${r ? ' · 외환보유액 수입 ' + r.months + '개월치' : ''}${x ? ' · 원화 3개월 ' + sg(x.chg3m) + '%' : ''}`, K.n >= 2 ? 'alert' : K.n === 1 ? 'warn' : 'info', '#macro'); }
  // 4) 분쟁
  if (conflicts && conflicts.items) { const it = conflicts.items, fresh = it.filter((c) => c.first === conflicts.updated), prevIds = new Set((prev && prev.conflicts) || []); snap.conflicts = it.map((c) => c.id);
    add('분쟁', `진행 중 ${it.length}곳${fresh.length ? ' · 새로: ' + fresh.map((c) => c.name).join(', ') : ''}`, fresh.length ? 'warn' : 'info', '#macro');
    const gone = prev && prev.conflicts ? prev.conflicts.filter((id) => !it.some((c) => c.id === id)) : []; if (gone.length) add('변화', '분쟁 목록에서 빠짐: ' + gone.join(', '), 'info', '#macro'); void prevIds; }
  // 5) 다가오는 발표 (7일 안)
  const ev = ((policy && policy.fred && policy.fred.events) || []).filter((e) => e.date >= today && (Date.parse(e.date) - Date.parse(today)) / 864e5 <= 7).sort((a, b) => (a.date < b.date ? -1 : 1));
  ev.forEach((e) => { const dd = Math.round((Date.parse(e.date) - Date.parse(today)) / 864e5); add('일정', `${e.date.slice(5).replace('-', '/')} (${dd === 0 ? '오늘' : dd + '일 뒤'}) ${e.title}${e.when ? ' · ' + e.when : ''}`, dd <= 1 ? 'warn' : 'info', '#calendar'); }); snap.events = ev.length;
  // 6) 봇 성적 주의
  if (score && score.bots) { const bad = score.bots.filter((b) => b.verdict === '미달'), near = score.bots.filter((b) => b.verdict !== '미달' && !b.retired && b.mddLimit != null && b.mdd <= b.mddLimit * 0.7);
    bad.forEach((b) => add('봇', `${b.name}: 미달${b.why ? ' — ' + b.why : ''}`, 'alert', '#scorecard')); near.forEach((b) => add('봇', `${b.name}: 낙폭 ${b.mdd}% (한도 ${b.mddLimit}% 에 가까워짐)`, 'warn', '#scorecard'));
    snap.bots = Object.fromEntries(score.bots.filter((b) => b.found).map((b) => [b.id, b.ret])); }
  // 7) 뉴스 제목 (세계 경제, 최근 것 3개)
  ((macro && macro.news) || []).slice(0, 3).forEach((n) => add('뉴스', String(n.title).replace(/&[a-z]+;/g, ' ').slice(0, 90), 'info'));
  return { lines: L, snap };
}
export async function run({ root = ROOT, now = new Date(), log = console.log, fetchImpl = fetch, botdata = null } = {}) {
  const J = (f) => { const p = join(root, 'data', f); try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null; } catch (e) { return null; } }, repo = process.env.GITHUB_REPOSITORY || 'rudrl09202-bit/sijangnalssi';
  const getBD = botdata || (async (f) => { try { const r = await fetchImpl('https://raw.githubusercontent.com/' + repo + '/bot-data/' + f + '?t=' + Math.floor(now.getTime() / 6e5)); return r.ok ? await r.json() : null; } catch (e) { return null; } });
  const logf = join(root, 'data', 'brief-log.json'); let hist = []; try { if (existsSync(logf)) hist = JSON.parse(readFileSync(logf, 'utf8')); } catch (e) { hist = []; }
  const today = now.toISOString().slice(0, 10), prev = hist.filter((h) => h.d < today).at(-1) || null;
  const { lines, snap } = build({ macro: await getBD('macro-live.json'), conflicts: J('conflicts.json'), policy: J('policy-live.json'), top10: J('top10-live.json'), score: J('scorecard.json'), now, prev });
  mkdirSync(join(root, 'data'), { recursive: true }); hist = hist.filter((h) => h.d !== today).concat(snap).slice(-400);
  writeFileSync(logf, JSON.stringify(hist)); writeFileSync(join(root, 'data', 'brief.json'), JSON.stringify({ v: 1, at: now.toISOString(), date: today, lines, use: 'display' }));
  log('브리핑 ' + lines.length + '줄 · 주의 ' + lines.filter((l) => l.level !== 'info').length + '줄 · 기록 ' + hist.length + '일'); lines.forEach((l) => log('  [' + l.tag + '] ' + (l.level === 'info' ? '' : '(' + l.level + ') ') + l.text));
  return { lines, snap };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run().catch((e) => { console.error('브리핑 실패: ' + e.message); process.exit(1); });
