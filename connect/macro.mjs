/* 세계 경제 신호 — 미·중 패권 싸움과 금융 긴장이 남기는 흔적 (야후 일봉, 키 필요 없음) + 세계 경제 뉴스 제목
 *  위험 회피 신호 (전날까지 마감된 일봉만 사용):
 *    A 위안화 급약세: 달러/위안 20거래일 +1.5% 이상   B 달러 급등: 달러지수 20거래일 +3% 이상
 *    C 미국 10년 금리 급등: 20거래일 +0.5%p 이상        D 나스닥 약세장: 종가 < 200일 평균
 *    (참고) E 공포지수 VIX 30 이상 — 시험에서 우연과 구분이 안 돼 판단에는 안 씀
 *  민경기 매매법: A~D 중 2개 이상 켜지면 류신영 몫의 새 롱 진입을 건너뜀 (6년 시험 research/macro-filter.mjs: 샤프 1.31→1.36, 무작위 200번 중 0번이 따라옴)
 *  뉴스는 보여 주기용 (과거 기록으로 시험할 수 없어서 매매 판단에는 쓰지 않음)
 *  (보여 주기) 통화 20개 동시 약세 G — 머니 글로브 지구본용. 6년 시험 불합격(research/fx-breadth.mjs)이라 매매 판단에는 안 씀. 12시간마다만 받음
 *  (보여 주기) 한국 위기 경보 판 — connect/korea.mjs, 12시간마다. 실패해도 나머지는 그대로
 *  결과: <dir>/macro-live.json · 받기에 실패하면 3일 안의 이전 값, 그것도 없으면 신호 없음(진입 막지 않음)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { chart } from './market.mjs';
import { parseRss } from './news.mjs';
import { FX, breadthAt } from './fxbreadth.mjs';
import { loadKorea } from './korea.mjs';
const DAY = 864e5;
export const MSYM = { usdcny: 'CNY=X', dxy: 'DX-Y.NYB', us10y: '^TNX', nasdaq: '^IXIC', vix: '^VIX' };
const NEWS = [
  { src: '미·중', url: 'https://news.google.com/rss/search?q=%EB%AF%B8%EC%A4%91%20OR%20%EA%B4%80%EC%84%B8%20OR%20%EC%88%98%EC%B6%9C%ED%86%B5%EC%A0%9C%20OR%20%EB%8C%80%EB%A7%8C%20%EB%B0%98%EB%8F%84%EC%B2%B4%20when%3A1d&hl=ko&gl=KR&ceid=KR:ko' },
  { src: '연준·금리', url: 'https://news.google.com/rss/search?q=%EC%97%B0%EC%A4%80%20OR%20%ED%8C%8C%EC%9B%94%20OR%20%EB%AF%B8%EA%B5%AD%20%EA%B8%88%EB%A6%AC%20OR%20%EB%AC%BC%EA%B0%80%20when%3A1d&hl=ko&gl=KR&ceid=KR:ko' },
  { src: '달러·위안', url: 'https://news.google.com/rss/search?q=%EB%8B%AC%EB%9F%AC%20%EA%B0%95%EC%84%B8%20OR%20%EC%9C%84%EC%95%88%ED%99%94%20OR%20%ED%99%98%EC%9C%A8%20when%3A1d&hl=ko&gl=KR&ceid=KR:ko' }
];
const day = (s) => new Date(s * 1000).toISOString().slice(0, 10);
// 시계열 { T:[ms 날짜], c:[] } 에서 t 이전 날짜까지
const idx = (d, t) => { const dd = Math.floor(t / DAY) * DAY; let lo = 0, hi = d.T.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (d.T[m] < dd) { k = m; lo = m + 1; } else hi = m - 1; } return k; };
export function riskAt(M, t) {
  if (!M) return null;
  const ch = (k, n, pct = true) => { const d = M[k]; if (!d) return null; const i = idx(d, t); if (i < n) return null; return pct ? (d.c[i] / d.c[i - n] - 1) * 100 : d.c[i] - d.c[i - n]; };
  const nq = (() => { const d = M.nasdaq; if (!d) return null; const i = idx(d, t); if (i < 200) return null; let s = 0; for (let q = i - 199; q <= i; q++) s += d.c[q]; return { px: d.c[i], ma: s / 200 }; })();
  const vix = M.vix ? M.vix.c[idx(M.vix, t)] : null, a = ch('usdcny', 20), b = ch('dxy', 20), c = ch('us10y', 20, false);
  const S = { A: { label: '위안화 급약세', val: a, unit: '% (20일)', on: a != null && a >= 1.5, th: '+1.5% 이상' }, B: { label: '달러 급등', val: b, unit: '% (20일)', on: b != null && b >= 3, th: '+3% 이상' },
    C: { label: '미국 10년 금리 급등', val: c, unit: '%p (20일)', on: c != null && c >= 0.5, th: '+0.5%p 이상' }, D: { label: '나스닥 약세장', val: nq ? (nq.px / nq.ma - 1) * 100 : null, unit: '% (200일선 대비)', on: !!nq && nq.px < nq.ma, th: '200일선 아래' },
    E: { label: '공포지수 VIX (참고)', val: vix, unit: '', on: vix != null && vix >= 30, th: '30 이상', ref: true } };
  const n = ['A', 'B', 'C', 'D'].filter((k) => S[k].on).length;
  return { S, n, blockLongs: n >= 2 };
}
export async function load({ dir, fetchImpl = fetch, now = Date.now(), log = () => {} } = {}) {
  const f = join(dir, 'macro-live.json'); let prev = null; try { if (existsSync(f)) prev = JSON.parse(readFileSync(f, 'utf8')); } catch (e) { prev = null; }
  // 1시간 안에 받은 게 있으면 그대로
  if (prev && prev.series && now - Date.parse(prev.at) < 3600e3) return prev;
  const series = {}, errors = [];
  for (const [k, sym] of Object.entries(MSYM)) { try { const r = await chart(sym, fetchImpl, '2y'); let c = r.c; if (k === 'us10y' && c.at(-1) > 20) c = c.map((x) => x / 10); const t = r.t.map(day); series[k] = { t: t.slice(-300), c: c.slice(-300).map((x) => Number(x.toPrecision(6))) }; } catch (e) { errors.push(k + ': ' + e.message); if (prev && prev.series && prev.series[k] && now - Date.parse(prev.at) < 3 * DAY) series[k] = prev.series[k]; } }
  const news = [];
  await Promise.all(NEWS.map(async (n) => { try { const c = new AbortController(), to = setTimeout(() => c.abort(), 12000); const r = await fetchImpl(n.url, { signal: c.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; sijangnalssi/1.0)' } }); clearTimeout(to); if (!r.ok) throw new Error('HTTP ' + r.status);
    parseRss(await r.text(), n.src).filter((x) => !x.t || now - x.t < 36 * 3600e3).slice(0, 5).forEach((x) => news.push(x)); } catch (e) { errors.push('뉴스 ' + n.src + ': ' + e.message); } }));
  const seen = new Set(), uniq = news.filter((x) => { const k = x.title.slice(0, 30); if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => (b.t || 0) - (a.t || 0)).slice(0, 12);
  const out = { v: 1, at: new Date(now).toISOString(), series, news: uniq.length ? uniq : (prev && prev.news) || [], errors };
  out.fxSeries = await loadFx(prev, now, fetchImpl, errors);
  const FM = prepare({ series: out.fxSeries || {} }); out.fx = FM ? { ...breadthAt(FM, now + DAY), at: (prev && prev.fxSeries === out.fxSeries && prev.fx && prev.fx.at) || out.at, use: 'display' } : null;
  try { out.korea = await loadKorea(prev, now, fetchImpl); } catch (e) { errors.push('한국 경보: ' + e.message); out.korea = (prev && prev.korea) || null; }
  const R = riskAt(prepare(out), now + DAY); out.now = R;
  writeFileSync(f, JSON.stringify(out)); log('세계 경제 신호: 위험 ' + (R ? R.n : '—') + '개 켜짐' + (R && R.blockLongs ? ' → 민경기 매매법 새 롱 쉼' : '') + ' · 뉴스 ' + out.news.length + '개' + (errors.length ? ' · 실패 ' + errors.length : ''));
  return out;
}
// 통화 20개 일봉(최근 40개) — 12시간 안에 받은 게 있으면 그대로
async function loadFx(prev, now, fetchImpl, errors) {
  const fresh = prev && prev.fxSeries && prev.fx && now - Date.parse(prev.fx.at) < 12 * 3600e3; if (fresh) return prev.fxSeries;
  const S = {}; let bad = 0;
  for (const f of FX) { try { const r = await chart(f.sym, fetchImpl, '3mo'); const k = r.c.map((x, i) => (x > 0 ? i : -1)).filter((i) => i >= 0).slice(-40); S['fx_' + f.id] = { t: k.map((i) => day(r.t[i])), c: k.map((i) => Number(r.c[i].toPrecision(6))) }; }
    catch (e) { bad++; if (prev && prev.fxSeries && prev.fxSeries['fx_' + f.id]) S['fx_' + f.id] = prev.fxSeries['fx_' + f.id]; } }
  if (bad) errors.push('통화 ' + bad + '개 실패');
  return Object.keys(S).length ? S : (prev && prev.fxSeries) || null;
}
export function prepare(o) { if (!o || !o.series) return null; const M = {}; for (const [k, d] of Object.entries(o.series)) M[k] = { T: d.t.map((x) => Date.parse(x + 'T00:00:00Z')), c: d.c }; return Object.keys(M).length ? M : null; }
