/* 뉴스·일정 위험 확인 (AI가 진입을 판단하기 전에 같이 봄)
 *  - 최근 12시간 코인 뉴스 제목 (구글 뉴스 한국어 · 코인데스크 · 코인텔레그래프 RSS) — 무료, 키 필요 없음
 *  - 48시간 안의 큰 발표 (FOMC·CPI·고용·한국은행) — data/policy-live.json + js/snapshot.js
 * 실패해도 매매는 계속 (뉴스 없음으로 표시)
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

export const FEEDS = [
  { src: '구글뉴스', url: 'https://news.google.com/rss/search?q=%EB%B9%84%ED%8A%B8%EC%BD%94%EC%9D%B8%20OR%20%EC%95%94%ED%98%B8%ED%99%94%ED%8F%90&hl=ko&gl=KR&ceid=KR:ko' },
  { src: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { src: 'Cointelegraph', url: 'https://cointelegraph.com/rss' }
];
const decode = (t) => String(t || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/<[^>]+>/g, '').trim();
const decode2 = (t) => { let a = decode(t); for (let k = 0; k < 2 && /&(amp|#39|apos|quot|lt|gt);/.test(a); k++) a = decode(a); return a; }; // 이중 인코딩(&amp;#39;)까지 풀기
export function parseRss(xml, src) {
  const out = [];
  for (const m of String(xml).matchAll(/<item[\s>][\s\S]*?<\/item>/g)) {
    const it = m[0], title = decode2((it.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1]), pub = Date.parse(decode((it.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/) || [])[1]));
    if (title) out.push({ title: title.slice(0, 140), t: isFinite(pub) ? pub : null, src });
  }
  return out;
}
export async function headlines({ fetchImpl = fetch, now = Date.now(), hours = 12, max = 12, log = () => {} } = {}) {
  const all = [];
  await Promise.all(FEEDS.map(async (f) => {
    try {
      const c = new AbortController(), to = setTimeout(() => c.abort(), 12000);
      const r = await fetchImpl(f.url, { signal: c.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; sijangnalssi/1.0)' } }); clearTimeout(to);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      all.push(...parseRss(await r.text(), f.src));
    } catch (e) { log('뉴스 ' + f.src + ' 실패: ' + e.message); }
  }));
  const seen = new Set();
  return all.filter((x) => x.t && now - x.t <= hours * 3600e3 && x.t <= now + 600e3)
    .sort((a, b) => b.t - a.t).filter((x) => { const k = x.title.slice(0, 40).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, max)
    .map((x) => ({ ...x, ago: Math.max(0, Math.round((now - x.t) / 3600e3 * 10) / 10) }));
}
// 48시간 안의 큰 발표 (한국 시간 기준 날짜)
export function upcomingEvents(root, now = Date.now(), hours = 48) {
  const ev = [];
  try { const p = join(root, 'data', 'policy-live.json'); if (existsSync(p)) (JSON.parse(readFileSync(p, 'utf8')).fred || {}).events?.forEach((e) => ev.push(e)); } catch (e) { /* 무시 */ }
  try {
    const ctx = { window: {} }; vm.createContext(ctx); vm.runInContext(readFileSync(join(root, 'js', 'snapshot.js'), 'utf8'), ctx);
    ((ctx.window.SNAPSHOT || {}).events || []).forEach((e) => { if (!ev.some((x) => x.date === e.date && x.title.slice(0, 6) === e.title.slice(0, 6))) ev.push(e); });
  } catch (e) { /* 무시 */ }
  const kstToday = new Date(now + 9 * 3600e3).toISOString().slice(0, 10), lim = new Date(now + 9 * 3600e3 + hours * 3600e3).toISOString().slice(0, 10);
  return ev.filter((e) => e.date >= kstToday && e.date <= lim).map((e) => ({ date: e.date, title: e.title, when: e.when || '' }));
}
// AI가 빨리 볼 수 있게 위험 단어 표시
const RISK = /해킹|규제|소송|파산|상장폐지|청산|폭락|SEC|hack|exploit|lawsuit|ban|crackdown|bankrupt|liquidat|delist|outflow|plunge|crash|FOMC|CPI|금리/i;
export function newsBrief(list, events) {
  return { 최근_뉴스: list.slice(0, 10).map((x) => (RISK.test(x.title) ? '⚠ ' : '') + x.title + ' (' + x.ago + '시간 전, ' + x.src + ')'), '48시간_안_큰_발표': events.map((e) => e.date.slice(5) + ' ' + e.title + (e.when ? ' ' + e.when : '')) };
}
