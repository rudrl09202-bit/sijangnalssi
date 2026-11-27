/*
 * 시장날씨 — 모의투자 엔진 (Quant)
 *
 * 브라우저와 Node 양쪽에서 쓰는 순수 계산 파일입니다. 네트워크·저장소에 손대지 않습니다.
 *  1) 지표: 이동평균, ATR(와일더), RSI, 신고가·신저가, 변동성, 모멘텀
 *  2) 봇 5개 (각자 가상 계좌 1억 원)
 *     ATLAS  추세 돌파   — 미너비니 트렌드 템플릿 + 터틀식 피라미딩·추적 손절
 *     ECHO   눌림목 반등 — 코너스 RSI(2) 평균회귀 (200일선 위에서만)
 *     ORBIT  모멘텀 순환 — 12-1 모멘텀 상위 + 절대 모멘텀(듀얼 모멘텀), 위험 회피 땐 금·현금
 *     NOVA   코인 추세   — 추세 필터 + 변동성 목표 비중
 *     CHIEF  시장날씨 점수 — 앱의 월가 스크리너 점수 + 분할 매수 계획 그대로
 *  3) VAULT 금고: 종목·업종 비중 한도, 시장 위험 필터, 하루 손실 차단, 낙폭 정지, 연속 손실 축소
 *  4) 체결 흉내: 신호는 종가에 → 다음 거래일 시가에 체결(미래 정보 사용 금지), 수수료·세금·슬리피지 반영
 *  5) 성적표: CAGR·샤프·소르티노·최대낙폭·칼마·승률·손익비·기대값(R)·월별/연도별·표본 외 구간·몬테카를로
 *
 * 상태(state)는 JSON 으로 저장·복원할 수 있어서, 백테스트와 실시간 모의투자가 같은 코드로 돕니다.
 */
