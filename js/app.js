/*
 * 시장날씨 v0.1 — 화면과 동작
 * 구조: 상태(S) → 화면 함수(views) → #view 에 그림. 하단 탭은 주소의 #해시로 이동.
 */
(function () {
  const SNAP = window.SNAPSHOT;
  const R = window.Rules;
  const A = window.Api;
  const T = window.Tickers;

  /* ---------- 저장소 ---------- */
  const store = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { alert('저장 공간이 부족합니다.'); } }
  };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /* ---------- 상태 ---------- */
  const S = {
    markets: JSON.parse(JSON.stringify(SNAP.markets)),
    fng: SNAP.crypto.fng, fngFrom: 'snapshot',
    totalCapT: SNAP.crypto.totalCapT, btcDominance: SNAP.crypto.btcDominance,
    prices: {}, priceSource: '', priceAt: 0,
    closes: {}, candles: {},
    coinList: SNAP.coinList.slice(),
    holdings: store.get('snw.holdings', []),
    journal: store.get('snw.journal', []),
    ui: { compareBasis: 'krw', coin: 'KRW-BTC', scoreQuery: '', scoreSector: '', scoreResult: null, phase: null, showAdd: false, addType: 'coin', assetTab: 'all' },
    risk: { account: 10000000, entry: 0, stop: 0, pct: 1 }
  };

  /* ---------- 도우미 ---------- */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (v, dp) => (v == null || isNaN(v)) ? '—' : Number(v).toLocaleString('ko-KR', { minimumFractionDigits: dp || 0, maximumFractionDigits: dp || 0 });
  const sign = (v, dp) => (v == null || isNaN(v)) ? '—' : (v > 0 ? '+' : '') + nf(v, dp == null ? 1 : dp);
  const won = (v) => (v == null || isNaN(v)) ? '—' : nf(Math.round(v)) + '원';
  const dirClass = (v) => v > 0 ? 'up' : v < 0 ? 'down' : '';
  const now = () => Date.now();

  function fmtMarket(m) {
    const v = m.unit === '$' ? '$' + nf(m.value, 2) : m.unit === '%' ? nf(m.value, 2) + '%' : m.unit === '원' ? nf(m.value, 1) + '원' : nf(m.value, 2);
    const c = m.chg == null ? '' : sign(m.chg, m.chgUnit === 'bp' ? 0 : 2) + m.chgUnit;
    return { v, c };
  }

  const ICON = {
    sun: '<svg viewBox="0 0 48 48" width="52" height="52" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="24" cy="24" r="8"/><path d="M24 6v5M24 37v5M6 24h5M37 24h5M11 11l3.5 3.5M33.5 33.5L37 37M11 37l3.5-3.5M33.5 14.5L37 11"/></svg>',
    cloud: '<svg viewBox="0 0 48 48" width="52" height="52" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 34h20a8 8 0 0 0 0-16 11 11 0 0 0-21-1A8.5 8.5 0 0 0 14 34z"/></svg>',
    storm: '<svg viewBox="0 0 48 48" width="52" height="52" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 30h20a8 8 0 0 0 0-16 11 11 0 0 0-21-1A8.5 8.5 0 0 0 14 30z"/><path d="M25 32l-4 7h6l-4 7"/></svg>'
  };

  /* ---------- 공통 계산 ---------- */
  function weather() { return R.marketWeather(S.markets, S.fng); }
  function btcKrw() { const p = S.prices['KRW-BTC']; return p ? p.krw : null; }
  function coinCtx(market) {
    return { symbol: market.slice(4), candles: S.candles[market], btc: S.candles['KRW-BTC'], markets: S.markets, rates: SNAP.rates, etfFlow: SNAP.crypto.etfFlowMonth, fng: S.fng, btcDominance: S.btcDominance, events: SNAP.events, now: now() };
  }
  function stockCtx(sectorId, currency) {
    return { markets: S.markets, rates: SNAP.rates, sectorId, currency: currency || 'KRW', sectors: SNAP.sectors, events: SNAP.events, now: now() };
  }
  function currentPhase() {
    const fed = SNAP.rates.find((r) => r.key === 'fed');
    const n = weather().count;
    if (fed.expect === 'cut') return 1;
    if (fed.expect === 'hike') return n >= 4 ? 3 : 2;
    return n >= 3 ? 4 : 2;
  }
  // 달러 표시 종목(미국 주식)은 원/달러로 바꿔 계산
  /* ---------- 시장 데이터 (connect/market.mjs 결과) ---------- */
  const ML = window.MARKET_LIVE && window.MARKET_LIVE.series ? window.MARKET_LIVE : null;
  const U = window.Universe;
  const MACRO_AS_OF = ML && ML.asOf ? ML.asOf : SNAP.asOf;
  if (ML) {
    Object.entries(ML.macro || {}).forEach(([k, m]) => {
      const cur = S.markets[k]; if (!cur || m.value == null) return;
      const bp = k === 'us10y';
      S.markets[k] = { ...cur, value: m.value, chg: bp ? m.chgBp : k === 'usdkrw' ? Math.round((m.value - m.prev) * 10) / 10 : m.chgPct, chgUnit: bp ? 'bp' : k === 'usdkrw' ? '원' : '%', hint: '자동 갱신 · ' + m.date + ' 종가', src: '야후 파이낸스 ' + m.date };
    });
    const map = { nasdaq: 'nasdaq', spx: 'spx', kospi: 'kospi', kosdaq: 'kosdaq', gold: 'gold', brent: 'brent', usd: 'usdkrw' };
    SNAP.rankAssets.forEach((a) => { const m = ML.macro && ML.macro[map[a.id]]; if (m) { a.y1 = m.y1; a.d1 = m.chgPct; } });
  }
  function stockKey(sym) { return String(sym || '').toUpperCase().replace(/^A(?=\d{6}$)/, '').replace('.', '-'); }
  function stockCandles(sym) {
    const k = ML && ML.series[stockKey(sym)];
    if (!k) return null;
    const fx = k.cur === 'USD' ? S.markets.usdkrw.value : 1;
    return { c: k.c, h: k.h, l: k.l, v: k.v.map((x) => x * fx), cur: k.cur };
  }
  function marketOf(sym) { const key = stockKey(sym); if (!U) return null; for (const mk of ['kospi', 'kosdaq', 'nasdaq', 'spx']) if (U.LIST[mk].some((x) => x.s === key)) return mk; return null; }
  function benchFor(sym, cur) { const mk = marketOf(sym) || (cur === 'USD' ? 'spx' : 'kospi'); return { bench: ML && ML.bench ? ML.bench[mk] : null, benchName: U ? U.MARKETS[mk] : '' }; }
  const RANK_CACHE = {};
  function stockRank(mk) {
    if (!ML || !U) return [];
    if (RANK_CACHE[mk]) return RANK_CACHE[mk];
    const items = U.LIST[mk].map((it) => {
      const k = stockCandles(it.s); if (!k) return null;
      const res = screenFor(it.s, it.sec, it.cur);
      const c = k.c, p = c[c.length - 1];
      return { id: it.s, kind: 'stock', name: it.n, cls: it.s + ' · ' + sectorName(it.sec), result: res, sym: it.s, cur: it.cur, sec: it.sec,
        price: it.cur === 'USD' ? '$' + nf(p, 2) : won(p), chg: c.length > 1 ? (p / c[c.length - 2] - 1) * 100 : null, m1: c.length > 21 ? (p / c[c.length - 22] - 1) * 100 : null,
        action: R.actionFor({ score: res, candles: k, held: false, fng: S.fng }) };
    }).filter(Boolean);
    return (RANK_CACHE[mk] = R.rankList(items));
  }
  const usdRate = () => (S.markets.usdkrw && S.markets.usdkrw.value > 500 ? S.markets.usdkrw.value : (REAL && REAL.usdkrw) || 1400);
  const fxOf = (h) => (h.currency === 'USD' ? usdRate() : 1);
  // 코인: 실시간 시세 → 없으면 동기화 때 받아 둔 가격
  function coinPx(h) { const p = S.prices[h.market]; return p && p.krw ? p.krw : (h.syncPrice || null); }
  function holdingValue(h) {
    if (h.type === 'coin') { const p = coinPx(h); return p ? p * h.qty : null; }
    return h.price ? h.price * h.qty * fxOf(h) : null;
  }
  // 원금(원화). 토스증권 해외주식은 토스가 '산 날 환율'로 계산한 원화 원금 합계(tossSum)에 맞춰 나눠 줌
  // (평단 달러 × 오늘 환율로만 계산하면 환율이 변한 만큼 손익이 토스 앱과 달라짐)
  function tossScale() {
    const T = LIVE && LIVE.tossSum && LIVE.tossSum.costKrw ? LIVE.tossSum : (S.tossCost ? { costKrw: S.tossCost } : null); if (!T) return 1;
    const usd = (LIVE.holdings || []).filter((x) => x.type === 'stock' && x.source === '토스증권').reduce((t, x) => t + x.avg * x.qty * (x.currency === 'USD' ? usdRate() : 1), 0);
    const k = usd ? T.costKrw / usd : 1;
    return k > 0.7 && k < 1.4 ? k : 1; // 말이 안 되는 값이면 쓰지 않음
  }
  function holdingCost(h) {
    const c = h.avg * h.qty * fxOf(h);
    return h.live && h.type === 'stock' && h.source === '토스증권' ? c * tossScale() : c;
  }

  // 직접 입력한 자산 + 동기화 프로그램이 가져온 자산(빗썸·토스증권)
  const COIN_KO = { BTC: '비트코인', ETH: '이더리움', SOL: '솔라나', XRP: '엑스알피(리플)', USDT: '테더', ONDO: '온도파이낸스', DOGE: '도지코인', ADA: '에이다', LINK: '체인링크', AVAX: '아발란체', SUI: '수이', TRX: '트론' };
  let REAL = window.LIVE_HOLDINGS || null;
  // 발표용 예시 데이터: 실제 보유 내역을 숨기고 보여 줄 때. 코인 평단은 지금 가격 대비 비율(f)로 정함
  const DEMO = { demo: true, syncedAt: new Date().toISOString(), sources: ['예시 데이터'], cashKrw: 3200000, notes: [], holdings: [
    { type: 'coin', source: '예시', symbol: 'BTC', market: 'KRW-BTC', qty: 0.085, f: 0.18 },
    { type: 'coin', source: '예시', symbol: 'ETH', market: 'KRW-ETH', qty: 1.6, f: -0.12 },
    { type: 'coin', source: '예시', symbol: 'SOL', market: 'KRW-SOL', qty: 14, f: -0.22 },
    { type: 'coin', source: '예시', symbol: 'XRP', market: 'KRW-XRP', qty: 1800, f: 0.55 },
    { type: 'coin', source: '예시', symbol: 'USDT', market: 'KRW-USDT', qty: 1500, f: 0.02 },
    { type: 'stock', source: '예시', symbol: '005930', name: '삼성전자', currency: 'KRW', qty: 60, avg: 61500, price: 74800 },
    { type: 'stock', source: '예시', symbol: '000660', name: 'SK하이닉스', currency: 'KRW', qty: 8, avg: 176000, price: 268000 },
    { type: 'stock', source: '예시', symbol: 'NVDA', name: '엔비디아', currency: 'USD', qty: 15, avg: 128.4, price: 181.4 },
    { type: 'stock', source: '예시', symbol: 'TSLA', name: '테슬라', currency: 'USD', qty: 6, avg: 412.0, price: 395.1 },
    { type: 'stock', source: '예시', symbol: 'JPM', name: 'JP모건', currency: 'USD', qty: 5, avg: 251.0, price: 297.3 }
  ] };
  S.demo = store.get('snw.demo', false);
  let LIVE = S.demo ? DEMO : REAL;
  S.sectorMap = store.get('snw.sectorMap', {});
  function allHoldings() {
    const live = LIVE && LIVE.holdings ? LIVE.holdings.filter((x) => !(x.type === 'coin' && x.symbol === 'P')).map((x) => {
      if (x.type === 'coin') {
        const c = S.coinList.find((k) => k.symbol === x.symbol);
        const avg = x.f != null ? (S.prices[x.market] ? S.prices[x.market].krw / (1 + x.f) : 0) : x.avg;
        return { id: 'live-coin-' + x.symbol, type: 'coin', live: true, source: x.source, name: c && c.name ? c.name : (COIN_KO[x.symbol] || x.symbol), symbol: x.symbol, market: x.market, qty: x.qty, avg, syncPrice: x.syncPrice, syncValue: x.syncValue };
      }
      const cur = x.currency || (/^(US|USA)$/i.test(x.country || '') || /^[A-Z][A-Z.\-]{0,9}$/.test(x.symbol || '') ? 'USD' : 'KRW');
      return { id: 'live-stock-' + x.symbol, type: 'stock', live: true, source: x.source, name: x.name || x.symbol, symbol: x.symbol, currency: cur, country: x.country, qty: x.qty, avg: x.avg, price: x.price, rate: x.rate, syncValue: x.syncValue, sector: S.sectorMap[x.symbol] || T.sectorOf(x.symbol), autoSector: !S.sectorMap[x.symbol] && !!T.sectorOf(x.symbol) };
    }) : [];
    if (S.demo) return live;
    // 연동된 종목과 같은 종목을 직접 입력해 두었으면 두 번 세지 않음
    const keyOf = (x) => x.type === 'coin' ? 'c:' + (x.market || 'KRW-' + x.symbol) : 's:' + String(x.symbol || x.name || '').toUpperCase();
    const seen = new Set(live.flatMap((x) => [keyOf(x), x.type === 'stock' ? 's:' + String(x.name || '').toUpperCase() : '']));
    return live.concat(S.holdings.filter((h) => !seen.has(keyOf(h))).map((h) => ({ ...h, source: '직접 입력' })));
  }
  function holdingScore(h) {
    if (h.type === 'coin') { if (R.STABLE.includes(h.symbol)) return R.scoreCoin2(coinCtx(h.market)); if (!S.candles[h.market]) return null; return R.scoreCoin2(coinCtx(h.market)); }
    return R.scoreStock2({ ...stockCtx(h.sector, h.currency), candles: stockCandles(h.symbol), ...benchFor(h.symbol, h.currency) });
  }
  const RATE_SENSITIVE = ['tech', 'discretionary', 'comm', 'realestate'];
  const ACTION_ORDER = ['stop', 'reduce', 'trim', 'add', 'add-small', 'hold', 'cash', 'wait'];
  function portfolio() {
    const hs = allHoldings(), cash = LIVE && LIVE.cashKrw ? LIVE.cashKrw : 0;
    const rows = hs.map((h) => { const v = holdingValue(h), c = holdingCost(h); return { h, v, c, pnl: v == null ? null : v - c, pr: v == null || !c ? null : (v - c) / c * 100 }; });
    const invest = rows.reduce((t, r) => t + (r.v || 0), 0), all = invest + cash;
    const cost = rows.reduce((t, r) => t + (r.v == null ? 0 : r.c), 0);
    rows.forEach((r) => { r.w = r.v == null || !all ? null : r.v / all * 100; r.act = holdingAction(r); });
    return { rows, cash, invest, all, cost, pnl: invest - cost };
  }
  function holdingAction(r) {
    const sc = holdingScore(r.h);
    if (!sc) return null;
    return R.actionFor({ score: sc, candles: r.h.type === 'coin' ? S.candles[r.h.market] : stockCandles(r.h.symbol), pnlPct: r.pr, weightPct: r.w, held: true, fng: S.fng });
  }
  function actBadge(a, lg) { return a ? `<span class="act ${a.tone}${lg ? ' lg' : ''}">${esc(a.label)}</span>` : ''; }
  function actCounts(rows) {
    const c = { buy: 0, hold: 0, sell: 0, check: 0 };
    rows.forEach((r) => { const a = r.act && r.act.action; if (!a) return; if (a === 'add' || a === 'add-small') c.buy++; else if (a === 'trim' || a === 'reduce') c.sell++; else if (a === 'stop') c.check++; else c.hold++; });
    return c;
  }
  function guideList(rows, limit) {
    const list = rows.filter((r) => r.act).sort((a, b) => ACTION_ORDER.indexOf(a.act.action) - ACTION_ORDER.indexOf(b.act.action) || (b.v || 0) - (a.v || 0));
    return list.slice(0, limit || list.length).map((r) => `<button class="gd" data-act="score-holding" data-id="${esc(r.h.id)}">
        <span><span class="b">${esc(r.h.name)}</span> <span class="muted xs num">${r.pr == null ? '' : sign(r.pr, 1) + '%'}${r.w == null ? '' : ' · 비중 ' + nf(r.w, 1) + '%'}</span></span>${actBadge(r.act)}
        <span class="why">${esc(r.act.reasons[0])}</span></button>`).join('');
  }
  function countsBox(c) {
    return `<div class="counts">
      <div class="cnt"><p class="xs muted">매수 검토</p><p class="num ${c.buy ? 'up' : 'muted'}">${c.buy}</p></div>
      <div class="cnt"><p class="xs muted">보유 유지</p><p class="num">${c.hold}</p></div>
      <div class="cnt"><p class="xs muted">매도·축소</p><p class="num ${c.sell ? 'down' : 'muted'}">${c.sell}</p></div>
      <div class="cnt"><p class="xs muted">손절 점검</p><p class="num ${c.check ? 'down' : 'muted'}">${c.check}</p></div></div>`;
  }
  function tools() {
    return `<div class="tools"><a class="icon-btn" href="#alerts" title="알림" aria-label="알림">${svgBell()}${window.SNW_ALERTS && window.SNW_ALERTS.items && window.SNW_ALERTS.items.length ? '<i class="bell-dot"></i>' : ''}</a></div>`;
  }
  function demoBanner() { return S.demo ? '<p class="demo-banner">발표 모드 · 예시 데이터입니다. 실제 보유 내역이 아닙니다.</p>' : ''; }
  function svgBell() { return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>'; }
  function svgMoon() { return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>'; }
  function svgSun() { return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/></svg>'; }
  function svgPresent() { return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M12 16v4M8 20h8M7 12l3-3 2 2 4-4"/></svg>'; }

  /* ---------- 화면: 홈 (토스식: 핵심 숫자 먼저, 자세한 건 눌러서) ---------- */
  const CHEV = '<svg class="chev" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
  function lrow(href, ic, title, sub, right, attrs) {
    return `<a class="lrow" href="${href}"${attrs || ''}>${ic != null ? `<span class="ic">${ic}</span>` : ''}<span class="grow"><p class="t">${title}</p>${sub ? `<p class="s">${sub}</p>` : ''}</span>${right != null ? `<span class="v">${right}</span>` : ''}${CHEV}</a>`;
  }
  function hcard(label, v, c, cls) { return `<div class="hcard"><p class="muted xs">${esc(label)}</p><p class="n">${esc(v)}</p><p class="c ${cls}">${esc(c)}</p></div>`; }
  /* ---------- 홈 맨 위: 코인 선물 AI 자동매매 데스크 ---------- */
  function homeDesk() {
    loadMk(); loadScalp(); loadFutures();
    const M3 = S.mk3, SCd = S.sc, FU = S.fut;
    const accts = [];
    if (M3) accts.push({ code: 'MK', name: '민경기 봇', sub: '추세 + 학습 · 4시간봉', href: '#mk', ret: M3.live.ret, pos: M3.live.positions, main: true });
    if (FU) accts.push({ code: 'FLUX', name: 'FLUX 추세추종', sub: '규칙만 · 4시간봉', href: '#futures', ret: FU.live.ret, pos: FU.live.positions || [] });
    if (FU && FU.council) accts.push({ code: 'AI3', name: 'AI 3명 만장일치', sub: 'FLUX 후보 + Claude·Gemini·GPT', href: '#futures', ret: FU.council.ret, pos: FU.council.positions || [] });
    if (SCd) { accts.push({ code: 'SC', name: '단타 · 조심형 Claude', sub: '15분봉', href: '#scalp', ret: SCd.live.ret, pos: SCd.live.positions });
      if (SCd.bold) accts.push({ code: 'SC', name: '단타 · 적극형 Claude', sub: '15분봉', href: '#scalp', ret: SCd.bold.ret, pos: SCd.bold.positions });
      if (SCd.major) accts.push({ code: 'SC', name: '단타 · AI 다수결', sub: '15분봉', href: '#scalp', ret: SCd.major.ret, pos: SCd.major.positions }); }
    const open = [].concat(...accts.map((a) => (a.pos || []).map((p) => ({ ...p, who: a.name, href: a.href }))));
    const tot = accts.length ? accts.reduce((t, a) => t + (a.ret || 0), 0) / accts.length : null;
    const btc = S.prices['KRW-BTC'], RG = SCd && SCd.regime, RISKW = /해킹|규제|소송|파산|상장폐지|폭락|hack|exploit|lawsuit|ban|bankrupt|delist|plunge|crash|FOMC|CPI/i;
    const risky = SCd && (SCd.news || []).filter((n) => RISKW.test(n.title)).slice(0, 2);
    const evs = SCd && (SCd.events || []).slice(0, 2);
    const mk = accts.find((a) => a.main);
    return `<section class="card panel desk">
        <div class="row between"><p class="kicker">코인 선물 AI 자동매매 · 가상 계좌 ${accts.length}개</p><a class="xs" href="#paper">전체 ›</a></div>
        ${mk ? `<a class="desk-main" href="#mk"><div><p class="b">민경기 봇</p><p class="muted xs">${esc(mk.sub)} · ${M3.wf && M3.wf.pass && M3.wf.pass.ok ? '시험 합격' : '시험 중'} · 포지션 ${mk.pos.length}</p></div><p class="num h-md ${dirClass(mk.ret)}">${pct(mk.ret, 2)}</p></a>` : '<p class="muted sm">민경기 봇 결과를 불러오는 중이에요</p>'}
        ${accts.filter((a) => !a.main).map((a) => `<a class="desk-row" href="${a.href}"><span>${esc(a.name)} <span class="muted xs">${esc(a.sub)}</span></span><span class="num ${dirClass(a.ret)}">${pct(a.ret, 2)}</span></a>`).join('')}
        ${tot != null ? `<p class="muted xs" style="margin-top:8px">계좌 평균 ${pct(tot, 2)} · 모두 가상 1억씩 · 실제 돈 아님</p>` : ''}</section>
      <section class="card"><div class="card-head"><h2>지금 열린 포지션 ${open.length}개</h2></div>
        ${open.length ? open.map((p) => `<a class="desk-row" href="${p.href}"><span><span class="side ${SIDE[p.side][1]}">${SIDE[p.side][0]}</span> ${esc(p.name)} <span class="muted xs">${esc(p.who)}</span></span><span class="num ${dirClass(p.upnl)}">${p.upnl >= 0 ? '+' : ''}${man(p.upnl)}</span></a>`).join('') : '<p class="muted sm">지금은 열린 포지션이 없어요. 봇들이 조건을 기다리는 중이에요.</p>'}</section>
      <section class="card"><h2>코인 시장 지금</h2>
        ${btc ? `<div class="kv"><span>비트코인</span><b class="num">${won(btc.krw)} <span class="${dirClass(btc.chg24)} xs">${sign(btc.chg24, 2)}%</span></b></div>` : ''}
        ${RG && RG.label ? `<div class="kv"><span>장세 (15분봉 기준)</span><b>${esc(RG.label)}</b></div>` : ''}
        ${S.fng != null ? `<div class="kv"><span>코인 심리 (공포·탐욕)</span><b class="num">${S.fng} <span class="muted xs">${S.fng <= 25 ? '극단적 공포' : S.fng >= 75 ? '극단적 탐욕' : S.fng < 45 ? '공포' : S.fng > 55 ? '탐욕' : '보통'}</span></b></div>` : ''}
        ${(evs || []).map((e) => `<div class="kv"><span><span class="act warn">발표 임박</span></span><b class="sm">${esc(e.date.slice(5).replace('-', '/'))} ${esc(e.title)}</b></div>`).join('')}
        ${(risky || []).map((n) => `<p class="sm news-line"><span class="act warn">주의</span> ${esc(n.title)} <span class="muted xs">${n.ago}시간 전</span></p>`).join('')}
        ${tvButton('perp', 'BTC', '비트코인 무기한 선물', '240')}</section>`;
  }
  function viewHomeOld() {
    const w = weather(), P = portfolio();
    const fed = SNAP.rates.find((r) => r.key === 'fed');
    const ev = SNAP.events.map((e) => ({ ...e, d: R.daysUntil(e.date, now()) })).filter((e) => e.d >= 0);
    const AL = window.SNW_ALERTS && window.SNW_ALERTS.items ? window.SNW_ALERTS.items : [];
    const hero = P.rows.length
      ? `<a class="card link-card" href="#assets"><div class="card-head"><p class="kicker">내 자산</p>${CHEV}</div>
          <p class="hero-num">${won(P.all)}</p>
          <p class="hero-sub ${dirClass(P.pnl)}">${P.pnl >= 0 ? '+' : ''}${won(P.pnl)} (${P.cost ? sign(P.pnl / P.cost * 100, 1) + '%' : '—'})</p></a>`
      : `<a class="card link-card" href="#assets"><p class="kicker">내 자산</p><p class="b">빗썸·토스증권을 연결하면 내 자산과 할 일이 여기에 나와요</p><p class="more-link">연결하러 가기 ›</p></a>`;
    const todo = P.rows.length ? (() => { const c = actCounts(P.rows); const g = guideList(P.rows, 3); return g ? `<section class="card"><div class="card-head"><h2>지금 할 일</h2><a href="#assets">전체 ›</a></div>
        <p class="muted sm">매수 검토 <b class="up">${c.buy}</b> · 유지 <b>${c.hold}</b> · 매도·축소 <b class="down">${c.sell}</b> · 손절 점검 <b class="down">${c.check}</b></p>
        <div class="guide">${g}</div></section>` : ''; })() : '';
    const alerts = AL.length ? `<section class="card"><div class="card-head"><h2>오늘의 매수 후보</h2><a href="#alerts">${AL.length}개 ›</a></div>
        <div>${AL.slice(0, 3).map((x) => lrow('#alerts', esc((x.name || '?').slice(0, 1)), esc(x.name), esc(x.line || ''), `<p class="n">${x.score}<span class="muted xs">점</span></p>`)).join('')}</div></section>` : '';
    const ind = [['spx', 'S&P 500'], ['nasdaq', '나스닥'], ['kospi', '코스피'], ['usdkrw', '원/달러'], ['us10y', '미국 10년 금리'], ['gold', '금'], ['vix', '공포지수']].filter(([k]) => S.markets[k])
      .map(([k, l]) => { const m = S.markets[k], f = fmtMarket(m); return hcard(l, f.v, f.c, dirClass(m.chg)); });
    const b = S.prices['KRW-BTC'];
    if (b) ind.splice(3, 0, hcard('비트코인', won(b.krw), sign(b.chg24, 2) + '%', dirClass(b.chg24)));
    return `
      <header class="top"><div><p class="kicker">${esc(todayLabel())} · 시장날씨</p><h1>AI 자동매매</h1></div>${tools()}</header>${demoBanner()}
      ${guideCard()}
      ${homeDesk()}
      <h2 class="sec">내 자산 · 시장 전체</h2>
      ${hero}
      <section class="card">
        <div class="row gap center"><span class="wx">${ICON[w.icon]}</span>
          <div class="grow"><p class="kicker">오늘의 시장날씨</p><p class="big-title">${esc(w.title)}</p></div></div>
        <p class="sm" style="color:var(--ink2)">${esc(w.sub)}</p>
        <details class="foldable"><summary>왜 이렇게 판단했나요</summary>
          <div class="chips">${w.winds.map((x) => `<span class="chip ${x.on ? 'chip-on' : ''}" title="${esc(x.text)}">${esc(x.label)} ${x.on ? '역풍' : '양호'}</span>`).join('')}</div>
          <div class="grid3" style="margin-top:10px">
            ${mini('공포지수', nf(S.markets.vix.value, 1), S.markets.vix.value >= 30 ? '공포' : S.markets.vix.value >= 20 ? '불안' : '안정')}
            ${mini('코인 심리', S.fng, S.fng <= 25 ? '극단적 공포' : S.fng >= 75 ? '극단적 탐욕' : '보통')}
            ${mini('미국 금리', fed.expect === 'hike' ? '인상' : fed.expect === 'cut' ? '인하' : '동결', fed.next ? R.daysUntil(fed.next, now()) + '일 뒤' : '')}
          </div>
          <ol class="list xs" style="margin-top:12px">${SNAP.why.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
        </details>
      </section>
      ${todo}
      ${alerts}
      ${homePaper()}
      <a class="card link-card hq-entry" href="#hq"><div class="card-head"><div><p class="kicker">본부</p><p class="b">봇 직원들이 일을 제대로 하는지 BOSS가 점검해요</p></div>${CHEV}</div></a>
      <h2 class="sec">주요 지표</h2>
      <div class="hscroll">${ind.join('')}</div>
      ${homeRank()}
      ${ev.length ? `<section class="card"><h2>다가오는 일정</h2>
        ${ev.slice(0, 3).map((e) => `<div class="ev"><span class="dday">${e.d === 0 ? 'D-DAY' : 'D-' + e.d}</span><div><p class="b">${esc(e.title)}</p><p class="muted xs">${esc(e.when)} · ${esc(e.why)}</p></div></div>`).join('')}</section>` : ''}
      <p class="muted xs pad">투자 참고 정보이며 투자 권유가 아닙니다. 결정과 책임은 본인에게 있습니다.</p>`;
  }
  function homePaper() {
    const P = window.SNW_PAPER; loadRemotePaper && setTimeout(loadRemotePaper, 0);
    if (!P) return `<a class="card link-card" href="#paper"><p class="kicker">투자봇</p><p class="b">가상 1억 원으로 봇들이 매일 자동 매매해요</p><p class="more-link">10년 검증 성적 보기 ›</p></a>`;
    const bots = P.bots.filter((b) => !b.empty && !b.retired), start = P.startCash * bots.length, nowV = bots.reduce((t, b) => t + (b.live ? b.live.equity : P.startCash), 0);
    const fills = (P.today || []).filter((e) => e.side === 'buy' || e.side === 'sell').length;
    const r = (nowV / start - 1) * 100;
    return `<a class="card link-card" href="#paper"><div class="card-head"><p class="kicker">주식 봇 ${bots.length}개 · 가상 ${bots.length}억 원</p>${CHEV}</div>
      <p class="hero-num" style="font-size:28px">${(r >= 0 ? '+' : '') + r.toFixed(2)}%</p>
      <p class="muted sm">${fills ? '최근 체결 ' + fills + '건' : '다음 거래일 주문 대기 중'} · 10년 검증 연 ${P.team.bt.full ? P.team.bt.full.cagr + '%' : '—'}</p></a>`;
  }
  function rankItems() {
    const items = SNAP.rankAssets.map((a) => {
      const res = R.scoreAsset2({ traits: a.traits, y1: a.y1, d1: a.d1, markets: S.markets, rates: SNAP.rates, events: SNAP.events, now: now() });
      const m = S.markets[a.id];
      return { id: a.id, kind: 'asset', name: a.name, cls: a.cls, result: res, price: m ? fmtMarket(m).v : a.id === 'usd' ? nf(S.markets.usdkrw.value, 1) + '원' : '', chg: m ? m.chg : null, action: R.actionFor({ score: res, held: false }) };
    });
    SNAP.rankCoins.forEach((mk) => {
      if (!S.candles[mk]) return;
      const meta = S.coinList.find((c) => c.market === mk), sym = mk.slice(4), p = S.prices[mk];
      const res = R.scoreCoin2(coinCtx(mk));
      items.push({ id: mk, kind: 'coin', name: meta && meta.name ? meta.name : (COIN_KO[sym] || sym), cls: '코인 · ' + sym, result: res, price: p ? won(p.krw) : '', chg: p ? p.chg24 : null, action: R.actionFor({ score: res, candles: S.candles[mk], held: false, fng: S.fng }) });
    });
    return R.rankList(items);
  }
  function rankRow(x, compact) {
    return `<details class="rk${x.rank <= 3 ? ' top3' : ''}">
      <summary><span class="rk-n num">${x.rank}</span>
        <span class="grow"><span class="b">${esc(x.name)}</span> <span class="muted xs">${esc(x.cls)}</span>
          <span class="rk-sub"><span class="num xs muted">${esc(x.price)}${x.chg == null ? '' : ` <span class="${dirClass(x.chg)}">${sign(x.chg, 2)}%</span>`}</span> ${actBadge(x.action)}</span></span>
        <span class="right"><span class="num rk-s">${x.result.score100}</span><span class="xs muted rk-g">${esc(x.result.grade)}</span></span></summary>
      <ul class="list xs rk-why">${x.good.map((t) => `<li>${esc(t)}</li>`).join('')}${x.bad.map((t) => `<li class="muted">${esc(t)}</li>`).join('')}</ul>
      ${compact ? `<div class="rk-more">${x.kind === 'coin' ? chartBtn('coin', x.id, x.name) : ASSET_MACRO[x.id] ? chartBtn('macro', ASSET_MACRO[x.id], x.name) : ''}</div>` : `<div class="rk-more">${x.kind === 'coin' ? `<div class="row gap" style="gap:8px;flex-wrap:wrap">${chartBtn('coin', x.id, x.name)}<button class="btn sm-btn" data-act="rank-coin" data-v="${esc(x.id)}">조건 33개와 분할 계획 보기</button></div>` : (ASSET_MACRO[x.id] ? chartBtn('macro', ASSET_MACRO[x.id], x.name) : '') + x.result.groups.filter((g) => g.score != null).map((g) => `<div class="kv"><span>${esc(g.name)} <span class="muted xs">가중 ${g.weight}%</span></span><b class="num">${g.score}</b></div>`).join('')}</div>`}
    </details>`;
  }
  const ASSET_MACRO = { nasdaq: 'nasdaq', spx: 'spx', kospi: 'kospi', kosdaq: 'kosdaq', gold: 'gold', brent: 'brent', usd: 'usdkrw' };
  const RANK_TABS = [['nasdaq', '나스닥'], ['spx', 'S&P 500'], ['kospi', '코스피'], ['kosdaq', '코스닥'], ['assets', '자산·코인']];
  function stockRow(x) {
    return `<details class="rk${x.rank <= 3 ? ' top3' : ''}">
      <summary><span class="rk-n num">${x.rank}</span>
        <span class="grow"><span class="b">${esc(x.name)}</span> <span class="muted xs">${esc(x.cls)}</span>
          <span class="rk-sub"><span class="num xs muted">${esc(x.price)}${x.chg == null ? '' : ` <span class="${dirClass(x.chg)}">${sign(x.chg, 2)}%</span>`}${x.m1 == null ? '' : ` · 1달 <span class="${dirClass(x.m1)}">${sign(x.m1, 1)}%</span>`}</span> ${actBadge(x.action)}</span></span>
        <span class="right"><span class="num rk-s">${x.result.score100}</span><span class="xs muted rk-g">${esc(x.result.grade)}</span></span></summary>
      <ul class="list xs rk-why">${x.good.map((t) => `<li>${esc(t)}</li>`).join('')}${x.bad.map((t) => `<li class="muted">${esc(t)}</li>`).join('')}</ul>
      <div class="rk-more">${x.result.groups.filter((g) => g.score != null).map((g) => `<div class="kv"><span>${esc(g.name)} <span class="muted xs">가중 ${g.weight}%</span></span><b class="num">${g.score}</b></div>`).join('')}
        <div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap">${chartBtn('stock', x.sym, x.name)}<button class="btn sm-btn" data-act="rank-stock" data-v="${esc(x.sym)}" data-sec="${esc(x.sec)}">조건 전체와 분할 계획 보기</button></div></div>
    </details>`;
  }
  function noMarketData() {
    return `<section class="card panel"><p class="kicker">종목 데이터가 아직 없어요</p>
      <p class="sm">나스닥·S&P500·코스피·코스닥 종목 순위는 컴퓨터에서 시장 데이터를 한 번 받아야 계산됩니다. 키는 필요 없습니다.</p>
      <ol class="list xs"><li>connect 폴더 주소창에 <b>cmd</b> 입력 → Enter</li><li><b>node market.mjs</b> 입력 → Enter (1~3분)</li><li>"완료"가 나오면 이 화면을 새로고침</li></ol>
      <p class="muted xs">node sync.mjs 를 실행해도 마지막에 같이 받습니다.</p></section>`;
  }
  function viewRank() {
    const tab = S.ui.rankTab || 'kospi';
    const seg = `<div class="seg seg-wrap" role="tablist" aria-label="시장 선택">${RANK_TABS.map(([k, l]) => `<button role="tab" class="${tab === k ? 'on' : ''}" aria-selected="${tab === k}" data-act="rank-tab" data-v="${k}">${l}</button>`).join('')}</div>`;
    const head = `<header class="top"><div><a href="#explore" class="back">‹ 시장</a><p class="kicker">${esc(todayLabel())} · ${ML ? '주가 ' + esc(ML.asOf) + ' 종가 기준' : '시장 데이터 받기 전'}</p><h1>오늘의 종목 순위</h1></div>${tools()}</header>`;
    const foot = `<section class="card note"><p class="b sm">순위는 이렇게 매깁니다</p>
        <p class="muted xs">각 시장의 시가총액 상위 대표 종목(나스닥 ${U ? U.LIST.nasdaq.length : 0} · S&P500 ${U ? U.LIST.spx.length : 0} · 코스피 ${U ? U.LIST.kospi.length : 0} · 코스닥 ${U ? U.LIST.kosdaq.length : 0}개)을 1년치 일봉으로 분석합니다. 월가 스크리너 방식으로 가치(PER·PSR·PBR·EV/EBITDA·PEG·배당) · 성장(매출·이익·분기 이익·성장 가속) · 수익성·재무(ROE·이익률·부채·현금흐름) · 모멘텀(미너비니 트렌드 템플릿·상대강도 RS·RSI·MACD) · 환경·위험(베타·변동성·낙폭·매크로·업종) — 재무는 SEC EDGAR·OpenDART 공식 공시 기준 5축을 1~100점으로 매겨 가중 평균합니다. 재무 지표가 없는 종목은 그 축을 빼고 계산합니다.</p>
        <p class="muted xs">점수가 높다는 것은 지금 가격 흐름과 환경이 그 종목에 상대적으로 유리하다는 뜻이며, 오른다는 보장이 아닙니다. 투자 권유가 아니고 결정과 책임은 본인에게 있습니다.</p></section>`;
    if (tab === 'assets') {
      const list = rankItems();
      return `${head}${seg}<section class="card panel tbl"><div class="tbl-head"><div><p class="kicker">대표 자산 TOP 10</p><p class="muted xs">지수·금·원유·달러·주요 코인</p></div></div>${list.slice(0, 10).map((x) => rankRow(x)).join('') || '<p class="muted pad">계산 중…</p>'}</section>${foot}`;
    }
    if (!ML) return head + seg + noMarketData() + foot;
    const list = stockRank(tab);
    const total = U.LIST[tab].length;
    return `${head}${seg}
      <section class="card panel tbl"><div class="tbl-head"><div><p class="kicker">${esc(U.MARKETS[tab])} TOP 10</p><p class="muted xs">대표 ${total}개 중 분석 ${list.length}개 · 순위를 누르면 이유</p></div></div>
        ${list.slice(0, 10).map(stockRow).join('') || '<p class="muted pad">데이터 없음</p>'}</section>
      ${list.length > 10 ? `<details class="card more-list"><summary class="b sm">11위 아래 ${list.length - 10}개 보기</summary><div class="tbl">${list.slice(10).map(stockRow).join('')}</div></details>` : ''}
      ${foot}`;
  }
  function homeRank() {
    if (!ML) {
      const list = rankItems().slice(0, 3);
      return `<section class="card panel tbl"><div class="tbl-head card-head"><div><h2>오늘의 순위</h2><p class="muted xs">대표 자산·코인 기준</p></div><a href="#rank">전체 ›</a></div>
        ${list.map((x) => rankRow(x, true)).join('')}</section>`;
    }
    const col = (mk) => { const l = stockRank(mk).slice(0, 3); return `<a class="mk" href="#rank" data-act="rank-tab" data-v="${mk}"><p class="kicker">${esc(U.MARKETS[mk])}</p>${l.map((x) => `<p class="mk-row"><span class="num muted">${x.rank}</span><span class="grow b">${esc(x.name)}</span><span class="num">${x.result.score100}</span></p>`).join('')}</a>`; };
    return `<section class="card"><div class="card-head"><h2>오늘의 종목 순위</h2><a href="#rank">전체 ›</a></div><p class="muted xs" style="margin-top:-8px">${esc(ML.asOf)} 종가 기준 · 시장별 TOP 3</p>
      <div class="grid2 mk-grid">${['nasdaq', 'spx', 'kospi', 'kosdaq'].map(col).join('')}</div></section>`;
  }
  function homePortfolio() {
    const P = portfolio();
    if (!P.rows.length) return `<a class="card link-card" href="#assets"><p class="kicker">내 자산</p><p class="b">빗썸·토스증권을 연결하면 내 종목의 상황과 행동 가이드가 여기에 나옵니다.</p></a>`;
    const c = actCounts(P.rows);
    return `<section class="card panel">
      <div class="row between"><p class="kicker">내 자산 현황</p><a class="xs" href="#assets">자세히 ›</a></div>
      <div class="row between" style="align-items:flex-end;gap:12px;flex-wrap:wrap"><p class="nav num">${won(P.all)}</p>
        <p class="num sm ${dirClass(P.pnl)}">${P.pnl >= 0 ? '+' : ''}${won(P.pnl)} · ${P.cost ? sign(P.pnl / P.cost * 100, 2) + '%' : '—'}</p></div>
      ${countsBox(c)}
      ${reviewMini()}
      <div class="guide">${guideList(P.rows, 4) || '<p class="muted sm">가격 기록을 불러오는 중…</p>'}</div>
      <p class="muted xs">행동 가이드는 진단점수·추세·과열·내 손익·비중을 정해진 규칙으로 합친 참고 정보입니다. 매매 결정과 책임은 본인에게 있습니다.</p>
    </section>`;
  }
  function tile(name, v, c, cls, hint) {
    return `<div class="card tile"><p class="muted sm">${esc(name)}</p><p class="h-lg">${esc(v)}</p><p class="sm b ${cls}">${esc(c)}</p><p class="muted xs">${esc(hint)}</p></div>`;
  }
  function mini(label, v, sub) { return `<div class="mini"><p class="muted xs">${esc(label)}</p><p class="h-md">${esc(v)}</p><p class="muted xs">${esc(sub)}</p></div>`; }
  // 짧은 원화: 1억 2,345만 / 2,345만 / 9,800원
  function wonShort(v) {
    if (v == null || isNaN(v)) return '—';
    const a = Math.abs(v), sg = v < 0 ? '-' : '';
    if (a >= 1e8) { const e = Math.floor(a / 1e8), m = Math.round((a % 1e8) / 1e4); return sg + e + '억' + (m ? ' ' + m.toLocaleString('ko-KR') + '만' : ''); }
    if (a >= 1e4) return sg + Math.round(a / 1e4).toLocaleString('ko-KR') + '만';
    return sg + Math.round(a).toLocaleString('ko-KR') + '원';
  }
  function todayLabel() { return new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }); }
  function svgSearch() { return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>'; }

  /* ---------- 화면: 내 자산 ---------- */
  // 휴대폰: GitHub 에 올린 '잠긴 자산 파일'을 비밀번호로 열기 (복호화는 이 폰 안에서만)
  function repoOf() {
    const m = location.hostname.match(/^([^.]+)\.github\.io$/); if (!m) return null;
    const name = location.pathname.split('/').filter(Boolean)[0]; return name ? m[1] + '/' + name : null;
  }
  async function fetchVault() {
    const repo = repoOf(); if (!repo) return null;
    const urls = ['https://api.github.com/repos/' + repo + '/contents/data/holdings.enc.json',
      'https://raw.githubusercontent.com/' + repo + '/main/data/holdings.enc.json?t=' + Date.now()];
    for (const u of urls) {
      try {
        const r = await fetch(u, { cache: 'no-store', headers: u.includes('api.github.com') ? { Accept: 'application/vnd.github.raw+json' } : {} });
        if (r.ok) { const j = await r.json(); if (j && j.ct) return j; }
      } catch (e) { /* 다음 주소 */ }
    }
    return null;
  }
  const b64 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
  async function vaultKey(box, pw) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: b64(box.salt), iterations: box.iter }, base, 256));
  }
  async function openVault(box, keyBytes) {
    const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(box.iv) }, key, b64(box.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }
  function useVault(data) {
    REAL = data; data.fromPhone = true;
    if (!S.demo) LIVE = REAL;
    loadPrices([]).then(render); allHoldings().filter((h) => h.type === 'coin').forEach((h) => ensureCloses(h.market));
  }
  async function tryVault() {
    if (REAL || !window.crypto || !crypto.subtle) return;
    const box = await fetchVault(); if (!box) return;
    S.vault = box;
    const saved = store.get('snw.vaultKey', null);
    if (saved && saved.salt === box.salt) { try { useVault(await openVault(box, b64(saved.key))); } catch (e) { store.set('snw.vaultKey', null); } }
    render();
  }
  function vaultCard() {
    if (REAL || !S.vault) return '';
    return `<section class="card panel"><p class="kicker">잠긴 내 자산</p>
      <p class="sm">컴퓨터에서 동기화한 자산이 잠긴 채로 올라와 있습니다(${esc(new Date(S.vault.at).toLocaleString('ko-KR'))}). 동기화 때 정한 휴대폰 비밀번호를 넣으세요.</p>
      <form id="vault-form" class="row" autocomplete="off"><input type="password" name="pw" placeholder="휴대폰 비밀번호" aria-label="휴대폰 비밀번호" required>
      <button class="btn primary sm-btn" type="submit">열기</button></form>
      <label class="xs muted"><input type="checkbox" id="vault-remember" checked> 이 휴대폰에서 기억하기</label>
      ${S.ui.vaultMsg ? `<p class="xs warn">${esc(S.ui.vaultMsg)}</p>` : ''}</section>`;
  }
  function syncInfo() {
    if (!LIVE && S.vault) return vaultCard();
    if (!LIVE) return `<section class="card note"><p class="b">빗썸·토스증권 자동 연결</p><p class="muted sm">connect 폴더의 동기화 프로그램을 한 번 실행하면 보유 자산이 자동으로 들어옵니다. 방법은 README의 "계좌 연결"을 보세요.</p></section>`;
    const t = new Date(LIVE.syncedAt);
    return `<section class="card note"><p class="b">자동 연결: ${esc(LIVE.sources.join(' · ') || '없음')}</p>
      <p class="muted sm">마지막 동기화 ${esc(t.toLocaleString('ko-KR'))}${LIVE.fromPhone ? ' · 휴대폰(잠금 해제됨)' : ''} · 새로 받으려면 컴퓨터에서 동기화 프로그램을 다시 실행하세요.</p>
      ${LIVE.fromPhone ? '<button class="btn sm-btn" data-act="vault-forget">이 휴대폰에서 잠그기</button>' : ''}
      ${(LIVE.notes || []).map((n) => `<p class="muted xs">· ${esc(n)}</p>`).join('')}</section>`;
  }
  // 동기화 프로그램이 계산한 총액과 앱 총액이 다르면 어느 종목이 다른지 보여 줌
  function syncCheck(rows, all) {
    if (S.demo || !REAL || !REAL.totalKrw) return '';
    const live = rows.filter((r) => r.h.live && r.h.syncValue != null);
    const liveSum = live.reduce((t, r) => t + (r.v || 0), 0) + (REAL.cashKrw || 0);
    const gap = liveSum - REAL.totalKrw;
    if (Math.abs(gap) < REAL.totalKrw * 0.1) return '';
    if (live.some((r) => r.v == null)) return ''; // 가격 못 받은 종목 안내가 따로 나옴
    const diff = live.filter((r) => r.v == null || Math.abs(r.v - r.h.syncValue) > Math.max(r.h.syncValue * 0.15, 100000))
      .map((r) => esc(r.h.name) + ' ' + (r.v == null ? '가격 없음' : won(r.v)) + ' / 동기화 ' + won(r.h.syncValue));
    return `<details class="card note"><summary><span class="b">합계가 거래소 숫자와 ${won(Math.abs(gap))} 달라요</span><span class="pro-tag">왜 그런지 보기</span></summary>
      <p class="muted sm" style="margin-top:8px">가격을 아직 못 받은 종목이 있거나, 마지막 동기화 이후 가격이 많이 움직였을 때 생겨요. 잠시 뒤 새로고침하면 대부분 맞춰져요.</p>
      <p class="muted xs">동기화 때 총액 ${won(REAL.totalKrw)} · 차이 나는 종목: ${diff.join(' · ') || '없음'}</p></details>`;
  }
  // 토스 해외주식 원금을 토스 앱과 맞추기 (토스가 원화 원금 합계를 안 보내 줄 때 직접 입력)
  function tossCostCard(rows) {
    const tr = rows.filter((r) => r.h.live && r.h.source === '토스증권' && r.h.type === 'stock');
    if (!tr.length || (LIVE && LIVE.tossSum && LIVE.tossSum.costKrw)) return '';
    const cost = tr.reduce((t, r) => t + (r.c || 0), 0);
    return `<details class="card foldable"${S.tossCost ? '' : ' open'}><summary>토스 손익이 토스 앱과 다르면</summary>
      <p class="muted sm">토스는 미국 주식 원금을 <b>산 날의 환율</b>로 계산해요. 토스 앱 <b>증권 → 내 투자</b>에서 평가금액에 손실 금액을 더하면 원금이에요(예: 평가 5,000만 + 손실 1,000만 = 원금 6,000만). 그 원금을 넣으면 이 앱도 토스와 같은 기준으로 계산해요.</p>
      <form id="toss-cost-form" class="row" style="gap:8px;margin-top:10px"><input name="v" inputmode="numeric" placeholder="토스 원금 (원)" value="${S.tossCost || ''}" style="flex:1;min-height:50px;border:0;border-radius:14px;padding:0 14px;background:var(--sunk);font-size:16px">
        <button class="btn primary" type="submit" style="min-height:50px">저장</button></form>
      <p class="muted xs" style="margin-top:6px">지금 계산된 토스 원금 ${won(cost)} ${S.tossCost ? '(입력값 ' + won(S.tossCost) + ' 기준으로 맞춤)' : ''}</p></details>`;
  }
  function viewAssets() {
    loadFilings();
    const hs = allHoldings();
    const cash = LIVE && LIVE.cashKrw ? LIVE.cashKrw : 0;
    const rows = hs.map((h) => { const v = holdingValue(h); const c = holdingCost(h); return { h, v, c, pnl: v == null ? null : v - c, pr: v == null || !c ? null : (v - c) / c * 100 }; })
      .sort((a, b) => (b.v || 0) - (a.v || 0));
    const sum = (list, f) => list.reduce((t, r) => t + (r.v == null ? 0 : f(r)), 0);
    const coins = rows.filter((r) => r.h.type === 'coin'), stocks = rows.filter((r) => r.h.type === 'stock');
    const coinV = sum(coins, (r) => r.v), stockV = sum(stocks, (r) => r.v);
    const invest = coinV + stockV, cost = sum(rows, (r) => r.c), pnl = invest - cost;
    const all = invest + cash;
    const missing = rows.filter((r) => r.v == null).length;
    const share = (x) => (all ? x / all * 100 : 0);
    const sensV = sum(rows.filter((r) => (r.h.type === 'coin' && !R.STABLE.includes(r.h.symbol)) || RATE_SENSITIVE.includes(r.h.sector)), (r) => r.v);
    const top = rows[0] && rows[0].v != null ? rows[0] : null;
    const tab = S.ui.assetTab || 'all';
    const syncT = LIVE ? new Date(LIVE.syncedAt) : null;

    if (!hs.length) return `
      <header class="top"><div><p class="kicker">빗썸 · 토스증권 · 직접 입력</p><h1>내 자산</h1></div>${tools()}</header>${demoBanner()}
      <section class="card empty"><p class="h-md">아직 등록한 자산이 없어요</p><p class="muted sm">빗썸·토스증권을 동기화하거나, 아래에서 직접 넣을 수 있습니다.</p></section>
      ${syncInfo()}${addBox()}`;

    const stat = (label, v, cls, sub) => `<div class="stat"><p class="kicker">${label}</p><p class="num ${cls || ''}">${v}</p>${sub ? `<p class="muted xs num">${sub}</p>` : ''}</div>`;
    const summary = `
      <section class="card panel">
        <div class="row between"><p class="kicker">총 자산</p><p class="kicker num">${syncT ? syncT.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' 업데이트' : '직접 입력'}</p></div>
        <p class="nav num">${won(all)}</p>
        <p class="hero-sub ${dirClass(pnl)}">${pnl >= 0 ? '+' : ''}${won(pnl)} (${cost ? sign(pnl / cost * 100, 1) + '%' : '—'}) <span class="muted" style="font-weight:500">투자 손익</span></p>
        <div class="alloc" role="img" aria-label="코인 ${nf(share(coinV), 1)}%, 주식 ${nf(share(stockV), 1)}%, 현금 ${nf(share(cash), 1)}%">
          <span class="a1" style="width:${share(coinV)}%"></span><span class="a2" style="width:${share(stockV)}%"></span><span class="a3" style="width:${share(cash)}%"></span></div>
        <div class="legend num xs"><span><i class="a1"></i>코인 ${nf(share(coinV), 1)}%</span><span><i class="a2"></i>주식 ${nf(share(stockV), 1)}%</span><span><i class="a3"></i>현금 ${nf(share(cash), 1)}%</span></div>
        <div class="stats">
          ${stat('투자 평가', wonShort(invest), '', '원금 ' + wonShort(cost))}
          ${stat('현금', wonShort(cash), '', '예수금')}
          ${stat('종목 수', hs.length + '개', '', missing ? '가격 없음 ' + missing : '코인' + coins.length + ' 주식' + stocks.length)}
        </div>
      </section>
      ${syncCheck(rows, all)}
      ${tossCostCard(rows)}
      ${missing ? `<section class="card note"><p class="b">총액에서 빠진 종목 ${missing}개</p><p class="muted sm">${esc(rows.filter((r) => r.v == null).map((r) => r.h.name).join(', '))} — 지금 가격을 받지 못해 합계에 들어가지 않았습니다. 잠시 뒤 새로고침하거나 동기화를 다시 실행해 주세요.</p></section>` : ''}
      <section class="card panel">
        <h2>위험 점검</h2>
        <div class="kv"><span>금리 민감 자산 비중</span><b class="num">${invest ? nf(sensV / invest * 100, 0) : 0}%</b></div>
        <div class="kv"><span>가장 큰 종목${top ? ' · ' + esc(top.h.name) : ''}</span><b class="num ${top && top.v / all > 0.4 ? 'warn' : ''}">${top ? nf(top.v / all * 100, 1) + '%' : '—'}</b></div>
        <div class="kv"><span>오늘의 시장날씨</span><b>${esc(weather().title)}</b></div>
        <p class="muted xs">한 종목이 40%를 넘으면 주황색으로 표시합니다. 금리 민감 자산은 코인(스테이블코인 제외)·기술·경기소비재·통신·부동산입니다.</p>
        ${stocks.some((r) => !r.h.sector) ? '<p class="muted xs">업종을 고르지 않은 주식은 금리 민감도와 진단점수 일부가 빠집니다. 주식 목록에서 업종을 골라 주세요.</p>' : ''}
      </section>`;

    const seg = `<div class="seg" role="tablist" aria-label="자산 보기">${[['all', '전체'], ['coin', '코인 ' + coins.length], ['stock', '주식 ' + stocks.length]].map(([k, l]) =>
      `<button role="tab" class="${tab === k ? 'on' : ''}" aria-selected="${tab === k}" data-act="asset-tab" data-v="${k}">${l}</button>`).join('')}</div>`;

    const block = (title, sub, list, total) => {
      if (!list.length) return '';
      const lp = sum(list, (r) => r.pnl), lc = sum(list, (r) => r.c);
      return `<section class="card panel tbl">
        <div class="tbl-head"><div><p class="kicker">${title}</p><p class="muted xs">${sub}</p></div>
          <div class="right"><p class="num b">${won(total)}</p><p class="num xs ${dirClass(lp)}">${sign(lp / (lc || 1) * 100, 2)}% · ${nf(share(total), 1)}%</p></div></div>
        <div class="tr th"><span>종목</span><span class="right">평가·현재가</span><span class="right">손익</span><span class="right">점수</span></div>
        ${groupRows(list, all, total)}
      </section>`;
    };
    const srcOf = (list) => Array.from(new Set(list.map((r) => r.h.source))).join(' · ');
    const coinBlock = block('코인', srcOf(coins) + ' · 실시간 시세', coins, coinV);
    const stockBlock = block('주식', srcOf(stocks) + ' · 동기화 시점 가격', stocks, stockV);

    return `
      <header class="top"><div><p class="kicker">${esc((LIVE ? LIVE.sources : []).join(' · ') || '직접 입력')}</p><h1>내 자산</h1></div>${tools()}</header>${demoBanner()}
      ${vaultCard()}${summary}${guideBox()}${seg}
      ${tab !== 'stock' ? coinBlock : ''}${tab !== 'coin' ? stockBlock + myFilCard(stocks) : ''}
      ${snowCard()}${calMini()}${reviewMini()}
      <p class="muted xs pad">금액 단위: 원 (현재가는 미국 주식만 달러). 업종은 분류표로 자동 지정되며, 주식 아래 칸에서 바꿀 수 있습니다. 점수 = 다중 조건 진단점수(100점). 누르면 근거를 볼 수 있습니다. ${S.priceSource ? '코인 시세: ' + esc(S.priceSource) + '.' : ''}</p>
      ${syncInfo()}${addBox()}`;
  }
  function groupRows(list, all, total) {
    const isCoin = list[0].h.type === 'coin';
    const keyOf = (h) => (isCoin ? T.coinCat(h.symbol) : (h.sector || 'none'));
    const nameOf = (k) => (isCoin ? T.COIN_CAT_NAME[k] : k === 'none' ? '업종 미지정' : sectorName(k));
    const groups = {};
    list.forEach((r) => { const k = keyOf(r.h); (groups[k] = groups[k] || []).push(r); });
    const order = Object.keys(groups).sort((a, b) => (a === 'none' || a === 'stable') - (b === 'none' || b === 'stable') || groups[b].reduce((t, r) => t + (r.v || 0), 0) - groups[a].reduce((t, r) => t + (r.v || 0), 0));
    return order.map((k) => {
      const g = groups[k], gv = g.reduce((t, r) => t + (r.v || 0), 0), gc = g.reduce((t, r) => t + (r.v == null ? 0 : r.c), 0);
      return `<div class="grp-row"><span>${esc(nameOf(k))} <span class="muted num">${g.length}</span></span><span class="num">${nf(Math.round(gv))} <span class="${dirClass(gv - gc)}">${gc ? sign((gv - gc) / gc * 100, 1) + '%' : ''}</span> <span class="muted">${all ? nf(gv / all * 100, 1) : 0}%</span></span></div>` + g.map((r) => holdRow(r, all)).join('');
    }).join('');
  }
  function guideBox() {
    const P = portfolio();
    return `<section class="card panel"><div class="row between"><p class="kicker">오늘의 행동 가이드</p><p class="muted xs">종목을 누르면 근거와 분할 계획</p></div>
      ${countsBox(actCounts(P.rows))}<div class="guide">${guideList(P.rows) || '<p class="muted sm">가격 기록을 불러오는 중…</p>'}</div>
      <p class="muted xs">규칙 기반 참고 정보입니다. 투자 권유가 아니며 결정과 책임은 본인에게 있습니다.</p></section>`;
  }
  function holdRow(r, all) {
    const h = r.h, sc = holdingScore(h);
    const act = R.actionFor && sc ? R.actionFor({ score: sc, candles: h.type === 'coin' ? S.candles[h.market] : stockCandles(h.symbol), pnlPct: r.pr, weightPct: r.v == null || !all ? null : r.v / all * 100, held: true, fng: S.fng }) : null;
    const usd = h.currency === 'USD';
    const cur = h.type === 'coin' ? coinPx(h) : h.price;
    const px = (v) => (v == null ? '—' : usd ? '$' + nf(v, 2) : nf(v, v < 100 ? 2 : 0));
    const qty = nf(h.qty, h.type === 'coin' ? (h.qty < 1 ? 6 : 4) : (Number.isInteger(h.qty) ? 0 : 4));
    return `<div class="tr">
      <div class="cell-name">
        <p class="b"><button class="link-btn" data-act="chart" data-kind="${h.type === 'coin' ? 'coin' : 'stock'}" data-v="${esc(h.type === 'coin' ? h.market : h.symbol)}" data-name="${esc(h.name)}">${esc(h.name)}</button>${h.symbol && h.symbol !== h.name ? ` <span class="sym num">${esc(h.symbol)}</span>` : ''}</p>
        <p class="muted xs num">${qty}${h.type === 'coin' ? '' : '주'}${h.source === '직접 입력' ? ' · 직접' : ''}</p>
        <p class="muted xs num">평단 ${px(h.avg)}</p>${actBadge(act)}${filChip(h)}
        ${h.type === 'stock' && h.live ? `<select class="mini-select" aria-label="${esc(h.name)} 업종${h.autoSector ? ' (자동)' : ''}" data-sector-for="${esc(h.symbol)}"><option value="">업종 선택</option>${SNAP.sectors.map((s) => `<option value="${s.id}" ${h.sector === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>` : ''}
      </div>
      <div class="right"><p class="num b">${r.v == null ? '가격 없음' : nf(Math.round(r.v))}</p><p class="num xs muted">${px(cur)}</p><p class="num xs muted">비중 ${r.v == null ? '—' : nf(r.v / all * 100, 1) + '%'}</p></div>
      <div class="right ${dirClass(r.pr)}"><p class="num b">${r.pr == null ? '—' : sign(r.pr, 2) + '%'}</p><p class="num xs">${r.pnl == null ? '' : (r.pnl > 0 ? '+' : '') + nf(Math.round(r.pnl))}</p></div>
      <div class="right"><button class="score-pill num" data-act="score-holding" data-id="${esc(h.id)}" aria-label="${esc(h.name)} 진단 보기">${h.type === 'stock' && ML && stockCandles(h.symbol) ? (screenFor(h.symbol, h.sector, h.currency).total ?? '—') : sc ? (sc.score100 == null ? '—' : sc.score100) : '…'}</button>
        ${h.live ? '' : `<button class="del" data-act="del-holding" data-id="${esc(h.id)}" aria-label="${esc(h.name)} 삭제">×</button>`}</div>
    </div>`;
  }
  function addBox() {
    return `<section class="card">
        <button class="btn ${S.ui.showAdd ? 'ghost' : ''}" data-act="toggle-add">${S.ui.showAdd ? '닫기' : '+ 직접 추가'}</button>
        ${S.ui.showAdd ? addForm() : ''}
      </section>`;
  }
  function sectorName(id) { const s = SNAP.sectors.find((x) => x.id === id); return s ? s.name : '업종 미지정'; }
  function addForm() {
    const t = S.ui.addType;
    return `<form id="add-form" class="form">
      <div class="seg" role="group" aria-label="자산 종류">
        <button type="button" class="${t === 'coin' ? 'on' : ''}" aria-pressed="${t === 'coin'}" data-act="add-type" data-v="coin">코인</button>
        <button type="button" class="${t === 'stock' ? 'on' : ''}" aria-pressed="${t === 'stock'}" data-act="add-type" data-v="stock">주식</button>
      </div>
      ${t === 'coin' ? `
        <label>코인 이름 또는 기호<input name="coin" list="coin-dl" required placeholder="예: 비트코인 또는 BTC" autocomplete="off"></label>
        <datalist id="coin-dl">${S.coinList.map((c) => `<option value="${esc(c.name)} (${esc(c.symbol)})"></option>`).join('')}</datalist>
        <div class="grid2"><label>수량<input name="qty" type="number" step="any" min="0" required></label><label>평균 매수가(원)<input name="avg" type="number" step="any" min="0" required></label></div>
      ` : `
        <label>종목 이름<input name="name" required placeholder="예: 엔비디아"></label>
        <label>업종<select name="sector" required class="select">${SNAP.sectors.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
        <div class="grid2"><label>수량<input name="qty" type="number" step="any" min="0" required></label><label>평균 매수가(원)<input name="avg" type="number" step="any" min="0" required></label></div>
        <label>지금 가격(원, 직접 입력)<input name="price" type="number" step="any" min="0" required></label>
      `}
      <button class="btn primary" type="submit">저장</button>
      <p class="muted xs" id="add-msg" role="status"></p>
    </form>`;
  }
  function findCoin(text) {
    const q = String(text || '').trim().toLowerCase();
    if (!q) return null;
    const m = q.match(/\(([a-z0-9]+)\)\s*$/i);
    const sym = m ? m[1].toLowerCase() : q;
    return S.coinList.find((c) => c.symbol.toLowerCase() === sym || c.name.toLowerCase() === q || c.name.toLowerCase() === sym || (c.en && c.en.toLowerCase() === q)) || null;
  }

  /* ---------- 화면: 진단 ---------- */
  function viewScore() {
    const r = S.ui.scoreResult;
    return `
      <header class="top"><div><a href="#explore" class="back">‹ 시장</a><p class="kicker">종목 이름만 적으면 돼요</p><h1>종목 분석</h1></div>${tools()}</header>
      <form id="score-form" class="form card">
        <label>종목 이름 또는 코드<input name="q" list="score-dl" value="${esc(S.ui.scoreQuery)}" placeholder="예: 비트코인, ETH, 엔비디아" autocomplete="off"></label>
        <datalist id="score-dl">${T.STOCK_LIST.map((c) => `<option value="${esc(c.name)} (${esc(c.symbol)})"></option>`).join('')}${S.coinList.map((c) => `<option value="${esc(c.name)} (${esc(c.symbol)})"></option>`).join('')}</datalist>
        <p class="xs muted" id="sector-hint" role="status">${esc(sectorHint(S.ui.scoreQuery))}</p>
        <label>업종 <span class="muted xs">(주식만 · 종목을 쓰면 자동으로 골라집니다)</span><select name="sector" class="select"><option value="">선택 안 함</option>${SNAP.sectors.map((s) => `<option value="${s.id}" ${S.ui.scoreSector === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
        <button class="btn primary" type="submit">진단하기</button>
      </form>
      ${r ? scoreCard(r) : ''}
      <p class="muted xs pad">점수는 사라·팔라는 신호가 아니라, 지금 이 종목을 둘러싼 조건이 얼마나 유리한지를 정해진 규칙으로 매긴 값입니다. 규칙은 js/rules.js 에 모두 공개돼 있습니다.</p>`;
  }
  function actionCard(r) {
    const a = r.action;
    if (!a) return '';
    const usd = r.currency === 'USD';
    const tick = (v) => (v >= 1e7 ? Math.round(v / 1e4) * 1e4 : v >= 1e5 ? Math.round(v / 100) * 100 : v >= 1e3 ? Math.round(v) : v);
    const px = (v) => (usd ? '$' + nf(v, 2) : v < 100 ? nf(v, 2) + '원' : won(tick(v)));
    return `<section class="card panel"><div class="row between"><p class="kicker">${r.pos ? '내 종목 행동 가이드' : '지금 산다면'}</p><span class="muted xs">신뢰도 ${esc(a.confidence)}</span></div>
      <div>${actBadge(a, true)}</div>
      <ul class="list xs">${a.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      ${a.plan.length ? `<p class="kicker">분할 계획 (가격 기준)</p><div class="plan">${a.plan.map((p) => `<div class="pl ${p.stop ? 'stop' : ''}"><span class="k">${esc(p.k)}</span><span class="xs muted">${esc(p.text)}</span><span class="num sm b">${px(p.px)}</span></div>`).join('')}</div>` : `<p class="muted xs">${r.kind && r.kind.startsWith('주식') ? (ML ? '이 종목은 시장 데이터 목록에 없어 가격 계획을 생략했습니다.' : 'connect 폴더에서 node market.mjs 를 실행하면 주가 기록이 들어와 분할 가격 계획도 계산합니다.') : '가격 기록이 없어 가격 계획은 생략했습니다.'}</p>`}
      <p class="muted xs">하루 평균 흔들림(ATR)과 20·60일 평균선으로 정한 기준선입니다. 계획 금액과 손절선은 매수 전에 정해 두세요.</p></section>`;
  }
  function sectorHint(q) {
    if (!q) return '예: 삼성전자, 엔비디아, NVDA, 005930, 비트코인';
    if (findCoin(q)) return '코인으로 진단합니다 (업종 필요 없음)';
    const f = T.findStock(q);
    return f ? (f.sector ? '자동 인식: ' + f.name + ' · ' + sectorName(f.sector) + (f.currency === 'USD' ? ' · 미국' : ' · 국내') : f.name + ' · 업종을 골라 주세요') : '목록에 없는 종목이면 업종을 직접 골라 주세요';
  }
  function scoreCard(r) {
    if (r.loading) return `<section class="card"><p class="muted">${esc(r.name)} 가격 기록 200일을 불러오는 중…</p></section>`;
    if (r.error) return `<section class="card"><p class="b">${esc(r.error)}</p></section>`;
    const s = r.result;
    const posNotes = r.pos ? R.positionNotes(r.pos.pnl, r.pos.weight) : [];
    const head = `<section class="card panel">
        <div class="row between"><div><p class="kicker">${esc(r.kind)}</p><p class="h-lg">${esc(r.name)}</p>${r.price ? `<p class="sm num">${esc(r.price)}</p>` : ''}</div>
        <div class="right"><p class="h-score">${s.score100 == null ? '—' : s.score100}<span class="muted sm"> /100</span></p><p class="b sm">${esc(s.grade)}</p></div></div>
        ${s.score100 == null ? '' : `<div class="meter" aria-hidden="true"><span style="width:${s.score100}%"></span></div>`}
        ${s.stable ? `<p class="muted sm">${esc(s.note)}</p>` : s.screen ? `<p class="muted xs num">월가 스크리너 5축 · 조건 ${s.checksUsed}개 · RS ${s.rs == null ? '—' : s.rs}${s.hasFund ? ' · 재무 지표 포함' : ' · 재무 지표 없음'}</p>` : `<p class="muted xs num">조건 ${s.checksUsed}개 반영 / 전체 ${s.checksAll}개${s.partial ? ' · 데이터가 없는 묶음은 빼고 계산' : ''}${r.days ? ' · 일봉 ' + r.days + '일 (' + esc(r.src) + ')' : ''}</p>`}
      </section>`;
    if (s.stable) return head;
    if (s.screen) {
      const cref = r.ref, cblock = cref && seriesFor(cref) ? `<section class="card panel chart-card"><p class="kicker">가격 차트 · 점선은 분할 계획</p>${chartBlock(cref, r.action && r.action.plan)}</section>` : '';
      const heading = `<p class="h-lg">${esc(r.name)}</p>${r.price ? `<p class="sm num">${esc(r.price)}</p>` : ''}<p class="muted xs num">${esc(r.kind)} · 조건 ${s.checksUsed}개 · RS ${s.rs == null ? '—' : s.rs} · ${s.fundSrc ? '재무: ' + esc(s.fundSrc) : '재무 지표 없음'}</p>`;
      return pentagonCard(s.axes, s.total, s.grade, '월가 스크리너 · 5축 점수', s.summary, heading) + swCard(s) + screensCard(s) + cblock + actionCard(r);
    }
    const pm = (list, sym) => list.map((c) => `<li><b>${esc(c.label)}</b> <span class="muted">${esc(c.note)}</span></li>`).join('') || '<li class="muted">없음</li>';
    const summary = `<section class="card panel"><p class="kicker">핵심 요약</p>
        <div class="grid2"><div><p class="sm b up">유리한 조건</p><ul class="list xs">${pm(s.plus)}</ul></div><div><p class="sm b down">불리한 조건</p><ul class="list xs">${pm(s.minus)}</ul></div></div>
        ${posNotes.length ? `<p class="kicker">내 포지션 점검</p><ul class="list xs">${posNotes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      </section>`;
    const groups = s.groups.map((g) => `<details class="grp" ${g.score != null && g.weight >= 20 ? 'open' : ''}>
        <summary><span>${esc(g.name)} <span class="muted xs">가중 ${g.weight}%</span></span><span class="num b">${g.score == null ? '—' : g.score}</span></summary>
        <div class="meter thin" aria-hidden="true"><span style="width:${g.score || 0}%"></span></div>
        ${g.checks.map((c) => `<div class="chk"><span class="dot ${c.pts == null ? 'na' : c.pts === c.max ? 'ok' : c.pts === 0 ? 'no' : 'mid'}" aria-hidden="true"></span>
          <div class="grow"><p class="sm">${esc(c.label)}</p><p class="muted xs">${esc(c.note)}</p></div><span class="num xs muted">${c.pts == null ? '—' : c.pts + '/' + c.max}</span></div>`).join('')}
      </details>`).join('');
    const cref = r.ref, cblock = cref && seriesFor(cref) ? `<section class="card panel chart-card"><p class="kicker">가격 차트 · 점선은 분할 계획</p>${chartBlock(cref, r.action && r.action.plan)}</section>` : '';
    const pent = r.ref && r.ref.kind === 'coin' ? pentagonCard(coinPentagon(s), s.score100, s.grade, '코인 5축 점수 · 가격·수급·거시 기반', '') : '';
    return head + pent + cblock + actionCard(r) + summary + `<section class="card panel tbl"><div class="tbl-head"><p class="kicker">조건별 점수 · 묶음을 눌러 펼치기</p></div>${groups}</section>`;
  }
  async function runScore(q, sector, pos) {
    S.ui.scoreQuery = q; S.ui.scoreSector = sector;
    const coin = findCoin(q);
    if (coin) {
      S.ui.scoreResult = { loading: true, name: coin.name };
      render();
      try {
        const [c] = await Promise.all([A.dailyCloses(coin.market), loadPrices([coin.market]), coin.market === 'KRW-BTC' ? null : ensureCloses('KRW-BTC')]);
        putCandles(coin.market, c);
      } catch (e) { /* 가격 기록 없이 계산 */ }
      const p = S.prices[coin.market];
      const res = R.scoreCoin2(coinCtx(coin.market));
      S.ui.scoreResult = { ref: { kind: 'coin', id: coin.market, name: coin.name }, kind: '코인 · ' + coin.symbol + ' · ' + T.COIN_CAT_NAME[T.coinCat(coin.symbol)], name: coin.name, price: p ? won(p.krw) + ' (' + sign(p.chg24, 2) + '%)' : '', result: res, pos, days: S.candles[coin.market] ? S.candles[coin.market].c.length : 0, src: S.candles[coin.market] ? S.candles[coin.market].source : '',
        action: R.actionFor({ score: res, candles: S.candles[coin.market], pnlPct: pos ? pos.pnl : null, weightPct: pos ? pos.weight : null, held: !!pos, fng: S.fng }) };
    } else if (q.trim()) {
      const t = q.trim(), code = t.replace(/\s*\(.*\)$/, '');
      const found = T.findStock(t);
      const sec = sector || (found && found.sector) || T.sectorOf(code);
      const cur = pos && pos.currency ? pos.currency : found ? found.currency : (/^[A-Za-z.]{1,6}$/.test(code) ? 'USD' : 'KRW');
      if (!sec) S.ui.scoreResult = { error: found ? found.name + '은(는) 업종 분류가 없는 종목(ETF 등)이에요. 업종을 골라 주세요.' : '종목을 찾지 못했어요. 이름을 정확히 쓰거나, 업종을 직접 골라 주세요.' };
      else { const sym = found ? found.symbol : code, kc = stockCandles(sym); const res = ML ? screenFor(sym, sec, cur) : R.scoreStock2({ ...stockCtx(sec, cur), candles: kc, ...benchFor(sym, cur) }); S.ui.scoreResult = { ref: kc ? { kind: 'stock', id: sym, name: found ? found.name : t } : null, kind: '주식 · ' + sectorName(sec) + (cur === 'USD' ? ' · 미국' : ' · 국내') + (sector ? '' : ' (업종 자동)'), name: found ? found.name + (found.symbol !== found.name ? ' (' + found.symbol + ')' : '') : t, result: res, pos, currency: cur, days: kc ? kc.c.length : 0, src: kc ? '야후 파이낸스' : '', action: R.actionFor({ score: res, candles: kc, pnlPct: pos ? pos.pnl : null, weightPct: pos ? pos.weight : null, held: !!pos, fng: S.fng }) }; }
    } else {
      S.ui.scoreResult = { error: '종목 이름을 적어 주세요.' };
    }
    render();
  }

  /* ---------- 화면: 세계 돈의 지도 ---------- */
  const OZ_PER_T = 32150.7466;
  function fxPerUsd(cur) {
    if (cur === 'USD') return 1;
    const L = S.fxLive && S.fxLive.rates;
    if (L && L.USD && L[cur]) return L.USD.krw / L[cur].krw; // 원화 교차환율로 1달러당 그 통화
    if (cur === 'KRW') return S.markets.usdkrw.value;
    const m = ML && ML.macro;
    if (cur === 'JPY' && m && m.usdjpy) return m.usdjpy.value;
    if (cur === 'CNY' && m && m.usdcny) return m.usdcny.value;
    if (cur === 'EUR' && m && m.eurusd) return 1 / m.eurusd.value;
    return S.fx && S.fx[cur] ? S.fx[cur] : null;
  }
  function wonBig(usdT) { // 조 달러 → 원 (조·경)
    const jo = usdT * S.markets.usdkrw.value;
    return jo >= 10000 ? nf(jo / 10000, 1) + '경 원' : nf(Math.round(jo)) + '조 원';
  }
  function worldAssets() {
    const W = SNAP.world;
    const silverPx = ML && ML.macro && ML.macro.silver ? ML.macro.silver.value : null;
    return W.assets.map((a) => {
      let v = a.usdT, live = false, sub = a.asOf + ' · ' + a.src;
      if (a.id === 'gold' && S.markets.gold && S.markets.gold.value) { v = a.tonnes * OZ_PER_T * S.markets.gold.value / 1e12; live = true; sub = nf(a.tonnes) + '톤 × 금값 $' + nf(S.markets.gold.value, 0) + ' · ' + a.src; }
      if (a.id === 'silver') { v = silverPx ? a.ozB * 1e9 * silverPx / 1e12 : null; live = !!silverPx; sub = silverPx ? nf(a.ozB * 10, 0) + '억 온스 × 은값 $' + nf(silverPx, 2) + ' · ' + a.src : '은 가격은 시장 데이터를 받으면 계산 · ' + a.src; }
      if (a.id === 'crypto') { v = S.totalCapT || null; live = true; sub = a.src; }
      if (a.id === 'btc') { v = S.totalCapT && S.btcDominance ? S.totalCapT * S.btcDominance / 100 : null; live = true; sub = '전체의 ' + nf(S.btcDominance, 1) + '% · ' + a.src; }
      return { ...a, v, live, sub };
    });
  }
  function fxCard() {
    const L = S.fxLive && S.fxLive.rates;
    const rows = [['USD', '미국 달러', '1달러'], ['EUR', '유로', '1유로'], ['JPY', '일본 엔', '100엔'], ['CNY', '중국 위안', '1위안']];
    const t = S.fxLive ? new Date(S.fxLive.at || Date.now()).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
    return `<section class="card panel"><div class="row between"><div><p class="kicker">환율 ${S.fxLive && S.fxLive.live ? '· 실시간' : ''}</p><p class="muted xs">${S.fxLive ? esc(S.fxLive.source) + ' · ' + t + ' 받음 · 1분마다 갱신' : '환율 불러오는 중…'}</p></div></div>
      <div class="fx-grid">${rows.map(([c, name, unit]) => { const r = L && L[c]; const v = r ? r.krw * (c === 'JPY' ? 100 : 1) : null; const mid = ({ USD: 'usdkrw', JPY: 'krwjpy', CNY: 'krwcny', EUR: 'krweur' })[c];
        return `<div class="cnt${ML && ML.macroSeries ? ' cnt-btn" role="button" tabindex="0" data-act="chart" data-kind="macro" data-v="' + mid + '" data-name="' + esc(MACRO_NAME[mid]) : ''}"><p class="xs muted">${name} · ${unit}</p><p class="num">${v ? nf(v, 2) + '원' : '—'}</p><p class="num xs ${r ? dirClass(r.chgPct) : ''}">${r && r.chgPct != null && !isNaN(r.chgPct) ? sign(r.chg * (c === 'JPY' ? 100 : 1), 2) + '원 · ' + sign(r.chgPct, 2) + '%' : '&nbsp;'}</p></div>`; }).join('')}</div>
      <p class="muted xs">1달러로 바꾸면: ${['EUR', 'JPY', 'CNY'].map((c) => { const v = fxPerUsd(c); return v ? nf(v, c === 'JPY' ? 1 : 3) + ' ' + ({ EUR: '유로', JPY: '엔', CNY: '위안' })[c] : ''; }).filter(Boolean).join(' · ')}. 아래 나라별 돈의 양은 이 환율로 달러 환산합니다.</p></section>`;
  }
  function viewWorld() {
    const W = SNAP.world;
    const assets = worldAssets();
    const max = Math.max.apply(null, assets.map((a) => a.v || 0));
    const get = (id) => assets.find((a) => a.id === id);
    const re = get('realestate'), gold = get('gold'), btc = get('btc'), stocks = get('stocks');
    const bar = (w, label, right, sub) => `<div class="wb"><div class="row between"><span class="b sm">${label}</span><span class="num sm">${right}</span></div>
      <div class="wb-track"><span style="width:${Math.max(w, 0.6)}%"></span></div>${sub ? `<p class="muted xs">${sub}</p>` : ''}</div>`;
    const WCH = { gold: ['macro', 'gold'], silver: ['macro', 'silver'], btc: ['coin', 'KRW-BTC'] };
    const assetBars = assets.slice().sort((a, b) => (b.v || 0) - (a.v || 0)).map((a) => bar(a.v ? a.v / max * 100 : 0, (WCH[a.id] && (WCH[a.id][0] === 'coin' || (ML && ML.macroSeries)) ? `<button class="link-btn" data-act="chart" data-kind="${WCH[a.id][0]}" data-v="${WCH[a.id][1]}" data-name="${esc(a.name)}">${esc(a.name)} ›</button>` : esc(a.name)) + (a.live ? ' <span class="act neu">실시간</span>' : ''), a.v ? nf(a.v, a.v < 10 ? 2 : 1) + '조 달러' : '—', `${a.v ? '≈ ' + wonBig(a.v) + ' · ' : ''}${esc(a.sub)}<br>${esc(a.note)}`)).join('');
    const money = W.money.map((m) => { const fx = fxPerUsd(m.id); return { ...m, usd: fx ? (m.id === 'USD' ? m.value : m.value / fx) : null }; });
    const mmax = Math.max.apply(null, money.map((m) => m.usd || 0));
    const moneyBars = money.slice().sort((a, b) => (b.usd || 0) - (a.usd || 0)).map((m) => bar(m.usd ? m.usd / mmax * 100 : 0, esc(m.name), m.usd ? nf(m.usd, 1) + '조 달러' : '환율 받는 중', `${nf(m.value, m.value < 100 ? 2 : 1)}${esc(m.unit)} · ${esc(m.asOf)} · ${esc(m.src)}${m.yoy != null ? ' · 1년 새 +' + m.yoy + '%' : ''}`)).join('');
    const fxBars = W.fxShare.map((c) => bar(c.v / W.fxShare[0].v * 100, esc(c.name) + (c.note ? ' <span class="muted xs">' + esc(c.note) + '</span>' : ''), nf(c.v, 1) + '%', '')).join('');
    const resBars = W.reserves.map((c) => bar(c.v, esc(c.name), nf(c.v, 1) + '%', '')).join('');
    const cn = money.find((m) => m.id === 'CNY'), us = money.find((m) => m.id === 'USD'), kr = money.find((m) => m.id === 'KRW');
    const insights = [
      re.v && gold.v ? `세상에서 가장 큰 자산은 <b>부동산</b>입니다. 지금까지 캔 금을 모두 합쳐도 부동산의 <b>${nf(gold.v / re.v * 100, 0)}%</b> 정도입니다.` : '',
      gold.v && btc.v ? `비트코인 전체 가치는 금의 <b>${nf(btc.v / gold.v * 100, 1)}%</b>입니다. "디지털 금"이라 불리지만 크기는 아직 금에 한참 못 미칩니다.` : '',
      cn && us && cn.usd && us.usd ? `돈의 양(M2)은 <b>중국이 미국의 ${nf(cn.usd / us.usd, 1)}배</b>입니다. 그런데도 세계 거래와 준비금은 달러가 압도합니다. 돈이 많은 것과 그 돈을 세계가 쓰는 것은 다릅니다.` : '',
      `외환거래 <b>10건 중 9건</b>에 달러가 끼어 있고, 각국 중앙은행 비상금의 <b>${W.reserves[0].v}%</b>가 달러입니다. 그래서 미국 금리가 오르면 전 세계 돈이 미국으로 빨려 들어갑니다.`,
      kr && kr.usd ? `한국의 돈의 양은 약 ${nf(kr.usd, 1)}조 달러로 미국의 ${nf(kr.usd / us.usd * 100, 0)}% 수준입니다. 원화는 세계 외환거래 비중 ${W.fxShare[5].v}%(12위)로 작아서, 위기 때 크게 흔들리기 쉽습니다.` : '',
      stocks.v && re.v ? `주식과 채권을 합쳐도(${nf(stocks.v + get('bonds').v, 0)}조 달러) 부동산(${nf(re.v, 0)}조 달러)보다 작습니다. 다만 주식·채권은 매일 사고팔 수 있어 돈의 흐름이 먼저 나타나는 곳입니다.` : ''
    ].filter(Boolean);
    return `
      <header class="top"><div><a href="#explore" class="back">‹ 시장</a><p class="kicker">원/달러 ${nf(S.markets.usdkrw.value, 1)}원 · 엔·위안·유로 실시간 환율로 환산</p><h1>세계 돈의 지도</h1></div>${tools()}</header>
      <section class="card panel"><p class="kicker">한눈에 보는 세계 경제</p><ul class="list sm">${insights.map((t) => `<li>${t}</li>`).join('')}</ul></section>
      ${fxCard()}
      <section class="card panel"><div><p class="kicker">자산 시장 크기</p><p class="muted xs">세상의 돈이 어디에 얼마나 담겨 있나 · 막대는 부동산 대비 크기</p></div>${assetBars}</section>
      <section class="card panel"><div><p class="kicker">나라별 돈의 양 (M2)</p><p class="muted xs">현금 + 예금처럼 바로 쓸 수 있는 돈 · 달러로 환산해 비교</p></div>${moneyBars}
        <p class="muted xs">돈의 양이 빠르게 늘면 물가와 자산 가격이 오르기 쉽고, 줄면 자산 시장에 찬바람이 붑니다.</p></section>
      <section class="card panel"><div><p class="kicker">통화의 힘 ① 하루 외환거래 ${W.fxTurnoverPerDayT}조 달러</p><p class="muted xs">거래마다 통화가 두 개라 합계 200% · ${esc(W.fxAsOf)} · ${esc(W.fxSrc)}</p></div>${fxBars}</section>
      <section class="card panel"><div><p class="kicker">통화의 힘 ② 세계 외환보유액 ${W.reservesT}조 달러</p><p class="muted xs">각국 중앙은행이 비상금을 어떤 돈으로 갖고 있나 · ${esc(W.resAsOf)} · ${esc(W.resSrc)}</p></div>${resBars}</section>
      <section class="card note"><p class="b sm">숫자에 대해</p>
        <p class="muted xs">부동산·주식·채권·돈의 양·외환 비중은 각 기관의 공식 발표값이라 발표가 나올 때마다 손으로 갱신합니다(js/snapshot.js의 world). 금·은·암호화폐 금액과 원화·달러 환산은 실시간 가격과 환율로 앱이 다시 계산합니다. 은의 남은 양은 기관마다 추정 차이가 큽니다.</p></section>`;
  }

  /* ---------- 화면: 차트 ---------- */
  const RANGES = [[22, '1달'], [66, '3달'], [130, '6달'], [250, '1년'], [750, '3년'], [1250, '5년'], [2520, '10년']];
  // 10년치 기록: js/history/키.js 를 필요할 때만 불러옴 (file:// 에서도 되는 script 방식)
  S.hist = {}; S.coinHist = {};
  // 차트 분석 도구 켜기·끄기 (기기에 저장)
  S.ta = Object.assign({ trend: true, sr: true, bb: false, fib: false, reg: false, cone: true, sub: 'vol' }, store.get('snw.ta', {}));
  const TA_TOOLS = [['trend', '추세선'], ['sr', '지지·저항'], ['bb', '볼린저'], ['reg', '회귀 채널'], ['fib', '피보나치'], ['cone', '예상 범위']];
  const TA_SUBS = [['vol', '거래대금'], ['rsi', 'RSI'], ['macd', 'MACD'], ['stoch', '스토캐스틱']];
  function taBar() {
    return `<div class="ta-bar" role="group" aria-label="분석 도구">${TA_TOOLS.map(([k, l]) => `<button class="ta-chip ${S.ta[k] ? 'on' : ''}" aria-pressed="${!!S.ta[k]}" data-act="ta" data-v="${k}">${l}</button>`).join('')}</div>
      <div class="ta-bar sub" role="group" aria-label="아래 칸 지표"><span class="xs muted">아래 칸</span>${TA_SUBS.map(([k, l]) => `<button class="ta-chip ${S.ta.sub === k ? 'on' : ''}" aria-pressed="${S.ta.sub === k}" data-act="ta-sub" data-v="${k}">${l}</button>`).join('')}</div>`;
  }
  const HIST_WAIT = {};
  window.SNW_HIST = (key, data) => { S.hist[key] = data; (HIST_WAIT[key] || []).forEach((f) => f()); delete HIST_WAIT[key]; };
  function loadHist(key) {
    if (S.hist[key] || HIST_WAIT[key]) return;
    HIST_WAIT[key] = [() => render()];
    const el = document.createElement('script');
    el.src = 'js/history/' + String(key).replace(/[^A-Za-z0-9_-]/g, '_') + '.js?v=' + encodeURIComponent((ML && ML.fetchedAt) || '');
    el.onerror = () => { S.hist[key] = { missing: true }; delete HIST_WAIT[key]; render(); };
    document.head.appendChild(el);
  }
  function loadCoinHist(market, unit) {
    const key = market + ':' + unit;
    if (S.coinHist[key]) return;
    S.coinHist[key] = { loading: true };
    A.coinHistory(market, unit).then((r) => { S.coinHist[key] = r; render(); }).catch(() => { S.coinHist[key] = { missing: true }; render(); });
  }
  // 기간별 차트 자료: { k, unit('일'|'주'|'월'), count } 또는 { loading } / { missing }
  function rangeData(ref, range) {
    const unit = range <= 250 ? 'd' : range <= 1250 ? 'w' : 'm';
    const count = unit === 'd' ? range : unit === 'w' ? Math.round(range / 5) : Math.round(range / 21);
    if (ref.kind === 'coin') {
      if (range <= 130) { const k = seriesFor(ref); return k ? { k, unit: 'd', count: range } : { loading: true }; }
      const cu = range <= 750 ? 'weeks' : 'months', key = ref.id + ':' + cu, h = S.coinHist[key];
      if (!h) { loadCoinHist(ref.id, cu); return { loading: true }; }
      if (h.loading || h.missing) return h;
      return { k: h, unit: cu === 'weeks' ? 'w' : 'm', count: cu === 'weeks' ? Math.round(range / 5) : Math.round(range / 21) };
    }
    if (unit === 'd' && range <= 250) { const k = seriesFor(ref); if (k) return { k, unit: 'd', count: range }; }
    const keys = ref.kind === 'stock' ? [stockKey(ref.id)] : ({ krwjpy: ['m_usdkrw', 'm_usdjpy'], krwcny: ['m_usdkrw', 'm_usdcny'], krweur: ['m_usdkrw', 'm_eurusd'] })[ref.id] || ['m_' + ref.id];
    keys.forEach(loadHist);
    if (keys.some((x) => !S.hist[x])) return { loading: true };
    if (keys.some((x) => S.hist[x].missing)) return { missing: true };
    let k = S.hist[keys[0]];
    if (keys.length === 2) k = crossFrom(S.hist[keys[0]], S.hist[keys[1]], ref.id === 'krwjpy' ? (a, b) => a / b * 100 : ref.id === 'krwcny' ? (a, b) => a / b : (a, b) => a * b);
    if (ref.kind === 'stock' && k.v && k.cur === 'USD') k = { ...k, v: k.v.map((x) => x * S.markets.usdkrw.value) };
    return { k: unit === 'd' ? k : window.PriceChart.aggregate(k, unit === 'w' ? 'W' : 'M'), unit, count };
  }
  function crossFrom(A, B, f) {
    const map = {}; B.t.forEach((t, i) => { map[t] = i; });
    const out = { t: [], o: [], h: [], l: [], c: [] };
    A.t.forEach((t, i) => { const j = map[t]; if (j == null || A.c[i] == null || B.c[j] == null) return; const o = f(A.o[i], B.o[j] || B.c[j]), c = f(A.c[i], B.c[j]); out.t.push(t); out.o.push(o); out.c.push(c); out.h.push(Math.max(o, c, f(A.h[i], B.c[j]))); out.l.push(Math.min(o, c, f(A.l[i], B.c[j]))); });
    return out;
  }
  const MACRO_NAME = { nasdaq: '나스닥 지수', spx: 'S&P 500 지수', kospi: '코스피 지수', kosdaq: '코스닥 지수', gold: '금 (달러/온스)', silver: '은 (달러/온스)', brent: '브렌트유 (달러/배럴)', us10y: '미국 10년물 금리', dxy: '달러지수', vix: '공포지수 VIX', usdkrw: '원/달러 환율', krwjpy: '원/엔 환율 (100엔)', krwcny: '원/위안 환율', krweur: '원/유로 환율' };
  const MACRO_FMT = { gold: '$', silver: '$', brent: '$', us10y: '%', usdkrw: '원', krwjpy: '원', krwcny: '원', krweur: '원' };
  // 두 시세를 날짜로 맞춰 교차 환율 만들기 (예: 원/엔 = 원/달러 ÷ 엔/달러 × 100)
  function crossSeries(a, b, f) {
    const A = ML && ML.macroSeries && ML.macroSeries[a], B = ML && ML.macroSeries && ML.macroSeries[b];
    if (!A || !B || !A.t || !B.t) return null;
    const map = {}; B.t.forEach((t, i) => { map[t] = i; });
    const out = { t: [], o: [], h: [], l: [], c: [] };
    A.t.forEach((t, i) => { const j = map[t]; if (j == null) return; out.t.push(t); ['o', 'c'].forEach((k) => out[k].push(f(A[k][i], B[k][j]))); const x = f(A.h[i], B.c[j]), y = f(A.l[i], B.c[j]); out.h.push(Math.max(x, y, out.o[out.o.length - 1], out.c[out.c.length - 1])); out.l.push(Math.min(x, y, out.o[out.o.length - 1], out.c[out.c.length - 1])); });
    return out.c.length > 1 ? out : null;
  }
  function seriesFor(ref) {
    if (!ref) return null;
    if (ref.kind === 'coin') { const k = S.candles[ref.id]; return k ? { ...k, o: k.o, t: k.t } : null; }
    if (ref.kind === 'stock') { const k = ML && ML.series[stockKey(ref.id)]; return k ? { ...k, v: stockCandles(ref.id).v } : null; }
    if (ref.kind === 'macro') {
      if (ref.id === 'krwjpy') return crossSeries('usdkrw', 'usdjpy', (a, b) => a / b * 100);
      if (ref.id === 'krwcny') return crossSeries('usdkrw', 'usdcny', (a, b) => a / b);
      if (ref.id === 'krweur') return crossSeries('usdkrw', 'eurusd', (a, b) => a * b);
      const k = ML && ML.macroSeries && ML.macroSeries[ref.id]; return k ? { ...k } : null;
    }
    return null;
  }
  function shortKrw(v) { return v >= 1e8 ? nf(v / 1e8, v >= 1e10 ? 0 : 2) + '억' : v >= 1e4 ? nf(v / 1e4, v >= 1e6 ? 0 : 1) + '만' : nf(v, 0); }
  function chartFmt(ref, k) {
    if (ref.kind === 'macro') { const u = MACRO_FMT[ref.id]; return u === '$' ? (v) => '$' + nf(v, v < 100 ? 2 : 0) : u === '%' ? (v) => nf(v, 2) + '%' : u === '원' ? (v) => nf(v, 1) : (v) => nf(v, v < 100 ? 2 : 0); }
    if (k && k.cur === 'USD') return (v) => '$' + nf(v, 2);
    return (v) => (v >= 1000 ? nf(Math.round(v)) : nf(v, v < 10 ? 3 : 2));
  }
  function chartBtn(kind, id, name, label) { return `<button class="btn sm-btn chart-btn" data-act="chart" data-kind="${kind}" data-v="${esc(id)}" data-name="${esc(name)}">${svgChart()} ${esc(label || '차트')}</button>`; }
  function svgChart() { return '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6M20 16v-9"/></svg>'; }
  function chartBlock(ref, plan) {
    const range = S.ui.chartRange || 130;
    const seg = `<div class="seg seg-sm seg-range" role="tablist" aria-label="차트 기간">${RANGES.map(([d, l]) => `<button role="tab" class="${range === d ? 'on' : ''}" aria-selected="${range === d}" data-act="chart-range" data-v="${d}">${l}</button>`).join('')}</div>`;
    if (ref.kind !== 'coin' && !ML) return seg + '<p class="muted sm">connect 폴더에서 node market.mjs 를 실행하면 차트가 나옵니다.</p>';
    const rd = rangeData(ref, range);
    if (rd.loading) return seg + taBar() + `<div class="pc-wait"><p class="muted sm">${range > 250 ? RANGES.find((x) => x[0] === range)[1] + '치 기록을 불러오는 중…' : '가격 기록을 불러오는 중…'}</p></div>`;
    if (rd.missing) return seg + `<p class="muted sm">${range > 250 ? '긴 기간 기록이 아직 없습니다. connect 폴더에서 node market.mjs 를 다시 실행하면 10년치가 생깁니다.' : '이 자산은 차트 기록이 없습니다.'}</p>`;
    const k = rd.k;
    const fmt = chartFmt(ref, k);
    const lines = rd.unit === 'd' ? (plan || []).map((p) => ({ px: p.px, label: p.k, stop: p.stop })) : [];
    const maLabels = rd.unit === 'w' ? ['20주선', '60주선'] : rd.unit === 'm' ? ['20개월선', '60개월선'] : ['20일선', '60일선'];
    const first = k.t && k.t[Math.max(0, k.c.length - rd.count)], note = rd.unit === 'd' ? '' : `<p class="muted xs">${rd.unit === 'w' ? '주봉' : '월봉'} · ${esc(first || '')}부터${k.c.length < rd.count ? ' (기록이 있는 기간 전체)' : ''}</p>`;
    const big = Math.max.apply(null, k.c) >= 1e6 && !(k.cur === 'USD');
    const afmt = big ? shortKrw : fmt;
    return seg + taBar() + note + window.PriceChart.html(k, { range: rd.count, ta: S.ta, maLabels, fmt, afmt, vfmt: (v) => '거래대금 ' + (v >= 1e12 ? nf(v / 1e12, 1) + '조' : nf(v / 1e8, 0) + '억') + '원', lines });
  }
  function chartStats(ref) {
    const k = seriesFor(ref); if (!k || k.c.length < 22) return '';
    const c = k.c, p = c[c.length - 1], fmt0 = chartFmt(ref, k), fmt = p >= 1e6 && k.cur !== 'USD' ? shortKrw : fmt0;
    const r = (n) => (c.length > n ? (p / c[c.length - 1 - n] - 1) * 100 : null);
    const m20 = c.slice(-20).reduce((a, b) => a + b, 0) / 20, m60 = c.length >= 60 ? c.slice(-60).reduce((a, b) => a + b, 0) / 60 : null;
    const hi = Math.max.apply(null, (k.h || c)), lo = Math.min.apply(null, (k.l || c)), rsi = R.rsi(c, 14);
    const cell = (l, v, cls, sub) => `<div class="cnt"><p class="xs muted">${l}</p><p class="num sm b ${cls || ''}">${v}</p>${sub ? `<p class="xs muted num">${sub}</p>` : ''}</div>`;
    const pc = (v) => (v == null ? '—' : sign(v, 1) + '%');
    const lt = longReturns(ref), y1 = c.length > 250 ? r(250) : lt.y1;
    const cagr = lt.y10 != null ? (Math.pow(1 + lt.y10 / 100, 1 / 10) - 1) * 100 : null;
    return `<div class="stat-grid">
      ${cell('1달', pc(r(21)), dirClass(r(21)))}${cell('3달', pc(r(63)), dirClass(r(63)))}${cell('1년', pc(y1), dirClass(y1))}
      ${cell('3년', pc(lt.y3), dirClass(lt.y3))}${cell('5년', pc(lt.y5), dirClass(lt.y5))}${cell('10년', pc(lt.y10), dirClass(lt.y10), cagr != null ? '연평균 ' + sign(cagr, 1) + '%' : '')}
      ${cell('1년 최고', esc(fmt(hi)))}${cell('1년 최저', esc(fmt(lo)))}${cell('최고가 대비', pc((p / hi - 1) * 100), 'down')}
      ${cell('20일선 대비', pc((p / m20 - 1) * 100), dirClass(p - m20))}${cell('60일선 대비', m60 ? pc((p / m60 - 1) * 100) : '—', m60 ? dirClass(p - m60) : '')}${cell('RSI(14)', rsi == null ? '—' : nf(rsi, 0) + (rsi > 70 ? ' 과열' : rsi < 30 ? ' 침체' : ''))}
    </div>`;
  }
  function liveNow(ref) {
    const L = S.fxLive && S.fxLive.rates, map = { usdkrw: ['USD', 1], krwjpy: ['JPY', 100], krwcny: ['CNY', 1], krweur: ['EUR', 1] };
    if (ref.kind === 'macro' && map[ref.id] && L && L[map[ref.id][0]]) return `<p class="xs muted">지금 <b class="num">${nf(L[map[ref.id][0]].krw * map[ref.id][1], 2)}원</b> · ${esc(S.fxLive.source)}</p>`;
    if (ref.kind === 'coin' && S.prices[ref.id]) return `<p class="xs muted">지금 <b class="num">${won(S.prices[ref.id].krw)}</b> · 실시간</p>`;
    return '';
  }
  // 3·5·10년 수익률: 주식·지표는 시장 데이터에 계산돼 있고, 코인은 월봉으로 계산
  function longReturns(ref) {
    if (ref.kind === 'stock') { const k = ML && ML.series[stockKey(ref.id)]; return k ? { y3: k.y3, y5: k.y5, y10: k.y10, since: k.since } : {}; }
    if (ref.kind === 'macro') { const m = ML && ML.macro && ML.macro[ref.id]; return m ? { y1: m.y1, y3: m.y3, y5: m.y5, y10: m.y10, since: m.since } : {}; }
    const h = S.coinHist[ref.id + ':months'];
    if (!h) { loadCoinHist(ref.id, 'months'); return {}; }
    if (!h.c) return {};
    const c = h.c, n = c.length, rr = (m) => (n > m ? (c[n - 1] / c[n - 1 - m] - 1) * 100 : null);
    return { y1: rr(12), y3: rr(36), y5: rr(60), y10: rr(120), since: h.t[0] };
  }
  function taCard(ref) {
    if (!window.TA) return '';
    const k = seriesFor(ref); if (!k || k.c.length < 60) return '';
    const fmt = chartFmt(ref, k), sf = Math.max.apply(null, k.c) >= 1e6 && k.cur !== 'USD' ? shortKrw : fmt;
    const a = window.TA.analyze(k, { fmt: sf, perYear: ref.kind === 'coin' ? 365 : 252, barsPerMonth: ref.kind === 'coin' ? 30 : 21 });
    if (!a) return '';
    return `<section class="card panel"><div class="row between"><p class="kicker">기술적 분석 리포트 · 일봉</p><span class="act ${a.verdict.startsWith('상승') ? 'pos' : a.verdict.startsWith('하락') ? 'neg' : 'neu'}">${esc(a.verdict)}</span></div>
      <ul class="list xs">${a.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
      <div class="ta-table">${a.rows.map((r) => `<div class="ta-row"><span class="muted">${esc(r[0])}</span><b class="num">${esc(r[1])}</b><span class="xs muted">${esc(r[2])}</span></div>`).join('')}</div>
      <p class="muted xs">추세선·지지·저항은 차트의 전환점(스윙 고점·저점)으로 자동 계산합니다. 예상 범위는 최근 60일 변동성으로 계산한 통계적 폭이며, 오를지 내릴지를 맞히는 예측이 아닙니다.</p></section>`;
  }
  function viewChart() {
    const ref = S.ui.chart;
    if (!ref) return `<header class="top"><div><a href="#explore" class="back">‹ 시장</a><h1>차트</h1></div></header><p class="muted pad">자산을 골라 주세요.</p>`;
    const k = seriesFor(ref);
    let score = null, action = null, kindLabel = '';
    if (ref.kind === 'coin') { score = R.scoreCoin2(coinCtx(ref.id)); action = R.actionFor({ score, candles: S.candles[ref.id], held: false, fng: S.fng }); kindLabel = '코인 · ' + ref.id.slice(4); }
    else if (ref.kind === 'stock') {
      const mk = marketOf(ref.id), it = U && mk ? U.LIST[mk].find((x) => x.s === stockKey(ref.id)) : null;
      const f = T.findStock(ref.id), sec = (it && it.sec) || (f && f.sector) || '';
      const cur = (k && k.cur) || (f && f.currency) || 'KRW';
      if (sec) { score = ML ? screenFor(ref.id, sec, cur) : R.scoreStock2({ ...stockCtx(sec, cur), candles: stockCandles(ref.id), ...benchFor(ref.id, cur) }); action = R.actionFor({ score, candles: stockCandles(ref.id), held: false, fng: S.fng }); }
      kindLabel = '주식 · ' + stockKey(ref.id) + (sec ? ' · ' + sectorName(sec) : '') + (mk ? ' · ' + U.MARKETS[mk] : '');
    } else kindLabel = '지표 · 일봉';
    const last = k ? k.c[k.c.length - 1] : null, prev = k && k.c.length > 1 ? k.c[k.c.length - 2] : null, fmt = chartFmt(ref, k);
    const chg = last && prev ? (last / prev - 1) * 100 : null;
    const back = S.ui.chartFrom || 'home';
    return `
      <header class="top"><div><a href="#${esc(back)}" class="back">‹ 뒤로</a><p class="kicker">${esc(kindLabel)}</p><h1>${esc(ref.name || MACRO_NAME[ref.id] || ref.id)}</h1></div>${tools()}</header>
      <section class="card panel chart-card">
        <div class="row between" style="align-items:flex-end;flex-wrap:wrap;gap:8px"><div><p class="nav num">${last ? esc(fmt(last)) : '—'}</p>
          <p class="num sm ${dirClass(chg)}">${chg == null ? '' : (chg > 0 ? '▲ ' : chg < 0 ? '▼ ' : '') + esc(fmt(Math.abs(last - prev))) + ' · ' + sign(chg, 2) + '%'} <span class="muted xs">${k && k.t ? esc(k.t[k.t.length - 1]) + ' 종가' : ''}</span></p>${liveNow(ref)}${tvButton(ref.kind, ref.id, ref.name || MACRO_NAME[ref.id] || ref.id, 'D')}</div>
          ${score && score.score100 != null ? `<div class="right"><p class="num rk-s">${score.score100}<span class="muted xs"> /100</span></p>${actBadge(action)}</div>` : ''}</div>
        ${chartBlock(ref, action && action.plan)}
      </section>
      ${ref.kind === 'stock' && ML ? (() => { const f = T.findStock(ref.id), mk = marketOf(ref.id), it = U && mk ? U.LIST[mk].find((x) => x.s === stockKey(ref.id)) : null, sec = (it && it.sec) || (f && f.sector) || ''; if (!sec) return ''; const sc = screenFor(ref.id, sec, (k && k.cur) || 'KRW'); return pentagonCard(sc.axes, sc.total, sc.grade, '월가 스크리너 · 5축 점수', sc.summary) + screensCard(sc); })() : ref.kind === 'coin' && score ? pentagonCard(coinPentagon(score), score.score100, score.grade, '코인 5축 점수', '') : ''}
      ${taCard(ref)}
      ${chartStats(ref) ? `<section class="card panel"><p class="kicker">한눈에 보는 숫자</p>${chartStats(ref)}${longReturns(ref).since ? `<p class="muted xs">기록 시작: ${esc(longReturns(ref).since)} · 10년이 안 된 자산은 기록 시작부터 계산하지 않고 비워 둡니다.</p>` : ''}</section>` : ''}
      ${action ? `<section class="card panel"><p class="kicker">지금 산다면 · ${esc(action.label)}</p><ul class="list xs">${action.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        ${ref.kind === 'coin' ? `<button class="btn sm-btn" data-act="rank-coin" data-v="${esc(ref.id)}">조건 전체 보기</button>` : `<button class="btn sm-btn" data-act="rank-stock" data-v="${esc(stockKey(ref.id))}" data-sec="">조건 전체 보기</button>`}</section>` : ''}
      <p class="muted xs pad">빨간 캔들은 그날 오른 날(종가 ≥ 시가), 파란 캔들은 내린 날입니다. 차트를 짚거나 마우스를 올리면 그날 가격이 나옵니다. 점선은 행동 가이드의 분할 계획 가격입니다.</p>`;
  }

  /* ---------- 화면: 자산 진단 ---------- */
  S.profile = store.get('snw.profile', null);
  S.extraCash = store.get('snw.extraCash', 0);
  function manwon(v) { const m = Math.round(v / 10000); return m >= 10000 ? nf(m / 10000, 2) + '억 원' : nf(m) + '만 원'; }
  function reviewInput() {
    const P = portfolio();
    const prof = S.profile && R.PROFILES.find((x) => x.id === S.profile.id);
    if (!prof) return null;
    const rows = P.rows.map((r) => {
      const h = r.h, sc = holdingScore(h);
      let vol = null;
      if (h.type === 'coin') { const k = S.candles[h.market]; if (k && k.c.length > 61) vol = R.volAnnual(k.c, 60); }
      else { const k = stockCandles(h.symbol); if (k && k.c.length > 61) vol = R.volAnnual(k.c, 60) * Math.sqrt(252 / 365); }
      return { name: h.name, sym: h.symbol, type: h.type, stable: h.type === 'coin' && R.STABLE.includes(h.symbol), value: r.v || 0, pnlPct: r.pr, sector: h.sector, score100: sc && sc.score100 != null ? sc.score100 : null, volAnn: vol };
    });
    return { profile: prof, weatherCount: weather().count, cash: P.cash + (Number(S.extraCash) || 0), rows, rateSensitive: RATE_SENSITIVE, sectorName };
  }
  function profileForm() {
    const ans = (S.profile && S.profile.answers) || [];
    return `<form id="profile-form" class="form">
      ${R.PROFILE_Q.map((q, i) => `<fieldset class="pq"><legend class="b sm">${i + 1}. ${esc(q.q)}</legend><div class="pq-opts">${q.a.map((a, j) => `<label class="pq-opt"><input type="radio" name="q${i}" value="${j}" ${ans[i] === j ? 'checked' : ''} required><span>${esc(a)}</span></label>`).join('')}</div></fieldset>`).join('')}
      <button class="btn primary" type="submit">내 투자성향 확인</button></form>`;
  }
  function viewReview() {
    const head = `<header class="top"><div><a href="#more" class="back">‹ 더보기</a><p class="kicker">투자성향에 맞는 비중 · 냉정한 평가</p><h1>자산 진단</h1></div>${tools()}</header>${demoBanner()}`;
    const guide = `<section class="card panel"><p class="kicker">투자성향별 권장 비중 (일반 가이드)</p>
      <div class="pf-table">${R.PROFILES.map((p) => `<div class="pf-row ${S.profile && S.profile.id === p.id ? 'on' : ''}"><span class="b sm">${p.name}</span>
        <div class="alloc" aria-label="현금 ${p.target.cash}%, 주식 ${p.target.stock}%, 코인 ${p.target.coin}%"><span class="a3" style="width:${p.target.cash}%"></span><span class="a2" style="width:${p.target.stock}%"></span><span class="a1" style="width:${p.target.coin}%"></span></div>
        <span class="num xs muted">현금 ${p.target.cash} · 주식 ${p.target.stock} · 코인 ${p.target.coin}</span></div>`).join('')}</div>
      <div class="legend num xs"><span><i class="a3"></i>현금·예금·채권</span><span><i class="a2"></i>주식·ETF</span><span><i class="a1"></i>코인</span></div>
      <p class="muted xs">시장날씨가 나쁠 때(역풍 4개 이상)는 현금을 5%p 더 두도록 목표를 조정합니다. 이 비중은 널리 쓰이는 일반적인 출발점이며, 나이·소득·빚·목표에 따라 달라질 수 있는 개인 자문이 아닙니다.</p></section>`;
    if (!S.profile || S.ui.editProfile) return `${head}<section class="card panel"><p class="kicker">투자성향 알아보기 · 질문 5개</p>${profileForm()}</section>${guide}`;
    const inp = reviewInput(), rv = inp && R.reviewPortfolio(inp);
    const prof = R.PROFILES.find((x) => x.id === S.profile.id);
    const profCard = `<section class="card panel"><div class="row between"><div><p class="kicker">내 투자성향</p><p class="h-lg">${esc(prof.name)}</p><p class="muted xs">${esc(prof.desc)}</p></div><button class="btn sm-btn" data-act="edit-profile">다시 하기</button></div>
      <label class="form-inline xs muted">빗썸·토스증권 예수금 말고 다른 곳(은행 등)에 둔 현금
        <span class="row" style="gap:6px"><input id="extra-cash" class="num" type="number" min="0" step="10000" value="${Number(S.extraCash) || 0}" inputmode="numeric"> 원</span></label></section>`;
    if (!rv) return `${head}${profCard}<section class="card empty"><p class="muted">평가할 자산이 아직 없습니다. 빗썸·토스증권을 동기화하거나 직접 추가해 주세요.</p></section>${guide}`;
    const gcls = { A: 'pos', B: 'pos', C: 'neu', D: 'neg', F: 'neg' }[rv.grade];
    const allocRow = (k, name) => { const a = rv.actual[k], t = rv.target[k], m = rv.moves.find((x) => x.k === k);
      return `<div class="ar"><div class="row between"><span class="b sm">${name}</span><span class="num xs">지금 <b>${nf(a, 1)}%</b> · 목표 ${nf(t, 1)}%</span></div>
        <div class="ar-bars"><span class="ar-now" style="width:${Math.min(100, a)}%"></span><span class="ar-goal" style="left:${Math.min(100, t)}%"></span></div>
        <p class="xs ${Math.abs(m.diffPct) < 3 ? 'muted' : m.amount > 0 ? 'up' : 'down'} num">${Math.abs(m.diffPct) < 3 ? '목표 근처 — 그대로 두기' : (m.amount > 0 ? '늘리기 약 ' : '줄이기 약 ') + manwon(Math.abs(m.amount)) + ' (' + sign(m.diffPct, 1) + '%p)'}</p></div>`; };
    return `${head}
      <section class="card panel"><div class="row between" style="align-items:flex-start"><div><p class="kicker">종합 평가 · ${esc(prof.name)} 기준</p><p class="sm">${esc(rv.headline)}</p></div>
        <div class="right"><p class="h-score">${rv.score}<span class="muted sm"> /100</span></p><span class="act lg ${gcls}">등급 ${rv.grade}</span></div></div>
        <div class="meter" aria-hidden="true"><span style="width:${rv.score}%"></span></div>
        <p class="muted xs num">평가 자산 ${manwon(rv.total)} (현금 포함) · 예상 연간 변동성 ${nf(rv.vol, 0)}% · 나쁜 해 예상 손실 ${nf(rv.worst, 0)}%</p></section>
      ${rv.issues.length ? `<section class="card panel"><p class="kicker">냉정한 한마디</p><ol class="list sm blunt">${rv.issues.slice(0, 5).map((x) => `<li>${esc(x.text)}</li>`).join('')}</ol></section>` : `<section class="card panel"><p class="kicker">냉정한 한마디</p><p class="sm">큰 약점이 보이지 않습니다. 지금 구조를 지키는 것이 가장 중요합니다.</p></section>`}
      <section class="card panel"><p class="kicker">목표 비중까지 · 리밸런싱</p>${allocRow('cash', '현금')}${allocRow('stock', '주식')}${allocRow('coin', '코인')}
        <p class="muted xs">한 번에 맞추기보다 몇 주에 걸쳐 나눠서 옮기는 것이 좋습니다. 팔 때는 손실 종목과 세금도 함께 고려하세요.</p></section>
      <section class="card panel tbl"><div class="tbl-head"><p class="kicker">항목별 점수</p></div>
        ${rv.cats.map((c) => `<details class="grp" ${c.score / c.max < 0.6 ? 'open' : ''}><summary><span>${esc(c.name)} <span class="muted xs">${esc(c.verdict || '')}</span></span><span class="num b">${c.score}<span class="muted xs">/${c.max}</span></span></summary>
          <div class="meter thin" aria-hidden="true"><span style="width:${c.score / c.max * 100}%"></span></div>${c.notes.map((n) => `<p class="xs muted" style="padding:4px 0">${esc(n)}</p>`).join('')}<div style="height:8px"></div></details>`).join('')}</section>
      ${profCard}${guide}
      <p class="muted xs pad">자산 진단은 정해진 규칙으로 계산한 참고용 평가입니다. 투자 권유나 개인 맞춤 자문이 아니며, 결정과 책임은 본인에게 있습니다.</p>`;
  }
  function reviewMini() {
    const inp = reviewInput();
    if (!inp) return `<a class="card link-card review-link" href="#review"><div><p class="kicker">자산 진단</p><p class="b">내 투자성향에 맞게 자산이 짜여 있을까?</p><p class="muted xs">질문 5개로 성향을 정하면 비중과 냉정한 평가가 나옵니다 ›</p></div></a>`;
    const rv = R.reviewPortfolio(inp); if (!rv) return '';
    const gcls = { A: 'pos', B: 'pos', C: 'neu', D: 'neg', F: 'neg' }[rv.grade];
    return `<a class="card link-card review-link" href="#review"><div class="row between" style="gap:12px"><div><p class="kicker">자산 진단 · ${esc(inp.profile.name)} 기준</p><p class="b sm">${esc(rv.headline)}</p>${rv.issues[0] ? `<p class="muted xs">${esc(rv.issues[0].text.split('.')[0])}.</p>` : ''}</div>
      <div class="right"><p class="num rk-s">${rv.score}</p><span class="act ${gcls}">${rv.grade}</span></div></div></a>`;
  }

  /* ---------- 자산 달력: 하루하루 기록 ---------- */
  // 실제 기록: 앱을 연 날의 총 자산을 기기에 저장 (발표 모드에서는 저장 안 함)
  S.assetLog = store.get('snw.assetLog', {});
  S.tossCost = Number(store.get('snw.tossCost', 0)) || 0;
  const dkey = (d) => { const x = new Date(d.getTime() + 9 * 3600 * 1000); return x.toISOString().slice(0, 10); }; // 한국 날짜
  const todayKey = () => dkey(new Date());
  function liveTotals() {
    const hs = allHoldings(), cash = (LIVE && LIVE.cashKrw ? LIVE.cashKrw : 0) + (Number(S.extraCash) || 0);
    let coin = 0, stock = 0, cost = 0, missing = 0; const hold = {};
    hs.forEach((h) => { const v = holdingValue(h); if (v == null) { missing++; return; } hold[h.id] = Math.round(v); cost += holdingCost(h); if (h.type === 'coin') coin += v; else stock += v; });
    return { t: Math.round(coin + stock + cash), c: Math.round(cash), k: Math.round(coin), s: Math.round(stock), cost: Math.round(cost), hold, missing };
  }
  function recordToday() {
    if (S.demo || !allHoldings().length) return;
    const t = liveTotals(); if (t.missing || !t.t) return;
    const k = todayKey(), prev = S.assetLog[k];
    if (prev && prev.t === t.t) return;
    delete t.missing; t.at = Date.now();
    S.assetLog[k] = t;
    const keys = Object.keys(S.assetLog).sort(); while (keys.length > 800) delete S.assetLog[keys.shift()];
    store.set('snw.assetLog', S.assetLog);
  }
  // 추정: 지금 보유 수량 × 그날 종가 (주말·휴장일은 직전 종가). 현금은 지금 현금으로 둠
  function priceMap(h) {
    if (h.type === 'coin') { const k = S.candles[h.market]; return k && k.t ? k.t.map((t, i) => [t, k.c[i]]) : null; }
    const s = ML && ML.series[stockKey(h.symbol)];
    if (!s || !s.t) return h.price ? [['2000-01-01', h.price * fxOf(h)]] : null;
    const fx = {}; const u = ML.macroSeries && ML.macroSeries.usdkrw; if (u && u.t) u.t.forEach((t, i) => { fx[t] = u.c[i]; });
    let lastFx = S.markets.usdkrw.value;
    return s.t.map((t, i) => { if (s.cur === 'USD') { if (fx[t]) lastFx = fx[t]; return [t, s.c[i] * lastFx]; } return [t, s.c[i]]; });
  }
  function estimateDays(days) {
    const hs = allHoldings(); if (!hs.length) return {};
    const maps = hs.map((h) => ({ h, m: priceMap(h) }));
    if (maps.some((x) => !x.m)) return {};
    const cash = (LIVE && LIVE.cashKrw ? LIVE.cashKrw : 0) + (Number(S.extraCash) || 0);
    const out = {}, ptr = maps.map(() => -1), now = new Date();
    for (let d = days; d >= 1; d--) {
      const key = dkey(new Date(now.getTime() - d * 86400000));
      let coin = 0, stock = 0, ok = true; const hold = {};
      maps.forEach((x, j) => { while (ptr[j] + 1 < x.m.length && x.m[ptr[j] + 1][0] <= key) ptr[j]++; if (ptr[j] < 0) { ok = false; return; } const v = x.m[ptr[j]][1] * x.h.qty; hold[x.h.id] = Math.round(v); if (x.h.type === 'coin') coin += v; else stock += v; });
      if (ok) out[key] = { t: Math.round(coin + stock + cash), c: Math.round(cash), k: Math.round(coin), s: Math.round(stock), hold, est: true };
    }
    return out;
  }
  function dayBook() {
    const est = estimateDays(200), book = { ...est };
    if (!S.demo) Object.keys(S.assetLog).forEach((k) => { book[k] = { ...S.assetLog[k], est: false }; });
    const lt = liveTotals(); if (!lt.missing && lt.t) book[todayKey()] = { ...lt, est: false, live: true };
    return book;
  }
  function shortWon(v) { const a = Math.abs(v), s = v > 0 ? '+' : v < 0 ? '−' : ''; return s + (a >= 1e8 ? nf(a / 1e8, 2) + '억' : a >= 1e4 ? nf(a / 1e4, a >= 1e6 ? 0 : 1) + '만' : nf(a)); }
  function calMini() {
    const t = todayChange();
    return `<a class="card link-card review-link" href="#calendar"><div class="row between" style="gap:12px"><div><p class="kicker">자산 달력</p><p class="b sm">하루하루 내 자산이 얼마나 변했는지</p><p class="muted xs">달력에서 날짜를 누르면 그날 많이 움직인 종목 ›</p></div>
      ${t ? `<div class="right"><p class="xs muted">오늘</p><p class="num b ${dirClass(t.ch)}">${shortWon(t.ch)}원</p><p class="num xs ${dirClass(t.ch)}">${sign(t.pc, 2)}%</p></div>` : ''}</div></a>`;
  }
  function viewCalendar() {
    const book = dayBook(), keys = Object.keys(book).sort();
    const prevOf = (k) => { const i = keys.indexOf(k); return i > 0 ? book[keys[i - 1]] : null; };
    const tk = todayKey(), month = S.ui.calMonth || tk.slice(0, 7);
    const [Y, M] = month.split('-').map(Number);
    const first = new Date(Date.UTC(Y, M - 1, 1)), daysIn = new Date(Date.UTC(Y, M, 0)).getUTCDate(), lead = (first.getUTCDay() + 6) % 7; // 월요일 시작
    const mk = (d) => month + '-' + String(d).padStart(2, '0');
    const sel = S.ui.calDay && S.ui.calDay.startsWith(month) ? S.ui.calDay : (book[tk] && tk.startsWith(month) ? tk : null);
    let cells = '';
    for (let i = 0; i < lead; i++) cells += '<div class="cal-c empty"></div>';
    let up = 0, down = 0, best = null, worst = null, firstV = null, lastV = null;
    for (let d = 1; d <= daysIn; d++) {
      const k = mk(d), b = book[k], p = b && prevOf(k), ch = b && p ? b.t - p.t : null, pc = ch != null && p.t ? ch / p.t * 100 : null;
      if (b) { if (firstV == null) firstV = p ? p.t : b.t; lastV = b.t; }
      if (ch != null) { if (ch > 0) up++; else if (ch < 0) down++; if (!best || ch > best.ch) best = { k, ch }; if (!worst || ch < worst.ch) worst = { k, ch }; }
      const cls = ch == null ? '' : ch > 0 ? 'up' : ch < 0 ? 'down' : '';
      const future = k > tk;
      cells += `<button class="cal-c ${cls} ${k === tk ? 'today' : ''} ${k === sel ? 'sel' : ''} ${b && b.est ? 'est' : ''}" ${future || !b ? 'disabled' : ''} data-act="cal-day" data-v="${k}" aria-label="${M}월 ${d}일${ch != null ? ' ' + shortWon(ch) + '원' : ''}">
        <span class="cal-d">${d}</span>${ch != null ? `<span class="cal-v num">${shortWon(ch)}</span><span class="cal-p num">${sign(pc, 1)}%</span>` : b ? '<span class="cal-p">시작</span>' : ''}${b && !b.est ? '<i class="cal-dot" title="실제 기록"></i>' : ''}</button>`;
    }
    const mch = firstV != null && lastV != null ? lastV - firstV : null;
    const prevM = new Date(Date.UTC(Y, M - 2, 1)).toISOString().slice(0, 7), nextM = new Date(Date.UTC(Y, M, 1)).toISOString().slice(0, 7);
    // 선택한 날 자세히
    let detail = '';
    if (sel && book[sel]) {
      const b = book[sel], p = prevOf(sel), ch = p ? b.t - p.t : null;
      const movers = p && b.hold && p.hold ? allHoldings().map((h) => ({ h, d: (b.hold[h.id] || 0) - (p.hold[h.id] || 0), v: b.hold[h.id] || 0, pv: p.hold[h.id] || 0 })).filter((x) => x.d).sort((a, c) => Math.abs(c.d) - Math.abs(a.d)).slice(0, 6) : [];
      detail = `<section class="card panel"><div class="row between"><div><p class="kicker">${sel.replace(/-/g, '.')} ${b.live ? '· 지금' : b.est ? '· 추정' : '· 기록'}</p><p class="nav num">${won(b.t)}</p>
          <p class="num sm ${dirClass(ch)}">${ch == null ? '첫 기록' : '전날보다 ' + (ch > 0 ? '+' : '') + won(ch) + ' (' + sign(ch / p.t * 100, 2) + '%)'}</p></div></div>
        <div class="stats">${[['코인', b.k], ['주식', b.s], ['현금', b.c]].map(([l, v]) => `<div class="stat"><p class="kicker">${l}</p><p class="num">${manwon(v)}</p>${p && v !== ({ 코인: p.k, 주식: p.s, 현금: p.c })[l] ? `<p class="xs num ${dirClass(v - ({ 코인: p.k, 주식: p.s, 현금: p.c })[l])}">${shortWon(v - ({ 코인: p.k, 주식: p.s, 현금: p.c })[l])}</p>` : ''}</div>`).join('')}</div>
        ${movers.length ? `<p class="kicker">이날 많이 움직인 종목</p><div class="mv">${movers.map((x) => `<div class="kv"><span>${esc(x.h.name)}</span><b class="num ${dirClass(x.d)}">${shortWon(x.d)}원 <span class="xs">${x.pv ? sign(x.d / x.pv * 100, 2) + '%' : ''}</span></b></div>`).join('')}</div>` : ''}
      </section>`;
    }
    const realDays = Object.keys(S.assetLog).length;
    return `
      <header class="top"><div><a href="#more" class="back">‹ 더보기</a><p class="kicker">하루하루 내 자산의 변화</p><h1>자산 달력</h1></div>${tools()}</header>${demoBanner()}
      <section class="card panel">
        <div class="row between"><button class="icon-btn" data-act="cal-month" data-v="${prevM}" aria-label="이전 달">‹</button>
          <div class="center-col"><p class="h-md">${Y}년 ${M}월</p><p class="num sm ${dirClass(mch)}">${mch == null ? '기록 없음' : '이번 달 ' + (mch > 0 ? '+' : '') + won(mch) + (firstV ? ' (' + sign(mch / firstV * 100, 2) + '%)' : '')}</p></div>
          <button class="icon-btn" data-act="cal-month" data-v="${nextM}" aria-label="다음 달" ${nextM > tk.slice(0, 7) ? 'disabled' : ''}>›</button></div>
        <div class="cal-h">${['월', '화', '수', '목', '금', '토', '일'].map((d) => `<span>${d}</span>`).join('')}</div>
        <div class="cal">${cells}</div>
        <div class="legend xs"><span><i class="lg-up"></i>오른 날</span><span><i class="lg-down"></i>내린 날</span><span><i class="cal-dot static"></i>실제 기록</span><span class="muted">흐린 칸 = 추정</span></div>
        ${up + down ? `<p class="muted xs num">오른 날 ${up}일 · 내린 날 ${down}일${best && best.ch > 0 ? ' · 최고 ' + Number(best.k.slice(8)) + '일 ' + shortWon(best.ch) : ''}${worst && worst.ch < 0 ? ' · 최저 ' + Number(worst.k.slice(8)) + '일 ' + shortWon(worst.ch) : ''}</p>` : ''}
      </section>
      ${detail}
      <section class="card note"><p class="b sm">달력 숫자는 이렇게 채웁니다</p>
        <p class="muted xs">점(•)이 있는 날은 앱을 연 날 실제로 저장한 총 자산입니다(지금까지 ${realDays}일). 흐린 칸은 <b>지금 보유 수량</b>에 그날 종가를 곱한 추정치라, 그사이 사고판 것은 반영되지 않습니다. 매일 한 번씩 앱을 열면 실제 기록이 쌓입니다. 기록은 이 기기에만 저장됩니다.</p></section>`;
  }
  function todayChange() {
    const book = dayBook(), keys = Object.keys(book).sort(), tk = todayKey(), i = keys.indexOf(tk);
    if (i < 1) return null;
    const b = book[tk], p = book[keys[i - 1]];
    return { ch: b.t - p.t, pc: (b.t - p.t) / p.t * 100 };
  }

  /* ---------- 포트폴리오 5축 분석 (레이더) ---------- */
  const AXES = [
    { id: 'trend', name: '추세', desc: '이동평균선 위치·정배열·시장 대비 힘으로 본 가격 흐름', groups: ['trend'] },
    { id: 'momentum', name: '탄력', desc: 'RSI·이격도·볼린저밴드로 본 과열·침체 정도 (과열도 감점)', groups: ['momentum'] },
    { id: 'risk', name: '안정성', desc: '변동성·최대 낙폭·하루 흔들림이 작을수록 높음', groups: ['risk'] },
    { id: 'flow', name: '수급', desc: '거래대금 변화와 오른 날·내린 날의 사고파는 힘 (코인은 ETF 자금·심리 포함)', groups: ['volume', 'flow'] },
    { id: 'env', name: '환경', desc: '금리·달러·유가·불안 같은 매크로와 업종 궁합', groups: ['macro', 'sector'] }
  ];
  function axisScores(res) { // 진단 결과 → 축별 0~6점
    const out = {};
    AXES.forEach((a) => { const gs = (res.groups || []).filter((g) => a.groups.includes(g.key) && g.score != null); out[a.id] = gs.length ? gs.reduce((t, g) => t + g.score, 0) / gs.length / 100 * 6 : null; });
    return out;
  }
  function snowData() {
    const P = portfolio(), total = P.all || 1;
    const items = P.rows.filter((r) => r.v && !(r.h.type === 'coin' && R.STABLE.includes(r.h.symbol))).map((r) => { const sc = holdingScore(r.h); return sc && sc.groups ? { h: r.h, w: r.v / total * 100, ax: axisScores(sc) } : null; }).filter(Boolean);
    const port = {};
    AXES.forEach((a) => { const xs = items.filter((x) => x.ax[a.id] != null), ws = xs.reduce((t, x) => t + x.w, 0); port[a.id] = ws ? xs.reduce((t, x) => t + x.ax[a.id] * x.w, 0) / ws : null; });
    return { items, port };
  }
  function radarSvg(port, sel) {
    const S0 = 300, C = S0 / 2, Rr = 104, n = AXES.length;
    const ang = (i) => -Math.PI / 2 + i * 2 * Math.PI / n, pt = (i, r) => [C + Math.cos(ang(i)) * r, C + Math.sin(ang(i)) * r];
    const poly = (r) => AXES.map((_, i) => pt(i, r).map((v) => v.toFixed(1)).join(',')).join(' ');
    let g = '';
    [2, 4, 6].forEach((lv) => { g += `<polygon class="rd-ring" points="${poly(Rr * lv / 6)}"/>`; });
    AXES.forEach((a, i) => { const [x, y] = pt(i, Rr); g += `<line class="rd-spoke" x1="${C}" y1="${C}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`; });
    // 선택한 축 부채꼴
    const si = AXES.findIndex((a) => a.id === sel);
    if (si >= 0) { const a1 = ang(si) - Math.PI / n, a2 = ang(si) + Math.PI / n; g += `<path class="rd-sel" d="M${C},${C} L${(C + Math.cos(a1) * Rr).toFixed(1)},${(C + Math.sin(a1) * Rr).toFixed(1)} A${Rr},${Rr} 0 0 1 ${(C + Math.cos(a2) * Rr).toFixed(1)},${(C + Math.sin(a2) * Rr).toFixed(1)} Z"/>`; }
    const vals = AXES.map((a, i) => pt(i, Rr * Math.max(0.15, (port[a.id] || 0) / 6)));
    g += `<polygon class="rd-shape" points="${vals.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')}"/>`;
    vals.forEach((p, i) => { g += `<circle class="rd-pt ${AXES[i].id === sel ? 'on' : ''}" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${AXES[i].id === sel ? 5 : 3.5}"/>`; });
    // 축 이름 (누르면 선택)
    AXES.forEach((a, i) => {
      const [x, y] = pt(i, Rr + 26), a1 = ang(i) - Math.PI / n, a2 = ang(i) + Math.PI / n, R2 = Rr + 44;
      g += `<g class="rd-axis ${a.id === sel ? 'on' : ''}" data-act="axis" data-v="${a.id}" role="button" tabindex="0" aria-label="${a.name} ${port[a.id] == null ? '' : port[a.id].toFixed(1) + '점'}">
        <path class="rd-hit" d="M${C},${C} L${(C + Math.cos(a1) * R2).toFixed(1)},${(C + Math.sin(a1) * R2).toFixed(1)} A${R2},${R2} 0 0 1 ${(C + Math.cos(a2) * R2).toFixed(1)},${(C + Math.sin(a2) * R2).toFixed(1)} Z"/>
        <text class="rd-lab" x="${x.toFixed(1)}" y="${(y - 2).toFixed(1)}" text-anchor="middle">${a.name}</text>
        <text class="rd-val" x="${x.toFixed(1)}" y="${(y + 13).toFixed(1)}" text-anchor="middle">${port[a.id] == null ? '—' : port[a.id].toFixed(1)}</text></g>`;
    });
    return `<svg class="rd" viewBox="0 0 ${S0} ${S0}" role="img" aria-label="포트폴리오 5축 점수">${g}</svg>`;
  }
  function snowCard() {
    const D = snowData();
    if (!D.items.length) return '';
    const sel = S.ui.axis || 'trend', ax = AXES.find((a) => a.id === sel), v = D.port[sel];
    const xs = D.items.filter((x) => x.ax[sel] != null);
    // 포트폴리오 평균보다 높은 종목은 올리는 쪽, 낮은 종목은 끌어내리는 쪽 (영향이 큰 = 비중 × 차이 순)
    const up = xs.filter((x) => x.ax[sel] >= v).sort((a, b) => (b.ax[sel] - v) * b.w - (a.ax[sel] - v) * a.w).slice(0, 5);
    const down = xs.filter((x) => x.ax[sel] < v).sort((a, b) => (v - b.ax[sel]) * b.w - (v - a.ax[sel]) * a.w).slice(0, 5);
    const row = (x, good) => `<button class="sf-row" data-act="chart" data-kind="${x.h.type === 'coin' ? 'coin' : 'stock'}" data-v="${esc(x.h.type === 'coin' ? x.h.market : x.h.symbol)}" data-name="${esc(x.h.name)}">
        <span class="row between"><span class="b sm">${esc(x.h.name)}</span><span class="num xs muted">${x.ax[sel].toFixed(1)}/6</span></span>
        <span class="sf-line"><span class="sf-bar"><span class="${good ? 'g' : 'b'}" style="width:${x.ax[sel] / 6 * 100}%"></span></span><span class="num xs muted">${nf(x.w, 1)}%</span></span></button>`;
    const avgAll = AXES.map((a) => D.port[a.id]).filter((x) => x != null), tot = avgAll.reduce((t, x) => t + x, 0);
    return `<section class="card panel"><div class="row between" style="align-items:flex-start;gap:12px"><div class="grow"><h2>내 포트폴리오 점수</h2><p class="muted xs">보유 종목 점수를 비중대로 합친 값 · 축을 누르면 이유</p></div><p class="num b h-md" style="white-space:nowrap;flex:none">${nf(tot, 1)}<span class="muted xs"> / 30</span></p></div>
      <div class="sf">
        <div class="sf-radar">${radarSvg(D.port, sel)}</div>
        <div class="sf-side">
          <p class="h-lg">${ax.name} <span class="num">${v == null ? '—' : v.toFixed(1)}</span><span class="muted sm"> / 6</span></p>
          <p class="muted xs">${esc(ax.desc)}</p>
          <div class="sf-cols"><div><p class="kicker">점수를 올리는 종목</p>${up.length ? up.map((x) => row(x, true)).join('') : '<p class="muted xs">없음</p>'}</div>
            <div><p class="kicker">점수를 끌어내리는 종목</p>${down.length ? down.map((x) => row(x, false)).join('') : '<p class="muted xs">없음</p>'}</div></div>
        </div></div>
      <p class="muted xs">오른쪽 %는 그 종목이 내 전체 자산에서 차지하는 비중입니다. 가치·성장·실적·재무·배당처럼 기업 실적이 필요한 축은 실적 데이터를 연결하면 추가할 수 있습니다. 지금 다섯 축은 가격·거래·거시 데이터로 계산합니다.</p></section>`;
  }

  /* ---------- 월가 스크리너 화면 (종목 오각형 1~100) ---------- */
  let RS_CACHE = null;
  function rsOf(sym) {
    if (!ML) return null;
    if (!RS_CACHE) { const m = {}; Object.entries(ML.series).forEach(([k, v]) => { m[k] = v.c; }); RS_CACHE = R.rsRatings(m); }
    return RS_CACHE[stockKey(sym)] ?? null;
  }
  function screenFor(sym, sec, cur) {
    const kc = stockCandles(sym), key = stockKey(sym);
    return R.screenStock({ candles: kc, ...benchFor(sym, cur), fund: ML && ML.fund ? ML.fund[key] : null, rs: rsOf(sym), sectorId: sec, currency: cur, markets: S.markets, rates: SNAP.rates, sectors: SNAP.sectors, events: SNAP.events, now: now() });
  }
  // 코인: 가격 기반 5축 (추세·탄력·안정성·수급·환경)
  function coinPentagon(res) {
    const g = (keys) => { const xs = (res.groups || []).filter((x) => keys.includes(x.key) && x.score != null); return xs.length ? Math.max(1, Math.round(xs.reduce((t, x) => t + x.score, 0) / xs.length)) : null; };
    const map = [['trend', '추세', ['trend']], ['momentum', '탄력', ['momentum']], ['risk', '안정성', ['risk']], ['flow', '수급', ['volume', 'flow']], ['env', '환경', ['macro', 'event']]];
    return map.map(([key, name, keys]) => ({ key, name, score: g(keys), checks: (res.groups || []).filter((x) => keys.includes(x.key)).reduce((t, x) => t.concat(x.checks), []) }));
  }
  function pentaSvg(axes, sel, act) {
    const S0 = 300, C = S0 / 2, Rr = 100, n = axes.length;
    const ang = (i) => -Math.PI / 2 + i * 2 * Math.PI / n, pt = (i, r) => [C + Math.cos(ang(i)) * r, C + Math.sin(ang(i)) * r];
    const poly = (r) => axes.map((_, i) => pt(i, r).map((v) => v.toFixed(1)).join(',')).join(' ');
    let g = '';
    [20, 40, 60, 80, 100].forEach((lv) => { g += `<polygon class="rd-ring ${lv === 100 ? 'outer' : ''}" points="${poly(Rr * lv / 100)}"/>`; });
    axes.forEach((a, i) => { const [x, y] = pt(i, Rr); g += `<line class="rd-spoke" x1="${C}" y1="${C}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`; });
    const si = axes.findIndex((a) => a.key === sel);
    if (si >= 0) { const a1 = ang(si) - Math.PI / n, a2 = ang(si) + Math.PI / n; g += `<path class="rd-sel" d="M${C},${C} L${(C + Math.cos(a1) * Rr).toFixed(1)},${(C + Math.sin(a1) * Rr).toFixed(1)} A${Rr},${Rr} 0 0 1 ${(C + Math.cos(a2) * Rr).toFixed(1)},${(C + Math.sin(a2) * Rr).toFixed(1)} Z"/>`; }
    const vals = axes.map((a, i) => pt(i, Rr * Math.max(0.06, (a.score || 0) / 100)));
    g += `<polygon class="rd-shape" points="${vals.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')}"/>`;
    vals.forEach((p, i) => { g += `<circle class="rd-pt ${axes[i].key === sel ? 'on' : ''}" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${axes[i].key === sel ? 5 : 3.5}"/>`; });
    axes.forEach((a, i) => {
      const [x, y] = pt(i, Rr + 28), a1 = ang(i) - Math.PI / n, a2 = ang(i) + Math.PI / n, R2 = Rr + 46;
      g += `<g class="rd-axis ${a.key === sel ? 'on' : ''}" data-act="${act}" data-v="${a.key}" role="button" tabindex="0" aria-label="${a.name} ${a.score == null ? '데이터 없음' : a.score + '점'}">
        <path class="rd-hit" d="M${C},${C} L${(C + Math.cos(a1) * R2).toFixed(1)},${(C + Math.sin(a1) * R2).toFixed(1)} A${R2},${R2} 0 0 1 ${(C + Math.cos(a2) * R2).toFixed(1)},${(C + Math.sin(a2) * R2).toFixed(1)} Z"/>
        <text class="rd-lab" x="${x.toFixed(1)}" y="${(y - 2).toFixed(1)}" text-anchor="middle">${a.name}</text>
        <text class="rd-val" x="${x.toFixed(1)}" y="${(y + 13).toFixed(1)}" text-anchor="middle">${a.score == null ? '—' : a.score}</text></g>`;
    });
    return `<svg class="rd" viewBox="-20 -6 ${S0 + 40} ${S0 + 12}" role="img" aria-label="5축 점수">${g}</svg>`;
  }
  function axisDetail(ax) {
    if (!ax) return '';
    const cs = ax.checks.filter((c) => c.max > 0 || c.pts == null);
    return `<p class="h-lg">${esc(ax.name)} <span class="num">${ax.score == null ? '—' : ax.score}</span><span class="muted sm"> / 100</span></p>
      ${ax.score == null ? '<p class="muted xs">이 축을 계산할 데이터가 아직 없습니다.</p>' : ''}
      <div class="ax-list">${cs.map((c) => `<div class="chk"><span class="dot ${c.pts == null ? 'na' : c.pts === c.max ? 'ok' : c.pts === 0 ? 'no' : 'mid'}" aria-hidden="true"></span><div class="grow"><p class="sm">${esc(c.label)}</p><p class="muted xs">${esc(c.note)}</p></div><span class="num xs muted">${c.pts == null ? '—' : c.pts + '/' + c.max}</span></div>`).join('')}</div>`;
  }
  function pentagonCard(axes, total, grade, title, summary, heading) {
    const sel = axes.some((a) => a.key === S.ui.pAxis) ? S.ui.pAxis : (axes.find((a) => a.score != null) || axes[0]).key;
    const gcls = total >= 65 ? 'pos' : total >= 50 ? 'neu' : 'neg';
    return `<section class="card panel"><div class="row between" style="align-items:flex-start;gap:12px"><div><p class="kicker">${esc(title)}</p>${heading || ''}${summary ? `<p class="sm">${esc(summary)}</p>` : ''}</div>
        <div class="right" style="white-space:nowrap"><p class="h-score">${total == null ? '—' : total}<span class="muted sm"> /100</span></p><span class="act ${gcls}">${esc(grade)}</span></div></div>
      <div class="sf"><div class="sf-radar">${pentaSvg(axes, sel, 'p-axis')}</div><div class="sf-side">${axisDetail(axes.find((a) => a.key === sel))}</div></div>
      <p class="muted xs">꼭짓점(축 이름)을 누르면 그 축의 세부 조건과 점수가 나옵니다.</p></section>`;
  }
  function screensCard(sc) {
    const box = (x) => `<div class="scr"><div class="row between"><div><p class="b sm">${esc(x.name)}</p><p class="xs muted">${esc(x.who)}</p></div><span class="num b ${x.total && x.pass === x.total ? 'up' : ''}">${x.pass}<span class="muted xs">/${x.total || x.items.length}</span></span></div>
      <ul class="scr-list">${x.items.map(([l, ok]) => `<li class="${ok == null ? 'na' : ok ? 'ok' : 'no'}"><span aria-hidden="true">${ok == null ? '–' : ok ? '✓' : '✕'}</span>${esc(l)}${ok == null ? ' <span class="muted">(데이터 없음)</span>' : ''}</li>`).join('')}</ul>
      <p class="xs muted">${esc(x.rule)}</p></div>`;
    const an = sc.analyst;
    return `<section class="card panel"><p class="kicker">월가 스크리너 체크리스트</p><div class="scr-grid">${sc.screens.map(box).join('')}
      ${an ? `<div class="scr"><p class="b sm">애널리스트 컨센서스</p><p class="xs muted">증권사 분석가 의견 평균</p>
        <div class="kv"><span>평균 의견</span><b>${an.rec != null ? esc(an.recText) + ' (' + nf(an.rec, 1) + ')' : '—'}</b></div>
        <div class="kv"><span>평균 목표가</span><b class="num">${an.target != null ? nf(an.target, 2) : '—'}</b></div>
        <div class="kv"><span>목표가까지</span><b class="num ${dirClass(an.upside)}">${an.upside != null ? sign(an.upside, 1) + '%' : '—'}</b></div>
        <div class="kv"><span>참여 분석가</span><b class="num">${an.n != null ? an.n + '명' : '—'}</b></div></div>` : ''}</div>
      <p class="muted xs">재무 지표는 공식 공시(미국 SEC EDGAR, 한국 OpenDART)로 계산합니다. 애널리스트 의견·목표가·공매도·기관 매수는 공식 무료 출처가 없어 넣지 않았습니다.</p>
      ${sc.rs != null ? `<p class="muted xs">상대강도(RS) ${sc.rs}점 = 이 종목의 최근 1년 가중 수익률이 분석 대상 종목 중 상위 ${100 - sc.rs}% 라는 뜻 (IBD 방식, 최근 3개월 40% 가중).</p>` : ''}</section>`;
  }
  function swCard(sc) {
    if (!sc.strengths.length && !sc.weaknesses.length) return '';
    return `<section class="card panel"><p class="kicker">강점과 약점</p><div class="grid2">
      <div><p class="sm b up">강점</p><ul class="list xs">${sc.strengths.map((t) => `<li>${esc(t)}</li>`).join('') || '<li class="muted">뚜렷한 강점 없음</li>'}</ul></div>
      <div><p class="sm b down">약점</p><ul class="list xs">${sc.weaknesses.map((t) => `<li>${esc(t)}</li>`).join('') || '<li class="muted">뚜렷한 약점 없음</li>'}</ul></div></div>
      ${!sc.hasFund ? '<p class="muted xs">재무 지표가 없어 가치·성장·수익성 축이 빠졌습니다. 미국 종목은 node market.mjs 를 다시 실행하면 SEC 공시에서 받고, 한국 종목은 .env 에 OpenDART 인증키(DART_API_KEY)를 넣어야 받습니다. 해외 기업(ADR) 등 일부는 제공되지 않습니다.</p>' : ''}</section>`;
  }

  /* ---------- 화면: 알림 ---------- */
  S.pushSub = store.get('snw.pushSub', null);
  const isStandalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent || '');
  function b64ToU8(s) { const p = '='.repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, (c) => c.charCodeAt(0)); }
  async function enablePush() {
    const key = window.SNW_CONFIG && window.SNW_CONFIG.vapidPublicKey;
    if (!key) { S.ui.pushMsg = '알림 키가 아직 없습니다. 컴퓨터에서 connect/push-setup.mjs 를 먼저 실행해 주세요.'; render(); return; }
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { S.ui.pushMsg = '알림이 허용되지 않았습니다. 아이폰 설정 → 알림 → 시장날씨에서 켤 수 있습니다.'; render(); return; }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) });
      S.pushSub = sub.toJSON(); store.set('snw.pushSub', S.pushSub); S.ui.pushMsg = '알림이 켜졌습니다. 아래 연결 코드를 GitHub에 넣으면 끝입니다.';
    } catch (e) { S.ui.pushMsg = '알림을 켜지 못했습니다: ' + (e && e.message ? e.message : e); }
    render();
  }
  async function testNotify() {
    try { const reg = await navigator.serviceWorker.ready; await reg.showNotification('시장날씨 테스트 알림', { body: '이렇게 매수 후보 알림이 옵니다.', icon: 'icons/icon-192.png', tag: 'snw-test', data: { url: './index.html#alerts' } }); S.ui.pushMsg = '테스트 알림을 보냈습니다.'; }
    catch (e) { S.ui.pushMsg = '테스트 알림 실패: ' + (e && e.message ? e.message : e); }
    render();
  }
  function viewAlerts() {
    const secure = location.protocol === 'https:' || location.hostname === 'localhost';
    const canPush = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    const key = window.SNW_CONFIG && window.SNW_CONFIG.vapidPublicKey;
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    const st = (ok, label, sub) => `<div class="step ${ok ? 'done' : ''}"><span class="step-i" aria-hidden="true">${ok ? '✓' : '·'}</span><div class="grow"><p class="b sm">${label}</p>${sub ? `<p class="xs muted">${sub}</p>` : ''}</div></div>`;
    const code = S.pushSub ? JSON.stringify([S.pushSub]) : '';
    const A = window.SNW_ALERTS;
    const items = A && A.items ? A.items : [];
    const list = items.length ? items.map((x) => `<button class="gd" data-act="chart" data-kind="${x.kind}" data-v="${esc(x.id)}" data-name="${esc(x.name)}">
        <span><span class="b">${esc(x.name)}</span> <span class="muted xs">${esc(x.market || '')}</span></span><span class="num b">${x.score}<span class="muted xs">/100</span></span>
        <span class="why">${esc(x.line)}</span></button>`).join('') : '<p class="muted sm">아직 보낸 알림이 없습니다. 매수 후보가 나오면 여기에 쌓입니다.</p>';
    return `
      <header class="top"><div><a href="#more" class="back">‹ 더보기</a><p class="kicker">매수 후보가 나오면 아이폰으로</p><h1>알림</h1></div>${tools()}</header>
      <section class="card panel"><p class="kicker">최근 매수 후보 알림</p>
        ${A && A.generatedAt ? `<p class="muted xs">마지막 자동 분석 ${esc(new Date(A.generatedAt).toLocaleString('ko-KR'))} · ${esc(A.note || '')}</p>` : ''}
        <div class="guide">${list}</div></section>
      <section class="card panel"><p class="kicker">알림 켜기 · 처음 한 번</p>
        ${st(secure, '인터넷 주소(https)로 열기', secure ? '' : '지금은 컴퓨터 파일로 열려 있어 알림을 켤 수 없습니다. GitHub Pages 주소로 여세요.')}
        ${st(isStandalone(), '아이폰 홈 화면에 설치', isStandalone() ? '' : (isIOS() ? '사파리 아래 공유 버튼(□↑) → "홈 화면에 추가" → 홈 화면의 시장날씨 아이콘으로 다시 열기' : '아이폰 사파리에서 이 주소를 열고 "홈 화면에 추가"'))}
        ${st(!!key, '알림 키 준비', key ? '' : '컴퓨터에서 connect 폴더의 node push-setup.mjs 를 한 번 실행')}
        ${st(perm === 'granted' && !!S.pushSub, '이 휴대폰에서 알림 허용', '')}
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <button class="btn primary sm-btn" data-act="push-on" ${secure && canPush ? '' : 'disabled'}>${S.pushSub ? '알림 다시 연결' : '알림 켜기'}</button>
          <button class="btn sm-btn" data-act="push-test" ${perm === 'granted' ? '' : 'disabled'}>테스트 알림</button></div>
        ${S.ui.pushMsg ? `<p class="sm">${esc(S.ui.pushMsg)}</p>` : ''}
        ${code ? `<p class="kicker">연결 코드</p><p class="xs muted">아래 코드를 복사해 GitHub 저장소 → Settings → Secrets and variables → Actions 에 이름 <b>PUSH_SUBSCRIPTIONS</b> 로 넣으세요. 이 코드로 이 휴대폰에만 알림이 갑니다(남에게 보내지 마세요).</p>
          <textarea class="code" readonly rows="4">${esc(code)}</textarea><button class="btn sm-btn" data-act="push-copy">연결 코드 복사</button>` : ''}
        ${!canPush && secure ? '<p class="xs muted">이 브라우저는 웹 푸시를 지원하지 않습니다. 아이폰은 iOS 16.4 이상, 홈 화면에 설치한 앱에서만 됩니다.</p>' : ''}
      </section>
      <section class="card note"><p class="b sm">어떤 때 알림이 오나요</p>
        <p class="muted xs">GitHub가 매일 두 번(한국장 마감 뒤 16:10, 미국장 마감 뒤 07:30) 자동으로 분석합니다. 나스닥·S&P500·코스피·코스닥 대표 종목과 주요 코인 가운데 <b>스크리너 70점 이상(코인은 65점)</b>이면서 <b>행동 가이드가 "분할 매수 검토"</b>인 종목이 새로 나오면 알립니다. 같은 종목은 7일 안에 다시 알리지 않습니다. 매수 결정과 책임은 본인에게 있습니다.</p></section>`;
  }

  /* ---------- 화면: 코인 ---------- */
  function viewCoin() {
    const mk = S.ui.coin;
    const meta = S.coinList.find((c) => c.market === mk) || { name: mk, symbol: mk.slice(4) };
    const p = S.prices[mk];
    const cl = S.closes[mk];
    const ch = (n) => cl && cl.length > n ? (cl[cl.length - 1] / cl[cl.length - 1 - n] - 1) * 100 : null;
    const m = S.markets;
    const winds = [
      { name: '금리', why: '미 10년물 ' + nf(m.us10y.value, 2) + '% — 이자 없는 코인은 금리가 높을수록 불리', bad: m.us10y.value >= 4.5 },
      { name: '달러', why: '달러지수 ' + nf(m.dxy.value, 2) + ' — 달러가 강하면 코인 약세', bad: m.dxy.value >= 102 },
      { name: 'ETF 자금', why: '미국 현물 ETF ' + SNAP.crypto.etfFlowLabel + ' ' + sign(SNAP.crypto.etfFlowMonth, 0) + '억 달러', bad: SNAP.crypto.etfFlowMonth < 0 }
    ];
    const bad = winds.filter((w) => w.bad).length;
    return `
      <header class="top"><div><a href="#explore" class="back">‹ 시장</a><p class="kicker">${esc(S.priceSource || '시세')} 기준 원화 가격</p><h1>코인 분석</h1></div></header>
      <div class="seg" role="group" aria-label="코인 선택">
        ${['KRW-BTC', 'KRW-ETH'].map((x) => `<button type="button" class="${mk === x ? 'on' : ''}" aria-pressed="${mk === x}" data-act="coin" data-v="${x}">${x === 'KRW-BTC' ? '비트코인' : '이더리움'}</button>`).join('')}
      </div>
      <section class="card">
        <p class="muted sm">${esc(meta.name)} · ${esc(meta.symbol)}</p>
        <p class="h-xxl">${p ? won(p.krw) : '불러오는 중'}</p>
        <div class="grid3">
          ${mini('24시간', p ? sign(p.chg24, 2) + '%' : '—', '')}
          ${mini('30일', sign(ch(30), 1) + (ch(30) == null ? '' : '%'), '')}
          ${mini('90일', sign(ch(90), 1) + (ch(90) == null ? '' : '%'), '')}
        </div>
      </section>
      <section class="card"><div class="row between"><h2>사람들의 마음</h2><span class="muted xs">공포·탐욕 지수${S.fngFrom === 'live' ? ' · 실시간' : ''}</span></div>
        <p><span class="h-xl">${S.fng}</span> <b class="down">${S.fng <= 25 ? '극단적 공포' : S.fng <= 45 ? '공포' : S.fng <= 55 ? '중립' : S.fng <= 75 ? '탐욕' : '극단적 탐욕'}</b></p>
        <div class="gauge" aria-hidden="true"><span style="left:calc(${S.fng}% - 7px)"></span></div>
        <div class="row between muted xs"><span>0 공포</span><span>50</span><span>100 탐욕</span></div>
      </section>
      <section class="card"><div class="row between"><h2>코인을 움직이는 3가지 바람</h2><span class="b ${bad ? 'down' : 'up'} sm">역풍 ${bad} / 3</span></div>
        ${winds.map((w) => `<div class="ev"><div class="grow"><p class="b">${esc(w.name)}</p><p class="muted xs">${esc(w.why)}</p></div><span class="b sm ${w.bad ? 'down' : 'up'}">${w.bad ? '역풍' : '순풍'}</span></div>`).join('')}
      </section>
      <div class="grid2">
        ${tile('코인 전체 시가총액', '$' + nf(S.totalCapT, 2) + '조', '', '', '')}
        ${tile('비트코인 도미넌스', nf(S.btcDominance, 1) + '%', '', '', '돈이 대장에게 얼마나 몰렸나')}
      </div>`;
  }

  /* ---------- 화면: 일지 ---------- */
  function viewJournal() {
    const rk = S.risk;
    return `
      <header class="top"><div><a href="#more" class="back">‹ 더보기</a><p class="kicker">오래 살아남는 트레이더의 도구</p><h1>매매일지</h1></div></header>
      <section class="card"><h2>사기 전에: 얼마나 살까?</h2><p class="muted sm">손절 가격을 먼저 정하면 살 수 있는 양이 정해집니다.</p>
        <div class="form" id="risk-form">
          <label>계좌 금액(원)<input data-risk="account" type="number" step="any" value="${rk.account || ''}"></label>
          <div class="grid2"><label>살 가격<input data-risk="entry" type="number" step="any" value="${rk.entry || ''}"></label><label>손절 가격<input data-risk="stop" type="number" step="any" value="${rk.stop || ''}"></label></div>
          <label>한 번에 잃어도 되는 비율 <b id="risk-pct">${rk.pct}%</b><input data-risk="pct" type="range" min="0.5" max="3" step="0.5" value="${rk.pct}"></label>
        </div>
        <div class="result" id="risk-out" role="status">${riskOut()}</div>
      </section>
      <section class="card"><h2>새 일지 쓰기</h2>
        <form id="journal-form" class="form">
          <label>무엇을<input name="what" required placeholder="예: 비트코인"></label>
          <label>왜 (지금 시장날씨와 사이클은?)<textarea name="why" rows="3" required placeholder="예: 12월 FOMC가 '이제 쉰다'로 나오면 금리·달러가 꺾일 것"></textarea></label>
          <label>틀렸다고 인정할 조건<input name="wrong" placeholder="예: 미 10년물이 5.2%를 넘으면"></label>
          <button class="btn primary" type="submit">일지 저장</button>
        </form>
      </section>
      <section class="card"><h2>내 기록 (${S.journal.length}건)</h2>
        ${S.journal.length ? S.journal.slice().reverse().map((j) => `<div class="jr">
          <div class="row between"><p class="b">${esc(j.what)}</p><span class="muted xs">${esc(j.date)} · 그날 날씨 ${esc(j.weather || '')}</span></div>
          <p class="sm">${esc(j.why)}</p>${j.wrong ? `<p class="muted xs">틀렸다고 볼 조건: ${esc(j.wrong)}</p>` : ''}
          <div class="row gap"><button class="btn sm-btn ${j.result === 'hit' ? 'on' : ''}" data-act="jr-result" data-id="${esc(j.id)}" data-v="hit">맞았다</button><button class="btn sm-btn ${j.result === 'miss' ? 'on' : ''}" data-act="jr-result" data-id="${esc(j.id)}" data-v="miss">틀렸다</button><button class="btn sm-btn" data-act="jr-del" data-id="${esc(j.id)}">삭제</button></div>
        </div>`).join('') : '<p class="muted sm">기록이 쌓이면 어떤 날씨에서 내가 잘 맞혔는지 보여 드립니다.</p>'}
        ${journalStats()}
      </section>`;
  }
  function riskOut() {
    const rk = S.risk;
    const r = R.positionSize(rk.account, rk.entry, rk.stop, rk.pct);
    if (!r) return '<p class="muted sm">살 가격과 손절 가격(살 가격보다 낮게)을 넣어 주세요.</p>';
    return `<div class="grid2"><div><p class="muted xs">최대로 살 수 있는 금액</p><p class="h-lg">${won(r.amount)}</p></div><div><p class="muted xs">틀려도 잃는 돈</p><p class="h-lg down">${won(r.maxLoss)}</p></div></div>
      <p class="muted xs">손절까지 ${nf(r.drop, 1)}% 떨어질 수 있으니, 계좌의 ${rk.pct}%만 잃도록 ${won(r.amount)}까지만 삽니다.</p>`;
  }
  function journalStats() {
    const done = S.journal.filter((j) => j.result);
    if (!done.length) return '';
    const hit = done.filter((j) => j.result === 'hit').length;
    return `<p class="sm"><b>적중률 ${nf(hit / done.length * 100, 0)}%</b> <span class="muted">(${hit}/${done.length}건)</span></p>`;
  }

  /* ---------- 화면: 성적표 ---------- */
  function viewCompare() {
    const basis = S.ui.compareBasis;
    const key = basis === 'krw' ? 'krw' : 'local';
    const rows = R.perfTable(SNAP.perf).sort((a, b) => b[key] - a[key]);
    const max = Math.max(...rows.map((r) => Math.abs(r[key])));
    return `
      <header class="top"><div><a href="#explore" class="back">‹ 시장</a><p class="kicker">${esc(SNAP.perf.period)}</p><h1>1년 전 1,000만 원을 넣었다면?</h1></div></header>
      <div class="seg" role="group" aria-label="수익률 기준">
        <button type="button" class="${basis === 'krw' ? 'on' : ''}" aria-pressed="${basis === 'krw'}" data-act="basis" data-v="krw">원화 기준 (내 계좌)</button>
        <button type="button" class="${basis === 'local' ? 'on' : ''}" aria-pressed="${basis === 'local'}" data-act="basis" data-v="local">현지 통화 기준</button>
      </div>
      <section class="card">${rows.map((r) => {
        const v = r[key], w = max ? Math.abs(v) / max * 50 : 0;
        return `<div class="pbar"><span class="pname">${esc(r.name)}</span>
          <span class="ptrack"><span class="${v >= 0 ? 'pos' : 'neg'}" style="width:${w}%"></span></span>
          <span class="pval"><b class="${dirClass(v)}">${sign(v, 1)}%</b>${basis === 'krw' ? `<span class="muted xs">${nf(r.won10m, 0)}만 원</span>` : ''}</span></div>`;
      }).join('')}</section>
      <section class="card"><p class="b accent sm">공부 포인트 · 환율 효과</p><p class="sm">해외 자산은 현지 통화로 올라도, 그사이 원화가 강해지면 원화 기준 수익이 줄어듭니다. 버튼으로 기준을 바꿔 순위가 어떻게 달라지는지 보세요.</p></section>`;
  }

  /* ---------- 화면: 사이클 ---------- */
  function viewCycle() {
    const cur = currentPhase();
    const sel = S.ui.phase || cur;
    const phases = [
      { id: 1, num: '①', name: '회복기', short: '금리 인하 시작', themes: '금융·증권, 경기소비재, 기술주, 코인', why: '돈이 싸지기 시작하면 가장 많이 빠졌던 성장·위험 자산이 먼저 튀어 오릅니다.' },
      { id: 2, num: '②', name: '확장기', short: '실적 증가, 금리 안정', themes: '반도체·기술, 산업재·기계, 소재', why: '기업 실적이 숫자로 찍히는 구간. 주도주가 가장 길게 갑니다.' },
      { id: 4, num: '④', name: '둔화기', short: '금리 고점, 경기 걱정', themes: '필수소비재, 헬스케어, 유틸리티, 배당주', why: '경기가 나빠도 사야 하는 것을 파는 방어주로 돈이 숨습니다.' },
      { id: 3, num: '③', name: '후기·과열', short: '물가↑ 금리 인상', themes: '에너지, 원자재·소재, 방산', why: '물가와 원자재 값이 오르면 물건을 가진 업종이 웃습니다.' }
    ];
    const sp = phases.find((p) => p.id === sel);
    const { quads } = R.sectorQuads(SNAP.sectors);
    const qbox = (k, name, arrow, hi) => `<div class="quad ${hi ? 'hi' : ''}"><div class="row between"><b class="sm">${name}</b><span class="muted" aria-hidden="true">${arrow}</span></div><div class="tags">${quads[k].map((s) => `<span class="tag">${esc(s.name)}</span>`).join('') || '<span class="muted xs">없음</span>'}</div></div>`;
    return `
      <header class="top"><div><a href="#explore" class="back">‹ 시장</a><p class="kicker">돈은 테마를 돌아다닙니다</p><h1>테마 사이클</h1></div></header>
      <section class="card"><h2>사이클 시계</h2>
        <div class="grid2">${phases.map((p) => `<button type="button" class="phase ${p.id === sel ? 'on' : ''}" aria-pressed="${p.id === sel}" data-act="phase" data-v="${p.id}">
          <span class="row between"><span class="muted xs">${p.num}</span>${p.id === cur ? '<span class="now">지금 여기</span>' : ''}</span>
          <span class="b">${p.name}</span><span class="muted xs">${p.short}</span></button>`).join('')}</div>
        <div class="phase-detail"><p class="muted xs">${sp.num} ${sp.name}에 강한 테마</p><p class="b">${sp.themes}</p><p class="sm">${sp.why}</p></div>
        <p class="muted xs">'지금 여기'는 연준 금리 방향과 시장날씨 역풍 개수로 자동 판단합니다.</p>
      </section>
      <section class="card"><h2>돈은 지금 어디서 어디로</h2><p class="muted xs">미국 11개 업종 · 가로 올해 수익률, 세로 최근 1달 · 시계 방향으로 돕니다 · 기준일 ${esc(SNAP.asOf)}</p>
        <div class="grid2 quads">${qbox('improve', '살아나는 중', '→', false)}${qbox('lead', '주도', '↓', true)}${qbox('lag', '소외', '↑', false)}${qbox('weak', '힘 빠지는 중', '←', false)}</div>
      </section>`;
  }

  /* ---------- 렌더 & 이동 ---------- */
  /* ===================== 모의투자 봇 ===================== */
  const BOT_STATUS = { ok: ['가동 중', 'live'], probation: ['절반 가동', 'neu'], halve: ['연속 손실 · 절반', 'neu'], dayblock: ['하루 쉼', 'neu'], paused: ['금고 정지', 'neg'] };
  const pct = (v, d) => { if (v == null || isNaN(v)) return '—'; const t = Number(v).toFixed(d == null ? 1 : d); return (/^-0(\.0+)?$/.test(t) ? t.slice(1) : (v > 0 ? '+' : '') + t) + '%'; };
  const rr = (x) => { const t = x.toFixed(1); return (t === '-0.0' ? '0.0' : (x > 0 ? '+' : '') + t) + 'R'; };
  const man = (v) => (v == null ? '—' : (Math.abs(v) >= 1e8 ? (v / 1e8).toFixed(2) + '억' : (Math.round(v / 1e4) || 0).toLocaleString('ko-KR') + '만') + '원');
  const pxOf = (v, cur) => (v == null ? '—' : cur === 'USD' ? '$' + nf(v, v < 10 ? 3 : 2) : v >= 100 ? nf(Math.round(v)) + '원' : nf(v, 2) + '원');
  function paperData() { return window.SNW_PAPER || null; }
  function loadRemotePaper() { // 컴퓨터에서 열었을 때: GitHub Pages 에 있는 최신 결과를 불러옴
    if (window.SNW_PAPER || S.paperTried) return; S.paperTried = true;
    const repo = (REAL && REAL.repo) || null; if (!repo || location.protocol.indexOf('http') === 0) return;
    const [owner, name] = repo.split('/'); if (!owner || !name) return;
    try {
      const s = document.createElement('script'); s.src = 'https://' + owner + '.github.io/' + name + '/js/paper-live.js?t=' + Date.now();
      s.onload = () => { if (route() === 'paper' || route() === 'home') render(); }; document.head.appendChild(s);
    } catch (e) { /* 불러오기 실패: 빈 화면 안내 유지 */ }
  }
  // 자산 곡선 (여러 줄, 시작=100 으로 맞춤)
  function lineSvg(lines, opt) {
    opt = opt || {};
    const box = document.querySelector('main'), Wd = Math.max(300, Math.min(760, (box ? box.clientWidth : 360) - 38)), H = opt.h || 190, pl = 52, pr = 8, pt = 10, pb = 22;
    const ls = lines.filter((l) => l && l.pts && l.pts.length > 1);
    if (!ls.length) return '<p class="muted sm">아직 그릴 기록이 없습니다.</p>';
    const from = ls.reduce((m, l) => (l.pts[0][0] > m ? l.pts[0][0] : m), ls[0].pts[0][0]); // 모든 줄이 있는 날부터
    const norm = ls.map((l) => { const p = l.pts.filter((x) => x[0] >= from); const b = p.length ? p[0][1] : 1; return { ...l, p: p.map(([d, v]) => [Date.parse(d), v / b * 100]) }; }).filter((l) => l.p.length > 1);
    if (!norm.length) return '';
    const xs = norm.flatMap((l) => l.p.map((x) => x[0])), ys = norm.flatMap((l) => l.p.map((x) => x[1]));
    const x0 = Math.min(...xs), x1 = Math.max(...xs); let y0 = Math.min(...ys), y1 = Math.max(...ys); const padY = (y1 - y0) * 0.06 || 1; y0 -= padY; y1 += padY;
    const log = opt.log && y0 > 0 && y1 / y0 > 4;
    const fy = (v) => log ? (Math.log(v) - Math.log(y0)) / (Math.log(y1) - Math.log(y0)) : (v - y0) / (y1 - y0);
    const X = (t) => pl + (t - x0) / Math.max(1, x1 - x0) * (Wd - pl - pr), Y = (v) => pt + (1 - fy(v)) * (H - pt - pb);
    // 눈금: 시작=0% 기준 수익률로 표시, 보기 좋은 값만
    let ticks;
    if (log) ticks = [10, 25, 50, 100, 150, 200, 300, 500, 1000, 2000, 5000, 10000].filter((v) => v >= y0 && v <= y1);
    else { const raw = (y1 - y0) / 4, mag = Math.pow(10, Math.floor(Math.log10(raw))), st = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) || raw; ticks = []; for (let v = Math.ceil(y0 / st) * st; v <= y1; v += st) ticks.push(v); }
    if (ticks.length < 2) ticks = [y0, y1];
    { const keep = []; ticks.forEach((v) => { if (!keep.length || Math.abs(Y(keep[keep.length - 1]) - Y(v)) >= 22) keep.push(v); }); ticks = keep; }
    const yrs = []; const ya = new Date(x0).getUTCFullYear(), yb = new Date(x1).getUTCFullYear(); const span = yb - ya;
    for (let y = ya + 1; y <= yb; y++) if (!span || span <= 6 || (y - ya) % 2 === 0) yrs.push(Date.UTC(y, 0, 1));
    const months = span < 1 ? [] : null;
    void months;
    const base = Y(100);
    return `<svg class="eq-svg" viewBox="0 0 ${Wd} ${H}" width="${Wd}" height="${H}" role="img" aria-label="${esc(opt.label || '자산 곡선')}">
      ${ticks.map((v) => `<line x1="${pl}" x2="${Wd - pr}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="eq-grid"/><text x="${pl - 6}" y="${(Y(v) + 3.5).toFixed(1)}" class="eq-ax" text-anchor="end">${(v >= 100 ? '+' : '') + Math.round(v - 100)}%</text>`).join('')}
      ${base > pt && base < H - pb ? `<line x1="${pl}" x2="${Wd - pr}" y1="${base.toFixed(1)}" y2="${base.toFixed(1)}" class="eq-base"/>` : ''}
      ${yrs.map((t) => `<text x="${X(t).toFixed(1)}" y="${H - 6}" class="eq-ax" text-anchor="middle">${String(new Date(t).getUTCFullYear()).slice(2)}년</text>`).join('')}
      ${norm.map((l) => `<polyline class="eq-line ${l.cls || ''}" points="${l.p.map(([t, v]) => X(t).toFixed(1) + ',' + Y(v).toFixed(1)).join(' ')}"/>`).join('')}
    </svg>
    <div class="legend xs">${norm.map((l) => `<span><i class="eq-key ${l.cls || ''}"></i>${esc(l.name)} <b class="num ${dirClass(l.p[l.p.length - 1][1] - 100)}">${pct(l.p[l.p.length - 1][1] - 100, 0)}</b></span>`).join('')}</div>`;
  }
  // 전문가용 내용은 접어 두기 (처음 보는 사람은 핵심만, 전문가는 펼쳐서)
  function proFold(title, inner) {
    const body = String(inner || '').replace(/^\s*<section class="card[^"]*">/, '').replace(/<\/section>\s*$/, '');
    return `<details class="card pro"><summary><span class="b">${title}</span><span class="pro-tag">전문가용 · 펼치기</span></summary><div class="pro-body">${body}</div></details>`;
  }
  const kDate = (d) => { const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? Number(m[2]) + '월 ' + Number(m[3]) + '일' : String(d || ''); };
  const BENCH_NAME = { spx: 'S&P500(원화)', kospi: '코스피', btc: '비트코인(원화)' };
  function metricGrid(m, opt) {
    if (!m) return '<p class="muted sm">기록이 쌓이면 성적표가 나옵니다.</p>';
    const cell = (k, v, cls, tip) => `<div class="mg"><p class="muted xs">${k}</p><p class="num b ${cls || ''}">${v}</p>${tip ? `<p class="muted xs">${tip}</p>` : ''}</div>`;
    const cells = [
      cell('1년 평균 수익', pct(m.cagr), dirClass(m.cagr), m.years + '년 평균 (CAGR)'),
      cell('가장 크게 떨어진 폭', pct(m.mdd), m.mdd < -25 ? 'warn' : '', '회복까지 최장 ' + m.longestDD + '일')
    ];
    const pro = [
      cell('샤프 지수', m.sharpe == null ? '—' : m.sharpe, '', '흔들림 대비 수익 · 1 넘으면 좋음'),
      cell('소르티노', m.sortino == null ? '—' : m.sortino, '', '하락만 따진 샤프'),
      cell('칼마', m.calmar == null ? '—' : m.calmar, '', '수익 ÷ 최대 낙폭'),
      cell('변동성(연)', m.vol + '%', '', '1년에 흔들리는 정도')
    ];
    if (!(opt && opt.noTrades) && m.trades) cells.push(
      cell('거래 수', m.trades + '번', '', '평균 ' + m.avgDays + '일 보유'),
      cell('승률', m.winRate + '%', '', '평균 ' + pct(m.avgWin) + ' / ' + pct(m.avgLoss)),
      cell('손익비(PF)', m.pf == null ? '—' : m.pf, m.pf >= 1.3 ? 'up' : m.pf < 1 ? 'down' : '', '총이익 ÷ 총손실'),
      cell('기대값', m.expR == null ? '—' : (m.expR > 0 ? '+' : '') + m.expR + 'R', '', '한 번에 건 위험 대비'));
    return `<div class="mgrid">${cells.join('')}</div><details class="pro-inline"><summary>전문가 지표 더 보기</summary><div class="mgrid">${pro.join('')}</div></details>`;
  }
  function heatMonths(monthly) {
    const ys = Array.from(new Set(Object.keys(monthly || {}).map((k) => k.slice(0, 4)))).sort().reverse().slice(0, 10);
    if (!ys.length) return '';
    const cell = (v) => { if (v == null) return '<td></td>'; const a = Math.min(60, Math.abs(v) * 6 + 8); return `<td style="background:color-mix(in srgb, var(${v >= 0 ? '--up' : '--down'}) ${a}%, transparent)">${v.toFixed(1)}</td>`; };
    return `<div class="hm-wrap"><table class="hm num"><thead><tr><th></th>${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => `<th>${m}</th>`).join('')}</tr></thead><tbody>
      ${ys.map((y) => `<tr><th>${y.slice(2)}</th>${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => cell(monthly[y + '-' + String(m).padStart(2, '0')])).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function yearBars(yearly, bench) {
    const ys = Object.keys(yearly || {}).sort(); if (!ys.length) return '';
    const mx = Math.max(10, ...ys.map((y) => Math.abs(yearly[y])), ...ys.map((y) => Math.abs((bench || {})[y] || 0)));
    return `<div class="yb">${ys.map((y) => { const v = yearly[y], b = bench && bench[y]; return `<div class="yb-row"><span class="xs muted">${y}</span>
      <div class="ptrack"><span class="${v >= 0 ? 'pos' : 'neg'}" style="width:${(Math.abs(v) / mx * 50).toFixed(1)}%"></span></div>
      <span class="num xs ${dirClass(v)}">${pct(v, 0)}</span><span class="num xs muted">${b == null ? '' : pct(b, 0)}</span></div>`; }).join('')}
      <p class="muted xs">오른쪽 회색 숫자는 같은 해 비교 지수</p></div>`;
  }
  function tradeList(list, limit) {
    if (!list || !list.length) return '<p class="muted sm">아직 끝난 거래가 없습니다.</p>';
    return list.slice(0, limit || 12).map((x) => `<div class="tl"><div class="row between"><p class="b sm">${esc(x.name)} <span class="muted xs">${esc(x.in.slice(2))} → ${esc(x.out.slice(2))} · ${x.days}일</span></p>
      <p class="num sm ${dirClass(x.pct)}">${pct(x.pct)}${x.R != null ? ' · ' + rr(x.R) : ''}</p></div>
      <p class="muted xs">산 이유: ${esc(x.why || '—')}<br>판 이유: ${esc(x.exitWhy || '—')}</p></div>`).join('');
  }
  function botTile(b, sel) {
    const st = b.retired ? ['퇴출·관찰', 'neg'] : b.live ? BOT_STATUS[b.live.status] || BOT_STATUS.ok : ['대기', 'neu'], m = b.bt && b.bt.full;
    return `<button class="bot ${sel ? 'on' : ''} ${b.retired ? 'retired' : ''}" data-act="paper-bot" data-v="${b.id}" aria-pressed="${sel}">
      <span class="row between"><span class="bot-code">${esc(b.code)}</span><span class="act ${st[1]}">${st[0]}</span></span>
      <span class="b sm">${esc(b.name)}</span>
      <span class="num sm ${dirClass(b.live && b.live.ret)}">모의 ${b.live ? pct(b.live.ret, 2) : '—'}</span>
      <span class="muted xs num">10년 연 ${m ? pct(m.cagr) : '—'}</span>
      <span class="muted xs">보유 ${b.live ? b.live.positions.length : 0} · 대기 주문 ${b.live ? b.live.orders.length : 0}</span></button>`;
  }
  function viewPaper() {
    const P = paperData();
    const head = `<header class="top"><div><p class="kicker">가상 1억 원씩 · 24시간 자동 · 실제 돈 아님</p><h1>투자봇</h1></div><div class="tools"><a class="icon-btn" href="#hq" title="본부" aria-label="본부 보기">${SV('<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>')}</a></div></header>`;
    if (!P) { loadRemotePaper(); return head + `<section class="card empty"><p class="h-md">아직 봇 결과가 없어요</p><p class="muted sm">GitHub 자동 실행(평일 오후 4시 10분·오전 7시 30분)이 한 번 돌면 이 화면이 채워집니다. 바로 보려면 GitHub → Actions → "매일 자동 분석·알림" → Run workflow.</p></section>`; }
    const sel = S.ui.paperBot || 'team', tab = S.ui.paperTab || 'live';
    const all = P.bots.filter((b) => !b.empty), bots = all.filter((b) => !b.retired), retired = all.filter((b) => b.retired);
    const tLive = P.team.live && P.team.live.metrics, tBt = P.team.bt.full;
    const totalStart = P.startCash * bots.length, totalNow = bots.reduce((t, b) => t + (b.live ? b.live.equity : P.startCash), 0);
    const summary = `<section class="card panel">
      <div class="row between"><p class="kicker">봇 ${bots.length}개 합산 · 가상 계좌</p><p class="kicker num">${kDate(P.asOf)} 기준</p></div>
      <p class="nav num">${won(totalNow)}</p>
      <p class="hero-sub ${dirClass(totalNow - totalStart)}">${totalNow >= totalStart ? '+' : ''}${won(totalNow - totalStart)} (${pct((totalNow / totalStart - 1) * 100, 2)})</p><p class="muted xs">${kDate(P.inception)}부터 모의 매매 중 · 실제 돈이 아닌 가상 1억씩</p>
      <div class="kv"><span>10년 검증 · 팀</span><b class="num ${dirClass(tBt && tBt.cagr)}">${tBt ? pct(tBt.cagr) + '/년' : '—'} <span class="muted xs">낙폭 ${tBt ? pct(tBt.mdd, 0) : '—'}</span></b></div>
      <div class="kv"><span>S&P500만 샀다면</span><b class="num">${P.bench.spx ? pct(P.bench.spx.metrics.cagr) + '/년' : '—'} <span class="muted xs">낙폭 ${P.bench.spx ? pct(P.bench.spx.metrics.mdd, 0) : '—'}</span></b></div>
      <div class="kv"><span>코스피만 샀다면</span><b class="num">${P.bench.kospi ? pct(P.bench.kospi.metrics.cagr) + '/년' : '—'} <span class="muted xs">낙폭 ${P.bench.kospi ? pct(P.bench.kospi.metrics.mdd, 0) : '—'}</span></b></div>
      </section>`;
    const today = (P.today || []).filter((e) => e.side !== 'vault' || true).slice(-8).reverse();
    const feed = today.length ? `<section class="card"><h2>최근 체결 · 금고 기록</h2>${today.map((e) => `<div class="kv"><span><span class="bot-code sm">${esc(e.botCode || '')}</span> ${e.side === 'vault' ? '금고' : esc(e.name)} <span class="muted xs">${esc(e.d.slice(5))}</span><br><span class="muted xs">${esc(e.reason || '')}</span></span>
      <b class="num ${e.side === 'buy' ? 'up' : e.side === 'sell' ? 'down' : ''}">${e.side === 'buy' ? '매수 ' + man(e.krw) : e.side === 'sell' ? '매도' + (e.pnl != null ? ' ' + (e.pnl >= 0 ? '+' : '') + man(e.pnl) : '') : '알림'}</b></div>`).join('')}</section>` : '';
    const office = `<h2 class="sec">봇 사무실</h2><div class="bots">
      <button class="bot ${sel === 'team' ? 'on' : ''}" data-act="paper-bot" data-v="team" aria-pressed="${sel === 'team'}"><span class="row between"><span class="bot-code">TEAM</span><span class="act neu">합산</span></span><span class="b sm">봇 ${bots.length}개 나눠 담기</span>
        <span class="num sm ${dirClass(totalNow - totalStart)}">모의 ${pct((totalNow / totalStart - 1) * 100, 2)}</span><span class="muted xs num">10년 연 ${tBt ? pct(tBt.cagr) : '—'}</span></button>
      ${all.map((b) => botTile(b, sel === b.id)).join('')}</div>`;
    const detail = sel === 'team' ? paperTeam(P, all) : paperBot(P, all.find((b) => b.id === sel) || bots[0], tab);
    void retired;
    const vault = `<section class="card"><h2>안전 규칙 (모든 봇 공통)</h2><p class="muted xs">봇이 어떤 판단을 해도 이 규칙은 넘을 수 없어요.</p>
      <div class="kv"><span>한 종목 최대 비중</span><b>${P.vault.maxPosPct}%</b></div>
      <div class="kv"><span>한 업종 최대 비중</span><b>${P.vault.maxSectorPct}%</b></div>
      <div class="kv"><span>하루 손실 차단</span><b>${P.vault.dayLossStop}% 넘으면 다음 날 신규 진입 금지</b></div>
      <div class="kv"><span>낙폭 정지</span><b>최고점 대비 ${P.vault.ddPause}% → 신규 진입 정지</b></div>
      <div class="kv"><span>재개</span><b>${P.vault.ddResume}% 회복 또는 ${P.vault.pauseDays}거래일 뒤 절반 크기</b></div>
      <div class="kv"><span>비상 브레이크</span><b>최고점 대비 ${P.vault.ddCut}% → 모든 보유 절반</b></div>
      <div class="kv"><span>연속 손실</span><b>${P.vault.streakHalve}번 연속 → 진입 크기 절반</b></div>
      <div class="kv"><span>시장 필터</span><b>지수가 200일선 아래면 그 시장 신규 매수 안 함</b></div>
      <p class="muted xs">비용: 국내 수수료 0.015%+매도세 0.20%, 미국 수수료·환전 각 0.1%, 코인 0.1%, 슬리피지 0.05~0.1%. 신호는 종가, 체결은 다음 거래일 시가.</p></section>`;
    const cav = `<section class="card note"><p class="b">솔직한 한계</p>${(P.caveats || []).map((c) => `<p class="muted xs">· ${esc(c)}</p>`).join('')}
      <p class="muted xs">· 실제 돈으로 넘어가는 건 아래 "실전 전환 조건"을 모두 통과한 봇만, 아주 작은 금액부터.</p></section>`;
    return head.replace('<h1>투자봇</h1>', '<h1>자동매매</h1>') + '<h2 class="sec">코인 선물 AI 자동매매</h2>' + mkEntry() + futuresEntry() + scalpEntry() + '<h2 class="sec">주식 봇 (모의)</h2>' + summary + filingsCard() + feed + office + detail + vault + cav;
  }
  function paperTeam(P, bots) {
    const T = P.team;
    const board = `<div class="lb"><div class="lb-r th"><span>봇</span><span class="right">10년/년</span><span class="right">낙폭</span><span class="right">샤프</span><span class="right">표본 밖</span><span class="right">모의</span></div>
      ${bots.map((b) => { const f = b.bt.full || {}, o = b.bt.oos || {}; return `<button class="lb-r" data-act="paper-bot" data-v="${b.id}"><span><span class="bot-code sm">${esc(b.code)}</span> <span class="xs">${esc(b.name)}${b.retired ? ' · 퇴출' : ''}</span></span>
        <span class="right num ${dirClass(f.cagr)}">${pct(f.cagr)}</span><span class="right num">${pct(f.mdd, 0)}</span><span class="right num">${f.sharpe == null ? '—' : f.sharpe}</span>
        <span class="right num ${dirClass(o.cagr)}">${pct(o.cagr)}</span><span class="right num ${dirClass(b.live && b.live.ret)}">${b.live ? pct(b.live.ret, 1) : '—'}</span></button>`; }).join('')}</div>`;
    return `<section class="card"><h2>10년 검증 · 팀 vs 시장</h2>
        ${lineSvg([{ name: '팀(퇴출 봇 제외, 균등)', pts: T.bt.curve, cls: 'l1' }, P.bench.spx && { name: BENCH_NAME.spx, pts: P.bench.spx.curve, cls: 'l2' }, P.bench.kospi && { name: '코스피', pts: P.bench.kospi.curve, cls: 'l3' }], { log: true, label: '팀 자산 곡선' })}
        ${metricGrid(T.bt.full, { noTrades: true })}
        ${T.bt.vs ? `<details class="pro-inline"><summary>시장과 얼마나 같이 움직이나 (전문가용)</summary><p class="muted xs">S&P500 대비 — 베타 ${T.bt.vs.beta} · 상관 ${T.bt.vs.corr} · 연 알파 ${pct(T.bt.vs.alphaYr)}. 베타가 1보다 작으면 시장보다 덜 흔들려요.</p></details>` : ''}
      </section>
      ${proFold('봇 순위표 · 10년 검증', `<section class="card"><div class="lb-scroll">${board}</div>
        <p class="muted xs">"표본 밖"은 규칙을 만들 때 보지 않은 최근 구간의 연 수익률입니다. 여기서도 버는 봇이 진짜에 가깝습니다.</p>
        ${bots.some((b) => b.bt.robust) ? `<p class="muted xs">승자 제외 검사: 10년 동안 가장 많이 오른 종목 ${bots.find((b) => b.bt.robust).bt.robust.dropped}개(${esc((P.robustNames || []).slice(0, 5).join(', '))} 등)를 빼고 다시 돌린 연 수익률 — ${bots.filter((b) => b.bt.robust).map((b) => esc(b.code) + ' ' + pct(b.bt.robust.cagr)).join(' · ')}. 원래 숫자와 차이가 클수록 "지금 와서 아는 승자" 덕을 본 것입니다.</p>` : ''}</section>`)}
      ${S.ui.noStudy ? '' : proFold('앱 점수가 실제로 맞았나 · 10년 검증', studyCard(P))}
      ${T.bt.mc ? mcCard(T.bt.mc, '팀') : ''}
      ${T.live && T.live.curve.length >= 5 ? `<section class="card"><h2>모의 계좌 · 팀</h2>${lineSvg([{ name: '팀 모의', pts: T.live.curve, cls: 'l1' }], { label: '팀 모의 곡선' })}${T.live.curve.length >= 20 ? metricGrid(T.live.metrics, { noTrades: true }) : '<p class="muted xs">20거래일이 지나면 성적표가 나옵니다.</p>'}</section>` : ''}`;
  }
  // 앱 점수 검증: 어떤 점수가 실제로 이후 수익과 이어졌나
  function studyCard(P) {
    const S2 = P.study; if (!S2 || !S2.factors || !S2.factors.length) return '';
    const verdict = (ic) => (ic >= 0.05 ? ['쓸모 큼', 'pos'] : ic >= 0.02 ? ['조금 쓸모', 'neu'] : ic > -0.02 ? ['쓸모없음', 'neu'] : ['거꾸로 작동', 'neg']);
    const A = S2.alert || {};
    return `<section class="card"><h2>앱 점수 검증 · 10년 (${esc(S2.from.slice(0, 4))}~${esc(S2.to.slice(0, 4))})</h2>
      <p class="muted xs">${S2.dates}개 시점마다 모든 종목을 채점하고, 그 뒤 60거래일(약 3개월) 동안 같은 날 평균보다 얼마나 더 올랐는지 비교했습니다 — 총 ${nf(S2.obs)}건.</p>
      <div class="lb-scroll"><div class="lb"><div class="lb-r th st-r"><span>점수 항목</span><span class="right">IC</span><span class="right">적중</span><span class="right">상위</span><span class="right">하위</span><span class="right">판정</span></div>
      ${S2.factors.map((f) => { const v = verdict(f.ic60); return `<div class="lb-r st-r"><span class="xs">${esc(f.name)}</span><span class="right num">${f.ic60.toFixed(3)}</span><span class="right num">${f.hit}%</span>
        <span class="right num ${dirClass(f.q[4])}">${pct(f.q[4])}</span><span class="right num ${dirClass(f.q[0])}">${pct(f.q[0])}</span><span class="right"><span class="act ${v[1]}">${v[0]}</span></span></div>`; }).join('')}</div></div>
      <p class="muted xs">IC = 점수 순위와 이후 수익 순위의 상관. 0.05 넘으면 월가에서도 쓸 만한 신호, 0 근처면 동전 던지기. 적중 = 시점별로 IC가 플러스였던 비율. 상위·하위 = 점수 상위 20%·하위 20% 종목의 3개월 초과수익.</p>
      <div class="kv"><span>지금 알림 조건 (70점 이상 + 분할 매수 검토)<br><span class="muted xs">${nf(A.n || 0)}번 해당 · 3개월 뒤 평균보다 높았던 비율 ${A.win60 == null ? '—' : A.win60 + '%'}</span></span>
        <b class="num ${dirClass(A.x60)}">${pct(A.x60, 2)}<br><span class="muted xs">나머지 ${pct(A.restX60, 2)}</span></b></div>
      <p class="muted xs">${esc(S2.note || '')}</p></section>`;
  }
  function mcCard(mc, who) {
    return `<section class="card"><h2>앞으로 1년, 어느 정도 범위일까</h2><p class="muted xs">과거 수익을 500번 섞어 계산한 예상 범위예요 (몬테카를로).</p>
      <div class="grid3">${mini('나쁜 해 (하위 5%)', pct(mc.ret5, 0), '최대 낙폭 ' + pct(mc.mdd5, 0))}${mini('보통 해 (중간)', pct(mc.ret50, 0), '보통 낙폭 ' + pct(mc.mdd50, 0))}${mini('좋은 해 (상위 5%)', pct(mc.ret95, 0), '1년 손실 확률 ' + mc.lossProb + '%')}</div>
      <p class="muted xs">${esc(who)}에게 "나쁜 해"가 와도 버틸 수 있는 금액만 실전에 넣는 게 원칙입니다.</p></section>`;
  }
  function paperBot(P, b, tab) {
    if (!b) return '';
    const segs = [['live', '모의 계좌'], ['bt', '10년 검증'], ['rule', '규칙·실전 조건']];
    const seg = `<div class="seg" role="tablist">${segs.map(([k, l]) => `<button role="tab" class="${tab === k ? 'on' : ''}" aria-selected="${tab === k}" data-act="paper-tab" data-v="${k}">${l}</button>`).join('')}</div>`;
    const head = `<section class="card"><div class="row between"><div><p class="kicker">${esc(b.code)} · ${esc(b.name)}</p><p class="b">${esc(b.role)}</p></div>${b.live ? `<span class="act ${(BOT_STATUS[b.live.status] || BOT_STATUS.ok)[1]}">${(BOT_STATUS[b.live.status] || BOT_STATUS.ok)[0]}</span>` : ''}</div></section>`;
    let body = b.retired ? `<section class="card note"><p class="b">퇴출된 봇 — 팀 계좌에서 제외</p><p class="muted xs">${esc(b.retired)}</p></section>` : '';
    if (tab === 'live') {
      const L = b.live;
      if (!L) body += '<section class="card"><p class="muted">모의 계좌가 아직 없습니다.</p></section>';
      else body += `<section class="card panel">
          <div class="row between"><p class="kicker">모의 계좌 · ${esc(L.lastDate || '')}</p><p class="kicker num">현금 ${man(L.cash)}</p></div>
          <p class="nav num">${won(L.equity)}</p><p class="num sm ${dirClass(L.ret)}">${pct(L.ret, 2)} <span class="muted">· 시작 ${man(L.start)} · ${L.days}일째</span></p>
          ${L.curve.length >= 5 ? lineSvg([{ name: b.code + ' 모의', pts: L.curve, cls: 'l1' }], { h: 150 }) : ''}
          ${L.days >= 20 && L.metrics ? metricGrid(L.metrics) : '<p class="muted xs">기록 ' + L.days + '일째 — 20거래일이 지나면 연 수익률·낙폭·승률 성적표가 나옵니다(너무 짧은 기록을 1년으로 늘려 계산하면 숫자가 과장됨).</p>'}
        </section>
        <section class="card"><h2>보유 ${L.positions.length}종목</h2>
          ${L.positions.length ? L.positions.map((p) => `<div class="tl"><div class="row between"><p class="b sm">${esc(p.name)} <span class="muted xs">${p.units > 1 ? p.units + '번 나눠 삼 · ' : ''}${esc(p.since.slice(2))}부터</span></p><p class="num sm ${dirClass(p.pct)}">${pct(p.pct)}${p.R != null ? ' · ' + rr(p.R) : ''}</p></div>
            <p class="muted xs num">비중 ${p.w}% · 평균 ${pxOf(p.avg, p.cur)} → 지금 ${pxOf(p.price, p.cur)}${p.stop ? ' · 손절 ' + pxOf(p.stop, p.cur) : ''}</p>
            <p class="muted xs">${esc(p.why || '')}${p.stopWhy ? ' · 손절 기준: ' + esc(p.stopWhy) : ''}</p></div>`).join('') : '<p class="muted sm">지금은 현금으로 기다리는 중입니다. 조건이 맞는 종목이 나오면 다음 거래일 시가에 삽니다.</p>'}
        </section>
        <section class="card"><h2>다음 거래일에 할 일 ${L.orders.length}건</h2>
          ${L.orders.length ? L.orders.slice(0, 20).map((o) => `<div class="kv"><span>${esc(o.name)}<br><span class="muted xs">${esc(o.why || '')}</span></span><b class="${o.side === 'buy' ? 'up' : 'down'} xs">${esc(o.kind)}</b></div>`).join('') : '<p class="muted sm">대기 중인 주문이 없습니다.</p>'}
        </section>
        <section class="card"><h2>끝난 거래</h2>${tradeList(L.trades, 15)}</section>`;
    } else if (tab === 'bt') {
      const B = b.bt, bn = P.bench[b.bench];
      const benchYear = bn && bn.metrics ? bn.metrics.yearly : null;
      const row = (k, m) => `<div class="lb-r"><span class="xs">${k}</span><span class="right num ${dirClass(m && m.cagr)}">${m ? pct(m.cagr) : '—'}</span><span class="right num">${m ? pct(m.mdd, 0) : '—'}</span><span class="right num">${m && m.sharpe != null ? m.sharpe : '—'}</span><span class="right num">${m && m.winRate != null ? m.winRate + '%' : '—'}</span><span class="right num">${m && m.pf != null ? m.pf : '—'}</span></div>`;
      body += `<section class="card"><h2>10년 자산 곡선 vs ${esc(BENCH_NAME[b.bench] || '')}</h2>
          ${lineSvg([{ name: b.code, pts: B.curve, cls: 'l1' }, bn && { name: BENCH_NAME[b.bench], pts: bn.curve, cls: 'l2' }], { log: true, label: b.code + ' 10년 곡선' })}
          ${metricGrid(B.full)}
          ${B.vs ? `<p class="muted xs">${esc(BENCH_NAME[b.bench])} 대비 — 베타 ${B.vs.beta} · 상관 ${B.vs.corr} · 연 알파 ${pct(B.vs.alphaYr)}</p>` : ''}</section>
        <section class="card"><h2>표본 안 vs 표본 밖 (과최적화 점검)</h2>
          <div class="lb"><div class="lb-r th"><span>구간</span><span class="right">연수익</span><span class="right">낙폭</span><span class="right">샤프</span><span class="right">승률</span><span class="right">PF</span></div>
          ${row('앞 70% (' + (B.is ? B.is.from.slice(0, 4) + '~' + B.is.to.slice(2, 4) : '') + ')', B.is)}${row('뒤 30% (' + (B.oos ? B.oos.from.slice(0, 4) + '~' + B.oos.to.slice(2, 4) : '') + ')', B.oos)}${row('전체', B.full)}
          ${B.robust ? row('승자 ' + B.robust.dropped + '개 제외', B.robust) : ''}</div>
          <p class="muted xs">뒤 30%에서 성적이 크게 무너지면 과거에만 맞춘 규칙일 가능성이 큽니다.${B.robust ? ' "승자 제외"는 10년 동안 가장 많이 오른 종목들(지금 와서야 아는 승자)을 빼고 돌린 결과 — 이 줄이 실제 기대치에 더 가깝습니다.' : ''}</p></section>
        ${B.mc ? mcCard(B.mc, b.code) : ''}
        <section class="card"><h2>연도별 수익</h2>${yearBars(B.full && B.full.yearly, benchYear)}</section>
        <section class="card"><h2>월별 수익 (%)</h2>${heatMonths(B.full && B.full.monthly)}</section>
        <section class="card"><h2>최근 백테스트 거래</h2>${tradeList(B.recent, 10)}
          ${B.full && B.full.best ? `<p class="muted xs">최고 거래: ${esc(B.full.best.name)} ${pct(B.full.best.pct)} · 최악 거래: ${esc(B.full.worst.name)} ${pct(B.full.worst.pct)}</p>` : ''}</section>`;
    } else {
      const rd = b.ready;
      body += `<section class="card"><h2>어떻게 사고파나</h2><p class="sm">${esc(b.method)}</p><p class="muted xs">왜 통하나: ${esc(b.edge)}</p></section>${b.id === 'chief' ? studyCard(P) : ''}
        <section class="card"><h2>실전 전환 조건 ${rd.passed}/${rd.total}</h2>
          <ul class="scr-list">${rd.items.map((x) => `<li class="${x.ok ? 'ok' : 'no'}"><span aria-hidden="true">${x.ok ? '✓' : '·'}</span>${esc(x.label)} <span class="muted xs num">${esc(String(x.val))}</span></li>`).join('')}</ul>
          <p class="muted xs">${rd.ready ? '모든 조건 통과 — 아주 작은 금액(전체 자산의 1~2%)으로 실전 검증을 시작해도 됩니다.' : '아직 실전 전환 전입니다. 모의 기록이 더 쌓여야 합니다.'}</p></section>`;
    }
    return head + seg + body;
  }


  /* ---------- TradingView 차트 (무료 위젯, 키 필요 없음) ----------
   * 화면 다시 그리기(render)에 지워지지 않도록 앱 바깥에 전체 화면으로 띄움 */
  const TV_MACRO = { us10y: 'TVC:US10Y', dxy: 'TVC:DXY', brent: 'TVC:UKOIL', gold: 'TVC:GOLD', silver: 'TVC:SILVER', vix: 'TVC:VIX', usdkrw: 'FX_IDC:USDKRW',
    spx: 'SP:SPX', nasdaq: 'NASDAQ:IXIC', kospi: 'KRX:KOSPI', kosdaq: 'KRX:KOSDAQ', usdjpy: 'FX_IDC:USDJPY', usdcny: 'FX_IDC:USDCNY', eurusd: 'FX:EURUSD', krwjpy: 'FX_IDC:JPYKRW', krwcny: 'FX_IDC:CNYKRW', krweur: 'FX_IDC:EURKRW' };
  function tvSymbol(kind, id) {
    const x = String(id || '');
    if (kind === 'coin') return 'UPBIT:' + x.replace(/^KRW-/, '') + 'KRW';
    if (kind === 'perp') return 'BINANCE:' + x + 'USDT.P';
    if (kind === 'macro') return TV_MACRO[x] || null;
    const k = x.toUpperCase().replace(/^A(?=\d{6})/, '');
    const kr = k.match(/^(\d{6})/); if (kr) return 'KRX:' + kr[1];
    return k.replace(/[-.](KS|KQ)$/, '').replace(/-/g, '.');
  }
  function tvButton(kind, id, name, iv) {
    const sym = tvSymbol(kind, id); if (!sym) return '';
    return `<button type="button" class="tv-btn" data-act="tv" data-v="${esc(sym)}" data-name="${esc(name || id)}" data-iv="${esc(iv || 'D')}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>TradingView 차트</button>`;
  }
  function openTV(sym, name, iv) {
    closeTV();
    const dark = document.documentElement.dataset.theme === 'dark';
    const wrap = document.createElement('div');
    wrap.className = 'tv-overlay'; wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-label', (name || sym) + ' 차트');
    wrap.innerHTML = `<div class="tv-head"><div><p class="b">${esc(name || sym)}</p><p class="muted xs">${esc(sym)} · TradingView</p></div><button type="button" class="tv-close" aria-label="닫기">✕</button></div><div class="tv-body"><div class="tradingview-widget-container" style="height:100%;width:100%"><div class="tradingview-widget-container__widget" style="height:100%;width:100%"></div></div></div>`;
    document.body.appendChild(wrap); document.body.classList.add('tv-open');
    wrap.querySelector('.tv-close').addEventListener('click', closeTV);
    const sc = document.createElement('script');
    sc.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'; sc.async = true;
    sc.textContent = JSON.stringify({ autosize: true, symbol: sym, interval: iv || 'D', timezone: 'Asia/Seoul', theme: dark ? 'dark' : 'light', style: '1', locale: 'kr',
      backgroundColor: dark ? '#101013' : '#FFFFFF', hide_side_toolbar: window.innerWidth < 700, allow_symbol_change: true, withdateranges: true, details: false, calendar: false,
      studies: ['MAExp@tv-basicstudies', 'RSI@tv-basicstudies'], support_host: 'https://www.tradingview.com' });
    sc.onerror = () => { const b = wrap.querySelector('.tv-body'); if (b) b.innerHTML = '<p class="muted sm pad">TradingView 차트를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.</p>'; };
    wrap.querySelector('.tradingview-widget-container').appendChild(sc);
    history.pushState({ tv: 1 }, '');
  }
  function closeTV() {
    const w = document.querySelector('.tv-overlay'); if (!w) return;
    w.remove(); document.body.classList.remove('tv-open');
    if (history.state && history.state.tv) history.back();
  }
  window.addEventListener('popstate', () => { const w = document.querySelector('.tv-overlay'); if (w) { w.remove(); document.body.classList.remove('tv-open'); } });

  /* ---------- 화면: 선물 데스크 (FLUX · 코인 무기한 선물 모의투자) ---------- */
  function futRepo() {
    const h = location.hostname || '';
    if (/\.github\.io$/.test(h)) return h.split('.')[0] + '/' + (location.pathname.split('/')[1] || '');
    return (REAL && REAL.repo) || 'rudrl09202-bit/sijangnalssi';
  }
  function loadFutures(force) {
    if (S.futLoading || (S.fut && !force && Date.now() - S.futAt < 5 * 60e3)) return;
    S.futLoading = true;
    const done = (j) => { S.futLoading = false; if (j && j.live) { S.fut = j; S.futAt = Date.now(); if (['futures', 'paper', 'hq', 'home', 'bot', 'analysis'].indexOf(route()) >= 0) render(); } };
    const raw = 'https://raw.githubusercontent.com/' + futRepo() + '/main/data/futures-live.json?t=' + Math.floor(Date.now() / 60e3);
    fetch(raw, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject())).catch(() => fetch('data/futures-live.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null))).then(done).catch(() => done(null));
  }
  const SIDE = { long: ['롱', 'up'], short: ['숏', 'down'] };
  const futT = (u) => { const t = Date.parse(String(u).replace(' ', 'T') + ':00Z') + 4 * 3600e3; if (!isFinite(t)) return String(u); const d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const FUT_ST = { ok: ['정상 운용', 'neu'], half: ['위험 절반', 'warn'], dayblock: ['오늘 진입 금지', 'warn'], killed: ['킬 스위치 휴식', 'neg'] };
  const usd = (v) => v == null ? '—' : '$' + (v >= 1000 ? nf(Math.round(v)) : v >= 1 ? v.toFixed(2) : v.toPrecision(4));
  function futTrades(list, limit) {
    if (!list || !list.length) return '<p class="muted sm">아직 끝난 거래가 없습니다.</p>';
    return list.slice(0, limit || 12).map((x) => `<div class="tl"><div class="row between"><p class="b sm"><span class="side ${SIDE[x.side][1]}">${SIDE[x.side][0]}</span> ${esc(x.name)} <span class="muted xs">${esc(x.in.slice(5))} → ${esc(x.out.slice(5))} · ${x.days}일 · ${x.lev}배</span></p>
      <p class="num sm ${dirClass(x.pnl)}">${x.pnl >= 0 ? '+' : ''}${man(x.pnl)} · ${rr(x.R || 0)}</p></div>
      <p class="muted xs">진입 ${usd(x.entry)} → 청산 ${usd(x.exit)} · ${esc(x.reason)}${x.funding ? ' · 펀딩 ' + (x.funding >= 0 ? '+' : '') + man(x.funding) : ''}</p></div>`).join('');
  }
  function viewFutures() {
    loadFutures();
    const D = S.fut;
    const head = `<header class="top"><div><a href="#paper" class="back">‹ 자동매매</a><p class="kicker">FLUX · 코인 무기한 선물 · 가상 1억 · 실제 돈 아님</p><h1>선물 데스크</h1></div>${tools()}</header><a class="lrow-mini" href="#scalp">15분봉 단타 데스크(Claude) 보기 ›</a>`;
    if (!D) return head + `<section class="card empty"><p class="h-md">선물 봇 결과를 불러오는 중이에요</p><p class="muted sm">4시간마다 자동으로 돌아요. 처음이라면 GitHub → Actions → "코인 선물 모의투자" → Run workflow 를 한 번 눌러 주세요.</p></section>`;
    const L = D.live, B = D.bt, m = B.metrics || {}, st = FUT_ST[L.status] || FUT_ST.ok;
    const thisM = new Date().toISOString().slice(0, 7), mNow = L.months && L.months.monthly ? L.months.monthly[thisM] : null;
    const prog = Math.max(0, Math.min(100, (mNow || 0) / D.goal * 100));
    const hero = `<section class="card panel">
      <div class="row between"><p class="kicker">가상 계좌 · ${futT(D.lastBar)} 마감 봉까지</p><span class="act ${st[1]}">${st[0]}</span></div>
      <p class="nav num">${won(L.equity)}</p>
      <p class="hero-sub ${dirClass(L.ret)}">${L.ret >= 0 ? '+' : ''}${won(L.equity - L.start)} (${pct(L.ret, 2)})</p>
      <p class="muted xs">${futT(D.inception)}부터 · 4시간마다 자동 판단 · 지금 레버리지 ${L.lev}배</p>
      <div class="goal"><div class="row between"><span class="sm">이번 달 ${mNow == null ? '—' : pct(mNow, 1)}</span><span class="muted xs">목표 월 ${D.goal}%</span></div><div class="goal-bar"><i style="width:${prog.toFixed(0)}%"></i></div></div>
    </section>`;
    // 월 10% 현실 점검
    const cur = D.cfg.riskPct;
    const reality = `<section class="card"><h2>월 ${D.goal}% 목표, 데이터로 본 현실</h2>
      <p class="sm">지난 ${B.months.months}개월 동안 이 봇(한 번에 계좌의 ${cur}% 위험)은 <b>한 달 평균 ${pct(B.months.avg, 1)}</b>, 월 ${D.goal}% 이상 낸 달은 <b>${B.months.hit}%</b>, 손실 난 달은 ${B.months.neg}%였어요. 가장 나빴던 달은 ${pct(B.months.worst, 1)}.</p>
      <p class="muted xs" style="margin-top:6px">위험(한 번에 잃어도 되는 비율)을 키우면 평균 수익은 오르지만 낙폭도 같이 커져요. 아래 표에서 '견딜 수 있는 낙폭'을 먼저 고르세요.</p>
      <div class="ftbl-wrap"><table class="ftbl num"><thead><tr><th>위험/회</th><th>월평균</th><th>월${D.goal}%↑</th><th>최악의 달</th><th>최대 낙폭</th><th>강제청산</th></tr></thead><tbody>
      ${(D.ladder || []).map((x) => `<tr class="${x.risk === cur ? 'on' : ''}"><td>${x.risk}%${x.risk === cur ? ' ✓' : ''}</td><td class="${dirClass(x.avgMonth)}">${pct(x.avgMonth, 1)}</td><td>${x.hit == null ? '—' : x.hit + '%'}</td><td class="${dirClass(x.worstMonth)}">${pct(x.worstMonth, 1)}</td><td>${pct(x.mdd, 0)}</td><td>${x.liq}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="muted xs" style="margin-top:6px">✓ = 지금 봇 설정. 과거 1~2년 데이터라 운 좋은 구간이 섞여 있을 수 있어요. 아래 10년 일봉 검증도 같이 보세요.</p></section>`;
    const posCardOf = (L) => `<section class="card"><h2>지금 포지션 ${L.positions.length}개 <span class="muted xs">· 최대 ${D.cfg.maxPos}개</span></h2>
      ${L.positions.length ? L.positions.map((p) => `<div class="fpos">
        <div class="row between"><p class="b"><span class="side ${SIDE[p.side][1]}">${SIDE[p.side][0]}</span> ${esc(p.name)} <span class="muted xs">${p.lev}배 · 격리 ${D.cfg.isoLev}배</span></p><p class="num b ${dirClass(p.upnl)}">${p.upnl >= 0 ? '+' : ''}${man(p.upnl)}</p></div>
        <div class="kv"><span>진입→현재</span><b class="num">${usd(p.entry)} → ${usd(p.mark)} <span class="muted xs">증거금 대비 ${pct(p.roe, 1)}</span></b></div>
        <div class="kv"><span>손절가</span><b class="num">${usd(p.stop)} <span class="muted xs">${p.toStop}% 남음 · 손실 한도 ${man(p.risk)}</span></b></div>
        <div class="kv"><span>청산가</span><b class="num">${usd(p.liq)} <span class="muted xs">${p.toLiq}% 남음 (손절이 먼저)</span></b></div>
        <div class="kv"><span>펀딩비 누적</span><b class="num ${dirClass(p.funding)}">${p.funding >= 0 ? '+' : ''}${man(p.funding)}</b></div>
        <p class="muted xs">${esc(p.since)} 진입 · ${esc(p.why)}</p>${tvButton('perp', p.sym, p.name + ' 무기한 선물', '240')}</div>`).join('') : '<p class="muted sm">지금은 들고 있는 포지션이 없어요. 조건이 맞는 돌파가 나오면 다음 4시간봉 시가에 들어가요.</p>'}
      ${L.pending.length ? `<p class="sm" style="margin-top:8px">다음 봉 시가 진입 예정: ${L.pending.map((o) => `<b>${SIDE[o.side][0]} ${esc(o.name)}</b>`).join(', ')}</p>` : ''}</section>`;
    const posCard = posCardOf(L);
    const CN = D.council;
    const RES = { approved: ['만장일치 · 진입', 'live'], rejected: ['보류', 'neu'], nokey: ['키 등록 전', 'neu'] };
    const VT = { yes: ['찬성', 'live'], no: ['반대', 'neu'], none: ['키 없음', 'neu'], error: ['응답 실패', 'warn'] };
    const council = !CN ? '<section class="card"><p class="muted sm">AI 회의 결과가 아직 없어요. 다음 4시간 실행 때 생겨요.</p></section>' : `
      <section class="card"><h2>AI 회의 · 셋 다 찬성할 때만 진입</h2>
        <p class="muted xs">FLUX가 찾은 후보를 Claude·Gemini·GPT가 각자 심사해요. 만장일치면 계좌의 ${CN.risk}%를 걸고, 한 명이라도 반대하면 들어가지 않아요. 금고 규칙(레버리지 ${D.cfg.maxLevTotal}배, 손절, 킬 스위치)은 AI가 바꿀 수 없어요.</p>
        <div class="kv"><span>FLUX (엔진 혼자, ${D.cfg.riskPct}%)</span><b class="num ${dirClass(L.ret)}">${pct(L.ret, 2)} <span class="muted xs">거래 ${(L.metrics && L.metrics.trades) || 0} · 포지션 ${L.positions.length}</span></b></div>
        <div class="kv"><span>AI 회의 (만장일치, ${CN.risk}%)</span><b class="num ${dirClass(CN.ret)}">${pct(CN.ret, 2)} <span class="muted xs">거래 ${(CN.metrics && CN.metrics.trades) || 0} · 포지션 ${CN.positions.length}</span></b></div>
        <div class="kv"><span>심사한 후보</span><b class="num">${CN.asked}건 중 ${CN.approved}건 진입${CN.asked ? ' (' + Math.round(CN.approved / CN.asked * 100) + '%)' : ''}</b></div></section>
      <section class="card"><h2>심사위원</h2><div class="ai-grid">${CN.ai.map((a) => `<div class="ai-card"><p class="b">${esc(a.name)}</p><p class="muted xs">${esc(a.model)}</p>
        <p class="sm" style="margin-top:6px">${a.key ? `찬성 ${a.yes}/${a.votes}${a.errors ? ' · 실패 ' + a.errors : ''}` : '<span class="act warn">키 등록 전</span>'}</p></div>`).join('')}</div>
        ${CN.ai.some((a) => !a.key) ? `<p class="muted xs" style="margin-top:8px">키가 없는 AI가 있으면 만장일치가 될 수 없어서 진입하지 않아요${CN.waiting ? ' (지금까지 ' + CN.waiting + '건이 투표를 기다렸어요)' : ''}. GitHub → Settings → Secrets → Actions 에 ANTHROPIC_API_KEY · GEMINI_API_KEY · OPENAI_API_KEY 를 넣으면 다음 4시간 실행부터 투표해요.</p>` : ''}</section>
      <section class="card"><h2>최근 투표</h2>${CN.votes.length ? CN.votes.slice(0, 12).map((v) => `<div class="vote">
        <div class="row between"><p class="b sm"><span class="side ${SIDE[v.side][1]}">${SIDE[v.side][0]}</span> ${esc(v.name)} <span class="muted xs">${futT(v.t)} 봉 · ${usd(v.price)}</span> <button type="button" class="link-btn xs" data-act="tv" data-v="${esc(tvSymbol('perp', v.sym))}" data-name="${esc(v.name)} 무기한 선물" data-iv="240">차트</button></p><span class="act ${(RES[v.result] || RES.rejected)[1]}">${(RES[v.result] || RES.rejected)[0]}</span></div>
        ${v.result === 'nokey' ? '' : v.votes.map((x) => `<p class="xs vote-line"><b>${esc(x.name)}</b> <span class="act ${(VT[x.vote] || VT.error)[1]}">${(VT[x.vote] || VT.error)[0]}${x.confidence ? ' ' + x.confidence : ''}</span> ${esc(x.reason)}</p>`).join('')}</div>`).join('') : '<p class="muted sm">아직 후보가 없었어요. FLUX가 돌파를 찾으면 여기서 투표가 열려요.</p>'}</section>
      ${posCardOf(CN)}
      <section class="card"><h2>AI 회의 거래</h2>${futTrades(CN.trades, 10)}</section>`;
    const liveCard = `<section class="card"><h2>모의 계좌 흐름</h2>${lineSvg([{ pts: L.curve.map(([t, v]) => [t.replace(' ', 'T') + ':00Z', v]), cls: 'l-bot', label: 'FLUX' }], { h: 170 })}
      <div class="grid3">${mini('끝난 거래', String((L.metrics && L.metrics.trades) || 0) + '번', '승률 ' + (L.metrics && L.metrics.winRate != null ? L.metrics.winRate + '%' : '—'))}${mini('손익비', L.metrics && L.metrics.pf != null ? String(L.metrics.pf) : '—', '1.3 이상이 목표')}${mini('펀딩·수수료', man(-(L.funding + L.fees)), '지금까지 낸 비용')}</div></section>
      <section class="card"><h2>최근 거래</h2>${futTrades(L.trades, 10)}</section>`;
    const d1 = D.d1 && D.d1.metrics;
    const btCard = `<section class="card"><h2>백테스트 · 4시간봉 (${esc(B.from)} ~)</h2>
      <div class="grid3">${mini('연 수익', pct(m.cagr, 0), 'BTC 그냥 보유 ' + pct(B.holdBtc, 0) + '(기간)')}${mini('최대 낙폭', pct(m.mdd, 0), '샤프 ' + (m.sharpe == null ? '—' : m.sharpe))}${mini('손익비', m.pf == null ? '—' : String(m.pf), '승률 ' + (m.winRate == null ? '—' : m.winRate + '%'))}</div>
      <div class="kv"><span>거래</span><b class="num">${m.trades || 0}번 (롱 ${B.longs} · 숏 ${B.shorts})</b></div>
      <div class="kv"><span>표본 밖 (최근 30%, ${esc(B.split)}~)</span><b class="num ${dirClass(B.oos && B.oos.cagr)}">${B.oos ? pct(B.oos.cagr, 0) + '/년 · 낙폭 ' + pct(B.oos.mdd, 0) : '—'}</b></div>
      <div class="kv"><span>낸 비용</span><b class="num">수수료 ${man(B.fees)} · 펀딩 ${man(B.funding)}</b></div>
      <div class="kv"><span>강제 청산 · 킬 스위치</span><b class="num">${B.liq}번 · ${B.kills}번</b></div>
      ${lineSvg([{ pts: B.curve, cls: 'l-bot', label: 'FLUX' }], { h: 170, log: true })}</section>
      <section class="card"><h2>교차 검증 · 같은 규칙을 일봉 10년에</h2>
      ${d1 ? `<div class="grid3">${mini('연 수익', pct(d1.cagr, 0), d1.from + '~')}${mini('최대 낙폭', pct(d1.mdd, 0), '샤프 ' + d1.sharpe)}${mini('월 평균', pct(D.d1.months.avg, 1), '월' + D.goal + '%↑ ' + D.d1.months.hit + '%')}</div>${yearBars(D.d1.yearly)}<p class="muted xs">2018·2022 같은 하락장이 들어 있는 10년이에요. 여기서도 수익이면 규칙이 한 시기에만 맞춘 게 아니라는 근거가 돼요.</p>` : '<p class="muted sm">일봉 데이터를 못 받았어요.</p>'}</section>
      ${B.mc ? mcCard(B.mc, '선물 계좌') : ''}
      <section class="card"><h2>월별 수익 (%)</h2>${heatMonths(m.monthly)}</section>
      <section class="card"><h2>최근 백테스트 거래</h2>${futTrades(B.recent, 8)}</section>`;
    const c = D.cfg, P = D.preset;
    const rules = `<section class="card"><h2>FLUX는 이렇게 매매해요</h2>
      <p class="sm"><b>추세추종</b>: 코인 ${D.coins.map((x) => esc(x.name)).join('·')}을 4시간봉으로 봐요.</p>
      <ul class="scr-list"><li class="ok"><span>·</span>롱: 최근 ${P.brk}봉(약 ${Math.round(P.brk * 4 / 24)}일) 고점을 넘고, ${P.emaF}·${P.emaS} EMA가 위로 정렬</li>
      <li class="ok"><span>·</span>숏: 반대로 저점 이탈 + 역배열, 그리고 <b>BTC가 장기 평균(약 200일) 아래</b>인 하락장일 때만</li>
      <li class="ok"><span>·</span>손절: 진입가에서 ATR ${P.stopAtr}배. 수익이 나면 고점에서 ATR ${P.trailAtr}배 아래로 따라 올라가요(추적 손절)</li>
      <li class="ok"><span>·</span>추세가 꺾이면(EMA 교차) 다음 봉에 정리</li>
      <li class="ok"><span>·</span>크기: 손절에 걸려도 계좌의 <b>${c.riskPct}%만</b> 잃게 계산 → 레버리지는 그 결과로 정해져요</li></ul></section>
      <section class="card"><h2>선물 금고 (어길 수 없는 규칙)</h2>
      <div class="kv"><span>전체 레버리지</span><b>최대 ${c.maxLevTotal}배 · 코인 하나 ${c.maxLevCoin}배</b></div>
      <div class="kv"><span>동시 포지션</span><b>최대 ${c.maxPos}개</b></div>
      <div class="kv"><span>마진</span><b>격리 ${c.isoLev}배 · 손절이 청산가보다 항상 먼저</b></div>
      <div class="kv"><span>하루 손실</span><b>${c.dayLoss}% → 그날 신규 진입 금지</b></div>
      <div class="kv"><span>낙폭</span><b>${c.ddHalve}% → 위험 절반 · ${c.ddKill}% → 전부 정리 후 ${Math.round(P.killBars * 4 / 24)}일 휴식</b></div>
      <div class="kv"><span>비용</span><b>수수료 ${(c.taker * 100).toFixed(2)}% · 미끄러짐 · 펀딩 8시간마다</b></div></section>`;
    const rd = D.ready;
    const ready = `<section class="card"><h2>실전 전환 조건 ${rd.passed}/${rd.total}</h2>
      <ul class="scr-list">${rd.items.map((x) => `<li class="${x.ok ? 'ok' : 'no'}"><span aria-hidden="true">${x.ok ? '✓' : '·'}</span>${esc(x.label)} <span class="muted xs num">${esc(String(x.val))}</span></li>`).join('')}</ul>
      <p class="muted xs">선물은 주식 봇보다 조건이 더 엄격해요(90일·30번·강제청산 0번). 통과해도 처음엔 아주 작은 금액, 레버리지 그대로로 시작해요.</p></section>
      <section class="card note"><p class="b">알아둘 점</p><p class="muted xs">· 시세는 야후의 현물 가격으로 계산해요. 실제 선물 가격과 아주 조금 다를 수 있어요.<br>· 펀딩비는 실제 기록이 아니라 장세에 따라 0.01~0.03%(8시간)로 추정해요.<br>· 4시간 데이터가 약 2년치라 백테스트 기간이 짧아요 → 10년 일봉 검증을 꼭 같이 보세요.<br>· 과거 성적은 미래 수익을 보장하지 않아요. 선물은 원금보다 크게 잃을 수 있는 상품이에요.</p></section>`;
    const tab = S.ui.futTab || 'live';
    const segs = [['live', 'FLUX'], ['council', 'AI 회의'], ['goal', '월 목표'], ['bt', '검증'], ['rule', '규칙']];
    const seg = `<div class="seg" role="tablist">${segs.map(([k, l]) => `<button role="tab" class="${tab === k ? 'on' : ''}" aria-selected="${tab === k}" data-act="fut-tab" data-v="${k}">${l}</button>`).join('')}</div>`;
    const body = tab === 'council' ? council : tab === 'goal' ? reality : tab === 'bt' ? btCard : tab === 'rule' ? rules + ready : posCard + liveCard;
    return head + hero + seg + body;
  }
  function futuresEntry() {
    loadFutures();
    const D = S.fut, L = D && D.live;
    return `<a class="card fut-entry" href="#futures"><div class="row between"><div><p class="kicker">코인 선물 추세추종 · 4시간봉 · 규칙 + AI 3명</p><p class="b">FLUX 롱·숏</p></div>
      <div class="right"><p class="num b ${dirClass(L && L.ret)}">${L ? pct(L.ret, 2) : '—'}</p><p class="muted xs">${L ? '포지션 ' + L.positions.length + ' · ' + L.lev + '배' : '불러오는 중'}</p></div></div></a>`;
  }


  /* ---------- 금리·물가 자동 갱신 (ECOS·FRED → data/policy-live.json) ---------- */
  function loadPolicy() {
    if (S.polLoading || (S.pol && Date.now() - S.polAt < 10 * 60e3)) return;
    S.polLoading = true;
    const raw = 'https://raw.githubusercontent.com/' + futRepo() + '/main/data/policy-live.json?t=' + Math.floor(Date.now() / 60e3);
    fetch(raw, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject())).catch(() => fetch('data/policy-live.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null))).catch(() => null).then((j) => {
      S.polLoading = false;
      if (j && (j.fred || j.ecos)) { S.pol = j; S.polAt = Date.now(); applyPolicy(j); render(); }
    });
  }
  function applyPolicy(P) {
    const f = P.fred || {}, e = P.ecos || {}, today = new Date().toISOString().slice(0, 10);
    const fed = SNAP.rates.find((r) => r.key === 'fed'), bok = SNAP.rates.find((r) => r.key === 'bok');
    if (fed && f.fedUpper) {
      if (fed.upper != null && Math.abs(f.fedUpper.value - fed.upper) > 0.001) { fed.expect = 'hold'; fed.expectText = (f.fedUpper.value > fed.upper ? '인상' : '인하') + ' 결정 반영 (' + f.fedUpper.date.slice(5).replace('-', '/') + ') · 다음 전망은 발표 후 갱신'; }
      fed.upper = f.fedUpper.value; fed.rate = (f.fedLower ? f.fedLower.value.toFixed(2) + '~' : '') + f.fedUpper.value.toFixed(2) + '%'; fed.live = 'FRED ' + f.fedUpper.date;
    }
    if (bok && e.bokRate) {
      if (bok.upper != null && Math.abs(e.bokRate.value - bok.upper) > 0.001) { bok.expect = 'hold'; bok.expectText = (e.bokRate.value > bok.upper ? '인상' : '인하') + ' 결정 반영 (' + e.bokRate.date.slice(5).replace('-', '/') + ')'; }
      if (bok.next && bok.next < today) bok.next = '';
      bok.upper = e.bokRate.value; bok.rate = e.bokRate.value.toFixed(2) + '%'; bok.live = 'ECOS ' + e.bokRate.date;
    }
    // 발표 일정: FRED 실제 일정으로 같은 종류(CPI·고용·FOMC) 교체
    if ((f.events || []).length) {
      const kind = (t) => (/CPI|소비자물가/.test(t) ? 'cpi' : /FOMC/.test(t) ? 'fomc' : /고용/.test(t) ? 'jobs' : null);
      const have = new Set(f.events.filter((x) => kind(x.title) !== 'fomc').map((x) => kind(x.title)));
      const keep = SNAP.events.filter((x) => !have.has(kind(x.title)));
      const add = f.events.filter((x) => x.date >= today && kind(x.title) !== 'fomc').map((x) => ({ date: x.date, title: x.title, when: x.date.slice(5).replace('-', '/') + ' ' + x.when, why: x.why, live: true }));
      SNAP.events.splice(0, SNAP.events.length, ...keep.concat(add).sort((a, b) => (a.date < b.date ? -1 : 1)));
    }
  }
  function policyCard() {
    loadPolicy();
    const P = S.pol;
    if (!P) return `<section class="card"><h2>금리·물가</h2><p class="muted sm">ECOS·FRED 키를 넣으면 한국·미국 기준금리와 물가가 4시간마다 자동으로 바뀌어요. 지금은 저장된 값을 보여줘요.</p>
      ${SNAP.rates.slice(0, 2).map((r) => `<div class="kv"><span>${esc(r.name)}</span><b class="num">${esc(r.rate)}</b></div>`).join('')}</section>`;
    const f = P.fred || {}, e = P.ecos || {};
    const pd = (d) => { const m = String(d || '').match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/); return !m ? String(d || '') : m[3] ? Number(m[2]) + '/' + Number(m[3]) : Number(m[2]) + '월분'; };
    const row = (label, o, fmt, sub) => o ? `<div class="kv"><span>${label}</span><b class="num">${fmt(o.value)}${o.prev != null && o.prev !== o.value ? ` <span class="muted xs">직전 ${fmt(o.prev)}</span>` : ''} <span class="muted xs">${esc(pd(sub || o.date))}${/변경/.test(sub || '') ? ' 변경' : ''}</span></b></div>` : '';
    const p2 = (v) => v.toFixed(2) + '%', p1 = (v) => v.toFixed(1) + '%';
    const up = SNAP.events.filter((x) => x.live && R.daysUntil(x.date, now()) >= 0).slice(0, 3);
    return `<section class="card"><div class="row between"><h2>금리·물가</h2><p class="muted xs">FRED·ECOS 자동 · ${new Date(P.fetchedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</p></div>
      ${f.fedUpper ? `<div class="kv"><span>미국 기준금리</span><b class="num">${f.fedLower ? f.fedLower.value.toFixed(2) + '~' : ''}${p2(f.fedUpper.value)} <span class="muted xs">${esc(pd(f.fedUpper.date))}</span></b></div>` : ''}
      ${row('한국 기준금리', e.bokRate, p2, e.bokRate && e.bokRate.date + ' 변경')}
      ${row('미국 물가 (전년비)', f.cpiYoY, p1, f.cpiYoY && f.cpiYoY.date.slice(0, 7))}
      ${row('미국 근원물가', f.coreCpiYoY, p1, f.coreCpiYoY && f.coreCpiYoY.date.slice(0, 7))}
      ${row('미국 실업률', f.unrate, p1, f.unrate && f.unrate.date.slice(0, 7))}
      ${row('한국 물가 (전년비)', e.krCpiYoY, p1)}
      ${e.leading ? `<div class="kv"><span>한국 경기선행지수<br><span class="muted xs">통계청 · 100 위면 확장 · 3개월 ${e.leading.chg3 >= 0 ? '+' : ''}${e.leading.chg3} (오르면 코스피에 순풍)</span></span><b class="num ${dirClass(e.leading.value - e.leading.prev)}">${e.leading.value.toFixed(1)} <span class="muted xs">${esc(pd(e.leading.date))}</span></b></div>` : ''}
      ${e.coincident ? `<div class="kv"><span>한국 경기동행지수<br><span class="muted xs">지금 경기 · 100 위면 확장</span></span><b class="num">${e.coincident.value.toFixed(1)} <span class="muted xs">${esc(pd(e.coincident.date))}</span></b></div>` : ''}
      ${row('미국 2년물 금리', f.us2y, p2)}
      ${f.curve || f.real10y || f.m2YoY || f.hySpread ? `<p class="sm" style="margin-top:12px"><b>경기·돈 흐름 신호</b></p>
      ${f.curve ? `<div class="kv"><span>장단기 금리차<br><span class="muted xs">10년−2년 · 마이너스면 경기침체 경고</span></span><b class="num ${f.curve.value < 0 ? 'down' : ''}">${f.curve.value > 0 ? '+' : ''}${f.curve.value.toFixed(2)}%p</b></div>` : ''}
      ${f.real10y ? `<div class="kv"><span>실질금리<br><span class="muted xs">물가 뺀 금리 · 높을수록 코인·성장주 부담</span></span><b class="num">${p2(f.real10y.value)}</b></div>` : ''}
      ${f.m2YoY ? `<div class="kv"><span>시중 돈의 양 (M2)<br><span class="muted xs">1년 전보다 · 늘면 자산 가격에 순풍</span></span><b class="num ${dirClass(f.m2YoY.value)}">${f.m2YoY.value > 0 ? '+' : ''}${f.m2YoY.value.toFixed(1)}%</b></div>` : ''}
      ${f.hySpread ? `<div class="kv"><span>신용 위험 (하이일드 가산금리)<br><span class="muted xs">5% 넘으면 시장이 불안해한다는 뜻</span></span><b class="num ${f.hySpread.value >= 5 ? 'down' : ''}">${p2(f.hySpread.value)}</b></div>` : ''}` : ''}
      ${up.length ? `<p class="sm" style="margin-top:10px"><b>다가오는 발표</b></p>${up.map((x) => `<div class="kv"><span>${esc(x.title)}</span><b class="sm">${R.daysUntil(x.date, now()) === 0 ? '오늘' : R.daysUntil(x.date, now()) + '일 뒤'} · ${esc(x.when)}</b></div>`).join('')}` : ''}
      ${(P.news || []).length ? `<p class="sm" style="margin-top:10px"><b>최근 발표</b></p>${P.news.slice(0, 3).map((n) => `<p class="xs muted" style="margin:4px 0 0">${new Date(n.at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })} · ${esc(n.t)}</p>`).join('')}` : ''}
      <p class="muted xs" style="margin-top:8px">4시간마다 확인해요. 발표가 나오면 다음 확인 때 반영되고 폰으로 알려드려요.</p></section>`;
  }
  /* ---------- 화면: 단타 데스크 (SCALP · 15분봉 · Claude 결정) ---------- */
  function loadScalp(force) {
    if (S.scLoading || (S.sc && !force && Date.now() - S.scAt < 2 * 60e3)) return;
    S.scLoading = true;
    fetch('https://raw.githubusercontent.com/' + futRepo() + '/bot-data/scalp-live.json?t=' + Math.floor(Date.now() / 60e3), { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject())).catch(() => fetch('data/scalp-live.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null))).catch(() => null).then((j) => { S.scLoading = false; if (j && j.live) { S.sc = j; S.scAt = Date.now(); if (['scalp', 'paper', 'hq', 'futures', 'mk', 'home', 'bot', 'analysis'].indexOf(route()) >= 0) render(); } });
  }
  const scT = (u, addMin) => { const t = Date.parse(String(u).replace(' ', 'T') + ':00Z') + (addMin || 0) * 60e3; if (!isFinite(t)) return String(u); const d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const SC_ST = { ok: ['정상 운용', 'neu'], dayblock: ['오늘 진입 금지', 'warn'], pause: ['연패 휴식', 'warn'], killed: ['킬 스위치 휴식', 'neg'] };
  const SC_DEC = { enter: ['진입', 'live'], skip: ['건너뜀', 'neu'], error: ['응답 실패', 'warn'], late: ['늦어서 건너뜀', 'neu'], nokey: ['키 없음', 'warn'] };
  const SETUP = { pullback: '눌림목', squeeze: '수축 돌파', 'mk-flow': '층류 추세', 'mk-revert': '균형선 복귀', 'mk-ml': '학습 모델' };
  function scTrades(list, n) {
    if (!list || !list.length) return '<p class="muted sm">아직 끝난 거래가 없어요.</p>';
    return list.slice(0, n || 10).map((x) => `<div class="tl"><div class="row between"><p class="b sm"><span class="side ${SIDE[x.side][1]}">${SIDE[x.side][0]}</span> ${esc(x.name)} <span class="muted xs">${scT(x.in)} · ${x.mins >= 60 ? Math.floor(x.mins / 60) + '시간 ' : ''}${x.mins % 60}분 · ${SETUP[x.kind] || ''}</span></p>
      <p class="num sm ${dirClass(x.pnl)}">${x.pnl >= 0 ? '+' : ''}${man(x.pnl)} · ${rr(x.R || 0)}</p></div><p class="muted xs">${usd(x.entry)} → ${usd(x.exit)} · ${esc(x.reason)}${x.ai && x.ai.reason ? ' · Claude: ' + esc(x.ai.reason) : ''}</p></div>`).join('');
  }
  function viewScalp() {
    loadScalp();
    const D = S.sc;
    const head = `<header class="top"><div><a href="#paper" class="back">‹ 자동매매</a><p class="kicker">SCALP · 15분봉 롱·숏 · Claude가 결정 · 가상 1억 · 실제 돈 아님</p><h1>단타 데스크</h1></div>${tools()}</header>`;
    if (!D) return head + `<section class="card empty"><p class="h-md">단타 봇 결과를 불러오는 중이에요</p><p class="muted sm">10분마다 자동으로 돌아요. 처음 몇 분은 결과가 없을 수 있어요.</p></section>`;
    const L = D.live, st = SC_ST[L.status] || SC_ST.ok, ageMin = Math.round((Date.now() - Date.parse(D.generatedAt)) / 60e3), SH = D.shadow;
    const BD = D.bold, MJ = D.major, tabSc = S.ui.scTab === 'bold' && BD ? 'bold' : S.ui.scTab === 'major' && MJ ? 'major' : 'careful';
    const accRow = (name, desc, eqv, ret, trades, open, extra, on) => `<div class="sc-row${on ? ' on' : ''}"><div><p class="b">${name}</p><p class="muted xs">${desc}</p></div>
      <div class="right"><p class="num b ${dirClass(ret)}">${pct(ret, 2)}</p><p class="muted xs num">${won(eqv)}</p><p class="muted xs">거래 ${trades} · 포지션 ${open}${extra ? ' · ' + extra : ''}</p></div></div>`;
    const hero = `<section class="card panel"><div class="row between"><p class="kicker">${scT(D.lastBar, 15)} 마감 봉까지 · 확인 ${ageMin < 1 ? '방금' : agoTxt(ageMin * 60e3)}</p><span class="act ${st[1]}">${st[0]}</span></div>
      <p class="muted xs" style="margin:6px 0 4px">같은 후보로 세 계좌가 동시에 가상 1억씩 굴러가요. 다른 건 "들어갈지 말지"를 누가 정하느냐뿐이에요.</p>
      ${accRow('조심형 Claude', '애매하면 건너뜀', L.equity, L.ret, L.stats.trades, L.positions.length, D.aiStats.asked ? D.aiStats.enter + '/' + D.aiStats.asked + ' 진입' : '', tabSc === 'careful')}
      ${BD ? accRow('적극형 Claude', '기본은 진입', BD.equity, BD.ret, BD.stats.trades, BD.positions.length, BD.aiStats.asked ? BD.aiStats.enter + '/' + BD.aiStats.asked + ' 진입' : '', tabSc === 'bold') : ''}
      ${MJ ? accRow('AI 3명 다수결', 'Claude·Gemini·GPT 중 2명 찬성', MJ.equity, MJ.ret, MJ.stats.trades, MJ.positions.length, MJ.aiStats.asked ? MJ.aiStats.enter + '/' + MJ.aiStats.asked + ' 진입' : '', tabSc === 'major') : ''}
      ${D.mk ? `<a href="#mk" class="sc-link">${accRow('민경기 봇 1세대 ›', '규칙만 (학습형과 비교용)', D.mk.equity, D.mk.ret, D.mk.stats.trades, D.mk.positions.length, '')}</a>` : ''}
      ${SH ? accRow('엔진 혼자', '후보를 전부 진입 (비교 기준)', SH.equity, SH.ret, SH.stats.trades, SH.open, '') : ''}
      <p class="muted xs" style="margin-top:8px">${scT(D.inception, 15)}부터${BD ? ' · 적극형은 ' + scT(BD.inception, 15) + '부터' : ''}</p></section>
      ${BD ? `<div class="seg" role="tablist">${[['careful', '조심형'], ['bold', '적극형']].concat(MJ ? [['major', '다수결']] : []).map(([k, l]) => `<button role="tab" class="${tabSc === k ? 'on' : ''}" data-act="sc-tab" data-v="${k}">${l}</button>`).join('')}</div>` : ''}`;
    const V = tabSc === 'major' ? { positions: MJ.positions, pending: MJ.pending, decisions: MJ.decisions, trades: MJ.trades, stats: MJ.stats, label: '다수결' } : tabSc === 'bold' ? { positions: BD.positions, pending: BD.pending, decisions: BD.decisions, trades: BD.trades, stats: BD.stats, label: '적극형' } : { positions: L.positions, pending: L.pending, decisions: D.decisions, trades: L.trades, stats: L.stats, label: '조심형' };
    const lg = (D.log || [])[0];
    const RG = D.regime;
    const RISKW = /해킹|규제|소송|파산|상장폐지|청산|폭락|SEC|hack|exploit|lawsuit|ban|crackdown|bankrupt|liquidat|delist|outflow|plunge|crash|FOMC|CPI|금리/i;
    const newsCard = (D.news && D.news.length) || (D.events && D.events.length) ? `<section class="card"><h2>AI가 같이 본 뉴스·일정</h2>
      <p class="muted xs">진입 판단 전에 최근 12시간 코인 뉴스와 48시간 안 큰 발표를 AI에게 같이 보여줘요. 큰 악재나 발표가 임박하면 건너뛰게 했어요.</p>
      ${(D.events || []).map((e) => `<div class="kv"><span><span class="act warn">발표 임박</span></span><b class="sm">${esc(e.date.slice(5).replace('-', '/'))} ${esc(e.title)}</b></div>`).join('')}
      ${(D.news || []).slice(0, 6).map((n) => `<p class="sm news-line">${RISKW.test(n.title) ? '<span class="act warn">주의</span> ' : ''}${esc(n.title)} <span class="muted xs">${n.ago}시간 전 · ${esc(n.src)}</span></p>`).join('')}</section>` : '';
    const now = `<section class="card"><div class="row between"><h2>지금 봇은</h2><p class="muted xs">${lg ? scT(lg.t, 15) + ' 판단' : ''}</p></div>
      ${RG && RG.label ? `<div class="kv"><span>지금 장세 (비트코인)</span><b>${esc(RG.label)}</b></div>` : ''}
      ${lg ? (lg.state ? `<p class="sm"><span class="act warn">${esc(lg.state)}</span></p>` : '') + lg.coins.map((c) => `<div class="kv sc-coin"><span>${esc(c.sym)}</span><b class="sm">${esc(c.text)}</b></div>`).join('')
        + `<p class="sm" style="margin-top:8px">${lg.cands.length ? '후보: <b>' + lg.cands.map(esc).join(', ') + '</b> → Claude에게 물어봄' : '이번 봉엔 후보 없음 — 조건이 맞을 때까지 기다려요'}</p>` : '<p class="muted sm">판단 기록이 아직 없어요.</p>'}
      <p class="muted xs" style="margin-top:6px">15분봉이 끝날 때마다 판단하고, 10분마다 결과를 올려요.</p></section>`;
    const pos = `<section class="card"><h2>${V.label} 포지션 ${V.positions.length}개${(V.pending || []).length ? ' + 대기 ' + V.pending.length : ''} <span class="muted xs">· 최대 ${D.cfg.maxPos}개</span></h2>${V.positions.length ? V.positions.map((p) => `<div class="fpos">
      <div class="row between"><p class="b"><span class="side ${SIDE[p.side][1]}">${SIDE[p.side][0]}</span> ${esc(p.name)} <span class="muted xs">${p.lev}배 · ${SETUP[p.kind] || ''}</span></p><p class="num b ${dirClass(p.upnl)}">${p.upnl >= 0 ? '+' : ''}${man(p.upnl)}</p></div>
      <div class="kv"><span>진입→현재</span><b class="num">${usd(p.entry)} → ${usd(p.mark)}</b></div>
      <div class="kv"><span>${p.be ? '손절(본전으로 올림)' : '손절'}</span><b class="num">${usd(p.stop)} <span class="muted xs">${p.toStop}%</span></b></div>
      <div class="kv"><span>목표(익절)</span><b class="num">${usd(p.tp)}</b></div>
      <div class="kv"><span>청산가</span><b class="num">${usd(p.liq)} <span class="muted xs">${p.toLiq}%</span></b></div>
      <div class="kv"><span>남은 시간</span><b class="num">${Math.round(p.barsLeft * 15 / 60 * 10) / 10}시간 뒤 정리</b></div>
      ${p.ai ? `<p class="xs" style="margin:6px 0 0">Claude ${p.ai.confidence}: ${esc(p.ai.reason)}</p>` : ''}${tvButton('perp', p.sym, p.name + ' 무기한 선물', '15')}</div>`).join('') : (V.pending || []).length ? '' : '<p class="muted sm">지금은 포지션이 없어요.</p>'}
      ${(V.pending || []).map((o) => `<div class="fpos pend"><div class="row between"><p class="b"><span class="side ${SIDE[o.side][1]}">${SIDE[o.side][0]}</span> ${esc(o.name)} <span class="muted xs">${SETUP[o.kind] || ''}</span></p><span class="act warn">체결 대기</span></div>
        <p class="sm" style="margin:6px 0 0">${scT(o.decidedBar, 15).split(' ')[1]}에 진입 결정 → ${scT(o.fillAt).split(' ')[1]} 봉 시작 가격으로 체결돼요. ${scT(o.fillAt, 16).split(' ')[1]}쯤 확인 때 포지션으로 옮겨져요.</p>
        ${o.ai && o.ai.reason ? `<p class="muted xs" style="margin:4px 0 0">${esc(o.ai.reason)}</p>` : ''}</div>`).join('')}</section>`;
    const dec = `<section class="card"><h2>${V.label} Claude 결정 기록</h2>${(V.decisions || []).length ? V.decisions.slice(0, 12).map((d) => `<div class="vote"><div class="row between"><p class="b sm"><span class="side ${SIDE[d.side][1]}">${SIDE[d.side][0]}</span> ${esc(d.name)} <span class="muted xs">${scT(d.t, 15)} · ${SETUP[d.kind] || ''}</span></p><span class="act ${(SC_DEC[d.decision] || SC_DEC.error)[1]}">${(SC_DEC[d.decision] || SC_DEC.error)[0]}${d.confidence ? ' ' + d.confidence : ''}</span></div><p class="xs vote-line">${esc(d.reason || '')}</p>${(d.votes || []).map((x) => `<p class="xs vote-line"><b>${esc(x.name)}</b> <span class="act ${(SC_DEC[x.decision] || SC_DEC.error)[1]}">${(SC_DEC[x.decision] || SC_DEC.error)[0]}${x.confidence ? ' ' + x.confidence : ''}</span> ${esc(x.reason || '')}</p>`).join('')}</div>`).join('') : '<p class="muted sm">아직 후보가 없었어요.</p>'}</section>`;
    const AC = D.aiCard;
    const aiCard = AC && tabSc === 'major' ? `<section class="card"><h2>AI 성적표 <span class="muted xs">· 다수결 계좌 기준</span></h2>
      <p class="muted xs">각 AI가 "진입"에 찬성했던 거래가 실제로 어땠는지 모아요. 거래가 쌓일수록 누가 잘 보는지 드러나요.</p>
      <div class="ftbl-wrap"><table class="ftbl num"><thead><tr><th>AI</th><th>찬성</th><th>거래</th><th>승률</th><th>평균</th><th>반대 땐</th></tr></thead><tbody>
      ${AC.map((a) => `<tr><td>${esc(a.name)}</td><td>${a.yes}/${a.asked}</td><td>${a.yesTrades}</td><td>${a.yesWin == null ? '—' : a.yesWin + '%'}</td><td class="${dirClass(a.yesR)}">${a.yesR == null ? '—' : rr(a.yesR)}</td><td class="${dirClass(a.noR == null ? 0 : -a.noR)}">${a.noR == null ? '—' : rr(a.noR)}</td></tr>`).join('')}
      </tbody></table></div><p class="muted xs">거래·승률·평균은 그 AI가 찬성한 거래의 결과예요. "반대 땐"이 마이너스면 그 AI가 반대한 게 맞았다는 뜻이에요.</p></section>` : '';
    const trades = `<section class="card"><h2>${V.label} 최근 거래 <span class="muted xs">· ${V.stats.trades}번 · 승률 ${V.stats.winRate == null ? '—' : V.stats.winRate + '%'} · 수수료 ${man(V.stats.fees)}</span></h2>${scTrades(V.trades, 10)}</section>
      ${SH && SH.trades.length ? `<section class="card"><h2>비교: 엔진 혼자 최근 거래</h2>${scTrades(SH.trades, 6)}</section>` : ''}`;
    const B = D.bt, bs = B.stats;
    const honest = `<section class="card"><h2>솔직한 검증 · 엔진만 최근 ${B.days}일</h2>
      <div class="grid3">${mini('수익', pct(B.ret, 1), '거래 ' + bs.trades + '번')}${mini('최대 낙폭', pct(B.metrics && B.metrics.mdd, 0), '하루 ' + bs.perDay + '번')}${mini('손익비', bs.pf == null ? '—' : String(bs.pf), '승률 ' + bs.winRate + '%')}</div>
      ${(() => { const st = D.study || [], allNeg = st.length && st.every((r) => r.all.ret < 0); return B.ret < 0
        ? `<p class="sm" style="margin-top:8px">규칙만으로 15분봉 단타를 하면 <b>수수료를 못 이기고 손실</b>이에요. 이 기간 수수료만 ${man(bs.fees)}였어요.${allNeg ? ' 손절·목표·보유시간·셋업을 바꿔도 모두 손실이라, 숫자를 맞추지 않고 그대로 두었어요.' : ''}</p>`
        : `<p class="sm" style="margin-top:8px">최근 ${B.days}일은 엔진만으로도 수익이었어요. 다만 기간이 짧고 수수료가 ${man(bs.fees)}나 들어서, 시장 분위기가 바뀌면 쉽게 손실로 돌아설 수 있어요.</p>`; })()}
      <p class="muted xs">그래서 이 봇의 실험은 하나예요: <b>Claude가 엔진 후보 중 나쁜 걸 걸러내서 손실을 수익으로 바꿀 수 있나?</b> 위의 "엔진 혼자" 계좌와 비교하면 알 수 있어요.</p>
      ${(D.study || []).length ? `<details class="pro-inline"><summary>설정을 바꿔 본 결과 (전문가용)</summary><div class="ftbl-wrap"><table class="ftbl num"><thead><tr><th>설정</th><th>전체</th><th>앞 절반</th><th>뒤 절반</th><th>거래</th></tr></thead><tbody>${D.study.map((r) => `<tr><td>${esc(r.name)}</td><td class="${dirClass(r.all.ret)}">${pct(r.all.ret, 1)}</td><td class="${dirClass(r.h1.ret)}">${pct(r.h1.ret, 1)}</td><td class="${dirClass(r.h2.ret)}">${pct(r.h2.ret, 1)}</td><td>${r.all.n}</td></tr>`).join('')}</tbody></table></div></details>` : ''}</section>`;
    const c = D.cfg;
    const rules = `<section class="card"><h2>규칙</h2>
      <div class="kv"><span>셋업</span><b>추세 눌림목 · 수축 후 돌파 (롱·숏)</b></div>
      <div class="kv"><span>결정</span><b>엔진 후보 → Claude가 진입/건너뜀</b></div>
      <div class="kv"><span>손절·목표</span><b>${c.stopAtr} ATR(최소 ${c.minStopPct}%) · ${c.tpR}R · 1R 가면 본전</b></div>
      <div class="kv"><span>보유</span><b>최대 ${c.maxBars * c.bar / 60}시간</b></div>
      <div class="kv"><span>크기</span><b>한 번에 계좌 ${c.riskPct}% · 동시 ${c.maxPos}개 · 전체 ${c.maxLevTotal}배</b></div>
      <div class="kv"><span>금고</span><b>하루 ${c.dayLoss}% 정지 · ${c.streakPause}연패 ${c.pauseBars * c.bar / 60}시간 휴식 · ${c.ddKill}% 킬</b></div>
      <div class="kv"><span>비용</span><b>수수료 ${(c.taker * 100).toFixed(2)}% · 미끄러짐 · 펀딩</b></div></section>`;
    return head + hero + now + newsCard + pos + dec + aiCard + trades + honest + rules;
  }

  /* ---------- 민경기 봇: 2세대 학습형 (1시간봉) + 1세대 규칙형 (15분봉) ---------- */
  function loadMk(force) {
    if (S.mkLoading || (!force && S.mkAt && Date.now() - S.mkAt < 2 * 60e3)) return;
    S.mkLoading = true;
    const get = (f) => fetch('https://raw.githubusercontent.com/' + futRepo() + '/bot-data/' + f + '?t=' + Math.floor(Date.now() / 60e3), { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject())).catch(() => fetch('data/' + f, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null))).catch(() => null);
    Promise.all([get('mk3-live.json'), get('mk-live.json')]).then(([a, b]) => { S.mkLoading = false; S.mkAt = Date.now(); if (a && a.live) S.mk3 = a; if (b && b.live) S.mk = b; if (['mk', 'paper', 'home', 'bot', 'analysis', 'hq'].indexOf(route()) >= 0) render(); });
  }
  function mkEntry() {
    loadMk();
    const M = S.mk3 && S.mk3.live, ok = S.mk3 && S.mk3.wf && S.mk3.wf.pass && S.mk3.wf.pass.ok;
    return `<a class="card fut-entry mk-entry" href="#mk"><div class="row between"><div><p class="kicker">내 봇 · 추세 + 학습 · 코인 선물 4시간봉</p><p class="b">민경기 봇</p><p class="muted xs">${S.mk3 ? '모델 ' + S.mk3.model.ver + '번째 · ' + (ok ? '시험 합격' : '시험 중') + ' · 포지션 ' + M.positions.length : '불러오는 중'}</p></div>
      <div class="right"><p class="num b ${dirClass(M && M.ret)}">${M ? pct(M.ret, 2) : '—'}</p><p class="muted xs">${M ? '거래 ' + M.n : ''}</p></div></div></a>`;
  }
  const MK3_ST = { ok: ['정상 운용', 'neu'], half: ['위험 절반', 'warn'], dayblock: ['오늘 진입 금지', 'warn'], killed: ['킬 스위치 휴식', 'neg'] };
  function viewMk() {
    loadMk(); loadScalp();
    const D = S.mk3, G2 = S.mk, G1 = S.sc && S.sc.mk;
    const head = `<header class="top"><div><a href="#paper" class="back">‹ 자동매매</a><p class="kicker">MK · 코인 선물 4시간봉 롱·숏 · 가상 1억 · 실제 돈 아님</p><h1>민경기 봇</h1></div>${tools()}</header>`;
    const older = (G2 ? mkGen2(G2) : '') + (G1 ? mkGen1(G1) : '');
    if (!D) return head + `<section class="card empty"><p class="h-md">민경기 봇 3세대가 준비 중이에요</p><p class="muted sm">바이낸스 4시간봉 역사를 받아 처음 학습하는 데 시간이 걸려요. 매시간 15분 무렵 결과가 올라와요.</p></section>` + older;
    const L = D.live, st = MK3_ST[L.status] || MK3_ST.ok, WF = D.wf || {}, ST = WF.study || [], B0 = ST[0], M0 = ST[1], PS = WF.pass || {};
    const hero = `<section class="card panel"><div class="row between"><p class="kicker">${scT(D.lastBar, 240)} 마감 봉까지 · 4시간마다 판단</p><span class="act ${st[1]}">${st[0]}</span></div>
      <p class="nav num">${won(L.equity)}</p><p class="hero-sub ${dirClass(L.ret)}">${pct(L.ret, 2)} · 거래 ${L.n}번${L.win != null ? ' · 승률 ' + L.win + '%' : ''}</p>
      <p class="muted xs">${scT(D.inception)}부터 가상 1억 · ${esc(D.src)}</p></section>`;
    const pos = `<section class="card"><h2>포지션 ${L.positions.length}개${L.pending.length ? ' + 대기 ' + L.pending.length : ''} <span class="muted xs">· 최대 ${D.cfg.maxPos}개</span></h2>
      ${L.positions.map((p) => `<div class="fpos"><div class="row between"><p class="b"><span class="side ${SIDE[p.side][1]}">${SIDE[p.side][0]}</span> ${esc(p.name)} <span class="muted xs">${p.lev}배</span></p><p class="num b ${dirClass(p.upnl)}">${p.upnl >= 0 ? '+' : ''}${man(p.upnl)}</p></div>
        <div class="kv"><span>진입→현재</span><b class="num">${usd(p.entry)} → ${usd(p.mark)}</b></div>
        <div class="kv"><span>${p.trail ? '추적 손절 (이익 지키는 중)' : '손절'}</span><b class="num">${usd(p.stop)}</b></div>
        <div class="kv"><span>청산가</span><b class="num">${usd(p.liq)}</b></div>
        <p class="muted xs" style="margin:4px 0 0">${esc(p.why || '')}</p>${tvButton('perp', p.sym, p.name + ' 무기한 선물', '240')}</div>`).join('')}
      ${L.pending.map((o) => `<div class="fpos pend"><div class="row between"><p class="b"><span class="side ${SIDE[o.side][1]}">${SIDE[o.side][0]}</span> ${esc(o.name)}</p><span class="act warn">체결 대기</span></div><p class="muted xs" style="margin:4px 0 0">${esc(o.why || '')} · ${scT(o.fillAt)} 시가로 체결</p></div>`).join('')}
      ${!L.positions.length && !L.pending.length ? '<p class="muted sm">지금은 포지션이 없어요. 추세 돌파가 나오고 학습 점수가 통과하면 들어가요.</p>' : ''}
      <p class="muted xs" style="margin-top:6px">나오는 방법: 손절(2.5ATR) · 1ATR 이익 뒤 추적 손절(최고점−3ATR) · 추세가 꺾이면(50/200EMA 교차) 정리</p></section>`;
    const verdict = B0 && M0 ? `<section class="card"><div class="row between"><h2>처음 보는 데이터로 본 시험</h2><span class="act ${PS.ok ? 'live' : 'warn'}">${PS.ok ? '합격' : '불합격'}</span></div>
      <p class="muted xs">${esc(WF.from.slice(0, 10))} ~ ${esc(WF.to.slice(0, 10))} · 과거로만 배우고 다음 90일을 매매하는 시험을 ${WF.folds.length}번 반복 · 수수료·미끄러짐·펀딩 포함</p>
      <div class="ftbl-wrap"><table class="ftbl num"><thead><tr><th></th><th>연 수익</th><th>최대 낙폭</th><th>샤프</th><th>손익비</th><th>거래</th></tr></thead><tbody>
        ${[[B0, 'FLUX 혼자'], [M0, '민경기 봇']].map(([r, n]) => `<tr${r === M0 ? ' class="hl"' : ''}><td>${n}</td><td class="${dirClass(r.all.cagr)}">${pct(r.all.cagr, 1)}</td><td>${pct(r.all.mdd, 0)}</td><td>${r.all.sharpe ?? '—'}</td><td>${r.all.pf ?? '—'}</td><td>${r.all.n}</td></tr>`).join('')}</tbody></table></div>
      <div class="kv"><span>FLUX 혼자보다 나음 (샤프↑, 수익 비슷 이상)</span><b>${PS.beats ? '✓' : '✗'}</b></div>
      <div class="kv"><span>앞·뒤 절반 모두 플러스</span><b>${PS.halves ? '✓' : '✗'}</b></div>
      <div class="kv"><span>손익비 1.3 이상</span><b>${PS.pf ? '✓' : '✗'}</b></div>
      <div class="kv"><span>최대 낙폭 -25% 이내</span><b>${PS.mdd ? '✓' : '✗'}</b></div>
      <p class="sm" style="margin-top:8px">${PS.ok ? '학습 필터가 추세 규칙을 실제로 더 낫게 만들었어요. 그래도 실시간 모의 계좌로 4주 이상 확인한 뒤 실제 돈을 상의해요.' : PS.halves && PS.pf ? '추세 규칙 자체는 수익이지만, 학습 필터가 아직 FLUX 혼자보다 확실히 낫지는 않아요. 매주 다시 배우면서 비교해요.' : '아직 기준을 다 넘지 못했어요. 숫자를 억지로 맞추지 않아요.'}</p>
      <details class="pro-inline"><summary>거르는 정도를 바꿔 본 결과</summary><div class="ftbl-wrap"><table class="ftbl num"><thead><tr><th>설정</th><th>연 수익</th><th>낙폭</th><th>샤프</th><th>앞</th><th>뒤</th></tr></thead><tbody>${ST.map((r) => `<tr><td>${esc(r.name)}</td><td class="${dirClass(r.all.cagr)}">${pct(r.all.cagr, 1)}</td><td>${pct(r.all.mdd, 0)}</td><td>${r.all.sharpe ?? '—'}</td><td class="${dirClass(r.h1.ret)}">${pct(r.h1.ret, 0)}</td><td class="${dirClass(r.h2.ret)}">${pct(r.h2.ret, 0)}</td></tr>`).join('')}</tbody></table></div></details></section>` : '';
    const BK = (WF.buckets || []).filter((b) => b.n);
    const judge = BK.length ? `<section class="card"><h2>학습 점수가 실제로 맞았나</h2>
      <p class="muted xs">시험 기간의 추세 돌파 후보를 학습 점수 순서로 5묶음으로 나눠, 실제 결과(평균 R)를 봤어요. 위로 갈수록 숫자가 커지면 모델이 좋은 후보를 골라낸다는 뜻이에요.</p>
      <div class="ftbl-wrap"><table class="ftbl num"><thead><tr><th>학습 점수</th><th>후보 수</th><th>이익 비율</th><th>평균 결과</th></tr></thead><tbody>${BK.slice().reverse().map((b, k) => `<tr><td>${['상위 20%', '60~80%', '40~60%', '20~40%', '하위 20%'][k]}</td><td>${b.n}</td><td>${b.win}%</td><td class="${dirClass(b.avgR)}">${rr(b.avgR)}</td></tr>`).join('')}</tbody></table></div></section>` : '';
    const dec = (D.decisions || []).length ? `<section class="card"><h2>최근 판단</h2>${D.decisions.slice(0, 10).map((d) => `<div class="kv"><span><span class="side ${SIDE[d.side][1]}">${SIDE[d.side][0]}</span> ${esc(d.name)} <span class="muted xs">${scT(d.t, 240)}</span></span><b class="sm">${d.ok ? (d.big ? '진입 (크게)' : '진입') : '건너뜀'} <span class="muted xs">점수 ${d.p ?? '—'}</span></b></div>`).join('')}</section>` : '';
    const watch = (D.watch || []).length ? `<section class="card"><h2>지금 코인별 상황</h2><p class="muted xs">40봉(약 7일) 고점·저점을 뚫으면 후보가 돼요.</p>
      <div class="ftbl-wrap"><table class="ftbl num"><thead><tr><th>코인</th><th>추세</th><th>고점까지</th><th>저점까지</th><th>난류</th></tr></thead><tbody>${D.watch.map((w) => `<tr><td>${esc(w.name)}</td><td>${w.trend === '상승 추세' ? '<span class="up">상승</span>' : '<span class="down">하락</span>'}</td><td>${w.toHi == null ? '—' : w.toHi <= 0 ? '<b>돌파</b>' : '+' + w.toHi + '%'}</td><td>${w.toLo == null ? '—' : w.toLo <= 0 ? '<b>이탈</b>' : '-' + w.toLo + '%'}</td><td>${w.ti == null ? '—' : Math.round(w.ti * 100) + '%'}</td></tr>`).join('')}</tbody></table></div></section>` : '';
    const trades = L.trades.length ? `<section class="card"><h2>최근 거래</h2>${futTrades(L.trades, 8)}</section>` : '';
    const Mo = D.model;
    const learned = `<section class="card"><h2>어떻게 판단하나</h2>
      <p class="sm">① <b>추세 돌파 규칙</b>이 후보를 뽑아요 (40봉 고점 돌파 + 50/200EMA 정배열, 숏은 BTC 하락장일 때만). 지난 수년간 수익이 확인된 규칙이에요.</p>
      <p class="sm">② <b>학습 모델</b>이 후보마다 "이익으로 끝날 확률"을 매겨요. 과거 후보 ${nf(Mo.n)}개(이익 ${Mo.rate}%)로 배웠어요. 하위 30%는 건너뛰고, 상위 30%는 1.5배 크게 들어가요.</p>
      <p class="sm">③ 리만(파동 정렬·균형선)·나비에-스토크스(난류) 지표, 펀딩비, 테이커 매수 쏠림, 비트코인 분위기 등 ${FEATS3_N}개 재료를 봐요.</p>
      <p class="sm" style="margin:8px 0 4px">많이 본 재료</p>${Mo.imp.slice(0, 6).map((x) => `<div class="kv"><span>${esc(x.label)}</span><b class="num">${x.v}%</b></div>`).join('')}
      <p class="muted xs" style="margin-top:6px">모델 ${Mo.ver}번째 · ${esc(Mo.at.slice(0, 10))} 학습 · 매주 다시 학습 · 안전 규칙: 한 번에 ${D.cfg.riskPct}%(크게 ${D.cfg.riskPct * 1.5}%) · 동시 ${D.cfg.maxPos}개 · 전체 ${D.cfg.maxLevTotal}배 이하 · 하루 ${D.cfg.dayLoss}% 정지 · ${D.cfg.ddHalve}% 위험 절반 · ${D.cfg.ddKill}% 킬</p></section>`;
    return head + hero + pos + verdict + judge + dec + watch + trades + learned + older;
  }
  const FEATS3_N = 24;
  function mkGen2(D) {
    const L = D.live, st = SC_ST[L.status] || SC_ST.ok, WF = D.wf || {}, S0 = (WF.study || [])[0], PS = WF.pass || {}, Mo = D.model;
    const verdict = S0 ? `<section class="card panel"><div class="row between"><h2>처음 보는 데이터로 본 시험</h2><span class="act ${PS.ok ? 'live' : 'warn'}">${PS.ok ? '합격' : '불합격'}</span></div>
      <p class="muted xs">${esc(WF.from.slice(0, 10))} ~ ${esc(WF.to.slice(0, 10))} · 과거로만 배우고 다음 30일을 맞히는 시험을 ${WF.folds}번 반복했어요. 수수료·미끄러짐·펀딩 포함.</p>
      <div class="grid3">${mini('수익', pct(S0.all.ret, 1), '거래 ' + S0.all.n + '번')}${mini('최대 낙폭', S0.mdd == null ? '—' : pct(S0.mdd, 0), '승률 ' + (S0.all.win == null ? '—' : S0.all.win + '%'))}${mini('손익비(PF)', S0.all.pf == null ? '—' : String(S0.all.pf), '앞 ' + pct(S0.h1.ret, 1) + ' · 뒤 ' + pct(S0.h2.ret, 1))}</div>
      <div class="kv"><span>거래 50번 이상</span><b>${PS.trades ? '✓' : '✗'}</b></div>
      <div class="kv"><span>앞·뒤 절반 모두 플러스</span><b>${PS.halves ? '✓' : '✗'}</b></div>
      <div class="kv"><span>손익비 1.2 이상</span><b>${PS.pf ? '✓' : '✗'}</b></div>
      <div class="kv"><span>최대 낙폭 -20% 이내</span><b>${PS.mdd ? '✓' : '✗'}</b></div>
      <p class="sm" style="margin-top:8px">${PS.ok ? '네 기준을 모두 넘었어요. 그래도 과거 시험이라, 실시간 모의 계좌가 4주 이상 비슷하게 가는지 본 다음에 실제 돈을 상의해요.' : '아직 기준을 다 넘지 못했어요. 숫자를 억지로 맞추지 않아요. 매주 새 데이터로 다시 배우면서 시험도 다시 봐요.'}</p>
      <details class="pro-inline"><summary>진입 기준을 바꿔 본 결과</summary><div class="ftbl-wrap"><table class="ftbl num"><thead><tr><th>설정</th><th>전체</th><th>앞</th><th>뒤</th><th>거래</th><th>PF</th></tr></thead><tbody>${WF.study.map((r) => `<tr><td>${esc(r.name)}</td><td class="${dirClass(r.all.ret)}">${pct(r.all.ret, 1)}</td><td class="${dirClass(r.h1.ret)}">${pct(r.h1.ret, 1)}</td><td class="${dirClass(r.h2.ret)}">${pct(r.h2.ret, 1)}</td><td>${r.all.n}</td><td>${r.all.pf == null ? '—' : r.all.pf}</td></tr>`).join('')}</tbody></table></div></details></section>` : '';
    const live = `<section class="card"><div class="row between"><h2>실시간 모의 계좌</h2><span class="act ${st[1]}">${st[0]}</span></div>
      <div class="grid3">${mini('수익', pct(L.ret, 2), won(L.equity))}${mini('거래', String(L.stats.trades), '승률 ' + (L.stats.winRate == null ? '—' : L.stats.winRate + '%'))}${mini('포지션', String(L.positions.length) + (L.pending.length ? ' +대기 ' + L.pending.length : ''), '최대 ' + D.cfg.maxPos + '개')}</div>
      <p class="muted xs">${scT(D.inception)}부터 · ${scT(D.lastBar, 60)} 마감 봉까지 판단 · 매시간 자동</p>
      ${L.positions.map((p) => `<div class="fpos"><div class="row between"><p class="b"><span class="side ${SIDE[p.side][1]}">${SIDE[p.side][0]}</span> ${esc(p.name)} <span class="muted xs">${p.lev}배</span></p><p class="num b ${dirClass(p.upnl)}">${p.upnl >= 0 ? '+' : ''}${man(p.upnl)}</p></div>
        <div class="kv"><span>진입→현재</span><b class="num">${usd(p.entry)} → ${usd(p.mark)}</b></div><div class="kv"><span>${p.be ? '손절(본전)' : '손절'} · 목표</span><b class="num">${usd(p.stop)} · ${usd(p.tp)}</b></div>
        <div class="kv"><span>남은 시간</span><b class="num">${p.barsLeft}시간 뒤 정리</b></div><p class="muted xs" style="margin:4px 0 0">${esc(p.why || '')}</p>${tvButton('perp', p.sym, p.name + ' 무기한 선물', '60')}</div>`).join('')}
      ${L.pending.map((o) => `<div class="fpos pend"><div class="row between"><p class="b"><span class="side ${SIDE[o.side][1]}">${SIDE[o.side][0]}</span> ${esc(o.name)}</p><span class="act warn">체결 대기</span></div><p class="muted xs" style="margin:4px 0 0">${esc(o.why || '')} · ${scT(o.fillAt).split(' ')[1]} 시가로 체결</p></div>`).join('')}
      ${L.trades.length ? '<h3 class="sm" style="margin:12px 0 0">최근 거래</h3>' + scTrades(L.trades, 8) : ''}</section>`;
    const reads = (D.read || []).length ? `<section class="card"><h2>지금 모델의 판단</h2>
      <p class="muted xs">다음 24시간 안에 목표(2R)가 손절(1R)보다 먼저 닿을 확률이에요. 시험에서 모델이 자신을 과신한 만큼 <b>낮춰서 보정한</b> 숫자예요. 수수료를 빼고 1R당 +0.1 이상 남을 때만 들어가요. 기준선은 약 ${Math.round((1 + 0.1) / 3 * 100 + 3)}%예요.</p>
      <div class="ftbl-wrap"><table class="ftbl num"><thead><tr><th>코인</th><th>롱 확률</th><th>숏 확률</th><th>판단</th></tr></thead><tbody>${D.read.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.pl}%</td><td>${r.ps}%</td><td>${r.sig ? `<span class="side ${SIDE[r.sig.side][1]}">${SIDE[r.sig.side][0]}</span>` : '<span class="muted">쉼</span>'}</td></tr>`).join('')}</tbody></table></div></section>` : '';
    const learned = Mo ? `<section class="card"><h2>무엇을 배웠나</h2>
      <p class="muted xs">모델 ${Mo.ver}번째 · ${esc(Mo.at.slice(0, 10))} 학습 · 코인 ${Mo.coins}개 · ${esc(Mo.from.slice(0, 10))}부터 1시간봉 · 학습 예시 ${nf(Mo.n)}개 · 재료 ${Mo.feats}개 · 매주 다시 학습</p>
      <p class="sm" style="margin:8px 0 4px">판단에 많이 쓴 재료 (중요도)</p>
      ${Mo.imp.slice(0, 8).map((x) => `<div class="kv"><span>${esc(x.label)}</span><b class="num">${x.v}%</b></div>`).join('')}
      <p class="muted xs" style="margin-top:6px">원래 목표 성공률: 롱 ${Mo.rate.long}% · 숏 ${Mo.rate.short}% (아무 때나 들어갔을 때)</p>
      ${(() => { const X = D.deriv; if (!X) return '<div class="fil"><p class="b sm">선물 시장 데이터</p><p class="muted xs">서울 서버가 바이낸스 펀딩비·미결제약정·롱숏 비율을 모으기 시작하면 여기에 표시돼요.</p></div>';
        const od = (X.cover && X.cover.oiDays) || 0;
        return `<div class="fil"><p class="b sm">선물 시장 데이터 (서울 서버 수집)</p>
          <div class="kv"><span>펀딩비</span><b>${X.useF ? '재료로 사용 중 ✓' : '준비 중'}</b></div>
          <div class="kv"><span>미결제약정 · 롱숏 비율 · 테이커</span><b>${X.useO ? '재료로 사용 중 ✓' : od + ' / ' + X.need + '일 쌓는 중'}</b></div>
          ${X.useO ? '' : `<div class="bar-track" style="margin-top:6px"><div class="bar-fill" style="width:${Math.min(100, od / X.need * 100)}%"></div></div>`}
          <p class="muted xs">바이낸스는 이 데이터를 최근 30일만 줘서 매시간 모아 두고 있어요. ${X.need}일이 차면 자동으로 다시 학습해요.</p></div>`; })()}</section>` : '';
    const CB = (WF.calib || []).filter((c) => c.n);
    const calib = CB.length ? `<section class="card"><h2>모델이 말한 확률이 맞았나</h2>
      <p class="muted xs">시험 기간에 모델이 "몇 %"라고 했던 것과 실제로 성공한 비율이에요. 두 숫자가 비슷할수록 믿을 만한 모델이에요.</p>
      <div class="ftbl-wrap"><table class="ftbl num"><thead><tr><th>모델 예측</th><th>실제</th><th>횟수</th></tr></thead><tbody>${CB.map((c) => `<tr><td>${c.pred}%</td><td>${c.real}%</td><td>${nf(c.n)}</td></tr>`).join('')}</tbody></table></div></section>` : '';
    const how = `<section class="card"><h2>어떻게 배우나</h2>
      <p class="sm">· <b>재료</b>: 리만 착안(파동 정렬·균형선 이탈·변곡 간격), 나비에-스토크스 착안(흐름 매끄러움·난류), 추세·변동성·거래량·비트코인 분위기·시간대 등 26개</p>
      <p class="sm">· <b>정답</b>: 그 시각에 들어갔다면 목표가 손절보다 먼저 닿았나 (롱·숏 따로)</p>
      <p class="sm">· <b>학습</b>: 그래디언트 부스팅 — 얕은 판단 나무 120개가 앞 나무의 실수를 고쳐 가며 쌓여요</p>
      <p class="sm">· <b>커닝 금지</b>: 시험 구간 바로 앞 25시간은 학습에서 빼서, 미래 정보가 새지 않게 했어요</p>
      <p class="muted xs" style="margin-top:6px">안전 규칙: 한 번에 계좌 ${D.cfg.riskPct}% · 동시 ${D.cfg.maxPos}개 · 전체 ${D.cfg.maxLevTotal}배 이하 · 손절 ${D.cfg.stopAtr}ATR(최소 ${D.cfg.minStopPct}%) · 목표 ${D.cfg.tpR}R · 최대 ${D.cfg.maxBars}시간 · 하루 ${D.cfg.dayLoss}% 정지 · ${D.cfg.ddKill}% 킬</p></section>`;
    return `<details class="card"><summary><span class="b">2세대 (1시간봉 가격만 학습) 기록</span><span class="pro-tag">${S0 ? '시험 ' + pct(S0.all.ret, 1) : ''}</span></summary><p class="muted xs" style="margin-top:8px">1시간봉 가격 모양만 보고 배운 버전이에요. 시험에서 손실이라 3세대로 바꿨고, 비교용으로 계속 돌려요.</p></details>` + verdict + live + reads + learned + calib + how;
  }
  // 1세대: 규칙만 쓴 15분봉 버전 (비교용)
  function mkGen1(M) {
    const P0 = M.study && M.study[0];
    return `<details class="card"><summary><span class="b">1세대 (규칙만, 15분봉) 기록</span><span class="pro-tag">${P0 ? '시험 ' + pct(P0.all.ret, 1) : ''}</span></summary>
      <p class="muted xs" style="margin-top:8px">사람이 정한 규칙(파동 정렬 ±0.7, 균형선 ±2.5ATR, 난류 85%)만으로 매매한 첫 버전이에요. 시험에서 손실이라 학습형으로 바꿨어요. 비교용으로 계속 돌려요.</p>
      <div class="kv"><span>실시간 모의</span><b class="num ${dirClass(M.ret)}">${pct(M.ret, 2)} · 거래 ${M.stats.trades}</b></div>
      ${(M.study || []).length ? `<div class="ftbl-wrap"><table class="ftbl num"><thead><tr><th>설정</th><th>전체</th><th>앞</th><th>뒤</th><th>거래</th></tr></thead><tbody>${M.study.map((r) => `<tr><td>${esc(r.name)}</td><td class="${dirClass(r.all.ret)}">${pct(r.all.ret, 1)}</td><td class="${dirClass(r.h1.ret)}">${pct(r.h1.ret, 1)}</td><td class="${dirClass(r.h2.ret)}">${pct(r.h2.ret, 1)}</td><td>${r.all.n}</td></tr>`).join('')}</tbody></table></div>` : ''}</details>`;
  }
  const SC_COIN = { BTC: '비트코인', ETH: '이더리움', SOL: '솔라나', XRP: '엑스알피', DOGE: '도지코인' };
  function scalpEntry() {
    loadScalp();
    const D = S.sc, L = D && D.live, lg = D && D.log && D.log[0];
    return `<a class="card fut-entry" href="#scalp"><div class="row between"><div><p class="kicker">코인 선물 단타 · 15분봉 · Claude</p><p class="b">SCALP 15분봉 롱·숏</p>${lg ? `<p class="muted xs">${scT(lg.t, 15)} 판단 · ${lg.cands.length ? '후보 ' + lg.cands.length + '개' : '후보 없음'}</p>` : ''}</div>
      <div class="right"><p class="num b ${dirClass(L && L.ret)}">${L ? pct(L.ret, 2) : '—'}</p><p class="muted xs">${L ? '거래 ' + L.stats.trades + ' · 포지션 ' + L.positions.length : '불러오는 중'}</p></div></div></a>`;
  }

  /* ---------- 화면: 탐색 (종목·시장 찾아보기) ---------- */
  const SV = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = {
    rank: SV('<path d="M6 20V10M12 20V4M18 20v-7"/>'), score: SV('<path d="M12 3l8 5.5-3 9.5H7L4 8.5z"/><path d="M12 8l3.5 2.4-1.3 4.1H9.8l-1.3-4.1z"/>'),
    coin: SV('<circle cx="12" cy="12" r="8.5"/><path d="M9.5 8h4a2 2 0 0 1 0 4h-4m0 0h4.5a2 2 0 0 1 0 4H9.5V8"/>'), world: SV('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5z"/>'),
    cycle: SV('<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>'), compare: SV('<path d="M4 19h16M7 15l3-4 3 2 4-6"/>'),
    journal: SV('<path d="M6 3h10l3 3v15H6z"/><path d="M9 10h7M9 14h7M9 18h4"/>'), cal: SV('<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/>'),
    review: SV('<path d="M12 3v9l6.5 4"/><circle cx="12" cy="12" r="8.5"/>'), bell: SV('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
    moon: SV('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'), present: SV('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4M8 20h8"/>'),
    info: SV('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>')
  };
  /* ---------- 시장: 코인 선물 시장 데이터 (서울 서버가 모은 바이낸스 펀딩비·미결제약정·롱숏 비율) ---------- */
  function loadDeriv() {
    if (S.dvLoading || (S.dvAt && Date.now() - S.dvAt < 10 * 60e3)) return;
    S.dvLoading = true;
    fetch('https://raw.githubusercontent.com/' + futRepo() + '/deriv-data/deriv.json?t=' + Math.floor(Date.now() / 6e5), { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((j) => { S.dvLoading = false; S.dvAt = Date.now(); if (j && j.coins) { S.dv = j; if (['explore', 'home'].indexOf(route()) >= 0) render(); } });
  }
  function derivCard() {
    loadDeriv();
    const D = S.dv; if (!D) return '';
    const NM = { BTC: '비트코인', ETH: '이더리움', SOL: '솔라나', XRP: '엑스알피', DOGE: '도지코인', BNB: '바이낸스코인', ADA: '에이다', LINK: '체인링크' };
    const lastV = (S2) => { if (!S2 || !S2.v || !S2.v.length) return null; for (let i = S2.v.length - 1; i >= 0; i--) if (S2.v[i] != null) return [i, S2.v[i]]; return null; };
    const rows = Object.keys(NM).filter((c) => D.coins[c]).map((c) => { const C = D.coins[c], f = C.f.length ? C.f[C.f.length - 1][1] * 100 : null, o = lastV(C.oi), ls = lastV(C.ls);
      const oi24 = o && o[0] >= 24 && C.oi.v[o[0] - 24] ? (o[1] / C.oi.v[o[0] - 24] - 1) * 100 : null;
      return { c, name: NM[c], f, oi24, ls: ls ? ls[1] : null }; });
    const hot = rows.filter((r) => r.f != null && r.f >= 0.03), cold = rows.filter((r) => r.f != null && r.f < 0);
    return `<section class="card"><div class="card-head"><h2>코인 선물 시장</h2><span class="muted xs">바이낸스 · ${kDate(D.updatedAt)}</span></div>
      <p class="muted xs">펀딩비가 높으면 롱이 과열(롱이 숏에게 돈을 냄), 마이너스면 숏이 과열이에요. 롱숏 비율 1보다 크면 개인 계정이 롱 쪽에 많아요.</p>
      <div class="ftbl-wrap"><table class="ftbl num"><thead><tr><th>코인</th><th>펀딩비(8시간)</th><th>미결제약정 하루</th><th>롱숏 비율</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="${r.f >= 0.03 ? 'up' : r.f < 0 ? 'down' : ''}">${r.f == null ? '—' : r.f.toFixed(4) + '%'}</td><td class="${dirClass(r.oi24)}">${r.oi24 == null ? '—' : sign(r.oi24, 1) + '%'}</td><td>${r.ls == null ? '—' : r.ls.toFixed(2)}</td></tr>`).join('')}</tbody></table></div>
      <p class="sm" style="margin-top:8px">${hot.length ? '롱 과열: <b>' + hot.map((r) => esc(r.name)).join(', ') + '</b> — 급락(롱 청산)에 주의해요. ' : ''}${cold.length ? '숏 과열: <b>' + cold.map((r) => esc(r.name)).join(', ') + '</b> — 급반등(숏 청산)이 나올 수 있어요.' : ''}${!hot.length && !cold.length ? '지금은 한쪽으로 크게 쏠린 코인이 없어요.' : ''}</p>
      <p class="muted xs">민경기 봇은 이 데이터도 학습 재료로 써요.</p></section>`;
  }
  function viewExplore() {
    return `<header class="top"><div><p class="kicker">종목과 시장 찾아보기</p><h1>시장</h1></div>${tools()}</header>
      ${tape()}
      ${derivCard()}
      <section class="card"><h2>종목 고르기</h2>
        ${lrow('#rank', IC.rank, '오늘의 종목 순위', '나스닥·S&P500·코스피·코스닥 TOP 10')}
        ${lrow('#score', IC.score, '종목 분석', '이름만 넣으면 1~100점 오각형 분석')}
        ${lrow('#coin', IC.coin, '코인 분석', '조건 33개와 분할 매수 계획')}</section>
      <section class="card"><h2>시장 공부</h2>
        ${lrow('#world', IC.world, '세계 돈의 지도', '부동산·금·달러·비트코인의 크기와 환율')}
        ${lrow('#cycle', IC.cycle, '테마 사이클', '돈은 지금 어디서 어디로')}
        ${lrow('#compare', IC.compare, '1년 성적표', '1년 전 1,000만 원을 넣었다면')}
        ${lrow('#quants', IC.info, '월가 퀀트는 어떻게 하나', '르네상스·투시그마·제인스트리트 방식과 이 앱')}</section>
      ${policyCard()}`;
  }
  /* ---------- 화면: 더보기 ---------- */


  /* ---------- 월가 퀀트 회사들은 어떻게 하나 (공개된 원칙 → 우리 앱에서 따라 한 것) ---------- */
  const QUANTS = [
    { name: '르네상스 테크놀로지', what: '수학자·물리학자가 아주 작은 통계 패턴을 수천 개 찾아 짧게 많이 거래해요. 하나하나는 약해도 합치면 강해요.', open: '모델은 완전 비공개 (외부 투자자도 못 들어감)', ours: '규칙을 만들 때 안 본 기간으로 다시 시험(표본 밖 검증), 크게 오른 종목을 빼고도 버는지 확인(승자 제외 검사)', href: '#paper' },
    { name: '투 시그마', what: '뉴스·위성사진·날씨 같은 다양한 데이터를 AI로 분석해요.', open: '일부 연구 도구만 공개, 매매 모델은 비공개', ours: '가격 말고도 금리·물가(FRED·ECOS)·환율·공포지수를 같이 봐요. 여러 AI(Claude·Gemini·GPT)에게 같은 자료를 주고 의견을 모아요.', href: '#explore' },
    { name: 'D.E. 쇼 · 시타델', what: '전략을 여러 개 동시에 돌리고, 전략마다 잃어도 되는 한도를 엄격하게 정해요.', open: '비공개', ours: '봇 여러 개를 나눠 돌리고, 모든 봇에 같은 안전 규칙(한 종목 15%, 하루 -3%, 낙폭 정지)을 걸었어요.', href: '#paper' },
    { name: '추세추종 펀드 (AQR · 맨 AHL 등)', what: '오르는 건 따라 사고 꺾이면 빠지는 단순한 규칙을 수십 년 지켜요. 논문으로 방법이 공개돼 있어요.', open: '방법은 논문으로 공개', ours: 'ATLAS·ORBIT·NOVA·FLUX가 이 방식이에요. 흔들림이 크면 크기를 줄이는 것(변동성 조절)도 넣었어요.', href: '#paper' },
    { name: '제인 스트리트 · 초단타(HFT)', what: '100만 분의 1초 단위로 사고팔며 호가 차이에서 조금씩 벌어요. 거래소 바로 옆에 서버를 둬요.', open: '비공개 · 개인은 따라 할 수 없음', ours: '따라 하지 않아요. 개인은 속도로 이길 수 없어서, 대신 15분봉 단타에서 "수수료를 이기는가"를 솔직하게 시험해요.', href: '#scalp' }
  ];
  function viewQuants() {
    return `<header class="top"><div><a href="#explore" class="back">‹ 시장</a><p class="kicker">공개된 원칙만 따라 했어요</p><h1>월가 퀀트는 어떻게 하나</h1></div>${tools()}</header>
      <section class="card note"><p class="sm">이 회사들의 매매 프로그램과 학습된 AI는 <b>모두 비공개</b>라 돈을 내도 쓸 수 없어요. 대신 논문·인터뷰로 알려진 원칙을 이 앱에 넣었어요.</p></section>
      ${QUANTS.map((q) => `<section class="card"><h2>${esc(q.name)}</h2>
        <p class="sm">${esc(q.what)}</p>
        <div class="kv sc-coin"><span>공개</span><b class="sm">${esc(q.open)}</b></div>
        <p class="sm" style="margin-top:8px"><b>이 앱에서는</b> ${esc(q.ours)}</p>
        <a class="lrow-mini" href="${q.href}" style="margin:8px 0 0">관련 화면 보기 ›</a></section>`).join('')}
      <section class="card note"><p class="b">결론</p><p class="muted sm">이 회사들의 진짜 강점은 비밀 공식보다 <b>철저한 검증과 손실 관리</b>예요. 그래서 이 앱도 "얼마 벌까"보다 "규칙이 진짜인지, 얼마나 잃을 수 있는지"를 먼저 보여줘요.</p></section>`;
  }

  /* ---------- 처음 안내 · 쉬운 용어 사전 ---------- */
  function guideCard() {
    let done = false; try { done = !!localStorage.getItem('snw.guide'); } catch (err) { /* 무시 */ }
    if (done) return '';
    return `<section class="card guide"><p class="b">처음 오셨나요? 이렇게 보면 돼요</p>
      <ol class="guide-list"><li><b>AI 자동매매</b> — 봇들이 코인 선물(롱·숏)을 24시간 가상 돈 1억으로 자동 매매해요. 실제 돈은 움직이지 않아요.</li>
      <li><b>민경기 봇</b> — 검증된 추세 규칙에 학습 모델을 더한 대표 봇이에요. 시험에 합격해야만 크게 들어가요.</li>
      <li><b>포지션</b> — 지금 들고 있는 롱·숏과 손익이에요. 손절선이 미리 정해져 있어요.</li>
      <li><b>시장</b>·<b>내 자산</b> — 코인 선물 시장 분위기, 내 실제 자산과 할 일을 봐요.</li></ol>
      <p class="muted xs">모르는 말은 더보기 → <a href="#words">쉬운 용어 사전</a>에서 찾아보세요.</p>
      <button class="btn primary" data-act="guide-done">알겠어요</button></section>`;
  }
  const WORDS = [
    ['손절', '정해둔 만큼 떨어지면 손해를 받아들이고 파는 것. 더 큰 손실을 막는 안전벨트예요.'],
    ['낙폭 (최대 낙폭)', '가장 높았을 때보다 얼마나 떨어졌는지. -20%면 1억이 8천만 원까지 내려갔다는 뜻이에요.'],
    ['분할 매수', '한 번에 다 사지 않고 몇 번에 나눠 사는 것. 타이밍 실수를 줄여요.'],
    ['비중', '내 전체 자산 중 그 종목이 차지하는 몫. 한 종목이 40%를 넘으면 위험해요.'],
    ['롱 / 숏', '롱은 오르면 버는 쪽, 숏은 내리면 버는 쪽에 거는 거예요. 선물에서만 숏이 돼요.'],
    ['선물 · 무기한 선물', '코인을 직접 사지 않고 가격 오르내림에만 거는 상품. 원금보다 크게 잃을 수 있어요.'],
    ['레버리지', '내 돈보다 크게 거는 배수. 3배면 1% 움직일 때 3% 벌거나 잃어요.'],
    ['청산 (강제 청산)', '선물에서 손실이 증거금만큼 커지면 거래소가 강제로 정리하는 것. 돈을 다 잃어요. 그래서 손절을 먼저 걸어요.'],
    ['펀딩비', '선물을 들고 있으면 8시간마다 주고받는 작은 비용. 보통 롱이 내고 숏이 받아요.'],
    ['모의투자', '진짜 돈 대신 가상 돈으로 하는 연습. 결과는 진짜 시세로 계산해요.'],
    ['백테스트', '같은 규칙을 과거 데이터에 돌려 봤을 때의 성적. 과거 성적이 미래를 보장하진 않아요.'],
    ['표본 밖 검증', '규칙을 만들 때 보지 않은 최근 기간으로 다시 시험한 결과. 여기서도 벌어야 믿을 만해요.'],
    ['승률 · 손익비(PF)', '승률은 이긴 거래 비율, 손익비는 번 돈 ÷ 잃은 돈. 손익비가 1보다 커야 결국 남아요.'],
    ['R (위험 단위)', '한 번 거래에서 잃기로 정한 금액. +2R이면 그 금액의 2배를 벌었다는 뜻이에요.'],
    ['이동평균선 (EMA)', '최근 며칠 평균 가격을 이은 선. 가격이 이 선 위면 오르는 흐름이라고 봐요.'],
    ['RSI', '최근에 얼마나 많이 올랐나/내렸나를 0~100으로. 70 넘으면 과열, 30 아래면 과매도.'],
    ['ATR', '하루(또는 한 봉)에 보통 얼마나 움직이는지. 손절 폭을 정할 때 써요.'],
    ['봉 (15분봉·4시간봉·일봉)', '그 시간 동안의 시작·최고·최저·마지막 가격을 막대 하나로 그린 것.'],
    ['샤프 지수', '흔들림에 비해 수익이 얼마나 좋았나. 1이 넘으면 괜찮은 편이에요.'],
    ['CAGR (연평균 수익률)', '여러 해 동안 매년 평균 몇 %씩 불었는지.']
  ,
    ['미결제약정 (OI)', '아직 정리되지 않은 선물 계약의 총액. 늘면서 가격이 오르면 새 돈이 들어오는 상승, 늘면서 내리면 숏이 쌓이는 하락이에요.'],
    ['롱숏 비율', '롱 계정 수 ÷ 숏 계정 수. 개인이 한쪽으로 크게 쏠리면 반대로 움직이는 경우가 많아요.'],
    ['테이커 매수/매도', '시장가로 급하게 사는 쪽과 파는 쪽의 비율. 1보다 크면 급하게 사려는 힘이 더 커요.'],
    ['추적 손절', '이익이 나면 손절선을 따라 올려서(숏은 내려서) 번 돈을 지키는 방법이에요.'],
    ['학습 필터 (메타 라벨링)', '규칙이 뽑은 후보마다 AI 모델이 "이익으로 끝날 확률"을 매겨, 낮은 후보는 건너뛰고 높은 후보는 크게 들어가는 방법이에요. 민경기 봇이 이렇게 해요.'],
    ['워크포워드 시험', '과거 데이터로만 배우고, 바로 다음 기간(처음 보는 데이터)으로 시험하는 걸 계속 밀면서 반복하는 방법. 커닝 없이 실력을 재는 방법이에요.']
  ];
  function viewWords() {
    return `<header class="top"><div><a href="#more" class="back">‹ 더보기</a><p class="kicker">모르는 말을 한 줄로</p><h1>쉬운 용어 사전</h1></div></header>
      <section class="card words">${WORDS.map(([k, v]) => `<div class="word"><p class="b">${esc(k)}</p><p class="sm">${esc(v)}</p></div>`).join('')}</section>`;
  }
  function viewMore() {
    const dark = document.documentElement.dataset.theme === 'dark';
    const tg = (act, on, ic, t, sub) => `<button class="lrow" data-act="${act}" role="switch" aria-checked="${on}"><span class="ic">${ic}</span><span class="grow"><p class="t">${t}</p><p class="s">${sub}</p></span><span class="toggle ${on ? 'on' : ''}"></span></button>`;
    return `<header class="top"><div><h1>더보기</h1></div></header>
      <section class="card menu-group"><h2>내 계좌 · 봇</h2>${lrow('#assets', IC.score, '내 자산', '빗썸·토스증권 실제 보유 자산과 할 일')}${lrow('#stocks', IC.rank, '주식 봇 (모의)', 'ATLAS·ORBIT·NOVA·CHIEF · 10년 검증')}${lrow('#hq', IC.info, '본부', 'BOSS가 봇들이 일을 제대로 하는지 점검')}</section>
      <section class="card menu-group"><h2>내 기록</h2>
        ${lrow('#journal', IC.journal, '투자 일지', '산 이유·판 이유 적고 돌아보기')}
        ${lrow('#calendar', IC.cal, '자산 달력', '하루하루 내 자산 변화')}
        ${lrow('#review', IC.review, '포트폴리오 평가', '투자성향별 비중과 냉정한 점수')}</section>
      <section class="card menu-group"><h2>도움말</h2>
        ${lrow('#words', IC.info, '쉬운 용어 사전', '낙폭·손절·롱숏·레버리지가 뭔지 한 줄로')}
        <button class="lrow" data-act="guide-reset"><span class="ic">${IC.info}</span><span class="grow"><p class="t">처음 안내 다시 보기</p><p class="s">홈에 사용법 안내 카드를 다시 띄워요</p></span></button></section>
      <section class="card menu-group"><h2>알림</h2>
        ${lrow('#alerts', IC.bell, '매수 후보 알림', '휴대폰 알림 켜기·테스트')}</section>
      <section class="card menu-group"><h2>화면</h2>
        ${tg('bigtext', !!(document.documentElement.classList && document.documentElement.classList.contains('big')), IC.info, '글씨 크게', '모든 화면 글씨를 크게')}
        ${tg('theme', dark, IC.moon, '어두운 화면', '밤에 눈이 편하게')}
        ${tg('demo', !!S.demo, IC.present, '발표 모드', '실제 자산 대신 예시 데이터로 보여주기')}</section>
      <section class="card menu-group"><h2>정보</h2>
        <div class="lrow" style="cursor:default"><span class="ic">${IC.info}</span><span class="grow"><p class="t">시장날씨</p><p class="s">시세 ${ML ? esc(ML.asOf) + ' 기준' : '—'} · 투자 권유가 아닌 참고 정보예요</p></span></div></section>`;
  }

  /* ---------- 본부 직원 캐릭터 (모두 직접 디자인한 오리지널) ----------
   * 공통: 말랑한 젤리 몸 + 큰 눈(깜빡임) + 볼터치. 직원마다 색·소품·움직임이 다름.
   * 상태: alert = 땀방울·빠른 흔들림, idle = 졸기(Zzz) */
  const MASCOT = {
    MK:     { c: '#9FD3C7', d: '#78B5A6', look: 'glasses', move: 'type',  w: 24, h: 28 },   // 민경기 봇: 추세 + 학습, 안경 쓰고 계산
    PRICE:  { c: '#8CC4F5', d: '#6AA8E0', look: 'headset', move: 'type',  w: 22, h: 26 },   // 시세 담당: 헤드셋 끼고 자판 두드림
    CHIEF:  { c: '#B9A9F2', d: '#9B88E0', look: 'glasses', move: 'nod',   w: 24, h: 30 },   // 판단 담당: 동그란 안경, 끄덕끄덕
    VAULT:  { c: '#A7B3C2', d: '#8796A8', look: 'lock',    move: 'breath',w: 28, h: 26 },   // 금고: 네모 단단한 몸, 팔짱
    REPORT: { c: '#F6D27A', d: '#E3B954', look: 'clip',    move: 'write', w: 20, h: 24 },   // 보고: 클립보드에 받아 적기
    ATLAS:  { c: '#F4A3A0', d: '#E2827E', look: 'fin',     move: 'hop',   w: 22, h: 28 },   // 추세 돌파: 로켓 지느러미, 통통 점프
    ORBIT:  { c: '#94D8C6', d: '#6FC0AB', look: 'ring',    move: 'sway',  w: 22, h: 26 },   // 모멘텀 순환: 머리 위 고리가 빙글
    NOVA:   { c: '#F2B8D6', d: '#E096BE', look: 'star',    move: 'twinkle', w: 20, h: 24 }, // 코인: 머리 위 별이 반짝
    ECHO:   { c: '#C9CED6', d: '#AEB5BF', look: 'none',    move: 'sleep', w: 20, h: 24 },
    RATE:   { c: '#F5B48A', d: '#E39566', look: 'thermo',  move: 'sway',  w: 22, h: 26 },   // 금리: 온도계
    USD:    { c: '#9FD39B', d: '#7CBB77', look: 'bow',     move: 'nod',   w: 22, h: 26 },   // 달러: 나비넥타이
    VIX:    { c: '#C3B3E8', d: '#A592D6', look: 'none',    move: 'jelly', w: 24, h: 24 },   // 변동성: 젤리처럼 출렁
    MOOD:   { c: '#F7B6B6', d: '#E59393', look: 'heart',   move: 'hop',   w: 20, h: 24 },   // 심리: 하트
    ORDER:  { c: '#B6C0CC', d: '#98A4B2', look: 'cap',     move: 'type',  w: 22, h: 26 },
    GUARD:  { c: '#9EB2CC', d: '#7F96B5', look: 'guard',   move: 'scan',  w: 24, h: 28 },   // 감시: 경비 모자 + 손전등
    COACH:  { c: '#F3C98B', d: '#DFAE66', look: 'whistle', move: 'nod',   w: 22, h: 28 },   // 코치: 호루라기
    FLUX:   { c: '#F2B49C', d: '#DE957A', look: 'bolt',    move: 'dash',  w: 22, h: 28 }    // 선물: 번개 고글, 좌우로 재빠르게
  };
  function mascot(code, x, y, tone, k) {
    const m = MASCOT[code] || { c: '#B9C4D0', d: '#9AA7B5', look: 'none', move: 'bob', w: 22, h: 26 };
    const move = tone === 'idle' ? 'sleep' : m.move, W = m.w, Hh = m.h, top = y - Hh, cx = x, ey = top + Hh * 0.42;
    const delay = 'animation-delay:' + ((k * 0.43) % 2.2).toFixed(2) + 's';
    const sq = code === 'VAULT' ? 7 : W / 2; // 금고는 네모난 몸
    let acc = '', hands = '';
    const armY = top + Hh * 0.66;
    hands = `<g class="mc-arms"><ellipse class="mc-arm l" cx="${cx - W / 2 - 1}" cy="${armY}" rx="3.2" ry="4.2" fill="${m.d}"/><ellipse class="mc-arm r" cx="${cx + W / 2 + 1}" cy="${armY}" rx="3.2" ry="4.2" fill="${m.d}"/></g>`;
    switch (m.look) {
      case 'headset': acc = `<path d="M${cx - W / 2 + 1} ${ey - 2} Q${cx} ${top - 9} ${cx + W / 2 - 1} ${ey - 2}" fill="none" stroke="#4A5565" stroke-width="2"/><rect x="${cx - W / 2 - 2}" y="${ey - 4}" width="4" height="7" rx="2" fill="#4A5565"/><rect x="${cx + W / 2 - 2}" y="${ey - 4}" width="4" height="7" rx="2" fill="#4A5565"/><path d="M${cx + W / 2} ${ey + 2} q-2 7 -7 7" fill="none" stroke="#4A5565" stroke-width="1.4"/>`; break;
      case 'glasses': acc = `<circle cx="${cx - 4.5}" cy="${ey}" r="4" fill="none" stroke="#3E4652" stroke-width="1.3"/><circle cx="${cx + 4.5}" cy="${ey}" r="4" fill="none" stroke="#3E4652" stroke-width="1.3"/><path d="M${cx - 0.6} ${ey} h1.2" stroke="#3E4652" stroke-width="1.3"/><path d="M${cx - 3} ${top + Hh - 6} l3 4 l3 -4 z" fill="#6E5FC9"/>`; break;
      case 'lock': acc = `<rect x="${cx - 4}" y="${top + Hh * 0.62}" width="8" height="6" rx="1.5" fill="#6B7787"/><path d="M${cx - 2.5} ${top + Hh * 0.62} v-2 a2.5 2.5 0 0 1 5 0 v2" fill="none" stroke="#6B7787" stroke-width="1.3"/><path d="M${cx - 9} ${ey - 6} l5 2 M${cx + 9} ${ey - 6} l-5 2" stroke="#3E4652" stroke-width="1.4" stroke-linecap="round"/>`; hands = `<path d="M${cx - 10} ${armY} q10 5 20 0" fill="none" stroke="${m.d}" stroke-width="5" stroke-linecap="round"/>`; break;
      case 'clip': acc = `<path d="M${cx - 1} ${top - 1} q-3 -6 2 -8" fill="none" stroke="${m.d}" stroke-width="2" stroke-linecap="round"/>`; hands = `<g class="mc-arms"><rect class="mc-clip" x="${cx + W / 2 - 3}" y="${armY - 7}" width="9" height="11" rx="1.5" fill="#fff" stroke="#9AA3AE" stroke-width="1"/><ellipse class="mc-arm r mc-pen" cx="${cx + W / 2 + 1}" cy="${armY}" rx="3" ry="4" fill="${m.d}"/><ellipse cx="${cx - W / 2 - 1}" cy="${armY}" rx="3" ry="4" fill="${m.d}"/></g>`; break;
      case 'fin': acc = `<path d="M${cx} ${top - 7} l5 7 h-10 z" fill="#E2827E"/><circle cx="${cx}" cy="${top + Hh * 0.75}" r="2.4" fill="#fff" opacity=".85"/>`; break;
      case 'ring': acc = `<g class="mc-ring"><ellipse cx="${cx}" cy="${top - 4}" rx="10" ry="3" fill="none" stroke="#5FAE98" stroke-width="2"/><circle cx="${cx + 10}" cy="${top - 4}" r="1.8" fill="#5FAE98"/></g>`; break;
      case 'star': acc = `<path class="mc-star" d="M${cx} ${top - 12} l2 4.2 4.6 .6 -3.4 3.2 .9 4.6 -4.1 -2.3 -4.1 2.3 .9 -4.6 -3.4 -3.2 4.6 -.6z" fill="#F5C451"/>`; break;
      case 'thermo': acc = `<rect x="${cx - 1.6}" y="${top - 10}" width="3.2" height="10" rx="1.6" fill="#fff" stroke="#C97B4E" stroke-width="1"/><circle cx="${cx}" cy="${top + 0.5}" r="2.6" fill="#E0664F"/><rect class="mc-merc" x="${cx - 0.8}" y="${top - 7}" width="1.6" height="7" fill="#E0664F"/>`; break;
      case 'bow': acc = `<path d="M${cx} ${top + Hh * 0.68} l-5 -3 v6 z M${cx} ${top + Hh * 0.68} l5 -3 v6 z" fill="#3E8E5A"/><circle cx="${cx}" cy="${top + Hh * 0.68}" r="1.4" fill="#2F6E45"/>`; break;
      case 'heart': acc = `<path class="mc-heart" d="M${cx} ${top - 3} c-2 -3 -6 -2 -5 1.5 c.6 2 5 4.5 5 4.5 s4.4 -2.5 5 -4.5 c1 -3.5 -3 -4.5 -5 -1.5z" fill="#E86B7A"/>`; break;
      case 'cap': acc = `<path d="M${cx - W / 2 + 1} ${top + 4} q${W / 2 - 1} -9 ${W - 2} 0 z" fill="#6B7787"/><rect x="${cx - 2}" y="${top - 2}" width="12" height="3" rx="1.5" fill="#6B7787"/>`; break;
      case 'guard': acc = `<path d="M${cx - W / 2} ${top + 5} q${W / 2} -11 ${W} 0 z" fill="#2F4058"/><rect x="${cx - W / 2 - 1}" y="${top + 3}" width="${W + 2}" height="3" rx="1.5" fill="#2F4058"/><circle cx="${cx}" cy="${top}" r="1.6" fill="#F5C451"/>`; hands = `<g class="mc-arms"><ellipse cx="${cx - W / 2 - 1}" cy="${armY}" rx="3.2" ry="4.2" fill="${m.d}"/><g class="mc-torch"><rect x="${cx + W / 2 - 1}" y="${armY - 2}" width="7" height="3.6" rx="1" fill="#4A5565"/><path d="M${cx + W / 2 + 6} ${armY - 1} l14 -6 v14 z" fill="#FFE9A6" opacity=".55"/></g></g>`; break;
      case 'bolt': acc = `<path class="mc-bolt" d="M${cx + 1} ${top - 13} l-5 8 h4 l-3 7 l8 -10 h-4 l3 -5 z" fill="#F5C451" stroke="#D9A62E" stroke-width=".6"/><rect x="${cx - 10}" y="${ey - 4.5}" width="20" height="8" rx="4" fill="#fff" fill-opacity=".35" stroke="#C77B5C" stroke-width="1.2"/>`; break;
      case 'whistle': acc = `<path d="M${cx - 6} ${top + 6} q6 10 12 0" fill="none" stroke="#C9302C" stroke-width="1"/><rect x="${cx - 2}" y="${top + Hh * 0.6}" width="6" height="3.6" rx="1.6" fill="#9AA3AE"/><path d="M${cx - W / 2} ${top + 4} q${W / 2} -10 ${W} 0 z" fill="#E86B5A"/>`; break;
    }
    const eyes = `<g class="mc-eyes" style="${delay}"><ellipse cx="${cx - 4.5}" cy="${ey}" rx="2.3" ry="2.8" fill="#2B2F36"/><ellipse cx="${cx + 4.5}" cy="${ey}" rx="2.3" ry="2.8" fill="#2B2F36"/><circle cx="${cx - 3.7}" cy="${ey - 1}" r=".8" fill="#fff"/><circle cx="${cx + 5.3}" cy="${ey - 1}" r=".8" fill="#fff"/></g>`;
    const sleepEyes = `<path d="M${cx - 7} ${ey} q2.5 2 5 0 M${cx + 2} ${ey} q2.5 2 5 0" fill="none" stroke="#2B2F36" stroke-width="1.4" stroke-linecap="round"/>`;
    const mouth = tone === 'alert' ? `<ellipse cx="${cx}" cy="${ey + 6}" rx="1.8" ry="1.4" fill="#2B2F36"/>` : `<path d="M${cx - 2.4} ${ey + 5} q2.4 2.4 4.8 0" fill="none" stroke="#2B2F36" stroke-width="1.2" stroke-linecap="round"/>`;
    const cheeks = `<ellipse cx="${cx - 8}" cy="${ey + 4}" rx="2.4" ry="1.4" fill="#FF9AA8" opacity=".55"/><ellipse cx="${cx + 8}" cy="${ey + 4}" rx="2.4" ry="1.4" fill="#FF9AA8" opacity=".55"/>`;
    const extra = tone === 'alert' ? `<path class="mc-sweat" d="M${cx + W / 2 + 2} ${top + 2} q2.5 4 0 5.5 q-2.5 -1.5 0 -5.5z" fill="#8CC9F0"/>` : move === 'sleep' ? `<g class="mc-zzz"><text x="${cx + 10}" y="${top - 2}">z</text><text x="${cx + 15}" y="${top - 9}" class="z2">z</text></g>` : '';
    return `<g class="mc mv-${move} ${tone || ''}" style="${delay}">
      <ellipse cx="${cx}" cy="${y + 1}" rx="${W / 2 + 1}" ry="3.6" class="hq-shadow"/>
      <g class="mc-bod">
        ${hands}
        <rect x="${cx - W / 2}" y="${top}" width="${W}" height="${Hh}" rx="${sq}" fill="${m.c}"/>
        <ellipse cx="${cx}" cy="${top + Hh * 0.78}" rx="${W * 0.3}" ry="${Hh * 0.16}" fill="#fff" opacity=".35"/>
        ${move === 'sleep' ? sleepEyes : eyes}${cheeks}${mouth}${acc}
      </g>${extra}</g>`;
  }


  /* ---------- 총책임자 BOSS: 오리지널 강아지 캐릭터 ----------
   * 크림색 몸 + 갈색 늘어진 귀 + 한쪽 눈 얼룩 + 남색 넥타이 + 돋보기. 꼬리는 늘 살랑살랑. */
  function bossSvg(icon) {
    const dog = `<g class="boss-dog">
      <ellipse cx="0" cy="1" rx="12" ry="3.4" class="hq-shadow"/>
      <path class="boss-tail" d="M9 -11 q8 -3 7 -10 q-1 -3 -3 -1" fill="none" stroke="#C99A6B" stroke-width="3.2" stroke-linecap="round"/>
      <rect class="boss-leg a" x="-8" y="-6" width="4.6" height="7" rx="2.3" fill="#EAD6B8"/>
      <rect class="boss-leg b" x="3.6" y="-6" width="4.6" height="7" rx="2.3" fill="#EAD6B8"/>
      <ellipse cx="0" cy="-10" rx="11" ry="8.5" fill="#F4E6CF"/>
      <path d="M-2.4 -17 h4.8 l-1 2 l1.6 6 l-3 2.4 l-3 -2.4 l1.6 -6 z" fill="#3B4A6B"/>
      <circle cx="0" cy="-25" r="11.5" fill="#F8EEDC"/>
      <ellipse class="boss-ear l" cx="-10.5" cy="-24" rx="4.2" ry="7.5" fill="#B98A5E" transform="rotate(18 -10.5 -24)"/>
      <ellipse class="boss-ear r" cx="10.5" cy="-24" rx="4.2" ry="7.5" fill="#B98A5E" transform="rotate(-18 10.5 -24)"/>
      <ellipse cx="4.6" cy="-26.4" rx="4.4" ry="3.8" fill="#E6CBA5"/>
      <g class="boss-eyes"><ellipse cx="-4.2" cy="-26" rx="1.9" ry="2.3" fill="#2B2F36"/><ellipse cx="4.6" cy="-26" rx="1.9" ry="2.3" fill="#2B2F36"/><circle cx="-3.6" cy="-26.8" r=".7" fill="#fff"/><circle cx="5.2" cy="-26.8" r=".7" fill="#fff"/></g>
      <ellipse cx="0.3" cy="-21.6" rx="2.3" ry="1.6" fill="#3A3030"/>
      <path d="M-2.4 -19.4 q1.3 1.4 2.7 0 q1.4 1.4 2.7 0" fill="none" stroke="#3A3030" stroke-width="1" stroke-linecap="round"/>
      <ellipse cx="-8" cy="-21" rx="2.3" ry="1.3" fill="#FF9AA8" opacity=".55"/><ellipse cx="8.4" cy="-21" rx="2.3" ry="1.3" fill="#FF9AA8" opacity=".55"/>
      <g class="boss-glass"><path d="M9 -8 l5 -4" stroke="#6B7787" stroke-width="2" stroke-linecap="round"/><circle cx="16" cy="-14" r="4.6" fill="#E6F2FF" fill-opacity=".7" stroke="#6B7787" stroke-width="1.6"/></g>
    </g>`;
    if (icon) return `<svg viewBox="-22 -40 44 44" width="46" height="46" aria-hidden="true">${dog}</svg>`;
    return dog;
  }
  const PATROL = { on: false, room: 0, wait: (ms) => new Promise((r) => setTimeout(r, ms)) };
  function startPatrol() {
    if (PATROL.on) return;
    PATROL.on = true;
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const P = (i, j) => [200 + (i - j) * 34, 112 + (i + j) * 17];
    const alive = () => route() === 'hq' && document.querySelector('.hq-svg');
    const status = (t) => { PATROL.msg = t; const e = document.getElementById("hq-patrol"); if (e) e.textContent = t; };
    const getBoss = (svg) => {
      let g = svg.querySelector('.hq-boss');
      if (!g) {
        g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'hq-boss');
        g.innerHTML = `<g class="boss-flip"><g transform="scale(1.4)">${bossSvg()}</g></g><g class="boss-say" style="opacity:0"><rect x="-44" y="-78" width="88" height="19" rx="9.5"/><text x="0" y="-64.5" text-anchor="middle"></text></g><text class="hq-name boss-name" x="0" y="15" text-anchor="middle">BOSS</text>`;
        svg.appendChild(g);
      }
      return g;
    };
    const place = (g, x, y, ms) => { g.style.transition = ms ? `transform ${ms}ms linear, opacity .4s` : 'opacity .4s'; g.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`; g._x = x; g._y = y; };
    const walk = async (svgSel, x, y) => {
      const svg = document.querySelectorAll('.hq-svg')[svgSel]; if (!svg) return;
      const g = getBoss(svg), dx = x - (g._x ?? x), dy = y - (g._y ?? y);
      const ms = reduce ? 0 : Math.max(300, Math.hypot(dx, dy) / 0.075);
      g.querySelector('.boss-flip').style.transform = dx < -1 ? 'scaleX(-1)' : 'scaleX(1)';
      g.classList.add('walk'); place(g, x, y, ms); await PATROL.wait(ms + 60); g.classList.remove('walk');
    };
    const say = async (svgSel, text, warn, code) => {
      const svg = document.querySelectorAll('.hq-svg')[svgSel]; if (!svg) return;
      const g = getBoss(svg), b = g.querySelector('.boss-say'), w = Math.min(150, 22 + text.length * 10.5);
      b.querySelector('rect').setAttribute('x', -w / 2); b.querySelector('rect').setAttribute('width', w);
      b.querySelector('text').textContent = text; b.classList.toggle('warn', warn === 'warn'); b.classList.toggle('fail', warn === 'fail'); b.style.opacity = 1;
      g.classList.add('check');
      const st = code && svg.querySelector(`.hq-p[data-code="${code}"]`); if (st) st.classList.add('checked');
      await PATROL.wait(2600);
      b.style.opacity = 0; g.classList.remove('check'); if (st) st.classList.remove('checked');
      await PATROL.wait(250);
    };
    (async () => {
      await PATROL.wait(700);
      while (alive()) {
        const svgs = document.querySelectorAll('.hq-svg');
        const k = PATROL.room % svgs.length, svg = svgs[k];
        const name = svg.dataset.room || '';
        const staff = (svg.dataset.patrol || '').split('|').filter(Boolean).map((t) => { const [code, i, j, tone, locked] = t.split(':'); return { code, i: +i, j: +j, tone, locked: locked === '1' }; });
        const g = getBoss(svg), [ex, ey] = P(2, 4.3);
        place(g, ex, ey + 10, 0); g.style.opacity = 0; await PATROL.wait(50); g.style.opacity = 1;
        status(`${name} 점검 중…`);
        await walk(k, ex, ey);
        let warn = 0, sleep = 0;
        for (const s of staff) {
          if (!alive()) break;
          const [x, y] = P(s.i + 1.3, s.j + 0.9);
          await walk(k, x, y);
          const a = HQ_AUDIT[name + '|' + s.code];
          status(`${name} · ${s.code} 점검: ${a ? a.ev : '맡은 일 정보 없음'}`);
          let t = a ? (a.st === 'ok' ? '확인 ✓ ' : a.st === 'fail' ? '일 안 됨! ' : a.st === 'warn' ? '사장님 확인! ' : '') + a.short : '정보 없음', w = a && (a.st === 'fail' || a.st === 'warn') ? a.st : '';
          if (a && a.st === 'fail') warn++; else if (a && a.st === 'warn') sleep++;
          await PATROL.wait(400);
          await say(k, t, w, s.code);
        }
        await walk(k, ex, ey);
        const gg = getBoss(document.querySelectorAll('.hq-svg')[k] || svg); gg.style.opacity = 0;
        status(`${name} 점검 끝 · ${warn ? '문제 ' + warn + '명' : ''}${warn && sleep ? ' · ' : ''}${sleep ? '확인 필요 ' + sleep + '명' : ''}${!warn && !sleep ? '모두 맡은 일 정상' : ''} → 다음 방으로`);
        await PATROL.wait(1400);
        PATROL.room++;
      }
      PATROL.on = false;
    })();
  }

  /* ===================== 본부(HQ): 방 4개 ===================== */
  // 아이소메트릭 방 하나를 SVG 로 그림. staff: [{code, name, say, tone, i, j}] (i,j = 바닥 칸 0~3)
  function isoRoom(o) {
    const P = (i, j, z) => [200 + (i - j) * 34, 112 + (i + j) * 17 - (z || 0)];
    const pt = (a) => a.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    const floor = [P(-0.5, -0.5), P(4.5, -0.5), P(4.5, 4.5), P(-0.5, 4.5)];
    const H = 86;
    const wallL = [P(-0.5, 4.5), P(-0.5, -0.5), P(-0.5, -0.5, H), P(-0.5, 4.5, H)];
    const wallR = [P(-0.5, -0.5), P(4.5, -0.5), P(4.5, -0.5, H), P(-0.5, -0.5, H)];
    // 오른쪽 벽 모니터 + 그래프
    const s0 = P(1.0, -0.5, 74), s1 = P(3.8, -0.5, 74), s2 = P(3.8, -0.5, 38), s3 = P(1.0, -0.5, 38);
    let spark = '';
    const ys = (o.series || []).filter((v) => isFinite(v));
    if (ys.length > 2) {
      const mn = Math.min(...ys), mx = Math.max(...ys), rg = mx - mn || 1;
      spark = ys.map((v, k) => { const t = k / (ys.length - 1); const x = s3[0] + (s2[0] - s3[0]) * t, yb = s3[1] + (s2[1] - s3[1]) * t; return x.toFixed(1) + ',' + (yb - 8 - (v - mn) / rg * 28).toFixed(1); }).join(' ');
    }
    // 왼쪽 벽 방 이름 (벽 기울기에 맞춰 기울임)
    const n0 = P(-0.5, 4.0, 62);
    const desk = (i, j) => { const a = P(i - 0.32, j - 0.32, 14), b = P(i + 0.32, j - 0.32, 14), c = P(i + 0.32, j + 0.32, 14), d = P(i - 0.32, j + 0.32, 14), e = P(i + 0.32, j + 0.32), f = P(i - 0.32, j + 0.32), g = P(i + 0.32, j - 0.32);
      return `<polygon class="hq-desk-top" points="${pt([a, b, c, d])}"/><polygon class="hq-desk-side" points="${pt([d, c, e, f])}"/><polygon class="hq-desk-side2" points="${pt([c, b, g, e])}"/>`; };
    const person = (s, k) => {
      const [x, y] = P(s.i - 0.05, s.j + 0.55, 0);
      const bw = Math.min(120, 18 + s.say.length * 10.6);
      return `<g class="hq-p ${s.tone || ''}" data-code="${esc(s.code)}">
        <g transform="translate(${x} ${y}) scale(1.35) translate(${-x} ${-y})">${mascot(s.code, x, y, s.tone, k)}</g>
        ${s.say ? `<g class="hq-say"><rect x="${x - bw / 2}" y="${y - 72}" width="${bw}" height="18" rx="9"/><text x="${x}" y="${y - 59.5}" text-anchor="middle">${esc(s.say)}</text></g>` : ''}
        <text x="${x}" y="${y + 17}" text-anchor="middle" class="hq-name">${esc(s.code)}</text></g>`;
    };
    const staff = (o.staff || []).slice().sort((a, b) => (a.i + a.j) - (b.i + b.j));
    const route = (o.staff || []).map((s) => [s.code, s.i, s.j, s.tone || '', o.locked ? 1 : 0].join(':')).join('|');
    return `<svg class="hq-svg" viewBox="0 0 400 300" role="img" aria-label="${esc(o.title)} 방" data-room="${esc(o.title)}" data-patrol="${esc(route)}">
      <polygon class="hq-floor" points="${pt(floor)}"/>
      <polygon class="hq-wall-l" points="${pt(wallL)}"/><polygon class="hq-wall-r" points="${pt(wallR)}"/>
      <polygon class="hq-screen" points="${pt([s0, s1, s2, s3])}"/>
      ${spark ? `<polyline class="hq-spark ${o.sparkCls || ''}" points="${spark}"/>` : ''}
      <text class="hq-room-name" transform="translate(${n0[0]},${n0[1]}) skewY(-26.57)">${esc(o.wallName || '')}</text>
      ${o.locked ? `<g class="hq-lock"><rect x="176" y="150" width="48" height="30" rx="8"/><path d="M188 150v-8a12 12 0 0 1 24 0v8" fill="none"/><circle cx="200" cy="165" r="3.5"/></g>` : ''}
      ${staff.map((s) => desk(s.i, s.j)).join('')}
      ${staff.map(person).join('')}
    </svg>`;
  }


  /* ---------- 공시 위험 확인 (DART·SEC) ---------- */
  function loadFilings() {
    if (S.filLoading || S.fil) return;
    S.filLoading = true;
    fetch('data/filings-live.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((j) => { S.filLoading = false; if (j && j.items) { S.fil = j; if (['paper', 'hq', 'assets'].indexOf(route()) >= 0) render(); } });
  }
  const filLine = (f) => `<p class="xs news-line"><span class="act ${f.level === 'bad' ? 'warn' : f.level === 'good' ? 'live' : 'neu'}">${f.level === 'bad' ? '주의' : f.level === 'good' ? '호재' : '공시'}</span> ${esc(f.date.slice(5).replace('-', '/'))} ${esc(f.note ? f.note + ' · ' + f.title : f.title)}${f.url ? ` <a href="${esc(f.url)}" target="_blank" rel="noopener">원문</a>` : ''}</p>`;
  const normFid = (id) => String(id || '').toUpperCase().replace(/^A(?=\d{6})/, '').replace(/[-.](KS|KQ)$/, '');
  // 내 보유 종목 공시: 서버 동기화가 잠가서 보낸 결과(LIVE.filings)를 먼저, 없으면 매일 분석 결과(공개 종목만)
  function myFil(sym) {
    const id = normFid(sym), mine = LIVE && LIVE.filings && LIVE.filings.items ? LIVE.filings.items.find((x) => x.id === id) : null;
    return mine || filOf(id) || null;
  }
  function filChip(h) {
    if (h.type !== 'stock') return '';
    const x = myFil(h.symbol); if (!x || (!x.bad && !x.good)) return '';
    const list = x.filings.filter((f) => f.level !== 'info').slice(0, 4);
    return `<details class="fil-chip"><summary><span class="act ${x.bad ? 'warn' : 'live'}">${x.bad ? '공시 주의 ' + x.bad : '호재 공시'}</span></summary>${list.map(filLine).join('')}</details>`;
  }
  function myFilCard(stocks) {
    if (S.demo || !stocks.length) return '';
    const F = LIVE && LIVE.filings;
    if (!F) return REAL ? `<section class="card note"><p class="b">내 주식 공시 확인</p><p class="muted xs">서버 동기화에 공시 확인을 켜면, 갖고 있는 주식의 최근 30일 공시(유상증자·전환사채·감사의견·상장폐지 등)를 매번 같이 확인해요.</p></section>` : '';
    const bad = F.items.filter((x) => x.bad), got = F.items.filter((x) => x.checked).length;
    const when = new Date(F.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    return `<section class="card"><h2>내 주식 공시 확인</h2>
      ${bad.length ? bad.map((x) => `<div class="fil"><div class="row between"><p class="b">${esc(x.name)} <span class="muted xs">${esc(x.id)} · ${x.src}</span></p><span class="act warn">위험 공시 ${x.bad}</span></div>${x.filings.filter((f) => f.level === 'bad').slice(0, 3).map(filLine).join('')}</div>`).join('')
        : '<p class="sm">최근 30일 동안 주가에 나쁠 수 있는 공시는 없어요 ✓</p>'}
      <p class="muted xs" style="margin-top:6px">${when} 확인 · ${F.items.length}종목 중 ${got}종목 공시 받음${got < F.items.length ? ' (한국 주식은 서버에 DART 키가 있어야 확인돼요)' : ''}</p>
      <p class="muted xs">공시가 있다고 꼭 팔아야 하는 건 아니에요. 원문을 읽고, 이유를 모르겠으면 비중을 늘리지 않는 게 안전해요.</p></section>`;
  }
  const filOf = (id) => S.fil && S.fil.items.find((x) => x.id === String(id).toUpperCase().replace(/^A(?=\d{6})/, '').replace(/[-.](KS|KQ)$/, ''));
  function filingsCard() {
    loadFilings();
    const F = S.fil; if (!F || !F.items.length) return '';
    const bad = F.items.filter((x) => x.bad), good = F.items.filter((x) => !x.bad && x.good), checked = F.items.filter((x) => x.checked).length;
    const line = filLine;
    const item = (x) => `<div class="fil"><div class="row between"><p class="b">${esc(x.name)} <span class="muted xs">${esc(x.id)} · ${x.src}</span></p>${x.bad ? `<span class="act warn">위험 공시 ${x.bad}</span>` : x.good ? '<span class="act live">호재 공시</span>' : ''}</div>
      <p class="muted xs" style="margin:2px 0 0">${esc(x.why.join(' · '))}</p>${x.filings.filter((f) => f.level !== 'info').slice(0, 3).map(line).join('')}</div>`;
    return `<section class="card"><h2>살 만한 종목 공시 확인</h2>
      <p class="muted xs">봇 보유·주문 대기·매수 후보·앱 점수 상위 ${F.items.length}종목의 최근 30일 공시를 DART(한국)·SEC(미국)에서 확인했어요. 유상증자·전환사채·감사의견·상장폐지 같은 공시는 주가에 나쁠 수 있어요.</p>
      ${bad.length ? bad.map(item).join('') : '<p class="sm" style="margin-top:8px">위험 공시가 있는 종목은 없어요 ✓</p>'}
      ${good.length ? `<details class="pro-inline"><summary>호재 공시 ${good.length}종목 보기</summary>${good.map(item).join('')}</details>` : ''}
      <p class="muted xs" style="margin-top:6px">${new Date(F.generatedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })} 확인 · ${checked}종목 공시 받음</p></section>`;
  }

  // 모의투자 방 기록: 지금 후보 종목과 이유 (단타·선물·주식 봇 모두)
  function paperCands(PP) {
    const out = [], SD = { long: '롱', short: '숏' }, V = { enter: '진입', skip: '건너뜀', error: '응답 실패', late: '늦어서 건너뜀', nokey: '키 없음' };
    loadScalp();
    const D = S.sc;
    if (D) {
      const lg = (D.log || [])[0];
      const pick = (list, c) => (list || []).find((d) => d.name + ' ' + SD[d.side] === c);
      // 지금 봉의 후보 → 계좌별 판단
      (lg ? lg.cands : []).forEach((c) => {
        const a = pick(D.decisions, c), b = D.bold && pick(D.bold.decisions, c), m = D.major && pick(D.major.decisions, c);
        const parts = [a && '조심형 ' + V[a.decision], b && '적극형 ' + V[b.decision], m && '다수결 ' + (m.reason || V[m.decision])].filter(Boolean);
        const why = (a && a.reason) || (b && b.reason) || '';
        out.push({ cls: '', html: `<b>단타</b> ${esc(c)} <span class="muted">${scT(lg.t, 15)}</span>${parts.length ? ' · ' + esc(parts.join(' · ')) : ' · 판단 대기'}`, why: esc(why) });
      });
      // 최근 결정 (지금 후보가 없을 때도 무엇을 봤는지 보이게)
      const recent = [].concat((D.decisions || []).map((d) => ({ ...d, who: '조심형' })), ((D.bold && D.bold.decisions) || []).map((d) => ({ ...d, who: '적극형' })), ((D.major && D.major.decisions) || []).map((d) => ({ ...d, who: '다수결' })))
        .filter((d) => d.decision === 'enter' || d.decision === 'skip').sort((x, y) => (x.t < y.t ? 1 : -1));
      const seen = new Set(out.map((o) => o.html));
      recent.slice(0, 6).forEach((d) => { const k = d.t + d.sym + d.side + d.who; if (seen.has(k) || out.length >= 4) return; seen.add(k);
        out.push({ cls: d.decision === 'enter' ? 'ok' : '', html: `<b>단타·${d.who}</b> ${esc(d.name)} ${SD[d.side]} <span class="muted">${scT(d.t, 15)}</span> · ${V[d.decision]}${d.votes ? ' (' + esc(d.reason) + ')' : ''}`, why: esc(d.votes ? d.votes.map((v) => v.name + ': ' + (v.reason || V[v.decision])).join(' / ') : d.reason || '') }); });
    }
    // 선물 (4시간봉): FLUX 진입 대기 · AI 회의 최근 투표
    const F = S.fut;
    if (F && F.live) {
      (F.live.pending || []).slice(0, 2).forEach((o) => out.push({ cls: '', html: `<b>선물·FLUX</b> ${esc(o.name)} ${SD[o.side]} · 다음 봉 진입 대기`, why: esc(o.why || '') }));
      const v = F.council && F.council.votes && F.council.votes[0];
      if (v) out.push({ cls: v.result === 'approved' ? 'ok' : '', html: `<b>선물·AI 회의</b> ${esc(v.name)} ${SD[v.side]} · ${v.result === 'approved' ? '만장일치 진입' : '보류'}`, why: esc(v.votes.map((x) => x.name + ': ' + x.reason).join(' / ')) });
    }
    // 주식·코인 봇: 다음 거래일 주문 대기
    loadFilings();
    PP.bots.filter((b) => !b.retired && b.live).forEach((b) => (b.live.orders || []).slice(0, 2).forEach((o) => { const fl = filOf(o.id), badF = fl && fl.bad ? fl.filings.find((f) => f.level === 'bad') : null;
      out.push({ cls: o.side === 'sell' || badF ? 'alert' : '', html: `<b>${esc(b.code)}</b> ${esc(o.name)} ${o.side === 'buy' ? '매수' : '매도'} 대기${badF ? ' · <span class="act warn">공시 주의</span>' : ''}`, why: esc((badF ? (badF.note || badF.title) + ' (' + badF.date.slice(5) + ') · ' : '') + (o.why || '')) }); }));
    // 오늘 체결
    (PP.today || []).slice(-2).reverse().forEach((e) => out.push({ cls: e.side === 'vault' ? 'alert' : 'ok', html: `<b>${esc(e.botCode || '')}</b> ${e.side === 'buy' ? '매수 체결' : e.side === 'sell' ? '매도 체결' : '금고'} ${esc(e.name || '')} <span class="muted">${esc((e.d || '').slice(5))}</span>`, why: esc(e.why || e.reason || '') }));
    return out;
  }
  function hqCard(o) {
    return `<a class="hq-card ${o.locked ? 'locked' : ''}" href="${o.href}">
      <div class="hq-head"><div><p class="hq-kick">${esc(o.kick)}</p><p class="hq-title">${esc(o.title)}</p></div>
        <div class="right"><p class="hq-num num ${o.numCls || ''}">${o.num}</p><p class="hq-sub ${o.subCls || ''}">${o.sub || ''}</p></div></div>
      ${isoRoom(o)}
      <div class="hq-log">${o.logTitle ? `<p class="hq-log-t">${o.logTitle}</p>` : ''}${(o.log || []).slice(0, o.logMax || 3).map((l) => `<p><span class="hq-dot ${l.cls || ''}"></span><span>${l.html}${l.why ? `<span class="hq-why">${l.why}</span>` : ''}</span></p>`).join('') || '<p class="muted">기록 없음</p>'}</div></a>`;
  }
  /* ---------- BOSS 업무 점검: 직원마다 맡은 일 + 실제 데이터로 확인 ----------
   * 결과: ok(제대로 함) · warn(일은 했고, 사장님이 볼 것을 찾음) · fail(맡은 일을 못 함) · wait(아직 차례 아님)
   * 모든 판정에는 근거(evidence)를 남김. 형식적인 "좋아"는 없음. */
  const HQ_AUDIT = {};
  function bizDaysSince(d) { // 데이터 날짜 이후 지난 평일 수 (주말 제외)
    if (!d) return 99; const a = new Date(String(d).slice(0, 10) + 'T00:00:00'), b = new Date(); let n = 0;
    for (const x = new Date(a); x < b && n < 99; x.setDate(x.getDate() + 1)) { if (x > a && x.getDay() % 6) n++; }
    return n;
  }
  const agoTxt = (ms) => ms < 3600e3 ? Math.max(1, Math.round(ms / 60e3)) + '분 전' : ms < 86400e3 ? Math.round(ms / 3600e3) + '시간 전' : Math.round(ms / 86400e3) + '일 전';
  const md = (d) => d ? String(d).slice(5, 10).replace('-', '/') : '—';
  function auditHQ(ctx) {
    const A = [], add = (room, o) => { o.room = room; A.push(o); HQ_AUDIT[room + '|' + o.code] = o; return o; };
    const { Pf, PP, w } = ctx;
    // ROOM 1 — 내 자산 방
    const R1 = '내 자산 방';
    if (!Pf.rows.length) {
      ['PRICE', 'CHIEF', 'VAULT', 'REPORT'].forEach((c) => add(R1, { code: c, duty: '자산 연결 후 시작', st: 'wait', short: '자산 연결 전', ev: '연결된 보유 자산이 없어요' }));
    } else {
      const syncT = LIVE && LIVE.syncedAt ? new Date(LIVE.syncedAt) : null, age = syncT ? Date.now() - syncT : Infinity;
      const noPx = Pf.rows.filter((r) => r.v == null);
      const pSt = S.demo ? 'ok' : !syncT || age > 6 * 3600e3 || noPx.length ? 'fail' : age > 90 * 60e3 ? 'warn' : 'ok';
      add(R1, { code: 'PRICE', duty: '보유 자산 시세를 1시간마다 받아오기', st: pSt, href: '#assets',
        short: !syncT ? '동기화 없음' : noPx.length ? '가격 빠짐 ' + noPx.length : agoTxt(age) + ' 동기화',
        ev: `마지막 동기화 ${syncT ? syncT.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) + ' (' + agoTxt(age) + ')' : '기록 없음'} · 가격 빠진 종목 ${noPx.length ? noPx.map((r) => r.h.name).slice(0, 3).join(', ') : '0개'}${pSt === 'fail' && syncT && age > 6 * 3600e3 ? ' · 1시간마다 해야 하는데 6시간 넘게 끊김 → 서버 확인 필요' : ''}` });
      const noAct = Pf.rows.filter((r) => !r.act), chk = Pf.rows.filter((r) => r.act && ['stop', 'reduce', 'trim'].indexOf(r.act.action) >= 0);
      add(R1, { code: 'CHIEF', duty: '보유 종목마다 유지·매수·점검 판단 내리기', st: noAct.length ? 'fail' : chk.length ? 'warn' : 'ok', href: '#assets',
        short: noAct.length ? '판단 누락 ' + noAct.length : chk.length ? '점검 ' + chk.length + '건' : '판단 완료',
        ev: `${Pf.rows.length}종목 중 ${Pf.rows.length - noAct.length}개 판단 완료${noAct.length ? ' · 누락: ' + noAct.map((r) => r.h.name).slice(0, 3).join(', ') : ''}${chk.length ? ' · 사장님 확인 필요: ' + chk.slice(0, 3).map((r) => r.h.name + '(' + r.act.label + ')').join(', ') : ''}` });
      const top = Pf.rows.slice().sort((a, b) => (b.v || 0) - (a.v || 0))[0], topW = top && Pf.all ? top.v / Pf.all * 100 : 0;
      add(R1, { code: 'VAULT', duty: '한 종목이 자산의 40%를 넘지 않게 감시', st: topW > 40 ? 'warn' : 'ok', href: '#assets',
        short: topW > 40 ? '쏠림 ' + topW.toFixed(0) + '%' : '비중 양호',
        ev: `가장 큰 종목 ${top ? top.h.name : '—'} ${topW.toFixed(1)}% (한도 40%)${topW > 40 ? ' → 한도 초과, 나눠 담기 검토' : ' → 한도 안'}` });
      const keys = Object.keys(S.assetLog || {}).sort(), last = keys[keys.length - 1], lag = last ? Math.round((new Date(todayKey()) - new Date(last)) / 864e5) : 99;
      add(R1, { code: 'REPORT', duty: '매일 자산 기록 남기기 (달력·성적표용)', st: lag <= 1 ? 'ok' : lag <= 6 ? 'warn' : 'fail', href: '#calendar',
        short: !last ? '기록 없음' : lag <= 1 ? '기록 ' + keys.length + '일' : lag + '일 빠짐',
        ev: `기록 ${keys.length}일치 · 마지막 기록 ${md(last)}${!last ? ' · 아직 한 번도 기록 안 됨' : lag > 1 ? ' · ' + lag + '일 동안 기록 안 됨' : ''}` });
    }
    // ROOM 2 — 모의투자 방
    const R2 = '모의투자 방';
    if (!PP) ['ATLAS', 'ORBIT', 'NOVA', 'CHIEF'].forEach((c) => add(R2, { code: c, duty: '모의투자 매매', st: 'fail', short: '결과 없음', ev: '모의투자 결과 파일을 못 불러왔어요 (매일 자동 분석 확인 필요)', href: '#paper' }));
    else PP.bots.filter((b) => !b.empty && !b.retired).slice(0, 4).forEach((b) => {
      const L = b.live, lagD = L ? bizDaysSince(L.lastDate) : 99, maxW = (PP.vault && PP.vault.maxPosPct) || 15;
      const over = L ? L.positions.filter((p) => p.w > maxW + 1) : [];
      const noStop = L ? L.positions.filter((p) => b.code !== 'ORBIT' && p.stop == null) : [];
      let st = 'ok', short = '정상';
      if (!L) { st = 'fail'; short = '기록 없음'; }
      else if (lagD > 3) { st = 'fail'; short = lagD + '일째 멈춤'; }
      else if (over.length) { st = 'fail'; short = '비중 위반'; }
      else if (noStop.length) { st = 'fail'; short = '손절선 없음'; }
      else if (L.status === 'paused') { st = 'warn'; short = '금고 규칙 정지'; }
      else if (lagD > 2) { st = 'warn'; short = '업데이트 늦음'; }
      add(R2, { code: b.code, duty: (b.role || b.name || ''), st, short, href: '#paper',
        ev: L ? `마지막 처리 ${md(L.lastDate)} · 보유 ${L.positions.length} · 대기 주문 ${L.orders.length} · 최대 비중 ${L.positions.length ? Math.max(...L.positions.map((p) => p.w || 0)).toFixed(1) : 0}% (한도 ${maxW}%)${b.code !== 'ORBIT' ? ' · 손절선 ' + (L.positions.length - noStop.length) + '/' + L.positions.length : ' · 월 1회 교체형(손절선 없음이 정상)'}${over.length ? ' · 위반: ' + over.map((p) => p.name + ' ' + p.w + '%').join(', ') : ''}${L.status === 'paused' ? ' · 낙폭이 커져 규칙대로 쉬는 중' : ''}` : '이 봇의 모의투자 기록이 없어요' });
    });
    {
      const D = S.fut;
      if (!D) add(R2, { code: 'FLUX', duty: '코인 선물 롱·숏 — 4시간마다 판단, 선물 금고 규칙 지키기', st: S.futLoading ? 'wait' : 'fail', short: S.futLoading ? '불러오는 중' : '결과 없음', href: '#futures', ev: S.futLoading ? '선물 결과를 불러오는 중이에요' : '선물 결과 파일이 없어요 (GitHub Actions "코인 선물 모의투자" 확인)' });
      else {
        const L = D.live, age = Date.now() - Date.parse(D.generatedAt), c = D.cfg;
        const badStop = L.positions.filter((p) => p.stop == null || (p.side === 'long' ? p.stop <= p.liq : p.stop >= p.liq));
        const overLev = L.lev > c.maxLevTotal + 0.05;
        let st = 'ok', short = '정상';
        if (age > 24 * 3600e3) { st = 'fail'; short = Math.round(age / 3600e3) + '시간째 멈춤'; }
        else if (overLev) { st = 'fail'; short = '레버리지 위반'; }
        else if (badStop.length) { st = 'fail'; short = '손절선 문제'; }
        else if (L.liq) { st = 'fail'; short = '강제청산 ' + L.liq + '번'; }
        else if (age > 9 * 3600e3) { st = 'warn'; short = '갱신 늦음'; }
        else if (L.status !== 'ok') { st = 'warn'; short = (FUT_ST[L.status] || ['주의'])[0]; }
        else if ((D.errors || []).length) { st = 'warn'; short = '시세 일부 빠짐'; }
        add(R2, { code: 'FLUX', duty: '코인 선물 롱·숏 — 4시간마다 판단, 선물 금고 규칙 지키기', st, short, href: '#futures',
          ev: `마지막 판단 ${futT(D.lastBar)} 봉 마감 (${agoTxt(age)}) · 포지션 ${L.positions.length}/${c.maxPos} · 레버리지 ${L.lev}배 (한도 ${c.maxLevTotal}배) · 손절이 청산가보다 먼저 ${L.positions.length - badStop.length}/${L.positions.length} · 강제청산 ${L.liq}번${(D.errors || []).length ? ' · 빠진 시세: ' + D.errors.join(', ') : ''}` });
      }
    }
    {
      loadScalp();
      const D = S.sc, duty = '코인 선물 단타 — 15분마다 판단, Claude 결정, 금고 규칙 지키기';
      if (!D) add(R2, { code: 'SCALP', duty, st: S.scLoading ? 'wait' : 'fail', short: S.scLoading ? '불러오는 중' : '결과 없음', href: '#scalp', ev: S.scLoading ? '단타 결과를 불러오는 중이에요' : '단타 결과 파일이 없어요 (GitHub Actions "코인 선물 단타" 확인)' });
      else {
        const L = D.live, age = Date.now() - Date.parse(D.generatedAt), c = D.cfg;
        const bad = L.positions.filter((p) => p.stop == null || (p.side === 'long' ? p.stop <= p.liq : p.stop >= p.liq));
        const errs = (D.decisions || []).slice(0, 10).filter((d) => d.decision === 'error').length;
        let st = 'ok', short = '정상';
        if (age > 3 * 3600e3) { st = 'fail'; short = Math.round(age / 3600e3) + '시간째 멈춤'; }
        else if (!D.hasKey) { st = 'fail'; short = 'Claude 키 없음'; }
        else if (L.lev > c.maxLevTotal + 0.05) { st = 'fail'; short = '레버리지 위반'; }
        else if (bad.length) { st = 'fail'; short = '손절선 문제'; }
        else if (errs >= 3) { st = 'warn'; short = 'Claude 응답 실패'; }
        else if (age > 45 * 60e3) { st = 'warn'; short = '갱신 늦음'; }
        else if (L.status !== 'ok') { st = 'warn'; short = (SC_ST[L.status] || ['주의'])[0]; }
        add(R2, { code: 'SCALP', duty, st, short, href: '#scalp',
          ev: `마지막 판단 ${scT(D.lastBar, 15)} 봉 (${agoTxt(age)}) · Claude ${D.aiStats.asked}번 중 ${D.aiStats.enter}번 진입${errs ? ' · 최근 응답 실패 ' + errs : ''} · 포지션 ${L.positions.length}/${c.maxPos} · 레버리지 ${L.lev}배(한도 ${c.maxLevTotal}) · 손절이 청산가보다 먼저 ${L.positions.length - bad.length}/${L.positions.length}` });
      }
    }
    {
      loadMk();
      const D = S.mk3, duty = '민경기 봇 — 4시간마다 추세 후보 판단, 매주 다시 학습, 금고 규칙 지키기';
      if (!D) add(R2, { code: 'MK', duty, st: S.mkLoading ? 'wait' : 'fail', short: S.mkLoading ? '불러오는 중' : '결과 없음', href: '#mk', ev: S.mkLoading ? '민경기 봇 결과를 불러오는 중이에요' : '민경기 봇 결과 파일이 없어요 (봇 루프 확인)' });
      else {
        const L = D.live, age = Date.now() - Date.parse(D.generatedAt), mAge = Date.now() - Date.parse(D.model.at);
        const bad = L.positions.filter((p) => p.stop == null || (p.side === 'long' ? p.stop <= p.liq : p.stop >= p.liq));
        let st = 'ok', short = '정상';
        if (age > 3 * 3600e3) { st = 'fail'; short = Math.round(age / 3600e3) + '시간째 멈춤'; }
        else if (bad.length) { st = 'fail'; short = '손절선 문제'; }
        else if (mAge > 9 * 864e5) { st = 'warn'; short = '재학습 밀림'; }
        else if (L.status !== 'ok') { st = 'warn'; short = (MK3_ST[L.status] || ['주의'])[0]; }
        add(R2, { code: 'MK', duty, st, short, href: '#mk',
          ev: `마지막 판단 ${scT(D.lastBar, 240)} 봉 (${agoTxt(age)}) · 모델 ${D.model.ver}번째 (${agoTxt(mAge)} 학습) · 시험 ${D.wf && D.wf.pass && D.wf.pass.ok ? '합격' : '불합격'} · 포지션 ${L.positions.length}/${D.cfg.maxPos}` });
      }
    }
    // ROOM 3 — 시장 관제실
    const R3 = '시장 관제실';
    const wind = (lbl) => (w.winds || []).find((x) => x.label.indexOf(lbl) >= 0);
    [['RATE', 'us10y', '금리', '미국 10년 금리 감시'], ['USD', 'usdkrw', '달러', '원/달러 환율 감시'], ['VIX', 'vix', '변동성', '공포지수(VIX) 감시']].forEach(([c, k, lbl, duty]) => {
      const m = S.markets[k], d = ML && ML.macro && ML.macro[k] ? ML.macro[k].date : null, lagD = d ? bizDaysSince(d) : 99, x = wind(lbl);
      const st = !m || m.value == null || lagD > 3 ? 'fail' : x && x.on ? 'warn' : 'ok';
      add(R3, { code: c, duty, st, href: '#explore', short: st === 'fail' ? (d ? lagD + '일 묵은 값' : '데이터 없음') : x && x.on ? '역풍 감지' : '정상 감시',
        ev: `현재 ${m && m.value != null ? fmtMarket(m).v : '—'} · 데이터 날짜 ${d ? md(d) : '스냅샷(자동 갱신 아님)'}${x ? ' · 판정: ' + (x.on ? '역풍' : '양호') + (x.why ? ' (' + x.why + ')' : '') : ''}` });
    });
    {
      const live = S.fngFrom === 'live', x = wind('심리');
      add(R3, { code: 'MOOD', duty: '코인 시장 심리(공포·탐욕) 감시', st: live ? (x && x.on ? 'warn' : 'ok') : 'warn', href: '#explore',
        short: live ? (x && x.on ? '역풍 감지' : '정상 감시') : '옛날 값 사용',
        ev: `공포·탐욕 ${S.fng != null ? S.fng : '—'} · ${live ? '실시간으로 받음' : '실시간 연결 실패 → 저장된 값 사용 중'}${x ? ' · 판정: ' + (x.on ? '역풍' : '양호') : ''}` });
    }
    // ROOM 4 — 실전 대기실
    const R4 = '실전 대기실';
    let best = null;
    if (PP) PP.bots.filter((b) => !b.retired && b.ready).forEach((b) => { if (!best || b.ready.passed > best.ready.passed) best = b; });
    const rd = best ? best.ready : null, open = rd && rd.ready;
    add(R4, { code: 'ORDER', duty: '실전 주문 — 조건 6개 통과 전에는 절대 주문 안 함', st: open ? 'warn' : 'ok', href: '#paper',
      short: open ? '전환 준비됨' : '규칙대로 잠금', ev: open ? '조건을 모두 통과 — 사장님 결정 후 1천만 원부터' : `실전 주문 0건 · 잠금 유지 (최고 ${rd ? rd.passed : 0}/${rd ? rd.total : 6})` });
    const fails = rd && rd.items ? rd.items.filter((i) => !i.ok) : [];
    add(R4, { code: 'GUARD', duty: '실전 전환 조건 6가지를 매일 다시 계산', st: !PP ? 'fail' : bizDaysSince(PP.asOf) > 3 ? 'fail' : 'ok', href: '#paper',
      short: !PP ? '계산 못 함' : (best ? best.code + ' ' + rd.passed + '/' + rd.total : '계산 완료'),
      ev: PP ? `계산 날짜 ${md(PP.asOf)} · 1위 ${best ? best.code : '—'} ${rd ? rd.passed + '/' + rd.total : ''}${fails.length ? ' · 남은 조건: ' + fails.slice(0, 2).map((i) => i.label + '(' + i.val + ')').join(', ') : ''}` : '모의투자 결과가 없어 계산 못 함' });
    const sat = (() => { const d = new Date(); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7)); return (d.getMonth() + 1) + '/' + d.getDate(); })();
    add(R4, { code: 'COACH', duty: '토요일 아침 주간 보고와 코칭', st: 'wait', short: sat + ' 보고',
      ev: `다음 보고 ${sat}(토) 오전 8:49 · 보고는 앱 밖(Claude)에서 만들어져 앱에서 완료 여부를 확인할 수 없어요` });
    return A;
  }
  const toneOf = (a) => !a ? '' : a.st === 'fail' ? 'alert' : a.st === 'warn' ? 'warn' : a.st === 'wait' ? 'idle' : '';
  const ST_TXT = { ok: '정상', warn: '확인 필요', fail: '문제', wait: '대기' };
  function auditLog(A) {
    const cnt = { ok: 0, warn: 0, fail: 0, wait: 0 }; A.forEach((a) => cnt[a.st]++);
    const rooms = [...new Set(A.map((a) => a.room))];
    return `<section class="card hq-audit"><div class="row between"><p class="b">BOSS 점검 일지</p><p class="muted sm">${A.length}명 중 정상 ${cnt.ok} · 확인 ${cnt.warn} · 문제 ${cnt.fail}</p></div>
      ${rooms.map((r) => `<p class="hq-audit-room">${esc(r)}</p>${A.filter((a) => a.room === r).map((a) => `<${a.href ? 'a href="' + a.href + '"' : 'div'} class="hq-audit-row">
        <span class="hq-chip ${a.st}">${ST_TXT[a.st]}</span>
        <div><p><b>${esc(a.code)}</b> <span class="muted">${esc(a.duty)}</span></p><p class="sm">${esc(a.ev)}</p></div></${a.href ? 'a' : 'div'}>`).join('')}`).join('')}
      <p class="muted xs" style="margin-top:8px">정상 = 맡은 일을 했고 문제 없음 · 확인 필요 = 일은 했고 사장님이 볼 것을 찾음 · 문제 = 맡은 일을 못 함</p></section>`;
  }
  function viewHQ() {
    // 1) 내 자산 방
    const Pf = portfolio(), cnt = actCounts(Pf.rows);
    const top = Pf.rows.slice().sort((a, b) => (b.v || 0) - (a.v || 0))[0];
    const topW = top && Pf.all ? top.v / Pf.all * 100 : 0;
    const guide = Pf.rows.filter((r) => r.act && r.act.action !== 'hold').sort((a, b) => ACTION_ORDER.indexOf(a.act.action) - ACTION_ORDER.indexOf(b.act.action)).slice(0, 3);
    const cal = (() => { try { return Object.entries(S.assetLog || {}).sort().slice(-30).map(([, v]) => v && v.t); } catch (e) { return []; } })();
    const syncT = LIVE && LIVE.syncedAt ? new Date(LIVE.syncedAt) : null;
    const asset = {
      href: '#assets', kick: 'ROOM 1', title: '내 자산 방', wallName: 'PORTFOLIO', series: cal,
      num: Pf.rows.length ? wonShort(Pf.all) : '—', sub: Pf.rows.length ? `${Pf.pnl >= 0 ? '+' : ''}${wonShort(Pf.pnl)} (${Pf.cost ? sign(Pf.pnl / Pf.cost * 100, 1) : '—'}%)` : '자산 연결 전', subCls: dirClass(Pf.pnl),
      staff: [
        { code: 'PRICE', i: 0, j: 0, say: syncT ? syncT.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }) + ' 동기화' : '연결 대기' },
        { code: 'CHIEF', i: 3, j: 0, say: cnt.check ? '손절 점검 ' + cnt.check : cnt.buy ? '매수 검토 ' + cnt.buy : '유지', tone: cnt.check ? 'alert' : '' },
        { code: 'VAULT', i: 3, j: 3, say: topW > 40 ? '한 종목 ' + topW.toFixed(0) + '%' : '비중 양호', tone: topW > 40 ? 'alert' : '' },
        { code: 'REPORT', i: 0, j: 3, say: '할 일 ' + (cnt.buy + cnt.sell + cnt.check) }],
      log: guide.map((r) => ({ cls: r.act.action === 'stop' ? 'alert' : '', html: `<b>${esc(r.h.name)}</b> ${esc(r.act.label)}` }))
    };
    // 2) 모의투자 방
    const PP = window.SNW_PAPER;
    let paper;
    if (PP) {
      const bots = PP.bots.filter((b) => !b.empty && !b.retired), start = PP.startCash * bots.length, nowV = bots.reduce((t, b) => t + (b.live ? b.live.equity : PP.startCash), 0);
      const r = (nowV / start - 1) * 100;
      const pos = [[0, 0], [3, 0], [0, 3], [2.2, 3.6]];
      paper = {
        href: '#paper', kick: 'ROOM 2', title: '모의투자 방', wallName: 'PAPER BOTS', series: (PP.team.live && PP.team.live.curve.length > 2 ? PP.team.live.curve : PP.team.bt.curve.slice(-120)).map((x) => x[1]),
        num: (r >= 0 ? '+' : '') + r.toFixed(2) + '%', numCls: dirClass(r), sub: '가상 ' + bots.length + '억 · ' + kDate(PP.inception) + '부터',
        staff: bots.slice(0, 4).map((b, k) => { const st = b.live ? b.live.status : 'ok'; const n = b.live ? b.live.positions.length : 0, o = b.live ? b.live.orders.length : 0;
          return { code: b.code, i: pos[k][0], j: pos[k][1], tone: st === 'paused' ? 'alert' : '', say: st === 'paused' ? '금고 정지' : n ? '보유 ' + n : o ? '주문 ' + o : '대기' }; }),
        log: paperCands(PP), logMax: 6, logTitle: '후보 종목 · 이유'
      };
    } else paper = { href: '#paper', kick: 'ROOM 2', title: '모의투자 방', wallName: 'PAPER BOTS', num: '—', sub: '결과 불러오는 중', staff: [{ code: 'ATLAS', i: 0, j: 0, say: '대기' }, { code: 'ORBIT', i: 3, j: 0, say: '대기' }, { code: 'NOVA', i: 0, j: 3, say: '대기' }, { code: 'CHIEF', i: 2.2, j: 3.6, say: '대기' }], log: [] };
    loadFutures();
    paper.staff = (paper.staff || []).concat([{ code: 'FLUX', i: 3.6, j: 2.2, say: S.fut ? pct(S.fut.live.ret, 1) : '불러오는 중' }]);
    // 3) 시장 관제실
    const w = weather(), ev = SNAP.events.map((e) => ({ ...e, d: R.daysUntil(e.date, now()) })).filter((e) => e.d >= 0);
    const wind = (lbl) => (w.winds || []).find((x) => x.label.indexOf(lbl) >= 0);
    const spx = ML && ML.macroSeries && ML.macroSeries.spx && ML.macroSeries.spx.c ? ML.macroSeries.spx.c.slice(-90) : [];
    const market = {
      href: '#explore', kick: 'ROOM 3', title: '시장 관제실', wallName: 'MARKET', series: spx,
      num: esc(w.title), numCls: 'hq-weather', sub: esc(w.sub || ''),
      staff: [['금리', 'RATE', 0, 0], ['달러', 'USD', 3, 0], ['변동성', 'VIX', 3, 3], ['심리', 'MOOD', 0, 3]].map(([l, c, i, j]) => { const x = wind(l); return { code: c, i, j, say: x ? (x.on ? '역풍' : '양호') : '—', tone: x && x.on ? 'alert' : '' }; }),
      log: ev.slice(0, 3).map((e) => ({ cls: e.d <= 3 ? 'alert' : '', html: `<b>${e.d === 0 ? 'D-DAY' : 'D-' + e.d}</b> ${esc(e.title)}` }))
    };
    // 4) 실전 대기실
    let bestRd = { passed: 0, total: 6 }, bestBot = null;
    if (PP) PP.bots.filter((b) => !b.retired && b.ready).forEach((b) => { if (b.ready.passed > bestRd.passed || !bestBot) { bestRd = b.ready; bestBot = b; } });
    const sat = (() => { const d = new Date(); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7)); return (d.getMonth() + 1) + '/' + d.getDate(); })();
    const live = {
      href: '#paper', kick: 'ROOM 4', title: '실전 대기실', wallName: 'LIVE', locked: !bestRd.ready, series: [],
      num: bestRd.passed + '/' + bestRd.total, sub: '실전 전환 조건' + (bestBot ? ' · ' + esc(bestBot.code) : ''),
      staff: [{ code: 'ORDER', i: 0, j: 0, say: bestRd.ready ? '준비됨' : '잠김', tone: bestRd.ready ? '' : 'idle' }, { code: 'GUARD', i: 3, j: 0, say: '감시 대기', tone: 'idle' }, { code: 'COACH', i: 0, j: 3, say: sat + ' 보고' }],
      log: [{ html: '모의투자 60거래일 · 거래 20번 · 손익비 1.3 이상 통과 후 열림' }, { html: '열리면 1천만 원부터 시작 · 하루 손실 한도 · 전체 정지 버튼' }]
    };
    const AUD = auditHQ({ Pf, PP, w });
    [asset, paper, market, live].forEach((o) => (o.staff || []).forEach((s) => { const a = HQ_AUDIT[o.title + '|' + s.code]; if (a) { s.say = a.short; s.tone = toneOf(a); } }));
    return `<header class="top"><div><a href="#home" class="back">‹ 홈</a><p class="kicker">방을 누르면 자세히 볼 수 있어요</p><h1>본부</h1></div>${tools()}</header>
      <div class="hq-patrol"><span class="hq-patrol-dog">${bossSvg(true)}</span><div><p class="hq-patrol-t">총책임자 <b>BOSS</b></p><p class="hq-patrol-s" id="hq-patrol">${esc(PATROL.msg || "방을 돌며 직원들이 일하는지 점검하고 있어요")}</p></div></div>
      <div class="hq-grid">${[asset, paper, market, live].map(hqCard).join('')}</div>
      ${auditLog(AUD)}`;
  }

  /* =====================================================================
   *  트레이딩 대시보드 (홈 · 봇 · 봇 상세 · 분석) — 코인 선물 AI 자동매매 중심
   * ===================================================================== */
  const tOf = (s) => { if (s == null) return NaN; const x = String(s); return Date.parse(x.length <= 10 ? x + 'T00:00:00Z' : x.replace(' ', 'T') + (x.length <= 16 ? ':00Z' : '')); };
  const kT = (s) => { const t = tOf(s); if (!isFinite(t)) return String(s || ''); const d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const stOf = (map, k) => (map[k] || map.ok || ['정상', 'neu']);
  // 모든 코인 선물 계좌를 같은 모양으로
  function accounts(all) {
    loadMk(); loadScalp(); loadFutures();
    const A = [], M3 = S.mk3, FU = S.fut, SCd = S.sc;
    const mk = (o) => A.push(Object.assign({ start: 1e8, curve: [], trades: [], positions: [], status: 'ok', stMap: SC_ST }, o));
    if (M3) mk({ id: 'mk', code: 'MK', name: '민경기 봇', strat: '추세 돌파 + 학습 필터', tf: '4시간봉', href: '#mk', main: true, equity: M3.live.equity, ret: M3.live.ret, curve: M3.live.curve, trades: M3.live.trades, positions: M3.live.positions, status: M3.live.status, stMap: MK3_ST, since: M3.inception, upd: M3.generatedAt,
      bt: M3.wf && M3.wf.study && M3.wf.study[1] ? { label: '워크포워드 시험', cagr: M3.wf.study[1].all.cagr, mdd: M3.wf.study[1].all.mdd, pf: M3.wf.study[1].all.pf, win: M3.wf.study[1].all.win, n: M3.wf.study[1].all.n, pass: M3.wf.pass && M3.wf.pass.ok } : null });
    if (FU) { const m = FU.bt && FU.bt.metrics;
      mk({ id: 'flux', code: 'FLUX', name: 'FLUX', strat: '추세 돌파 (규칙만)', tf: '4시간봉', href: '#futures', equity: FU.live.equity, ret: FU.live.ret, curve: FU.live.curve, trades: FU.live.trades, positions: FU.live.positions || [], status: FU.live.status, stMap: FUT_ST, since: FU.inception, upd: FU.generatedAt,
        bt: m ? { label: '백테스트', cagr: m.cagr, mdd: m.mdd, pf: m.pf, win: m.winRate, n: m.trades } : null });
      if (FU.council) mk({ id: 'ai3', code: 'AI3', name: 'AI 3명 만장일치', strat: 'FLUX 후보 → Claude·Gemini·GPT 모두 찬성', tf: '4시간봉', href: '#futures', equity: FU.council.equity, ret: FU.council.ret, curve: FU.council.curve, trades: FU.council.trades || [], positions: FU.council.positions || [], status: FU.council.status, stMap: FUT_ST, since: FU.council.inception, upd: FU.generatedAt }); }
    if (SCd) {
      const bt = SCd.bt ? { label: '엔진 백테스트', cagr: null, ret: SCd.bt.ret, mdd: SCd.bt.metrics && SCd.bt.metrics.mdd, pf: SCd.bt.stats.pf, win: SCd.bt.stats.winRate, n: SCd.bt.stats.trades, days: SCd.bt.days } : null;
      mk({ id: 'sc1', code: 'SC', name: '단타 · 조심형', strat: '15분 후보 → Claude가 애매하면 건너뜀', tf: '15분봉', href: '#scalp', equity: SCd.live.equity, ret: SCd.live.ret, curve: SCd.live.curve, trades: SCd.live.trades, positions: SCd.live.positions, status: SCd.live.status, since: SCd.inception, upd: SCd.generatedAt, bt });
      if (SCd.bold) mk({ id: 'sc2', code: 'SC', name: '단타 · 적극형', strat: '15분 후보 → Claude가 기본은 진입', tf: '15분봉', href: '#scalp', equity: SCd.bold.equity, ret: SCd.bold.ret, curve: SCd.bold.curve || [], trades: SCd.bold.trades, positions: SCd.bold.positions, since: SCd.bold.inception, upd: SCd.generatedAt, bt });
      if (SCd.major) mk({ id: 'sc3', code: 'SC', name: '단타 · AI 다수결', strat: '15분 후보 → AI 3명 중 2명 찬성', tf: '15분봉', href: '#scalp', equity: SCd.major.equity, ret: SCd.major.ret, curve: SCd.major.curve || [], trades: SCd.major.trades, positions: SCd.major.positions, since: SCd.major.inception, upd: SCd.generatedAt, bt });
      if (all && SCd.shadow) mk({ id: 'sc0', code: 'SC', name: '단타 · 엔진 혼자', strat: '15분 후보 전부 진입 (비교 기준)', tf: '15분봉', href: '#scalp', cmp: true, equity: SCd.shadow.equity, ret: SCd.shadow.ret, curve: SCd.shadow.curve || [], trades: SCd.shadow.trades || [], positions: [], upd: SCd.generatedAt, bt });
      if (all && SCd.mk) mk({ id: 'mk1', code: 'MK1', name: '민경기 1세대', strat: '리만·나비에-스토크스 규칙만 (비교)', tf: '15분봉', href: '#mk', cmp: true, equity: SCd.mk.equity, ret: SCd.mk.ret, curve: SCd.mk.curve || [], trades: SCd.mk.trades || [], positions: SCd.mk.positions || [], upd: SCd.generatedAt });
    }
    if (all && S.mk) mk({ id: 'mk2', code: 'MK2', name: '민경기 2세대', strat: '1시간봉 가격만 학습 (비교)', tf: '1시간봉', href: '#mk', cmp: true, equity: S.mk.live.equity, ret: S.mk.live.ret, curve: S.mk.live.curve || [], trades: S.mk.live.trades || [], positions: S.mk.live.positions || [], status: S.mk.live.status, upd: S.mk.generatedAt });
    A.forEach((a) => { a.st = statsOf(a); });
    return A;
  }
  // 성과 지표 (끝난 거래 + 자산 곡선)
  function statsOf(a) {
    const tr = (a.trades || []).filter((t) => t && t.pnl != null), n = tr.length, w = tr.filter((t) => t.pnl > 0);
    const gw = w.reduce((s, t) => s + t.pnl, 0), gl = -tr.filter((t) => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0);
    const cv = (a.curve || []).map(([t, v]) => [tOf(t), v]).filter((x) => isFinite(x[0]));
    let peak = -Infinity, mdd = 0; cv.forEach(([, v]) => { peak = Math.max(peak, v); mdd = Math.min(mdd, (v / peak - 1) * 100); });
    const last = cv.length ? cv[cv.length - 1] : null, back = (ms) => { if (!last) return null; const tgt = last[0] - ms; let v = null; for (const [t, x] of cv) { if (t <= tgt) v = x; else break; } return v; };
    const d1 = back(864e5), d7 = back(7 * 864e5);
    let streak = 0, worstStreak = 0; tr.slice().reverse().forEach((t) => { if (t.pnl <= 0) { streak++; worstStreak = Math.max(worstStreak, streak); } else streak = 0; });
    const hold = tr.map((t) => (tOf(t.out) - tOf(t.in)) / 36e5).filter(isFinite);
    return { n, win: n ? w.length / n * 100 : null, pf: gl ? gw / gl : (gw ? Infinity : null), avgR: n ? tr.reduce((s, t) => s + (t.R || 0), 0) / n : null, pnl: tr.reduce((s, t) => s + t.pnl, 0),
      mdd: cv.length > 1 ? mdd : null, ch1: d1 && last ? (last[1] / d1 - 1) * 100 : null, ch7: d7 && last ? (last[1] / d7 - 1) * 100 : null, worstStreak,
      best: tr.reduce((m, t) => (!m || t.pnl > m.pnl ? t : m), null), worst: tr.reduce((m, t) => (!m || t.pnl < m.pnl ? t : m), null), hold: hold.length ? hold.reduce((s, h) => s + h, 0) / hold.length : null };
  }
  function groupBy(tr, keyFn, labelFn) {
    const g = {}; tr.forEach((t) => { const k = keyFn(t); if (k == null) return; const x = g[k] || (g[k] = { k, label: labelFn ? labelFn(k) : k, n: 0, w: 0, R: 0, pnl: 0 }); x.n++; if (t.pnl > 0) x.w++; x.R += t.R || 0; x.pnl += t.pnl; });
    return Object.values(g).map((x) => ({ ...x, win: x.w / x.n * 100, avgR: x.R / x.n })).sort((a, b) => b.n - a.n);
  }
  const fmtPF = (v) => (v == null ? '—' : v === Infinity ? '∞' : v.toFixed(2));
  const holdTxt = (h) => (h == null ? '—' : h < 1 ? Math.round(h * 60) + '분' : h < 48 ? h.toFixed(1) + '시간' : (h / 24).toFixed(1) + '일');
  // 작은 선 그래프
  function spark(curve, w, h) {
    w = w || 72; h = h || 26; const p = (curve || []).map(([, v]) => v).filter((v) => v != null);
    if (p.length < 2) return `<svg class="spark" width="${w}" height="${h}"></svg>`;
    const lo = Math.min(...p), hi = Math.max(...p), r = hi - lo || 1, d = p[p.length - 1] - p[0];
    return `<svg class="spark ${d > 0 ? 'up' : d < 0 ? 'down' : 'flat'}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${p.map((v, i) => (i / (p.length - 1) * w).toFixed(1) + ',' + (h - 2 - (v - lo) / r * (h - 4)).toFixed(1)).join(' ')}"/></svg>`;
  }
  // 자산 곡선 (시작=0% 기준 수익률, 여러 계좌 겹쳐 그리기)
  function eqChart(series, opt) {
    opt = opt || {};
    const box = document.querySelector('main'), Wd = Math.max(300, Math.min(760, (box ? box.clientWidth : 360) - 36)), H = opt.h || 200, pl = 40, pr = 6, pt = 10, pb = 22;
    const from = opt.from || -Infinity;
    const ls = series.map((s) => { const pts = (s.curve || []).map(([t, v]) => [tOf(t), v]).filter((x) => isFinite(x[0]) && x[0] >= from); if (pts.length < 2) return null; const b = opt.base ? s.start : pts[0][1]; return { ...s, p: pts.map(([t, v]) => [t, (v / b - 1) * 100]) }; }).filter(Boolean);
    if (!ls.length) return '<p class="muted sm chart-empty">아직 그릴 기록이 없어요. 거래가 쌓이면 여기에 그래프가 나와요.</p>';
    const xs = ls.flatMap((l) => l.p.map((x) => x[0])), ys = ls.flatMap((l) => l.p.map((x) => x[1])).concat([0]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs); let y0 = Math.min(...ys), y1 = Math.max(...ys); const pad = (y1 - y0) * 0.08 || 0.5; y0 -= pad; y1 += pad;
    const X = (t) => pl + (t - x0) / Math.max(1, x1 - x0) * (Wd - pl - pr), Y = (v) => pt + (1 - (v - y0) / (y1 - y0)) * (H - pt - pb);
    const raw = (y1 - y0) / 4, mag = Math.pow(10, Math.floor(Math.log10(raw || 1))), st = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) || raw;
    const ticks = []; for (let v = Math.ceil(y0 / st) * st; v <= y1 + 1e-9; v += st) ticks.push(+v.toFixed(6));
    const span = x1 - x0, nx = 4, xt = []; for (let k = 0; k <= nx; k++) xt.push(x0 + span * k / nx);
    const xl = (t) => { const d = new Date(t); return span < 2 * 864e5 ? String(d.getHours()).padStart(2, '0') + ':00' : (d.getMonth() + 1) + '/' + d.getDate(); };
    const one = ls.length === 1, l0 = ls[0];
    const path = (l) => l.p.map(([t, v], i) => (i ? 'L' : 'M') + X(t).toFixed(1) + ',' + Y(v).toFixed(1)).join('');
    return `<svg class="eqc" viewBox="0 0 ${Wd} ${H}" width="100%" height="${H}" preserveAspectRatio="none" role="img" aria-label="수익률 그래프">
      ${ticks.map((v) => `<line x1="${pl}" x2="${Wd - pr}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="${Math.abs(v) < 1e-9 ? 'eqc-zero' : 'eqc-grid'}"/><text x="${pl - 6}" y="${(Y(v) + 3.5).toFixed(1)}" class="eqc-ax" text-anchor="end">${v > 0 ? '+' : ''}${Math.abs(st) < 1 ? v.toFixed(1) : Math.round(v)}%</text>`).join('')}
      ${xt.map((t, k) => `<text x="${X(t).toFixed(1)}" y="${H - 5}" class="eqc-ax" text-anchor="${k === 0 ? 'start' : k === nx ? 'end' : 'middle'}">${xl(t)}</text>`).join('')}
      ${one ? `<path class="eqc-area ${l0.p[l0.p.length - 1][1] >= 0 ? 'up' : 'down'}" d="${path(l0)}L${X(l0.p[l0.p.length - 1][0]).toFixed(1)},${Y(Math.max(y0, Math.min(0, y1))).toFixed(1)}L${X(l0.p[0][0]).toFixed(1)},${Y(Math.max(y0, Math.min(0, y1))).toFixed(1)}Z"/>` : ''}
      ${ls.map((l, k) => `<path class="eqc-line k${one ? (l.p[l.p.length - 1][1] >= 0 ? 'u' : 'd') : k}" d="${path(l)}"/>`).join('')}
    </svg>
    ${one ? '' : `<div class="eqc-leg">${ls.map((l, k) => `<span><i class="k${k}"></i>${esc(l.name)} <b class="num ${dirClass(l.p[l.p.length - 1][1])}">${pct(l.p[l.p.length - 1][1], 2)}</b></span>`).join('')}</div>`}`;
  }
  const PERIODS = [['1d', '1일', 864e5], ['1w', '1주', 7 * 864e5], ['1m', '1달', 30 * 864e5], ['all', '전체', Infinity]];
  function periodSeg(key) {
    const cur = S.ui[key] || 'all';
    return `<div class="seg seg-sm" role="tablist">${PERIODS.map(([k, l]) => `<button class="${cur === k ? 'on' : ''}" data-act="period" data-k="${key}" data-v="${k}">${l}</button>`).join('')}</div>`;
  }
  const periodFrom = (key) => { const p = PERIODS.find((x) => x[0] === (S.ui[key] || 'all')); return p && isFinite(p[2]) ? Date.now() - p[2] : -Infinity; };
  const kpi = (label, val, cls, sub) => `<div class="kpi"><p class="kpi-l">${label}</p><p class="kpi-v num ${cls || ''}">${val}</p>${sub ? `<p class="kpi-s">${sub}</p>` : ''}</div>`;
  const sideTag = (s) => `<span class="side ${SIDE[s][1]}">${SIDE[s][0]}</span>`;

  /* ---------- 홈: 대시보드 ---------- */
  function viewHome() {
    const A = accounts(false), live = A.filter((a) => !a.cmp);
    const head = `<header class="top"><div><p class="kicker">${esc(todayLabel())}</p><h1>자동매매</h1></div>${tools()}</header>${demoBanner()}`;
    if (!live.length) return head + guideCard() + `<section class="card empty"><p class="h-md">봇 결과를 불러오는 중이에요</p><p class="muted sm">잠시 뒤 자동으로 나타나요.</p></section>`;
    const tot = live.reduce((s, a) => s + a.equity, 0), start = live.reduce((s, a) => s + a.start, 0), pnl = tot - start;
    const ch1s = live.filter((a) => a.st.ch1 != null), d1 = ch1s.length ? ch1s.reduce((s, a) => s + a.equity - a.equity / (1 + a.st.ch1 / 100), 0) : null;
    const pos = [].concat(...live.map((a) => (a.positions || []).map((p) => ({ ...p, who: a }))));
    const upnl = pos.reduce((s, p) => s + (p.upnl || 0), 0);
    const allTr = [].concat(...live.map((a) => (a.trades || []).map((t) => ({ ...t, who: a })))).sort((x, y) => tOf(y.out) - tOf(x.out));
    const nTr = allTr.length, wTr = allTr.filter((t) => t.pnl > 0).length, rPnl = allTr.reduce((a, t) => a + t.pnl, 0);
    const realOf = (a) => (a.trades || []).reduce((t, x) => t + (x.pnl || 0), 0), openOf = (a) => (a.positions || []).reduce((t, p) => t + (p.upnl || 0), 0);
    const hero = `<section class="card"><div class="card-head"><h2>봇별 가상 자산</h2><span class="muted xs">각 1억으로 시작 · 실제 돈 아님</span></div>
      <div class="acc-list">${live.slice().sort((x, y) => y.ret - x.ret).map((a) => { const pl = a.equity - a.start, up = openOf(a), rl = realOf(a);
        return `<a class="acc" href="#bot/${a.id}"><div class="acc-top"><span class="acc-name"><b>${esc(a.name)}</b><span class="muted xs">${esc(a.tf)}${a.positions.length ? ' · 포지션 ' + a.positions.length : ''}</span></span>${spark(a.curve)}</div>
          <div class="acc-mid"><span class="num acc-eq">${won(a.equity)}</span><span class="num acc-pl ${dirClass(pl)}">${pl >= 0 ? '+' : ''}${man(pl)} · ${pct(a.ret, 2)}</span></div>
          <div class="acc-sub"><span>진행 중 <b class="num ${dirClass(up)}">${a.positions.length ? (up >= 0 ? '+' : '') + man(up) : '—'}</b></span><span>확정 <b class="num ${dirClass(rl)}">${a.st.n ? (rl >= 0 ? '+' : '') + man(rl) : '—'}</b></span>${Math.abs(pl - up - rl) >= 5000 ? `<span>진입 수수료·펀딩 <b class="num ${dirClass(pl - up - rl)}">${pl - up - rl >= 0 ? '+' : ''}${man(pl - up - rl)}</b></span>` : ''}<span>거래 <b class="num">${a.st.n}</b>${a.st.n ? ' · 승률 ' + Math.round(a.st.win) + '%' : ''}</span></div></a>`; }).join('')}</div>
      <div class="kpis k4" style="margin-top:12px">${kpi('평가 손익 · 진행 중', (upnl >= 0 ? '+' : '') + man(upnl), dirClass(upnl), pos.length ? '포지션 ' + pos.length + '개 아직 안 끝남' : '진행 중 없음')}${kpi('끝난 거래 ' + nTr + '건 · 확정', nTr ? (rPnl >= 0 ? '+' : '') + man(rPnl) : '—', dirClass(rPnl), nTr ? '이익 ' + wTr + ' · 손실 ' + (nTr - wTr) : '아직 없음')}</div></section>`;
    const chart = `<section class="card"><div class="card-head"><h2>수익률</h2>${periodSeg('hp')}</div>${eqChart(live.map((a) => ({ name: a.name, curve: a.curve, start: a.start })), { from: periodFrom('hp'), base: (S.ui.hp || 'all') === 'all' })}</section>`;
    const board = `<section class="card"><div class="card-head"><h2>봇 순위</h2><a href="#analysis" class="xs">분석 ›</a></div>
      <div class="lbd">${live.slice().sort((a, b) => b.ret - a.ret).map((a, k) => `<a class="lb-row" href="#bot/${a.id}"><span class="lb-n num">${k + 1}</span><span class="lb-name"><b>${esc(a.name)}</b><span class="muted xs">${esc(a.tf)} · 거래 ${a.st.n}${a.st.win != null ? ' · 승률 ' + Math.round(a.st.win) + '%' : ''}</span></span>${spark(a.curve)}<span class="lb-ret num ${dirClass(a.ret)}">${pct(a.ret, 2)}</span></a>`).join('')}</div></section>`;
    const posCard = `<section class="card"><div class="card-head"><h2>진행 중인 포지션 ${pos.length}</h2>${pos.length ? `<span class="num sm ${dirClass(upnl)}">평가 ${upnl >= 0 ? '+' : ''}${man(upnl)}</span>` : ''}</div>
      ${pos.length ? `<div class="tbl">${pos.map((p) => { const nt = p.notional || (p.lev != null ? p.lev * p.who.equity : null); return `<a class="tr2" href="#bot/${p.who.id}"><span>${sideTag(p.side)} <b>${esc(p.name)}</b><span class="muted xs"> ${esc(p.who.name)}</span></span><span class="num xs muted">${nt ? '규모 ' + man(nt) + (p.lev != null ? ' (' + p.lev + '배)' : '') + ' · ' : ''}${usd(p.entry)} → ${usd(p.mark)}</span><span class="num ${dirClass(p.upnl)}">${p.upnl >= 0 ? '+' : ''}${man(p.upnl)}</span></a>`; }).join('')}</div>` : '<p class="muted sm">열린 포지션이 없어요. 봇들이 조건을 기다리는 중이에요.</p>'}</section>`;
    const recent = `<section class="card"><div class="card-head"><h2>끝난 거래</h2>${nTr ? `<span class="num sm ${dirClass(rPnl)}">확정 ${rPnl >= 0 ? '+' : ''}${man(rPnl)}</span>` : ''}</div>
      ${nTr ? `<div class="tbl">${allTr.slice(0, 8).map((t) => `<div class="tr2"><span>${sideTag(t.side)} <b>${esc(t.name)}</b><span class="muted xs"> ${esc(t.who.name)} · ${kT(t.out)}</span></span><span class="muted xs">${esc(t.reason || '')}</span><span class="num ${dirClass(t.pnl)}">${t.pnl >= 0 ? '+' : ''}${man(t.pnl)}</span></div>`).join('')}</div>` : '<p class="muted sm">아직 끝난 거래가 없어요.</p>'}</section>`;
    const ins = insights(A);
    const insCard = ins.length ? `<section class="card"><div class="card-head"><h2>오늘의 점검</h2><a href="#analysis" class="xs">자세히 ›</a></div>${ins.slice(0, 3).map((x) => `<div class="ins ${x.lv}"><p class="sm"><b>${esc(x.title)}</b></p><p class="muted xs">${esc(x.text)}</p></div>`).join('')}</section>` : '';
    return head + guideCard() + hero + chart + posCard + insCard + recent + homeMarket();
  }
  function homeMarket() {
    const SCd = S.sc, RG = SCd && SCd.regime, btc = S.prices['KRW-BTC'];
    const RISKW = /해킹|규제|소송|파산|상장폐지|폭락|hack|exploit|lawsuit|ban|bankrupt|delist|plunge|crash|FOMC|CPI/i;
    const risky = SCd ? (SCd.news || []).filter((n) => RISKW.test(n.title)).slice(0, 2) : [], evs = SCd ? (SCd.events || []).slice(0, 2) : [];
    return `<section class="card"><div class="card-head"><h2>시장</h2><a href="#explore" class="xs">더 보기 ›</a></div>
      <div class="kpis k3">${kpi('비트코인', btc ? nf(Math.round(btc.krw / 1e4)) + '만' : '—', '', btc ? `<span class="${dirClass(btc.chg24)}">${sign(btc.chg24, 2)}%</span>` : '')}${kpi('장세', RG && RG.label ? esc(RG.label.split('·')[0].trim()) : '—', '', RG && RG.label && RG.label.split('·')[1] ? esc(RG.label.split('·')[1].trim()) : '15분봉')}${kpi('공포·탐욕', S.fng != null ? String(S.fng) : '—', '', S.fng == null ? '' : S.fng <= 25 ? '극단적 공포' : S.fng >= 75 ? '극단적 탐욕' : S.fng < 45 ? '공포' : S.fng > 55 ? '탐욕' : '보통')}</div>
      ${evs.map((e) => `<p class="sm news-line"><span class="act warn">발표</span> ${esc(e.date.slice(5).replace('-', '/'))} ${esc(e.title)}</p>`).join('')}
      ${risky.map((n) => `<p class="sm news-line"><span class="act warn">주의</span> ${esc(n.title)} <span class="muted xs">${n.ago}시간 전</span></p>`).join('')}</section>`;
  }

  /* ---------- 봇 목록 ---------- */
  function viewBots() {
    const A = accounts(true), live = A.filter((a) => !a.cmp), cmp = A.filter((a) => a.cmp);
    const card = (a) => { const st = stOf(a.stMap, a.status);
      return `<a class="card bot-card${a.main ? ' main' : ''}" href="#bot/${a.id}"><div class="row between"><div><p class="b">${esc(a.name)} ${a.main ? '<span class="tag">대표</span>' : ''}</p><p class="muted xs">${esc(a.strat)} · ${esc(a.tf)}</p></div><span class="act ${st[1]}">${st[0]}</span></div>
        <div class="bot-mid"><div><p class="num bot-ret ${dirClass(a.ret)}">${pct(a.ret, 2)}</p><p class="muted xs num">${won(a.equity)}</p></div>${spark(a.curve, 110, 36)}</div>
        <div class="bot-stats"><span>거래 <b class="num">${a.st.n}</b></span><span>승률 <b class="num">${a.st.win == null ? '—' : Math.round(a.st.win) + '%'}</b></span><span>손익비 <b class="num">${fmtPF(a.st.pf)}</b></span><span>낙폭 <b class="num">${a.st.mdd == null ? '—' : pct(a.st.mdd, 1)}</b></span><span>포지션 <b class="num">${a.positions.length}</b></span></div></a>`; };
    return `<header class="top"><div><p class="kicker">코인 선물 · 가상 1억씩 · 24시간 자동</p><h1>봇</h1></div>${tools()}</header>
      ${live.length ? live.map(card).join('') : '<section class="card empty"><p class="h-md">봇 결과를 불러오는 중이에요</p></section>'}
      ${cmp.length ? `<h2 class="sec">비교용 계좌</h2><p class="muted xs pad">새 방법이 정말 나은지 보려고 같이 돌리는 기준 계좌예요.</p>${cmp.map(card).join('')}` : ''}
      <h2 class="sec">주식 봇 (모의)</h2>${homePaper().replace('href="#paper"', 'href="#stocks"')}`;
  }

  /* ---------- 봇 상세 ---------- */
  function viewBot() {
    const id = S.ui.bot, A = accounts(true), a = A.find((x) => x.id === id);
    const head = (t, k) => `<header class="top"><div><a href="#paper" class="back">‹ 봇</a><p class="kicker">${esc(k || '')}</p><h1>${esc(t)}</h1></div>${tools()}</header>`;
    if (!a) return head('봇') + '<section class="card empty"><p class="h-md">불러오는 중이에요</p></section>';
    const st = stOf(a.stMap, a.status), x = a.st, tab = S.ui.botTab || 'perf';
    const top = `<section class="card dash-hero"><div class="row between"><p class="kpi-l">${esc(a.strat)} · ${esc(a.tf)}</p><span class="act ${st[1]}">${st[0]}</span></div>
      <p class="dash-big num ${dirClass(a.ret)}">${pct(a.ret, 2)}</p><p class="dash-sub num">${won(a.equity)} <span class="muted">· ${a.since ? kT(a.since) + '부터' : ''}${a.upd ? ' · 갱신 ' + agoTxt(Date.now() - Date.parse(a.upd)) : ''}</span></p>
      <div class="kpis k3">${kpi('승률', x.win == null ? '—' : Math.round(x.win) + '%', '', '거래 ' + x.n)}${kpi('손익비', fmtPF(x.pf), x.pf != null && x.pf >= 1 ? 'up' : x.pf != null ? 'down' : '', '평균 ' + (x.avgR == null ? '—' : rr(x.avgR)))}${kpi('최대 낙폭', x.mdd == null ? '—' : pct(x.mdd, 1), x.mdd < -10 ? 'down' : '', '연속 손실 ' + x.worstStreak)}</div></section>`;
    const chart = `<section class="card"><div class="card-head"><h2>자산 곡선</h2>${periodSeg('bp')}</div>${eqChart([{ name: a.name, curve: a.curve, start: a.start }], { from: periodFrom('bp'), base: (S.ui.bp || 'all') === 'all' })}</section>`;
    const seg = `<div class="seg" role="tablist">${[['perf', '거래'], ['ana', '분석'], ['val', '검증']].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-act="bot-tab" data-v="${k}">${l}</button>`).join('')}</div>`;
    let body = '';
    if (tab === 'perf') {
      body = `<section class="card"><h2>포지션 ${a.positions.length}</h2>${a.positions.length ? `<div class="tbl">${a.positions.map((p) => `<div class="tr2"><span>${sideTag(p.side)} <b>${esc(p.name)}</b> <span class="muted xs">${p.lev != null ? p.lev + '배' : ''}</span></span><span class="num xs muted">${usd(p.entry)} → ${usd(p.mark)} · ${p.be || (p.stop != null && Math.abs(p.stop / p.entry - 1) < 1e-6) ? '본전 손절' : p.trail ? '추적 손절' : '손절'} ${usd(p.stop)}${p.tp ? ' · 목표 ' + usd(p.tp) : ''}</span><span class="num ${dirClass(p.upnl)}">${p.upnl >= 0 ? '+' : ''}${man(p.upnl)}</span></div>`).join('')}</div>` : '<p class="muted sm">지금은 포지션이 없어요.</p>'}</section>
        <section class="card"><h2>거래 기록 ${x.n}</h2>${x.n ? `<div class="tbl">${a.trades.slice(0, 40).map((t) => `<div class="tr2"><span>${sideTag(t.side)} <b>${esc(t.name)}</b><span class="muted xs"> ${kT(t.in)} → ${kT(t.out)}</span></span><span class="muted xs">${esc(t.reason || '')} · ${rr(t.R || 0)}</span><span class="num ${dirClass(t.pnl)}">${t.pnl >= 0 ? '+' : ''}${man(t.pnl)}</span></div>`).join('')}</div>` : '<p class="muted sm">아직 끝난 거래가 없어요.</p>'}</section>`;
    } else if (tab === 'ana') body = anaBlocks(a.trades, a.name);
    else body = valBlock(a);
    return head(a.name, a.code + ' · 가상 1억 · 실제 돈 아님') + top + chart + seg + body + `<a class="lrow-mini pad" href="${a.href}">전략 화면 자세히 보기 ›</a>`;
  }
  function anaBlocks(trades, who) {
    const tr = (trades || []).filter((t) => t && t.pnl != null);
    if (tr.length < 3) return `<section class="card"><p class="muted sm">분석하려면 끝난 거래가 3개 이상 필요해요 (지금 ${tr.length}개). 거래가 쌓이면 방향·코인·청산 이유별로 무엇이 잘 되고 안 되는지 보여 드려요.</p></section>`;
    const tbl = (title, rows, note) => `<section class="card"><h2>${title}</h2><div class="ftbl-wrap"><table class="ftbl num"><thead><tr><th></th><th>거래</th><th>승률</th><th>평균</th><th>손익</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.label)}</td><td>${r.n}</td><td>${Math.round(r.win)}%</td><td class="${dirClass(r.avgR)}">${rr(r.avgR)}</td><td class="${dirClass(r.pnl)}">${(r.pnl >= 0 ? '+' : '') + man(r.pnl)}</td></tr>`).join('')}</tbody></table></div>${note ? `<p class="muted xs">${note}</p>` : ''}</section>`;
    const holdK = (t) => { const h = (tOf(t.out) - tOf(t.in)) / 36e5; return !isFinite(h) ? null : h < 2 ? '0~2시간' : h < 8 ? '2~8시간' : h < 24 ? '8~24시간' : h < 72 ? '1~3일' : '3일 넘게'; };
    const hourK = (t) => { const d = new Date(tOf(t.in)); if (!isFinite(d)) return null; const h = d.getHours(); return h < 6 ? '00~06시' : h < 12 ? '06~12시' : h < 18 ? '12~18시' : '18~24시'; };
    return tbl('롱 · 숏', groupBy(tr, (t) => t.side, (k) => SIDE[k][0])) + tbl('코인별', groupBy(tr, (t) => t.name)) + tbl('어떻게 끝났나', groupBy(tr, (t) => (t.reason || '').replace(/\s*\(.*\)$/, '').replace(/ \d+(\.\d+)?R$/, '')), '손절이 많아도 익절이 크면 괜찮아요. 평균(R)이 플러스인지가 중요해요.')
      + tbl('보유 시간', groupBy(tr, holdK)) + tbl('진입 시간 (한국 시각)', groupBy(tr, hourK)) + (tr.some((t) => t.kind) ? tbl('셋업별', groupBy(tr, (t) => t.kind, (k) => SETUP[k] || k)) : '');
  }
  function valBlock(a) {
    const b = a.bt, x = a.st;
    if (!b) return `<section class="card"><h2>검증</h2><p class="muted sm">이 계좌는 따로 과거 시험 결과가 없어요. 실시간 기록으로만 판단해요.</p></section>`;
    const row = (l, bv, lv) => `<tr><td>${l}</td><td>${bv}</td><td>${lv}</td></tr>`;
    return `<section class="card"><h2>시험 vs 실전</h2><p class="muted xs">과거 시험(${esc(b.label)})과 실시간 모의 성적을 나란히 봐요. 실전이 시험보다 훨씬 나쁘면 규칙이 과거에만 맞았을 수 있어요.</p>
      <div class="ftbl-wrap"><table class="ftbl num"><thead><tr><th></th><th>시험</th><th>실전(모의)</th></tr></thead><tbody>
      ${row('수익', b.cagr != null ? '연 ' + pct(b.cagr, 1) : pct(b.ret, 1) + (b.days ? ' (' + b.days + '일)' : ''), pct(a.ret, 2))}
      ${row('승률', b.win == null ? '—' : Math.round(b.win) + '%', x.win == null ? '—' : Math.round(x.win) + '%')}
      ${row('손익비', b.pf == null ? '—' : b.pf, fmtPF(x.pf))}
      ${row('최대 낙폭', b.mdd == null ? '—' : pct(b.mdd, 1), x.mdd == null ? '—' : pct(x.mdd, 1))}
      ${row('거래 수', b.n == null ? '—' : b.n, x.n)}</tbody></table></div>
      ${b.pass != null ? `<p class="sm" style="margin-top:8px">시험 판정: <b>${b.pass ? '합격' : '불합격'}</b></p>` : ''}
      ${x.n < 20 ? `<p class="muted xs">실전 거래가 ${x.n}번이라 아직 비교하기 일러요. 20번 넘으면 의미가 생겨요.</p>` : ''}</section>`;
  }

  /* ---------- 분석: 모든 봇 비교 + 자동 점검 + 업그레이드 기록 ---------- */
  function insights(A) {
    const out = [], live = A.filter((a) => !a.cmp);
    live.forEach((a) => {
      const tr = (a.trades || []).filter((t) => t.pnl != null), x = a.st;
      if (a.upd && Date.now() - Date.parse(a.upd) > 3 * 3600e3) out.push({ lv: 'bad', title: a.name + ' 갱신 멈춤', text: agoTxt(Date.now() - Date.parse(a.upd)) + ' 동안 새 결과가 없어요. 본부에서 원인을 확인하세요.' });
      if (x.mdd != null && x.mdd <= -10) out.push({ lv: 'bad', title: a.name + ' 낙폭 ' + pct(x.mdd, 1), text: '고점 대비 많이 빠졌어요. 위험을 줄이거나 규칙을 점검할 때예요.' });
      if (tr.length >= 20) {
        const sides = groupBy(tr, (t) => t.side); sides.forEach((g) => { if (g.n >= 10 && g.avgR <= -0.25) out.push({ lv: 'warn', title: a.name + ' ' + SIDE[g.k][0] + ' 성적 나쁨', text: SIDE[g.k][0] + ' ' + g.n + '번 평균 ' + rr(g.avgR) + ' — ' + SIDE[g.k][0] + ' 조건을 더 까다롭게 하거나 끄는 걸 검토해요.' }); });
        groupBy(tr, (t) => t.name).forEach((g) => { if (g.n >= 8 && g.avgR <= -0.4) out.push({ lv: 'warn', title: a.name + ' · ' + g.label + ' 계속 손실', text: g.n + '번 평균 ' + rr(g.avgR) + ' — 이 코인을 빼는 걸 검토해요.' }); });
        if (a.bt && a.bt.win != null && x.win != null && x.win < a.bt.win - 15) out.push({ lv: 'warn', title: a.name + ' 실전이 시험보다 나쁨', text: '승률 시험 ' + Math.round(a.bt.win) + '% → 실전 ' + Math.round(x.win) + '%. 과거에만 맞는 규칙일 수 있어요.' });
      }
    });
    const best = live.filter((a) => a.st.n >= 5).sort((p, q) => q.ret - p.ret)[0];
    if (best && best.ret > 0) out.push({ lv: 'good', title: best.name + ' 가장 좋음 ' + pct(best.ret, 2), text: '거래 ' + best.st.n + '번 · 승률 ' + Math.round(best.st.win) + '% · 손익비 ' + fmtPF(best.st.pf) });
    const nAll = live.reduce((s, a) => s + a.st.n, 0);
    if (nAll < 20) out.push({ lv: 'info', title: '아직 판단하기엔 거래가 적어요', text: '모든 봇 합쳐 끝난 거래 ' + nAll + '번. 20번이 넘으면 무엇이 잘 되고 안 되는지 자동으로 짚어 드려요.' });
    return out;
  }
  const CHANGES = [
    ['11/24', '민경기 봇 3세대', '추세 돌파(검증된 규칙) 후보에 학습 필터를 더함. FLUX 혼자와 매주 비교', 'mk3'],
    ['11/24', '선물 데이터 수집', '서울 서버가 바이낸스 펀딩비·미결제약정·롱숏 비율·4시간봉 6년치를 모음', null],
    ['11/24', '긴급 탈출 (단타)', '거래량 3배 + 반대 장대봉 + 20EMA 돌파 시 즉시 정리 → 시험 -44.2% → -54.7%로 나빠져 꺼 둠', null],
    ['11/24', '민경기 2세대 보정', '모델이 자신을 과신(40%라 했지만 실제 30%) → 시험 성적으로 확률 보정, 우위 없으면 쉼', null],
    ['11/24', '민경기 2세대', '1시간봉 2년 · 재료 26개 학습 → 워크포워드 -69.8%로 불합격', null],
    ['11/24', '민경기 1세대', '리만·나비에-스토크스 규칙만 → 시험 -27.5%로 불합격, 비교용으로 유지', null]
  ];
  function viewAnalysis() {
    const A = accounts(true), tab = S.ui.anaTab || 'cmp';
    const head = `<header class="top"><div><p class="kicker">성과를 보고 · 원인을 찾고 · 봇을 고쳐요</p><h1>분석</h1></div>${tools()}</header>`;
    if (!A.length) return head + '<section class="card empty"><p class="h-md">불러오는 중이에요</p></section>';
    const seg = `<div class="seg" role="tablist">${[['cmp', '비교'], ['why', '원인'], ['log', '업그레이드']].map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-act="ana-tab" data-v="${k}">${l}</button>`).join('')}</div>`;
    let body = '';
    if (tab === 'cmp') {
      body = `<section class="card"><div class="card-head"><h2>수익률 비교</h2>${periodSeg('ap')}</div>${eqChart(A.map((a) => ({ name: a.name, curve: a.curve, start: a.start })), { from: periodFrom('ap'), base: (S.ui.ap || 'all') === 'all', h: 220 })}</section>
        <section class="card"><h2>성과표</h2><div class="ftbl-wrap"><table class="ftbl num"><thead><tr><th>봇</th><th>수익</th><th>거래</th><th>승률</th><th>손익비</th><th>평균</th><th>낙폭</th></tr></thead><tbody>
        ${A.slice().sort((a, b) => b.ret - a.ret).map((a) => `<tr${a.main ? ' class="hl"' : ''}><td><a href="#bot/${a.id}">${esc(a.name)}</a>${a.cmp ? ' <span class="muted xs">비교</span>' : ''}</td><td class="${dirClass(a.ret)}">${pct(a.ret, 2)}</td><td>${a.st.n}</td><td>${a.st.win == null ? '—' : Math.round(a.st.win) + '%'}</td><td>${fmtPF(a.st.pf)}</td><td class="${dirClass(a.st.avgR)}">${a.st.avgR == null ? '—' : rr(a.st.avgR)}</td><td>${a.st.mdd == null ? '—' : pct(a.st.mdd, 1)}</td></tr>`).join('')}</tbody></table></div>
        <p class="muted xs">손익비 = 번 돈 ÷ 잃은 돈 (1보다 커야 수익). 평균 = 거래 한 번에 건 위험 대비 평균 결과(R).</p></section>`;
    } else if (tab === 'why') {
      const all = [].concat(...A.filter((a) => !a.cmp).map((a) => a.trades || []));
      const ins = insights(A);
      body = `<section class="card"><h2>자동 점검</h2>${ins.length ? ins.map((x) => `<div class="ins ${x.lv}"><p class="sm"><b>${esc(x.title)}</b></p><p class="muted xs">${esc(x.text)}</p></div>`).join('') : '<p class="muted sm">특별히 짚을 문제가 없어요.</p>'}</section>
        <p class="muted xs pad">아래는 비교용을 뺀 모든 봇의 거래를 합친 분석이에요. 봇별로 보려면 봇 화면 → 분석 탭.</p>` + anaBlocks(all, '전체');
    } else {
      const M3 = S.mk3;
      body = `<section class="card"><h2>업그레이드 기록</h2><p class="muted xs">무엇을 바꿨고, 시험 결과가 어땠는지 남겨요. 결과가 나쁘면 되돌려요.</p>
        ${CHANGES.map(([d, t, x, k]) => `<div class="chg"><p class="sm"><span class="muted num">${d}</span> <b>${esc(t)}</b></p><p class="muted xs">${esc(x)}${k === 'mk3' && M3 && M3.wf && M3.wf.study ? ' · 최근 시험: 민경기 연 ' + pct(M3.wf.study[1].all.cagr, 1) + ' vs FLUX 연 ' + pct(M3.wf.study[0].all.cagr, 1) + (M3.wf.pass && M3.wf.pass.ok ? ' (합격)' : ' (불합격)') : ''}</p></div>`).join('')}</section>
        <section class="card"><h2>다음 업그레이드 후보</h2>
          <div class="chg"><p class="sm"><b>미결제약정·롱숏 비율 재료</b></p><p class="muted xs">서버가 90일치를 모으면 민경기 봇이 자동으로 다시 배워요 (약 2달).</p></div>
          <div class="chg"><p class="sm"><b>일봉 추세 후보 추가</b></p><p class="muted xs">4시간봉에 일봉 돌파 후보를 더해 거래 기회를 늘리는 시험.</p></div>
          <div class="chg"><p class="sm"><b>실전 연결 준비</b></p><p class="muted xs">시험 합격 + 실시간 모의 4주 이상 비슷할 때. 거래소에 손절 주문을 미리 거는 방식.</p></div></section>`;
    }
    return head + seg + body;
  }
  const VIEWS = { bot: viewBot, analysis: viewAnalysis, stocks: viewPaper, mk: viewMk, quants: viewQuants, words: viewWords, scalp: viewScalp, futures: viewFutures, hq: viewHQ, explore: viewExplore, more: viewMore, paper: viewBots, alerts: viewAlerts, calendar: viewCalendar, review: viewReview, chart: viewChart, world: viewWorld, rank: viewRank, home: viewHome, assets: viewAssets, score: viewScore, coin: viewCoin, journal: viewJournal, compare: viewCompare, cycle: viewCycle };
  const TAB_OF = { bot: 'paper', stocks: 'paper', assets: 'more', world: 'explore', mk: 'paper', quants: 'explore', words: 'more', scalp: 'paper', futures: 'paper', hq: 'home', compare: 'explore', cycle: 'explore', rank: 'explore', world: 'explore', chart: 'explore', score: 'explore', coin: 'explore', review: 'more', calendar: 'more', journal: 'more', alerts: 'more' };
  function route() { let h = (location.hash || '#home').slice(1); if (h.indexOf('bot/') === 0) { S.ui.bot = h.slice(4); h = 'bot'; } return VIEWS[h] ? h : 'home'; }
  function tape() {
    const item = (k, label) => { const m = S.markets[k]; if (!m) return ''; const f = fmtMarket(m); return `<span class="tk"><b>${label}</b> ${esc(f.v)} <em class="${dirClass(m.chg)}">${esc(f.c)}</em></span>`; };
    const coin = (mk, label) => { const p = S.prices[mk]; return p ? `<span class="tk"><b>${label}</b> ${nf(p.krw)} <em class="${dirClass(p.chg24)}">${sign(p.chg24, 2)}%</em></span>` : ''; };
    const fx = (c, label) => { const L = S.fxLive && S.fxLive.rates && S.fxLive.rates[c]; return L ? `<span class="tk"><b>${label}</b> ${nf(L.krw * (c === 'JPY' ? 100 : 1), 2)}${L.chgPct != null && !isNaN(L.chgPct) ? ` <em class="${dirClass(L.chgPct)}">${sign(L.chgPct, 2)}%</em>` : ''}</span>` : ''; };
    return `<div class="tape num" aria-label="주요 시세">${[item('kospi', '코스피'), item('spx', 'S&P500'), item('usdkrw', '원/달러'), fx('JPY', '엔(100)'), fx('CNY', '위안'), fx('EUR', '유로'), item('us10y', '미 10년 금리'), item('dxy', '달러지수'), item('vix', '공포지수'), item('gold', '금'), item('brent', '유가'), coin('KRW-BTC', '비트코인'), coin('KRW-ETH', '이더리움')].join('')}</div>`;
  }
  function render() {
    const r = route();
    const el = document.getElementById('view');
    el.innerHTML = VIEWS[r]();
    if (document.body && document.body.classList) document.body.classList.toggle('wide', r === 'hq');
    if (r === 'hq') startPatrol();
    document.querySelectorAll('.tabbar a').forEach((a) => {
      const on = a.dataset.tab === (TAB_OF[r] || r);
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }
  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

  /* ---------- 사용자 동작 ---------- */
  document.addEventListener('change', (e) => { if (e.target.id === 'extra-cash') { S.extraCash = Math.max(0, Number(e.target.value) || 0); store.set('snw.extraCash', S.extraCash); render(); } });
  document.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[role=button][data-act]')) { e.preventDefault(); e.target.click(); } });
  document.addEventListener('input', (e) => {
    const f = e.target.form;
    if (!f || f.id !== 'score-form' || e.target.name !== 'q') return;
    const q = e.target.value, hint = document.getElementById('sector-hint'), sel = f.querySelector('select[name=sector]');
    if (hint) hint.textContent = sectorHint(q);
    const st = !findCoin(q) && T.findStock(q);
    if (sel) sel.value = st && st.sector ? st.sector : (findCoin(q) ? '' : sel.value);
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act, v = b.dataset.v, id = b.dataset.id;
    if (act === 'basis') { S.ui.compareBasis = v; render(); }
    else if (act === 'phase') { S.ui.phase = Number(v); render(); }
    else if (act === 'coin') { S.ui.coin = v; render(); ensureCloses(v); }
    else if (act === 'bigtext') { const on = !document.documentElement.classList.contains('big'); document.documentElement.classList.toggle('big', on); try { localStorage.setItem('snw.big', on ? '1' : ''); } catch (err) { /* 무시 */ } render(); }
    else if (act === 'guide-done') { try { localStorage.setItem('snw.guide', '1'); } catch (err) { /* 무시 */ } render(); }
    else if (act === 'guide-reset') { try { localStorage.removeItem('snw.guide'); } catch (err) { /* 무시 */ } location.hash = '#home'; }
    else if (act === 'theme') { const d = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = d; try { localStorage.setItem('snw.theme', d); } catch (err) { /* 무시 */ } const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = d === 'dark' ? '#101013' : '#F2F4F6'; render(); }
    else if (act === 'paper-bot') { S.ui.paperBot = v; if (v !== 'team' && !S.ui.paperTab) S.ui.paperTab = 'live'; render(); }
    else if (act === 'paper-tab') { S.ui.paperTab = v; render(); }
    else if (act === 'tv') openTV(v, b.dataset.name, b.dataset.iv);
    else if (act === 'sc-tab') { S.ui.scTab = v; render(); }
    else if (act === 'period') { S.ui[b.dataset.k] = v; render(); }
    else if (act === 'bot-tab') { S.ui.botTab = v; render(); }
    else if (act === 'ana-tab') { S.ui.anaTab = v; render(); }
    else if (act === 'fut-tab') { S.ui.futTab = v; render(); window.scrollTo(0, 0); }
    else if (act === 'vault-forget') { store.set('snw.vaultKey', null); location.reload(); }
    else if (act === 'demo') { S.demo = !S.demo; store.set('snw.demo', S.demo); LIVE = S.demo ? DEMO : REAL; S.ui.scoreResult = null; render(); loadPrices([]).then(render); allHoldings().filter((h) => h.type === 'coin').forEach((h) => ensureCloses(h.market)); }
    else if (act === 'chart') { S.ui.chartFrom = route(); S.ui.chart = { kind: b.dataset.kind, id: v, name: b.dataset.name }; if (b.dataset.kind === 'coin') ensureCloses(v); location.hash = '#chart'; }
    else if (act === 'push-on') { enablePush(); }
    else if (act === 'push-test') { testNotify(); }
    else if (act === 'push-copy') { const t = document.querySelector('textarea.code'); if (t) { t.select(); (navigator.clipboard ? navigator.clipboard.writeText(t.value) : Promise.reject()).then(() => { S.ui.pushMsg = '복사했습니다.'; render(); }).catch(() => { document.execCommand && document.execCommand('copy'); }); } }
    else if (act === 'p-axis') { S.ui.pAxis = v; render(); }
    else if (act === 'axis') { S.ui.axis = v; render(); }
    else if (act === 'cal-day') { S.ui.calDay = v; render(); }
    else if (act === 'cal-month') { S.ui.calMonth = v; S.ui.calDay = null; render(); }
    else if (act === 'edit-profile') { S.ui.editProfile = true; render(); window.scrollTo(0, 0); }
    else if (act === 'ta') { S.ta[v] = !S.ta[v]; store.set('snw.ta', S.ta); render(); }
    else if (act === 'ta-sub') { S.ta.sub = v; store.set('snw.ta', S.ta); render(); }
    else if (act === 'chart-range') { S.ui.chartRange = Number(v); render(); }
    else if (act === 'rank-tab') { e.preventDefault(); S.ui.rankTab = v; if (location.hash !== '#rank') location.hash = '#rank'; else render(); }
    else if (act === 'rank-stock') { const it = U && Object.values(U.LIST).flat().find((x) => x.s === v); location.hash = '#score'; runScore(it ? it.n + ' (' + it.s + ')' : v, b.dataset.sec || ''); }
    else if (act === 'rank-coin') { const c = S.coinList.find((x) => x.market === v); location.hash = '#score'; runScore(c && c.name ? c.name + ' (' + c.symbol + ')' : v.slice(4) + ' (' + v.slice(4) + ')', ''); }
    else if (act === 'asset-tab') { S.ui.assetTab = v; render(); }
    else if (act === 'toggle-add') { S.ui.showAdd = !S.ui.showAdd; render(); }
    else if (act === 'add-type') { S.ui.addType = v; render(); }
    else if (act === 'del-holding') {
      const h = S.holdings.find((x) => x.id === id);
      if (h && confirm(h.name + '을(를) 목록에서 지울까요?')) { S.holdings = S.holdings.filter((x) => x.id !== id); store.set('snw.holdings', S.holdings); render(); }
    }
    else if (act === 'score-holding') {
      const h = allHoldings().find((x) => x.id === id);
      if (!h) return;
      location.hash = '#score';
      const v = holdingValue(h), c0 = holdingCost(h), tot = allHoldings().reduce((t, x) => t + (holdingValue(x) || 0), 0) + (LIVE && LIVE.cashKrw ? LIVE.cashKrw : 0);
      const pos = { pnl: v != null && c0 ? (v - c0) / c0 * 100 : null, weight: v != null && tot ? v / tot * 100 : null, currency: h.currency };
      if (h.type === 'coin') { const c = S.coinList.find((x) => x.market === h.market); runScore(c ? c.name + ' (' + c.symbol + ')' : h.symbol + ' (' + h.symbol + ')', '', pos); }
      else runScore(h.symbol && /^[A-Z.]+$/.test(h.symbol) ? h.symbol : h.name, h.sector, pos);
    }
    else if (act === 'jr-result') { const j = S.journal.find((x) => x.id === id); if (j) { j.result = j.result === v ? null : v; store.set('snw.journal', S.journal); render(); } }
    else if (act === 'jr-del') { if (confirm('이 일지를 지울까요?')) { S.journal = S.journal.filter((x) => x.id !== id); store.set('snw.journal', S.journal); render(); } }
  });

  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (f.id === 'toss-cost-form') {
      e.preventDefault();
      const v = Math.round(Number(String(new FormData(f).get('v') || '').replace(/[^0-9.]/g, '')) || 0);
      S.tossCost = v; store.set('snw.tossCost', v); render(); return;
    }
    if (f.id === 'vault-form') {
      e.preventDefault();
      const pw = new FormData(f).get('pw'), remember = document.getElementById('vault-remember');
      S.ui.vaultMsg = '여는 중…'; render();
      vaultKey(S.vault, String(pw)).then(async (kb) => {
        const data = await openVault(S.vault, kb);
        if (remember && remember.checked) store.set('snw.vaultKey', { salt: S.vault.salt, key: btoa(String.fromCharCode.apply(null, kb)) });
        S.ui.vaultMsg = ''; useVault(data); render();
      }).catch(() => { S.ui.vaultMsg = '비밀번호가 맞지 않습니다.'; render(); });
      return;
    }
    if (f.id === 'profile-form') {
      e.preventDefault();
      const fd = new FormData(f), ans = R.PROFILE_Q.map((_, i) => Number(fd.get('q' + i)));
      const p = R.profileFromAnswers(ans);
      S.profile = { id: p.id, answers: ans, points: p.points, at: Date.now() }; store.set('snw.profile', S.profile); S.ui.editProfile = false; render(); window.scrollTo(0, 0);
      return;
    }
    if (f.id === 'add-form') {
      e.preventDefault();
      const fd = new FormData(f);
      const qty = Number(fd.get('qty')), avg = Number(fd.get('avg'));
      if (S.ui.addType === 'coin') {
        const c = findCoin(fd.get('coin'));
        if (!c) { f.querySelector('#add-msg').textContent = '목록에서 코인을 골라 주세요.'; return; }
        S.holdings.push({ id: uid(), type: 'coin', name: c.name, market: c.market, qty, avg });
        loadPrices([c.market]).then(render); ensureCloses(c.market);
      } else {
        S.holdings.push({ id: uid(), type: 'stock', name: String(fd.get('name')).trim(), sector: fd.get('sector'), qty, avg, price: Number(fd.get('price')) });
      }
      store.set('snw.holdings', S.holdings);
      S.ui.showAdd = false; render();
    }
    if (f.id === 'score-form') {
      e.preventDefault();
      const fd = new FormData(f);
      runScore(String(fd.get('q') || ''), String(fd.get('sector') || ''));
    }
    if (f.id === 'journal-form') {
      e.preventDefault();
      const fd = new FormData(f);
      S.journal.push({ id: uid(), date: new Date().toLocaleDateString('ko-KR'), what: fd.get('what'), why: fd.get('why'), wrong: fd.get('wrong'), weather: weather().title, result: null });
      store.set('snw.journal', S.journal); render();
    }
  });

  // 토스증권 종목 업종 고르기
  document.addEventListener('change', (e) => {
    const sym = e.target.dataset && e.target.dataset.sectorFor;
    if (!sym) return;
    S.sectorMap[sym] = e.target.value; store.set('snw.sectorMap', S.sectorMap); render();
  });

  // 리스크 계산기: 입력할 때마다 결과만 다시 그림(입력 칸은 그대로)
  document.addEventListener('input', (e) => {
    const k = e.target.dataset && e.target.dataset.risk;
    if (!k) return;
    S.risk[k] = Number(e.target.value);
    const out = document.getElementById('risk-out'); if (out) out.innerHTML = riskOut();
    const pct = document.getElementById('risk-pct'); if (pct) pct.textContent = S.risk.pct + '%';
  });

  /* ---------- 데이터 불러오기 ---------- */
  async function loadFx() {
    try {
      const r = await A.fxLive();
      S.fxLive = { ...r, at: r._at };
      const u = r.rates.USD;
      if (u && u.krw) S.markets.usdkrw = { ...S.markets.usdkrw, value: u.krw, chg: u.chg != null && !isNaN(u.chg) ? Math.round(u.chg * 10) / 10 : S.markets.usdkrw.chg, chgUnit: '원', hint: r.source + (r.live ? ' · 실시간' : '') };
    } catch (e) { /* 실패하면 시장 데이터·기본값 유지 */ }
  }
  async function loadPrices(markets) {
    const all = Array.from(new Set(['KRW-BTC', 'KRW-ETH'].concat(SNAP.rankCoins, markets || []).concat(allHoldings().filter((h) => h.type === 'coin').map((h) => h.market))));
    try {
      const r = await A.coinPrices(all);
      Object.assign(S.prices, r.prices); S.priceSource = r.source; S.priceAt = r._at;
    } catch (e) { /* 네트워크 없음: 가격 없이 표시 */ }
  }
  function putCandles(market, c) { S.closes[market] = c.closes; S.candles[market] = { c: c.closes, o: c.opens, h: c.highs, l: c.lows, v: c.vols, t: c.times, source: c.source }; }
  async function ensureCloses(market) {
    if (S.closes[market]) return;
    try { const c = await A.dailyCloses(market); putCandles(market, c); render(); } catch (e) { /* 무시 */ }
  }
  async function boot() {
    render();
    loadPolicy();
    const jobs = [
      tryVault(),
      loadPrices([]),
      A.fearGreed().then((r) => { S.fng = r.value; S.fngFrom = r._from === 'live' ? 'live' : 'cache'; }).catch(() => {}),
      A.cryptoGlobal().then((r) => { S.totalCapT = r.totalCapT; S.btcDominance = r.btcDominance; }).catch(() => {}),
      loadFx(),
      A.coinList().then((r) => { if (r.list && r.list.length) S.coinList = r.list; }).catch(() => {}),
      A.fxRates ? A.fxRates().then((r) => { S.fx = r.rates; }).catch(() => {}) : null
    ];
    await Promise.all(jobs);
    render();
    const coins = Array.from(new Set(['KRW-BTC', 'KRW-ETH'].concat(allHoldings().filter((h) => h.type === 'coin').map((h) => h.market), SNAP.rankCoins)));
    for (const m of coins) await ensureCloses(m);
    recordToday(); render();
    // 1분마다 시세 갱신. 입력 중이면 화면을 다시 그리지 않음(적던 글이 지워지지 않게)
    setInterval(() => {
      Promise.all([loadPrices([]), loadFx()]).then(() => {
        recordToday();
        const a = document.activeElement;
        if (a && a.closest && a.closest('form, #risk-form')) return;
        render();
      });
    }, 60 * 1000);
  }

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  boot();
})();