(function (root) {
  'use strict';

  /* ===================== 1. 지표 (모두 그 날까지의 값만 사용) ===================== */
  function smaArr(a, n) {
    const out = new Array(a.length).fill(null); let s = 0;
    for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) out[i] = s / n; }
    return out;
  }
  function emaArr(a, n) {
    const out = new Array(a.length).fill(null), k = 2 / (n + 1); let e = null, s = 0;
    for (let i = 0; i < a.length; i++) {
      if (i < n - 1) { s += a[i]; continue; }
      if (i === n - 1) { s += a[i]; e = s / n; } else e = a[i] * k + e * (1 - k);
      out[i] = e;
    }
    return out;
  }
  function atrArr(h, l, c, n) { // 와일더 ATR
    const out = new Array(c.length).fill(null); let a = null, s = 0;
    for (let i = 1; i < c.length; i++) {
      const tr = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
      if (i <= n) { s += tr; if (i === n) { a = s / n; out[i] = a; } } else { a = (a * (n - 1) + tr) / n; out[i] = a; }
    }
    return out;
  }
  function rsiArr(c, n) { // 와일더 RSI
    const out = new Array(c.length).fill(null); let g = 0, l = 0;
    for (let i = 1; i < c.length; i++) {
      const d = c[i] - c[i - 1], up = d > 0 ? d : 0, dn = d < 0 ? -d : 0;
      if (i <= n) { g += up; l += dn; if (i === n) { g /= n; l /= n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } }
      else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
    }
    return out;
  }
  function rollMax(a, n) { const out = new Array(a.length).fill(null); for (let i = n - 1; i < a.length; i++) { let m = -Infinity; for (let j = i - n + 1; j <= i; j++) if (a[j] > m) m = a[j]; out[i] = m; } return out; }
  function rollMin(a, n) { const out = new Array(a.length).fill(null); for (let i = n - 1; i < a.length; i++) { let m = Infinity; for (let j = i - n + 1; j <= i; j++) if (a[j] < m) m = a[j]; out[i] = m; } return out; }
  function volArr(c, n, perYear) { // 연율화 변동성(%)
    const out = new Array(c.length).fill(null); const r = c.map((x, i) => (i ? Math.log(x / c[i - 1]) : 0));
    let s = 0, s2 = 0;
    for (let i = 1; i < c.length; i++) {
      s += r[i]; s2 += r[i] * r[i];
      if (i > n) { s -= r[i - n]; s2 -= r[i - n] * r[i - n]; }
      if (i >= n) { const m = s / n, v = Math.max(0, s2 / n - m * m); out[i] = Math.sqrt(v * perYear) * 100; }
    }
    return out;
  }
  const ret = (c, i, n) => (i >= n && c[i - n] > 0 ? c[i] / c[i - n] - 1 : null);

  // 자산 하나의 지표를 한 번에 미리 계산
  function prepare(a) {
    const { c, h, l } = a, n = c.length, perYear = a.kind === 'coin' ? 365 : 252;
    const v = a.v || new Array(n).fill(0);
    a.ind = {
      sma5: smaArr(c, 5), sma20: smaArr(c, 20), sma50: smaArr(c, 50), sma100: smaArr(c, 100), sma150: smaArr(c, 150), sma200: smaArr(c, 200),
      ema20: emaArr(c, 20), ema50: emaArr(c, 50),
      atr: atrArr(h, l, c, 14), rsi2: rsiArr(c, 2), rsi14: rsiArr(c, 14),
      hi20: rollMax(h, 20), hi50: rollMax(h, 50), hi252: rollMax(h, 252), lo10: rollMin(l, 10), lo20: rollMin(l, 20), lo252: rollMin(l, 252),
      vol20: volArr(c, 20, perYear), vol60: volArr(c, 60, perYear), dvol50: smaArr(v, 50), v50: smaArr(v, 50)
    };
    a.idx = {}; a.t.forEach((d, i) => { a.idx[d] = i; });
    a.perYear = perYear;
    return a;
  }
  // IBD식 상대강도 원점수: 최근 3개월 40% + 6·9·12개월 각 20%
  function rsRaw(c, i) {
    const r3 = ret(c, i, 63), r6 = ret(c, i, 126), r9 = ret(c, i, 189), r12 = ret(c, i, 252);
    if (r3 == null || r12 == null) return null;
    return 0.4 * r3 + 0.2 * r6 + 0.2 * r9 + 0.2 * r12;
  }

  /* ===================== 2. 비용 (보수적으로) ===================== */
  // 국내: 수수료 0.015% + 매도 시 증권거래세 0.20% / 미국: 수수료 0.1% (환전 비용 0.1% 별도) / 코인: 0.1% / 슬리피지 별도
  const COST = {
    KRW_STOCK: { buy: 0.00015, sell: 0.00015 + 0.0020, slip: 0.0005 },
    USD_STOCK: { buy: 0.0010 + 0.0010, sell: 0.0010 + 0.0010, slip: 0.0005 },
    COIN: { buy: 0.0010, sell: 0.0010, slip: 0.0010 },
    GOLD: { buy: 0.0010 + 0.0010, sell: 0.0010 + 0.0010, slip: 0.0005 }
  };
  const costOf = (a) => (a.kind === 'coin' ? COST.COIN : a.kind === 'gold' ? COST.GOLD : a.cur === 'USD' ? COST.USD_STOCK : COST.KRW_STOCK);
  const lotOf = (a) => (a.kind === 'stock' && a.cur === 'KRW' ? 1 : a.kind === 'coin' ? 1e-6 : 1e-4); // 국내 주식은 1주 단위, 미국·코인은 소수점
  const floorLot = (q, lot) => Math.floor(q / lot + 1e-9) * lot;

  /* ===================== 3. 금고(VAULT) 기본 규칙 ===================== */
  const VAULT = {
    maxPosPct: 15,        // 한 종목 최대 비중
    maxSectorPct: 35,     // 한 업종 최대 비중
    dayLossStop: -3,      // 하루 -3% 넘게 잃으면 다음 날 신규 진입 금지
    ddPause: -15,         // 최고점 대비 -15% → 신규 진입 정지
    ddResume: -8,         // -8% 안으로 회복하면 재개
    pauseDays: 20,        // 또는 20거래일 쉬면 절반 크기로 재개(새 최고점까지)
    ddCut: -25,           // 최고점 대비 -25% → 보유 전부 절반으로 (비상 브레이크)
    streakHalve: 4,       // 4연속 손실 → 신규 진입 크기 절반
    minCashPct: 2         // 수수료·오차용 최소 현금
  };

  /* ===================== 4. 봇 정의 ===================== */
  const START_CASH = 100000000; // 봇마다 가상 1억 원

  const BOTS = [
    {
      id: 'atlas', code: 'ATLAS', name: '추세 돌파', kinds: ['stock'], maxPos: 10, riskPct: 0.6,
      role: '신고가를 뚫고 올라가는 주도주를 따라 탐',
      method: '미너비니 트렌드 템플릿(이동평균 정배열·52주 고점 근처·상대강도 70 이상) + 거래량 실린 20일 고점 돌파. 터틀식으로 1ATR 오를 때마다 최대 3번까지 불타기, 손절은 진입가 −2ATR(최대 −8%), 이후 50일선 이탈·20일 저점 이탈·샹들리에(최고 종가 −3ATR)로 수익을 지킴. 3주 안에 힘이 안 붙는 돌파는 정리, 손실로 판 종목은 15일 동안 다시 사지 않음.',
      edge: '추세는 생각보다 오래 간다(모멘텀 효과). 대신 승률이 낮고 큰 수익 몇 번이 성적을 만듦.'
    },
    {
      id: 'echo', code: 'ECHO', name: '눌림목 반등', kinds: ['stock'], maxPos: 8, posPct: 12, usOnly: true,
      retired: '실제 10년 데이터에서 두 번 모두 손실(1차 연 −2.7%, 수정판 연 −4.8%·낙폭 −42%) — 짧게 자주 사고파는 전략이라 수수료·환전·세금을 이기지 못함. 팀 계좌에서 빼고 기록만 관찰.',
      role: '미국 대형주가 잠깐 과하게 빠졌을 때 짧게 받음',
      method: '코너스 RSI(2) 전략(2차 수정판): 미국 주식만(국내는 매도세 0.20%가 짧은 매매 수익을 다 먹어서 제외). 200일선 위인데 2일 RSI가 5 아래로 급락하면 다음 날 시가 매수, 더 빠지면 한 번 더 추가. 종가가 5일선 위로 오르거나 RSI(2)가 70을 넘으면 정리, 최대 10거래일 보유, 비상 손절 −3ATR.',
      edge: '대형주는 짧은 급락 뒤 되돌림이 잦음(단기 평균회귀). 승률은 높고 한 번 수익은 작아서 비용이 낮은 시장에서만 의미가 있음.'
    },
    {
      id: 'orbit', code: 'ORBIT', name: '모멘텀 순환', kinds: ['stock', 'gold'], maxPos: 10,
      role: '한 달에 한 번, 가장 강한 종목 10개로 갈아탐',
      method: '매달 첫 거래일: 최근 12개월 수익률(마지막 1개월 제외, 12-1 모멘텀) 상위 10개를 변동성 반비례로 담음. 절대 모멘텀 필터(12개월 수익 > 0, 200일선 위)와 시장 필터(지수 200일선 아래면 그 시장 제외) — 빈자리는 금(200일선 위일 때) 또는 현금. 비상 손절 −25%.',
      edge: '학계에서 가장 오래 검증된 이상현상 중 하나(제가디시·티트먼, 안토나치 듀얼 모멘텀). 하락장 회피가 핵심.'
    },
    {
      id: 'nova', code: 'NOVA', name: '코인 추세', kinds: ['coin'], maxPos: 4,
      role: '코인은 추세가 살아 있을 때만, 흔들림에 맞춰 비중 조절',
      method: '매주 월요일: 비트코인이 200일선 위일 때만 위험 자산 보유(경계선 들락날락 방지: +2% 넘어야 켜지고 −3% 깨야 꺼짐). 손실로 판 코인은 2주 쉬었다 다시 봄. 20일 EMA > 50일 EMA 이고 종가가 50일 EMA 위인 코인 중 3개월 수익률 상위 4개. 비중 = 0.3 × (50% ÷ 실제 연 변동성), 코인당 최대 25%. 매일: 50일 EMA 이탈 또는 최고 종가 −3ATR 이탈 시 정리.',
      edge: '코인은 추세가 극단적으로 길고 하락도 극단적 — 추세 필터 + 변동성 목표가 낙폭을 크게 줄임.'
    },
    {
      id: 'chief', code: 'CHIEF', name: '시장날씨 점수', kinds: ['stock'], maxPos: 10, riskPct: 0.75,
      role: '이 앱의 월가 스크리너 점수와 분할 매수 계획을 그대로 실행',
      method: '매주: 스크리너 70점 이상 + 행동 가이드 "분할 매수 검토"인 종목. 1차는 다음 날 시가(계획의 1/3), 2·3차는 앱이 제시한 가격에 지정가(10일 유효), 손절은 앱의 손절선. 매일 손절·샹들리에 추적, 매주 다시 채점해 "분할 매도"면 1/3 정리, 점수 40 미만이면 전부 정리.',
      edge: '앱의 판단 자체를 검증하는 봇. 이 봇이 돈을 못 벌면 알림 규칙을 고쳐야 함.'
    }
  ];

  /* ===================== 5. 엔진 ===================== */
  function newAccount(bot, cash) {
    return { bot: bot.id, cash: cash || START_CASH, start: cash || START_CASH, pos: {}, orders: [], trades: [], equity: [], peak: cash || START_CASH,
      paused: false, dayBlock: false, streak: 0, events: [], lastEq: cash || START_CASH, lastDate: null };
  }

  // 데이터 묶음: { assets: {id: asset}, fx: {date: usdkrw}, regime: {spx, kospi, btc} 자산 id, calendar: [date...] }
  function buildWorld(assets, opts) {
    opts = opts || {};
    const A = {};
    assets.forEach((a) => { if (a.c && a.c.length > 30) A[a.id] = prepare(a); });
    const cal = Array.from(new Set([].concat.apply([], Object.values(A).map((a) => a.t)))).sort();
    // 환율: 날짜마다 직전 값 이어 쓰기
    const fx = {}; let last = opts.usdkrwDefault || 1400;
    const fxs = opts.usdkrw || {};
    cal.forEach((d) => { if (fxs[d]) last = fxs[d]; fx[d] = last; });
    const calIdx = {}; cal.forEach((d, k) => { calIdx[d] = k; });
    // 날짜마다 거래가 있었던 자산 종류 (주말엔 코인만)
    const kindsOn = {}; Object.values(A).forEach((a) => { a.t.forEach((d) => { (kindsOn[d] = kindsOn[d] || {})[a.kind] = 1; }); });
    const has = {}; Object.values(A).forEach((a) => { has[a.kind] = 1; });
    return { A, cal, calIdx, kindsOn, has, fx, regimeOf: opts.regimeOf || {}, sectorOf: opts.sectorOf || {}, chief: opts.chief || null };
  }

  const fxAt = (W, a, d) => (a.cur === 'USD' ? W.fx[d] : 1);
  // 날짜 d 에 자산의 가장 최근 인덱스(그 날 거래가 없으면 직전 거래일)
  function lastIdx(a, d) {
    if (a.idx[d] != null) return a.idx[d];
    let lo = 0, hi = a.t.length - 1, ans = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (a.t[m] <= d) { ans = m; lo = m + 1; } else hi = m - 1; }
    return ans;
  }
  // 시장 필터: 그 자산이 속한 시장 지수가 200일선 위인가 (데이터 없으면 통과)
  function regimeOn(W, a, d) {
    const rid = W.regimeOf[a.market] || (a.kind === 'coin' ? W.regimeOf.coin : null);
    const r = rid && W.A[rid]; if (!r) return true;
    const i = lastIdx(r, d); if (i < 200) return true;
    return r.c[i] > r.ind.sma200[i];
  }

  function equityOf(W, acc, d) {
    let v = acc.cash;
    for (const id in acc.pos) { const p = acc.pos[id], a = W.A[id], i = lastIdx(a, d); v += p.qty * (i >= 0 ? a.c[i] : p.avg) * fxAt(W, a, d); }
    return v;
  }
  // 주문 크기·한도 계산용: d 날 시가에 주문할 때는 d 종가를 아직 모름 → d 이전 마지막 종가로 평가 (미래 가격 안 씀)
  function prevIdx(a, d) { const i = lastIdx(a, d); if (i < 0) return -1; return a.t[i] === d ? i - 1 : i; }
  function equityPrev(W, acc, d) {
    let v = acc.cash;
    for (const id in acc.pos) { const p = acc.pos[id], a = W.A[id], i = prevIdx(a, d); v += p.qty * (i >= 0 ? a.c[i] : p.avg) * fxAt(W, a, d); }
    return v;
  }
  function sectorExposurePrev(W, acc, d, sec) {
    let v = 0; for (const id in acc.pos) { const a = W.A[id]; if ((W.sectorOf[id] || a.sec) === sec) { const i = prevIdx(a, d); v += acc.pos[id].qty * (i >= 0 ? a.c[i] : acc.pos[id].avg) * fxAt(W, a, d); } }
    return v;
  }
  function sectorExposure(W, acc, d, sec) {
    let v = 0; for (const id in acc.pos) { const a = W.A[id]; if ((W.sectorOf[id] || a.sec) === sec) { const i = lastIdx(a, d); v += acc.pos[id].qty * a.c[i] * fxAt(W, a, d); } }
    return v;
  }

  // 체결 기록
  function fill(W, acc, a, d, side, qty, px, reason, tag) {
    const fx = fxAt(W, a, d), c = costOf(a);
    if (side === 'buy') {
      const gross = qty * px * fx, fee = gross * c.buy;
      if (gross + fee > acc.cash) { qty = floorLot(acc.cash / (px * fx * (1 + c.buy)), lotOf(a)); if (qty <= 0) return null; }
      const g2 = qty * px * fx, f2 = g2 * c.buy;
      acc.cash -= g2 + f2;
      const p = acc.pos[a.id];
      if (p) { p.avg = (p.avg * p.qty + px * qty) / (p.qty + qty); p.qty += qty; p.units = (p.units || 1) + 1; p.costKrw += g2 + f2; p.lastAdd = px; }
      else acc.pos[a.id] = { id: a.id, qty, avg: px, entry: px, entryDate: d, units: 1, costKrw: g2 + f2, hiClose: px, lastAdd: px, reason, tag: tag || {} };
      const ev = { d, side, id: a.id, name: a.name, qty, px, krw: Math.round(g2 + f2), reason };
      acc.events.push(ev); return ev;
    }
    const p = acc.pos[a.id]; if (!p) return null;
    qty = Math.min(qty, p.qty);
    const g = qty * px * fx, fee = g * c.sell;
    acc.cash += g - fee;
    const costPart = p.costKrw * (qty / p.qty);
    const pnl = g - fee - costPart;
    const R = p.risk0 ? ((px - p.entry) / p.risk0) : null;
    acc.trades.push({ bot: acc.bot, id: a.id, name: a.name, cur: a.cur, in: p.entryDate, out: d, entry: round(p.avg), exit: round(px), qty, pnl: Math.round(pnl), pct: round((pnl / costPart) * 100, 2), R: R == null ? null : round(R, 2), days: dayDiff(p.entryDate, d), why: p.reason, exitWhy: reason });
    p.qty -= qty; p.costKrw -= costPart;
    if (p.qty <= lotOf(a) / 2) delete acc.pos[a.id];
    acc.streak = pnl < 0 ? acc.streak + 1 : 0;
    if (!acc.pos[a.id]) (acc.exits = acc.exits || {})[a.id] = { d, loss: pnl < 0 }; // 재진입 대기용
    const ev = { d, side, id: a.id, name: a.name, qty, px, krw: Math.round(g - fee), pnl: Math.round(pnl), reason };
    acc.events.push(ev); return ev;
  }
  const round = (x, n) => { const k = Math.pow(10, n == null ? 4 : n); return Math.round(x * k) / k; };
  const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

  // 주문 처리: 오늘 바(d)가 있는 자산만. 손절이 먼저(보수적), 그다음 진입
  function runOrders(W, acc, d) {
    const keep = [];
    // 1) 보유 종목 손절(스톱) 체크
    for (const id of Object.keys(acc.pos)) {
      const p = acc.pos[id], a = W.A[id], i = a.idx[d]; if (i == null || !p.stop) continue;
      if (a.l[i] <= p.stop) {
        const c = costOf(a), px = Math.min(a.o[i], p.stop) * (1 - c.slip);
        fill(W, acc, a, d, 'sell', p.qty, px, p.stopWhy || '손절선 이탈');
      }
    }
    // 2) 대기 주문 — 금고가 막은 상태(낙폭 정지·하루 손실 차단)면 남아 있던 매수 주문은 모두 취소 (매도 주문은 그대로)
    const blocked = acc.paused || acc.dayBlock;
    if (blocked) { const nB = acc.orders.filter((o) => o.side === 'buy').length; if (nB) { acc.orders = acc.orders.filter((o) => o.side !== 'buy'); (acc.events = acc.events || []).push({ d, side: 'vault', reason: '금고 차단 중 — 대기 매수 주문 ' + nB + '개 취소' }); } }
    for (const o of acc.orders) {
      const a = W.A[o.id], i = a && a.idx[d];
      if (i == null) { keep.push(o); continue; }
      const c = costOf(a);
      if (o.type === 'moo') { // 시가 주문
        if (o.side === 'buy') {
          const px = a.o[i] * (1 + c.slip);
          const qty = sizeQty(W, acc, a, d, px, o);
          if (qty > 0) { const ev = fill(W, acc, a, d, 'buy', qty, px, o.reason, o.tag); if (ev) afterBuy(W, acc, a, d, px, o); }
        } else if (acc.pos[o.id]) {
          const px = a.o[i] * (1 - c.slip), q = o.frac ? floorLot(acc.pos[o.id].qty * o.frac, lotOf(a)) || acc.pos[o.id].qty : acc.pos[o.id].qty;
          fill(W, acc, a, d, 'sell', q, px, o.reason);
        }
      } else if (o.type === 'limit' && o.side === 'buy') { // 지정가 매수: 저가가 지정가 이하로 오면 체결
        if (o.needPos && !acc.pos[o.id]) continue; // 1차가 손절됐으면 2·3차 취소
        if (a.l[i] <= o.limit) {
          const px = Math.min(a.o[i], o.limit) * (1 + c.slip * 0.5);
          const qty = sizeQty(W, acc, a, d, px, o);
          if (qty > 0) { const ev = fill(W, acc, a, d, 'buy', qty, px, o.reason, o.tag); if (ev) afterBuy(W, acc, a, d, px, o); }
        } else if (--o.ttl > 0) keep.push(o);
      } else if (o.type === 'stopbuy') { // 불타기: 가격이 올라 이 값을 넘으면 매수
        if (!acc.pos[o.id]) continue; // 이미 정리된 종목이면 취소
        if (a.h[i] >= o.trigger) {
          const px = Math.max(a.o[i], o.trigger) * (1 + c.slip);
          const qty = sizeQty(W, acc, a, d, px, o);
          if (qty > 0) { const ev = fill(W, acc, a, d, 'buy', qty, px, o.reason, o.tag); if (ev) afterBuy(W, acc, a, d, px, o); }
        } else if (--o.ttl > 0) keep.push(o);
      }
    }
    acc.orders = keep;
    // 3) 오늘 시가에 산 종목도, 같은 날 저가가 손절선 아래면 손절된 것으로 봄(보수적)
    for (const id of Object.keys(acc.pos)) {
      const p = acc.pos[id], a = W.A[id], i = a.idx[d];
      if (i == null || p.entryDate !== d || !p.stop || a.l[i] > p.stop) continue;
      fill(W, acc, a, d, 'sell', p.qty, p.stop * (1 - costOf(a).slip), (p.stopWhy || '손절선') + ' — 산 날 바로 이탈');
    }
  }

  // 주문 크기: 위험 기준(riskKrw) 또는 비중 기준(weight), 금고 한도로 자름
  function sizeQty(W, acc, a, d, px, o) {
    const eq = equityPrev(W, acc, d), fx = fxAt(W, a, d);
    let krw;
    if (o.weight != null) krw = eq * o.weight;
    else if (o.riskKrw != null && o.stopDist > 0) krw = (o.riskKrw / (o.stopDist * fx)) * px * fx;
    else krw = eq * 0.05;
    if (o.part) krw *= o.part;
    if (acc.halve) krw *= 0.5;
    const pi = prevIdx(a, d), held = acc.pos[a.id] ? acc.pos[a.id].qty * (pi >= 0 ? a.c[pi] : px) * fx : 0;
    const capPos = eq * (o.maxPct || VAULT.maxPosPct) / 100 - held;
    const sec = W.sectorOf[a.id] || a.sec;
    const capSec = sec && a.kind === 'stock' ? eq * VAULT.maxSectorPct / 100 - sectorExposurePrev(W, acc, d, sec) : Infinity;
    const capCash = acc.cash - eq * VAULT.minCashPct / 100;
    krw = Math.min(krw, capPos, capSec, capCash);
    if (krw < eq * 0.003) return 0; // 너무 작은 주문은 안 냄
    return floorLot(krw / (px * fx * (1 + costOf(a).buy)), lotOf(a));
  }
  function afterBuy(W, acc, a, d, px, o) {
    const p = acc.pos[a.id];
    if (o.stop != null) p.stop = Math.max(p.stop || 0, o.stop);
    if (o.risk0 != null && !p.risk0) p.risk0 = o.risk0;
    if (o.stopWhy) p.stopWhy = o.stopWhy;
    if (o.after) o.after(p, px);
    if (o.tag) Object.assign(p.tag, o.tag);
  }

  // 하루 처리: 체결 → 평가 → 금고 → 각 봇의 종가 판단 → 다음 날 주문
  function step(W, acc, bot, d, ctx) {
    acc.events = [];
    runOrders(W, acc, d);
    // 보유 종목 최고 종가 갱신
    for (const id in acc.pos) { const a = W.A[id], i = a.idx[d]; if (i != null) acc.pos[id].hiClose = Math.max(acc.pos[id].hiClose || 0, a.c[i]); }
    const eq = equityOf(W, acc, d);
    // 금고
    const dayChg = acc.lastEq ? (eq / acc.lastEq - 1) * 100 : 0;
    acc.peak = Math.max(acc.peak, eq);
    const dd = (eq / acc.peak - 1) * 100;
    acc.dayBlock = dayChg <= VAULT.dayLossStop;
    if (eq >= acc.peak) acc.probation = false; // 새 최고점 → 정상 크기로
    if (!acc.paused && !acc.probation && dd <= VAULT.ddPause) { acc.paused = true; acc.pauseDays = 0; acc.events.push({ d, side: 'vault', reason: '최고점 대비 ' + dd.toFixed(1) + '% — 신규 진입 정지' }); }
    else if (acc.paused) {
      acc.pauseDays = (acc.pauseDays || 0) + 1;
      // 낙폭이 회복되거나, 20거래일 쉬었으면 절반 크기로 재개 (현금만 들고 있으면 낙폭이 회복될 수 없으므로)
      if (dd >= VAULT.ddResume || acc.pauseDays >= VAULT.pauseDays) { acc.paused = false; acc.probation = true; acc.events.push({ d, side: 'vault', reason: (dd >= VAULT.ddResume ? '낙폭 회복(' + dd.toFixed(1) + '%)' : VAULT.pauseDays + '거래일 휴식') + ' — 절반 크기로 재개, 새 최고점 전까지' }); }
    }
    // 비상 브레이크: 최고점 대비 -25% → 모든 보유를 절반으로 (한 번의 하락에 한 번만)
    if (dd <= VAULT.ddCut && !acc.cutDone && Object.keys(acc.pos).length) {
      acc.cutDone = true;
      Object.keys(acc.pos).forEach((id) => { if (!hasOrder(acc, id, 'sell')) acc.orders.push({ id, side: 'sell', type: 'moo', frac: 0.5, reason: '금고 비상 브레이크 — 최고점 대비 ' + dd.toFixed(1) + '%, 보유 절반 축소' }); });
      acc.events.push({ d, side: 'vault', reason: '최고점 대비 ' + dd.toFixed(1) + '% — 모든 보유 절반 축소' });
    }
    if (dd > VAULT.ddResume) acc.cutDone = false;
    acc.halve = acc.streak >= VAULT.streakHalve || !!acc.probation;
    acc.equity.push([d, Math.round(eq)]);
    acc.lastEq = eq; acc.lastDate = d;
    const canEnter = !acc.paused && !acc.dayBlock;
    STRAT[bot.id](W, acc, bot, d, eq, canEnter, ctx || {});
    acc.prevDay = d;
  }

  // 손실로 판 종목은 며칠 동안 다시 사지 않음 (같은 함정에 연달아 빠지지 않게)
  const cooling = (acc, id, d, days) => { const x = acc.exits && acc.exits[id]; return !!x && x.loss && dayDiff(x.d, d) < days; };
  const hasOrder = (acc, id, side) => acc.orders.some((o) => o.id === id && (!side || o.side === side));
  const cancelBuys = (acc, id) => { acc.orders = acc.orders.filter((o) => !(o.id === id && o.side === 'buy')); };
  const sell = (acc, id, reason, frac) => { if (!hasOrder(acc, id, 'sell')) { cancelBuys(acc, id); acc.orders.push({ id, side: 'sell', type: 'moo', reason, frac }); } };
  const nOpen = (acc) => Object.keys(acc.pos).length + new Set(acc.orders.filter((o) => o.side === 'buy' && !acc.pos[o.id] && o.type === 'moo').map((o) => o.id)).size;
  // 봇마다 '자기 시장이 열린 날' 기준으로 월·주의 첫날을 판단
  const isoDow = (d) => (new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7; // 월=0 … 일=6
  // 계좌를 연 첫날도 '시작일'로 봄 → 바로 첫 편입
  const isMonthStart = (W, d, acc) => !acc.prevDay || acc.prevDay.slice(0, 7) !== d.slice(0, 7);
  const isWeekStart = (W, d, acc) => !acc.prevDay || isoDow(d) < isoDow(acc.prevDay) || dayDiff(acc.prevDay, d) >= 7;

  /* ---------- 전략들 ---------- */
  const STRAT = {};

  // ATLAS — 추세 돌파
  STRAT.atlas = function (W, acc, bot, d, eq, canEnter, ctx) {
    // 1) 보유 관리
    for (const id of Object.keys(acc.pos)) {
      const p = acc.pos[id], a = W.A[id], i = a.idx[d]; if (i == null) continue;
      const I = a.ind, atr = I.atr[i] || 0, c = a.c[i];
      const held = dayDiff(p.entryDate, d);
      if (I.sma50[i] && c < I.sma50[i] && held > 5) { sell(acc, id, '50일선 아래로 마감 — 추세 이탈'); continue; }
      if (I.lo20[i - 1] && c < I.lo20[i - 1]) { sell(acc, id, '20일 최저가 이탈(터틀 청산)'); continue; }
      if (held >= 21 && p.risk0 && c < p.entry + 0.5 * p.risk0 && (p.units || 1) === 1) { sell(acc, id, '3주 지나도 힘이 안 붙은 돌파 — 시간 손절'); continue; }
      // 샹들리에: +2R 넘으면 최고 종가 −3ATR 로 손절 올림, +1R 넘으면 본전
      if (p.risk0 && c >= p.entry + p.risk0) { const be = p.avg * 1.002; if (!p.stop || p.stop < be) { p.stop = be; p.stopWhy = '본전 손절(+1R 도달 후)'; } }
      if (p.risk0 && c >= p.entry + 2 * p.risk0 && atr) { const ch = p.hiClose - 3 * atr; if (ch > p.stop) { p.stop = ch; p.stopWhy = '샹들리에 추적 손절(최고 종가 −3ATR)'; } }
    }
    if (!canEnter) return;
    // 2) 신규 진입
    const cands = [];
    const rsMap = ctx.rs || {};
    for (const id in W.A) {
      const a = W.A[id]; if (a.kind !== 'stock' || acc.pos[id] || hasOrder(acc, id) || cooling(acc, id, d, 15)) continue;
      const i = a.idx[d]; if (i == null || i < 260) continue;
      const I = a.ind, c = a.c[i];
      if (!(c > I.sma50[i] && I.sma50[i] > I.sma150[i] && I.sma150[i] > I.sma200[i] && I.sma200[i] > I.sma200[i - 21])) continue;
      if (c < 0.75 * I.hi252[i] || c < 1.3 * I.lo252[i]) continue;
      const rs = rsMap[id]; if (rs == null || rs < 70) continue;
      if (!(I.hi20[i - 1] && c > I.hi20[i - 1])) continue;                          // 20일 고점 돌파
      if (!(a.v && I.v50[i - 1] && a.v[i] >= 1.4 * I.v50[i - 1])) continue;         // 거래량 1.4배 이상
      if (a.h[i] > a.l[i] && (c - a.l[i]) / (a.h[i] - a.l[i]) < 0.5) continue;       // 종가가 하루 범위 위쪽 절반
      if (!regimeOn(W, a, d)) continue;
      const atr = I.atr[i]; if (!atr) continue;
      if ((c / I.sma50[i] - 1) > 0.25) continue;                                     // 50일선에서 25% 넘게 뜬 건 추격 금지
      cands.push({ id, a, rs, c, atr });
    }
    cands.sort((x, y) => y.rs - x.rs);
    for (const x of cands) {
      if (nOpen(acc) >= bot.maxPos) break;
      const stopDist = Math.min(2 * x.atr, x.c * 0.08);
      const riskKrw = eq * bot.riskPct / 100;
      acc.orders.push({ id: x.id, side: 'buy', type: 'moo', riskKrw, stopDist, risk0: stopDist, stop: x.c - stopDist, stopWhy: '초기 손절(−2ATR, 최대 −8%)',
        reason: '트렌드 템플릿 통과 · RS ' + x.rs + ' · 거래량 실린 20일 고점 돌파', maxPct: 12,
        after: null });
      // 불타기 2번: +1ATR, +2ATR (10일 유효)
      [1, 2].forEach((k) => acc.orders.push({ id: x.id, side: 'buy', type: 'stopbuy', trigger: x.c + k * x.atr, ttl: 10, riskKrw, stopDist, maxPct: 15,
        stop: x.c + k * x.atr - 2 * x.atr, stopWhy: '불타기 후 손절 상향(마지막 매수가 −2ATR)', reason: '불타기 ' + (k + 1) + '차 (+' + k + 'ATR)' }));
    }
  };

  // ECHO — 눌림목 반등 (코너스 RSI2)
  STRAT.echo = function (W, acc, bot, d, eq, canEnter) {
    for (const id of Object.keys(acc.pos)) {
      const p = acc.pos[id], a = W.A[id], i = a.idx[d]; if (i == null) continue;
      const I = a.ind, c = a.c[i];
      if (I.sma5[i] && c > I.sma5[i]) { sell(acc, id, '종가가 5일선 위로 회복 — 반등 완료'); continue; }
      if (I.rsi2[i] > 70) { sell(acc, id, 'RSI(2) 70 돌파 — 반등 완료'); continue; }
      if (dayDiff(p.entryDate, d) >= 14) { sell(acc, id, '보유 10거래일 초과 — 시간 청산'); continue; }
      // 한 번 더 빠지면 추가(최대 2단위)
      if ((p.units || 1) < 2 && c < p.entry && I.rsi2[i] < 5 && canEnter && !hasOrder(acc, id, 'buy'))
        acc.orders.push({ id, side: 'buy', type: 'moo', weight: bot.posPct / 100, maxPct: bot.posPct * 2, reason: '추가 하락 — 2차 매수(코너스 분할)' });
    }
    if (!canEnter) return;
    const cands = [];
    for (const id in W.A) {
      const a = W.A[id]; if (a.kind !== 'stock' || acc.pos[id] || hasOrder(acc, id)) continue;
      if (bot.usOnly && a.cur !== 'USD') continue;
      const i = a.idx[d]; if (i == null || i < 210) continue;
      const I = a.ind, c = a.c[i];
      if (!(I.sma200[i] && c > I.sma200[i])) continue;
      if (!(I.rsi2[i] != null && I.rsi2[i] < 5)) continue;
      if (!regimeOn(W, a, d)) continue;
      if (I.vol20[i] > 70) continue; // 지나치게 요동치는 종목 제외
      cands.push({ id, a, r: I.rsi2[i], atr: I.atr[i], c, dv: I.dvol50[i] || 0 });
    }
    cands.sort((x, y) => x.r - y.r || y.dv - x.dv);
    for (const x of cands) {
      if (nOpen(acc) >= bot.maxPos) break;
      acc.orders.push({ id: x.id, side: 'buy', type: 'moo', weight: bot.posPct / 100, maxPct: bot.posPct * 2, stop: x.c - 3 * x.atr, risk0: 3 * x.atr, stopWhy: '비상 손절(−3ATR)',
        reason: '200일선 위 + RSI(2) ' + x.r.toFixed(1) + ' — 단기 과매도' });
    }
  };

  // ORBIT — 모멘텀 순환 (월 1회)
  STRAT.orbit = function (W, acc, bot, d, eq, canEnter) {
    for (const id of Object.keys(acc.pos)) {
      const p = acc.pos[id], a = W.A[id], i = a.idx[d]; if (i == null) continue;
      // 손절: 산 값 −stopPct (기본 25%). trailPct 가 있으면 보유 중 최고 종가 대비 추적 손절도 (연구용, 실제 봇은 기본값)
      const sp = bot.stopPct || 0.25; p.hiC = Math.max(p.hiC || p.avg, a.c[i]);
      if (a.c[i] < p.avg * (1 - sp)) sell(acc, id, '비상 손절(−' + Math.round(sp * 100) + '%)');
      else if (bot.trailPct && a.c[i] < p.hiC * (1 - bot.trailPct)) sell(acc, id, '추적 손절(고점 −' + Math.round(bot.trailPct * 100) + '%)');
    }
    if (!isMonthStart(W, d, acc)) return;
    const sc = [];
    for (const id in W.A) {
      const a = W.A[id]; if (a.kind !== 'stock') continue;
      const i = lastIdx(a, d); if (i < 260 || dayDiff(a.t[i], d) > 7) continue;
      const I = a.ind, c = a.c[i];
      const m = a.c[i - 21] / a.c[i - 252] - 1; // 12-1 모멘텀
      if (!(m > 0 && c > I.sma200[i])) continue;    // 절대 모멘텀
      if (!regimeOn(W, a, d)) continue;
      sc.push({ id, a, m, vol: I.vol60[i] || 30 });
    }
    sc.sort((x, y) => y.m - x.m);
    const pick = sc.slice(0, bot.maxPos);
    const want = {};
    if (pick.length) {
      const inv = pick.map((x) => 1 / Math.max(10, x.vol)), s = inv.reduce((t, v) => t + v, 0);
      const share = Math.min(1, pick.length / bot.maxPos); // 후보가 적으면 그만큼만 투자
      pick.forEach((x, k) => { want[x.id] = Math.min(0.15, inv[k] / s * share * 0.97); });
    }
    // 남는 비중: 금이 200일선 위면 금, 아니면 현금
    const g = Object.values(W.A).find((a) => a.kind === 'gold');
    const used = Object.values(want).reduce((t, v) => t + v, 0);
    if (g && used < 0.9) { const gi = lastIdx(g, d); if (gi > 200 && g.c[gi] > g.ind.sma200[gi]) want[g.id] = Math.min(0.97 - used, 0.5); }
    // 리밸런싱: 빠진 종목 매도, 새 종목 매수, 비중 차이 크면 조정
    for (const id of Object.keys(acc.pos)) if (!want[id]) sell(acc, id, '월간 교체 — 모멘텀 순위 밖');
    if (!canEnter) return;
    for (const id in want) {
      const a = W.A[id], i = lastIdx(a, d), cur = acc.pos[id] ? acc.pos[id].qty * a.c[i] * fxAt(W, a, d) / eq : 0;
      const gap = want[id] - cur;
      if (gap > 0.02) acc.orders.push({ id, side: 'buy', type: 'moo', weight: gap, maxPct: 16, reason: a.kind === 'gold' ? '위험 회피 — 금 보유(200일선 위)' : '12-1 모멘텀 상위 · 절대 모멘텀 통과 (' + ((sc.find((x) => x.id === id) || {}).m * 100).toFixed(0) + '%)' });
      else if (gap < -0.04 && acc.pos[id]) sell(acc, id, '비중 줄이기(월간 리밸런싱)', Math.min(1, -gap / cur));
    }
  };

  // NOVA — 코인 추세 + 변동성 목표
  STRAT.nova = function (W, acc, bot, d, eq, canEnter) {
    const btc = Object.values(W.A).find((a) => a.kind === 'coin' && a.sym === 'BTC');
    const bi = btc ? btc.idx[d] : null;
    // 비트코인 200일선 필터 — 경계선에서 들락날락하지 않게 위아래 여유(+2% 넘어야 켜짐, −3% 깨야 꺼짐)
    if (btc && bi != null && bi > 200) {
      const r = btc.c[bi] / btc.ind.sma200[bi];
      if (!acc.riskOn && r > 1.02) acc.riskOn = true; else if (acc.riskOn && r < 0.97) acc.riskOn = false;
    }
    const riskOn = !!acc.riskOn;
    for (const id of Object.keys(acc.pos)) {
      const p = acc.pos[id], a = W.A[id], i = a.idx[d]; if (i == null) continue;
      const I = a.ind, c = a.c[i];
      if (I.ema50[i] && c < I.ema50[i]) { sell(acc, id, '50일 EMA 이탈 — 추세 종료'); continue; }
      if (!riskOn && a.sym !== 'BTC') { sell(acc, id, '비트코인 200일선 아래 — 알트코인 정리'); continue; }
      const ch = p.hiClose - 3 * (I.atr[i] || 0); if (I.atr[i] && ch > (p.stop || 0)) { p.stop = ch; p.stopWhy = '샹들리에 추적 손절(최고 종가 −3ATR)'; }
    }
    if (!isWeekStart(W, d, acc) || !riskOn) return;
    const sc = [];
    for (const id in W.A) {
      const a = W.A[id]; if (a.kind !== 'coin' || (!acc.pos[id] && cooling(acc, id, d, 14))) continue;
      const i = a.idx[d]; if (i == null || i < 100) continue;
      const I = a.ind, c = a.c[i];
      if (!(I.ema20[i] > I.ema50[i] && c > I.ema50[i])) continue;
      sc.push({ id, a, m: ret(a.c, i, 90), vol: I.vol20[i] || 80, atr: I.atr[i], c });
    }
    sc.sort((x, y) => y.m - x.m);
    const pick = sc.slice(0, bot.maxPos);
    for (const id of Object.keys(acc.pos)) if (!pick.some((x) => x.id === id)) sell(acc, id, '주간 교체 — 상위 4개 밖');
    if (!canEnter) return;
    pick.forEach((x) => {
      // 변동성 목표: 연 변동성 50%인 코인이면 40%, 100%면 20% (코인당 최대 35%)
      const w = Math.min(0.25, 0.3 * 50 / Math.max(25, x.vol));
      const i = x.a.idx[d], cur = acc.pos[x.id] ? acc.pos[x.id].qty * x.c / eq : 0, gap = w - cur;
      if (gap > 0.03) acc.orders.push({ id: x.id, side: 'buy', type: 'moo', weight: gap, maxPct: 26, stop: x.c - 3 * x.atr, risk0: 3 * x.atr, stopWhy: '초기 손절(−3ATR)',
        reason: '추세(20>50 EMA) · 3개월 ' + (x.m * 100).toFixed(0) + '% · 목표 변동성 비중 ' + (w * 100).toFixed(0) + '%' });
      else if (gap < -0.05 && acc.pos[x.id]) sell(acc, x.id, '변동성 커져 비중 축소', Math.min(1, -gap / cur));
      void i;
    });
  };

  // CHIEF — 앱의 스크리너 점수 (ctx.chief(id, d, i) 가 {score, action, plan} 을 돌려줌)
  STRAT.chief = function (W, acc, bot, d, eq, canEnter, ctx) {
    const judge = W.chief; if (!judge) return;
    const weekly = isWeekStart(W, d, acc);
    for (const id of Object.keys(acc.pos)) {
      const p = acc.pos[id], a = W.A[id], i = a.idx[d]; if (i == null) continue;
      const atr = a.ind.atr[i], c = a.c[i];
      if (p.risk0 && c >= p.entry + p.risk0) { const be = p.avg * 1.002; if (!p.stop || p.stop < be) { p.stop = be; p.stopWhy = '본전 손절(+1R 도달 후)'; } }
      if (p.risk0 && atr && c >= p.entry + 2 * p.risk0) { const ch = p.hiClose - 3 * atr; if (ch > p.stop) { p.stop = ch; p.stopWhy = '샹들리에 추적 손절(최고 종가 −3ATR)'; } }
      if (weekly) {
        const j = judge(a, i, d, true, (c / p.avg - 1) * 100); if (!j) continue;
        if (j.score < 40) sell(acc, id, '재채점 ' + j.score + '점 — 조건 불리, 전량 정리');
        else if (j.action === 'stop') sell(acc, id, '행동 가이드 "손절 검토"');
        else if ((j.action === 'trim' || j.action === 'reduce') && !p.tag.trimmed) { p.tag.trimmed = true; sell(acc, id, '행동 가이드 "' + (j.label || '분할 매도') + '" — 1/3 정리', 1 / 3); }
      }
    }
    if (!canEnter || !(weekly || bot.daily)) return; // bot.daily: 알림처럼 매일 후보를 보고 다음 날 시가에 1차 매수 (재채점·정리는 그대로 매주)
    const cands = [];
    for (const id in W.A) {
      const a = W.A[id]; if (a.kind !== 'stock' || acc.pos[id] || hasOrder(acc, id)) continue;
      const i = a.idx[d]; if (i == null || i < 200) continue;
      if (!(a.c[i] > a.ind.sma200[i])) continue; // 계산을 줄이려고 장기 상승 종목만 채점
      const j = judge(a, i, d, false); if (!j || j.score < 70 || !(j.action === 'add' || j.action === 'add-small')) continue;
      cands.push({ id, a, i, j });
    }
    cands.sort((x, y) => y.j.score - x.j.score);
    for (const x of cands) {
      if (nOpen(acc) >= bot.maxPos) break;
      const plan = x.j.plan || [], c = x.a.c[x.i];
      const stopP = (plan.find((q) => q.stop) || {}).px || c - 2.5 * x.a.ind.atr[x.i];
      const dist = c - stopP; if (!(dist > 0)) continue;
      const riskKrw = eq * bot.riskPct / 100, why = x.j.score + '점 · ' + (x.j.label || '분할 매수 검토');
      const base = { riskKrw, stopDist: dist, risk0: dist, stop: stopP, stopWhy: '앱 손절선', maxPct: 12 };
      acc.orders.push({ ...base, id: x.id, side: 'buy', type: 'moo', part: 1 / 3, reason: why + ' — 1차(1/3)' });
      plan.filter((q) => (q.k === '2차' || q.k === '3차') && q.px < c).forEach((q) => acc.orders.push({ ...base, id: x.id, side: 'buy', type: 'limit', limit: q.px, ttl: 10, part: 1 / 3, needPos: true, reason: why + ' — ' + q.k + '(지정가)' }));
    }
  };

  /* ===================== 6. 실행 ===================== */
  // 날짜별 상대강도 순위 (ATLAS 용) — 주식만
  function rsRanks(W, d) {
    const xs = [];
    for (const id in W.A) { const a = W.A[id]; if (a.kind !== 'stock') continue; const i = a.idx[d]; if (i == null) continue; const r = rsRaw(a.c, i); if (r != null) xs.push([id, r]); }
    xs.sort((x, y) => x[1] - y[1]);
    const out = {}; xs.forEach(([id], k) => { out[id] = Math.max(1, Math.min(99, Math.round((k + 0.5) / xs.length * 99))); });
    return out;
  }

  // 여러 봇을 같은 날짜들에 걸쳐 돌림. state: { accounts: {botId: acc} }
  function run(W, state, dates, opts) {
    opts = opts || {};
    const bots = BOTS.filter((b) => !opts.only || opts.only.includes(b.id));
    state.accounts = state.accounts || {};
    bots.forEach((b) => { if (!state.accounts[b.id]) state.accounts[b.id] = newAccount(b, opts.cash); });
    const allEvents = [];
    const active = bots.filter((b) => b.kinds.some((k) => W.has[k]));
    for (const d of dates) {
      const ctx = { rs: null }, on = W.kindsOn[d] || {};
      for (const b of active) {
        if (!b.kinds.some((k) => on[k])) continue; // 이 봇의 시장이 쉬는 날
        if (state.accounts[b.id].lastDate && state.accounts[b.id].lastDate >= d) continue; // 이미 처리한 날
        if (b.id === 'atlas' && !ctx.rs) ctx.rs = rsRanks(W, d);
        const acc = state.accounts[b.id];
        step(W, acc, b, d, ctx);
        if (opts.collect) acc.events.forEach((e) => allEvents.push({ bot: b.id, ...e }));
        if (opts.compact && acc.equity.length > 4000) acc.equity = acc.equity.slice(-4000);
      }
    }
    return allEvents;
  }

  // 백테스트 한 번: 데이터 전체 기간
  function backtest(W, opts) {
    opts = opts || {};
    const state = { accounts: {} };
    const from = opts.from || W.cal[Math.min(W.cal.length - 1, 260)];
    const dates = W.cal.filter((d) => d >= from && (!opts.to || d <= opts.to));
    run(W, state, dates, { only: opts.only, cash: opts.cash });
    return state;
  }

  /* ===================== 7. 성적표 ===================== */
  function metrics(equity, trades, opts) {
    opts = opts || {};
    if (!equity || equity.length < 2) return null;
    const v = equity.map((x) => x[1]), t = equity.map((x) => x[0]);
    const r = v.slice(1).map((x, i) => x / v[i] - 1);
    const years = Math.max(1 / 365, dayDiff(t[0], t[t.length - 1]) / 365.25);
    const per = r.length / years; // 1년에 몇 번 기록됐는지
    const mean = r.reduce((a, b) => a + b, 0) / r.length;
    const sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, r.length - 1));
    const dn = Math.sqrt(r.reduce((a, b) => a + (b < 0 ? b * b : 0), 0) / Math.max(1, r.length));
    const rf = (opts.rf == null ? 0.025 : opts.rf) / per;
    let peak = v[0], mdd = 0, ddStart = t[0], longest = 0, curStart = t[0];
    v.forEach((x, i) => { if (x >= peak) { peak = x; longest = Math.max(longest, dayDiff(curStart, t[i])); curStart = t[i]; } else mdd = Math.min(mdd, x / peak - 1); });
    longest = Math.max(longest, dayDiff(curStart, t[t.length - 1])); void ddStart;
    const total = v[v.length - 1] / v[0] - 1, cagr = Math.pow(v[v.length - 1] / v[0], 1 / years) - 1;
    const tr = trades || [];
    const wins = tr.filter((x) => x.pnl > 0), losses = tr.filter((x) => x.pnl <= 0);
    const gw = wins.reduce((a, x) => a + x.pnl, 0), gl = -losses.reduce((a, x) => a + x.pnl, 0);
    const Rs = tr.filter((x) => x.R != null).map((x) => x.R);
    // 월별 수익
    const monthly = {}; let prevM = null, prevV = v[0];
    t.forEach((d, i) => { const m = d.slice(0, 7); if (prevM && m !== prevM) { monthly[prevM] = round((v[i - 1] / prevV - 1) * 100, 2); prevV = v[i - 1]; } prevM = m; });
    if (prevM) monthly[prevM] = round((v[v.length - 1] / prevV - 1) * 100, 2);
    const yearly = {}; let prevY = null, pyV = v[0];
    t.forEach((d, i) => { const y = d.slice(0, 4); if (prevY && y !== prevY) { yearly[prevY] = round((v[i - 1] / pyV - 1) * 100, 2); pyV = v[i - 1]; } prevY = y; });
    if (prevY) yearly[prevY] = round((v[v.length - 1] / pyV - 1) * 100, 2);
    return {
      from: t[0], to: t[t.length - 1], years: round(years, 2),
      total: round(total * 100, 2), cagr: round(cagr * 100, 2), vol: round(sd * Math.sqrt(per) * 100, 2),
      sharpe: sd ? round((mean - rf) / sd * Math.sqrt(per), 2) : null, sortino: dn ? round((mean - rf) / dn * Math.sqrt(per), 2) : null,
      mdd: round(mdd * 100, 2), calmar: mdd ? round(cagr / -mdd, 2) : null, longestDD: longest,
      trades: tr.length, winRate: tr.length ? round(wins.length / tr.length * 100, 1) : null,
      avgWin: wins.length ? round(wins.reduce((a, x) => a + x.pct, 0) / wins.length, 2) : null,
      avgLoss: losses.length ? round(losses.reduce((a, x) => a + x.pct, 0) / losses.length, 2) : null,
      pf: gl > 0 ? round(gw / gl, 2) : (gw > 0 ? 99 : null), expR: Rs.length ? round(Rs.reduce((a, b) => a + b, 0) / Rs.length, 2) : null,
      avgDays: tr.length ? round(tr.reduce((a, x) => a + x.days, 0) / tr.length, 1) : null,
      best: tr.length ? tr.reduce((a, x) => (x.pct > a.pct ? x : a)) : null, worst: tr.length ? tr.reduce((a, x) => (x.pct < a.pct ? x : a)) : null,
      monthly, yearly
    };
  }
  // 벤치마크 대비: 같은 기간 수익률·베타·상관
  function versus(equity, bench) {
    if (!equity || !bench || equity.length < 30) return null;
    const bm = {}; bench.forEach(([d, x]) => { bm[d] = x; });
    const pairs = []; let lb = null;
    equity.forEach(([d, x]) => { if (bm[d] != null) lb = bm[d]; if (lb != null) pairs.push([x, lb]); });
    if (pairs.length < 30) return null;
    const ra = [], rb = [];
    for (let i = 1; i < pairs.length; i++) { ra.push(pairs[i][0] / pairs[i - 1][0] - 1); rb.push(pairs[i][1] / pairs[i - 1][1] - 1); }
    const m = (x) => x.reduce((a, b) => a + b, 0) / x.length, ma = m(ra), mb = m(rb);
    let cov = 0, vb = 0, va = 0; for (let i = 0; i < ra.length; i++) { cov += (ra[i] - ma) * (rb[i] - mb); vb += (rb[i] - mb) ** 2; va += (ra[i] - ma) ** 2; }
    const beta = vb ? cov / vb : null, corr = va && vb ? cov / Math.sqrt(va * vb) : null;
    return { bench: round((pairs[pairs.length - 1][1] / pairs[0][1] - 1) * 100, 2), beta: beta == null ? null : round(beta, 2), corr: corr == null ? null : round(corr, 2),
      alphaYr: beta == null ? null : round((ma - beta * mb) * 252 * 100, 2) };
  }
  // 몬테카를로: 일간 수익을 20일 덩어리로 섞어 1년 뒤 분포
  function monteCarlo(equity, n, seed) {
    if (!equity || equity.length < 120) return null;
    const v = equity.map((x) => x[1]), r = v.slice(1).map((x, i) => x / v[i] - 1);
    let s = seed || 7; const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
    const B = 20, H = 252, ends = [], mdds = [];
    for (let k = 0; k < (n || 500); k++) {
      let x = 1, peak = 1, mdd = 0;
      for (let j = 0; j < H; j += B) { const st = Math.floor(rnd() * (r.length - B)); for (let q = 0; q < B && j + q < H; q++) { x *= 1 + r[st + q]; peak = Math.max(peak, x); mdd = Math.min(mdd, x / peak - 1); } }
      ends.push(x - 1); mdds.push(mdd);
    }
    ends.sort((a, b) => a - b); mdds.sort((a, b) => a - b);
    const q = (arr, p) => round(arr[Math.floor(p * (arr.length - 1))] * 100, 1);
    return { ret5: q(ends, 0.05), ret50: q(ends, 0.5), ret95: q(ends, 0.95), mdd5: q(mdds, 0.05), mdd50: q(mdds, 0.5), lossProb: round(ends.filter((x) => x < 0).length / ends.length * 100, 1) };
  }
  // 여러 봇 자산 곡선을 같은 비중으로 합침 (매일 재조정한 팀 계좌)
  function combine(curves) {
    const maps = curves.filter((c) => c && c.length > 1).map((c) => { const m = {}; c.forEach(([d, x]) => { m[d] = x; }); return m; });
    if (!maps.length) return [];
    const dates = Array.from(new Set([].concat.apply([], curves.filter(Boolean).map((c) => c.map((x) => x[0]))))).sort();
    const last = maps.map(() => null); let val = 100000000; const out = [];
    dates.forEach((d) => {
      let s = 0, n = 0;
      maps.forEach((m, k) => { if (m[d] != null) { if (last[k] != null) { s += m[d] / last[k] - 1; n++; } last[k] = m[d]; } else if (last[k] != null) n++; });
      if (n) val *= 1 + s / n; out.push([d, Math.round(val)]);
    });
    return out;
  }
  // 실전 전환 체크리스트
  function readiness(live, bt) {
    const L = live || {}, B = bt || {};
    const items = [
      ['모의투자 60거래일 이상', (L.days || 0) >= 60, (L.days || 0) + '일'],
      ['청산된 거래 20번 이상', (L.trades || 0) >= 20, (L.trades || 0) + '번'],
      ['손익비(PF) 1.3 이상', L.pf != null && L.pf >= 1.3, L.pf == null ? '—' : L.pf],
      ['모의 최대낙폭이 백테스트의 1.5배 이내', L.mdd != null && B.mdd != null && L.mdd >= B.mdd * 1.5, L.mdd == null ? '—' : L.mdd + '%'],
      ['백테스트 표본 외 구간도 수익', B.oosCagr != null && B.oosCagr > 0, B.oosCagr == null ? '—' : B.oosCagr + '%/년'],
      ['백테스트 샤프 0.8 이상', B.sharpe != null && B.sharpe >= 0.8, B.sharpe == null ? '—' : B.sharpe]
    ].map(([label, ok, val]) => ({ label, ok: !!ok, val }));
    return { items, passed: items.filter((x) => x.ok).length, total: items.length, ready: items.every((x) => x.ok) };
  }

  const Quant = { BOTS, VAULT, COST, START_CASH, prepare, buildWorld, run, backtest, step, newAccount, metrics, versus, monteCarlo, combine, readiness, rsRanks, equityOf, lastIdx,
    _: { smaArr, emaArr, atrArr, rsiArr, rollMax, rollMin, volArr, rsRaw, isMonthStart, isWeekStart, dayDiff } };
  root.Quant = Quant;
  if (typeof module !== 'undefined' && module.exports) module.exports = Quant;
})(typeof window !== 'undefined' ? window : globalThis);
