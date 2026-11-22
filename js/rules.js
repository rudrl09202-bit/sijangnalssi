/*
 * 시장날씨 — 판단 규칙 (모든 점수·날씨는 여기 규칙대로만 계산됩니다)
 * 규칙을 바꾸고 싶으면 이 파일의 숫자만 고치면 됩니다.
 * 브라우저에서는 window.Rules, Node 테스트에서는 module.exports 로 씁니다.
 */
(function (root) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const DAY = 24 * 60 * 60 * 1000;

  /* ---------- 1. 시장날씨 ---------- */
  // 역풍(위험 신호) 5가지 중 몇 개가 켜졌는지로 날씨를 정합니다.
  const WEATHER_LIMITS = {
    us10y: 4.5,   // 미 10년물 금리(%) 이상이면 역풍
    dxy: 102,     // 달러지수 이상이면 역풍
    brent: 90,    // 브렌트유($) 이상이면 역풍
    vix: 25,      // VIX 이상이면 역풍
    fng: 25       // 코인 공포탐욕 이하면 역풍(공포)
  };

  function marketWeather(m, fng) {
    const winds = [
      { key: 'us10y', label: '금리', on: m.us10y.value >= WEATHER_LIMITS.us10y, text: '미 10년물 ' + m.us10y.value.toFixed(2) + '%' },
      { key: 'dxy', label: '달러', on: m.dxy.value >= WEATHER_LIMITS.dxy, text: '달러지수 ' + m.dxy.value.toFixed(2) },
      { key: 'brent', label: '유가', on: m.brent.value >= WEATHER_LIMITS.brent, text: '브렌트 $' + m.brent.value.toFixed(2) },
      { key: 'vix', label: '변동성', on: m.vix.value >= WEATHER_LIMITS.vix, text: 'VIX ' + m.vix.value.toFixed(2) },
      { key: 'fng', label: '심리', on: fng <= WEATHER_LIMITS.fng, text: '공포탐욕 ' + fng }
    ];
    const n = winds.filter((w) => w.on).length;
    const table = [
      { icon: 'sun', title: '맑음', sub: '돈이 풀리는 분위기 · 위험자산에 순풍' },
      { icon: 'sun', title: '대체로 맑음', sub: '역풍이 하나 · 크게 걱정할 단계는 아님' },
      { icon: 'cloud', title: '구름 조금', sub: '역풍이 둘 · 종목을 가려서 볼 때' },
      { icon: 'cloud', title: '흐림', sub: '역풍이 셋 · 변동성에 대비' },
      { icon: 'storm', title: '흐림, 소나기 주의', sub: '돈이 마르는 긴축 국면 · 변동성 큼' },
      { icon: 'storm', title: '폭풍우', sub: '모든 바람이 역풍 · 방어가 우선' }
    ];
    return { count: n, winds, ...table[n] };
  }

  /* ---------- 2. 업종 로테이션 4칸 ---------- */
  function median(arr) {
    const s = arr.slice().sort((a, b) => a - b);
    const k = Math.floor(s.length / 2);
    return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
  }
  function sectorQuads(sectors) {
    const mx = median(sectors.map((s) => s.ytd));
    const my = median(sectors.map((s) => s.m1));
    const q = { improve: [], lead: [], lag: [], weak: [] };
    sectors.forEach((s) => {
      const right = s.ytd >= mx, up = s.m1 > my;
      q[right ? (up ? 'lead' : 'weak') : (up ? 'improve' : 'lag')].push(s);
    });
    return { medYtd: mx, medM1: my, quads: q };
  }

  /* ---------- 3. 1년 성적표 ---------- */
  function perfTable(perf) {
    const fx = perf.usdkrwNow / perf.usdkrwThen;
    return perf.rows.map((r) => {
      const p = r.now / r.then;
      const k = r.ccy === 'USD' ? p * fx : p;
      return { name: r.name, local: (p - 1) * 100, krw: (k - 1) * 100, won10m: k * 1000 };
    });
  }

  /* ---------- 4. 종목 진단 점수 (5개 항목 × 20점) ---------- */
  // (1) 매크로 바람: 20점에서 역풍마다 깎기
  function scoreMacro(m, rates) {
    let s = 20; const why = [];
    if (m.us10y.value >= 5) { s -= 8; why.push('미 10년물 5% 이상(-8)'); }
    else if (m.us10y.value >= 4.5) { s -= 5; why.push('미 10년물 4.5% 이상(-5)'); }
    if (m.dxy.value >= 103) { s -= 6; why.push('달러지수 103 이상(-6)'); }
    else if (m.dxy.value >= 100) { s -= 3; why.push('달러지수 100 이상(-3)'); }
    const fed = rates.find((r) => r.key === 'fed');
    if (fed && fed.expect === 'hike') { s -= 4; why.push('연준 추가 인상 예상(-4)'); }
    if (fed && fed.expect === 'cut') { s += 2; why.push('연준 인하 예상(+2)'); }
    return { score: clamp(s, 0, 20), why: why.length ? why.join(', ') : '금리·달러 모두 부담 없음' };
  }

  // (2) 가격 추세: 일봉 종가 배열(오래된 → 최근)로 이동평균 비교
  function sma(arr, n) { if (arr.length < n) return null; const t = arr.slice(-n); return t.reduce((a, b) => a + b, 0) / n; }
  function scoreTrend(closes) {
    if (!closes || closes.length < 60) return { score: null, why: '가격 기록이 부족해 계산하지 않음' };
    const p = closes[closes.length - 1], m20 = sma(closes, 20), m60 = sma(closes, 60);
    let s = 0; const why = [];
    if (p > m20) { s += 7; why.push('20일 평균 위(+7)'); } else why.push('20일 평균 아래');
    if (p > m60) { s += 7; why.push('60일 평균 위(+7)'); } else why.push('60일 평균 아래');
    if (m20 > m60) { s += 6; why.push('단기 평균이 장기 평균 위(+6)'); } else why.push('단기 평균이 장기 평균 아래');
    const chg30 = closes.length > 30 ? (p / closes[closes.length - 31] - 1) * 100 : null;
    return { score: s, why: why.join(', ') + (chg30 != null ? ' · 30일 ' + (chg30 > 0 ? '+' : '') + chg30.toFixed(1) + '%' : '') };
  }

  // (3) 심리(역발상): 공포가 클수록 가점
  function scoreSentiment(fng) {
    const s = fng <= 20 ? 14 : fng <= 40 ? 11 : fng <= 60 ? 8 : fng <= 80 ? 5 : 2;
    return { score: s, why: '공포탐욕 ' + fng + ' — ' + (fng <= 20 ? '극단적 공포는 역발상 가점' : fng >= 80 ? '극단적 탐욕은 과열 감점' : '보통 구간') };
  }

  // (4) 수요: 코인은 현물 ETF 자금 흐름(억 달러)
  function scoreFlow(flow) {
    const s = flow <= -20 ? 3 : flow < 0 ? 7 : flow <= 20 ? 13 : 18;
    return { score: s, why: '현물 ETF ' + (flow >= 0 ? '+' : '') + flow + '억 달러 ' + (flow < 0 ? '순유출' : '순유입') };
  }

  // (5) 이벤트 위험: 가장 가까운 큰 일정까지 남은 날
  function daysUntil(dateStr, now) {
    const d = new Date(dateStr + 'T00:00:00+09:00').getTime();
    return Math.ceil((d - now) / DAY);
  }
  function nextEvent(events, now) {
    const up = events.map((e) => ({ ...e, d: daysUntil(e.date, now) })).filter((e) => e.d >= 0).sort((a, b) => a.d - b.d);
    return up[0] || null;
  }
  function scoreEvent(events, now) {
    const e = nextEvent(events, now);
    if (!e) return { score: 14, why: '예정된 큰 일정 없음' };
    const s = e.d <= 7 ? 6 : e.d <= 21 ? 10 : 14;
    return { score: s, why: e.title + '까지 ' + e.d + '일' };
  }

  // (6) 업종 사이클: 로테이션 4칸 위치
  function scoreSector(sectorId, sectors) {
    const { quads } = sectorQuads(sectors);
    const pts = { lead: 16, improve: 13, weak: 7, lag: 4 };
    const label = { lead: '주도', improve: '살아나는 중', weak: '힘 빠지는 중', lag: '소외' };
    for (const k of Object.keys(quads)) {
      const s = quads[k].find((x) => x.id === sectorId);
      if (s) return { score: pts[k], why: s.name + ' 업종은 \'' + label[k] + '\' 칸 (올해 ' + s.ytd + '%, 1달 ' + s.m1 + '%)' };
    }
    return { score: null, why: '업종을 고르면 계산' };
  }

  function grade(total, max) {
    const pct = total / max * 100;
    return pct >= 70 ? '조건 유리' : pct >= 50 ? '보통' : pct >= 35 ? '조건 불리' : '매우 불리';
  }

  // 코인 진단
  function scoreCoin(ctx) {
    const axes = [
      { name: '매크로 바람', ...scoreMacro(ctx.markets, ctx.rates) },
      { name: '수요 (ETF 자금)', ...scoreFlow(ctx.etfFlow) },
      { name: '심리 (역발상)', ...scoreSentiment(ctx.fng) },
      { name: '가격 추세', ...scoreTrend(ctx.closes) },
      { name: '이벤트 위험', ...scoreEvent(ctx.events, ctx.now) }
    ];
    return finish(axes);
  }

  // 주식 진단 (v0.1: 실적·추세는 데이터 연결 전이라 제외하고 계산)
  function scoreStock(ctx) {
    const axes = [
      { name: '매크로 바람', ...scoreMacro(ctx.markets, ctx.rates) },
      { name: '업종 사이클', ...scoreSector(ctx.sectorId, ctx.sectors) },
      { name: '이벤트 위험', ...scoreEvent(ctx.events, ctx.now) },
      { name: '실적', score: null, why: '실적 데이터 연결 후 계산 (다음 버전)' },
      { name: '가격 추세', score: null, why: '주가 기록 연결 후 계산 (다음 버전)' }
    ];
    return finish(axes);
  }

  function finish(axes) {
    const done = axes.filter((a) => a.score != null);
    const total = done.reduce((s, a) => s + a.score, 0);
    const max = done.length * 20;
    const as100 = max ? Math.round(total / max * 100) : 0;
    return { axes, total, max, score100: as100, partial: done.length < axes.length, grade: max ? grade(total, max) : '계산 불가' };
  }

  /* ---------- 4-2. 다중 조건 진단 v2 ----------
   * 조건(체크)마다 점수를 주고, 체크를 7개 묶음으로 모아 묶음별 0~100점을 낸 뒤
   * 묶음 가중치로 평균합니다. 데이터가 없는 체크·묶음은 빼고 남은 가중치로 다시 나눕니다.
   */
  const COIN_WEIGHTS = { macro: 15, trend: 25, momentum: 15, risk: 10, volume: 10, flow: 20, event: 5 };
  const STOCK_WEIGHTS = { macro: 25, sector: 35, trend: 20, event: 10, fundamental: 10 };
  // 주가 기록이 있을 때: 가격 조건 비중을 키움 (실적 데이터는 아직 없음)
  const STOCK_WEIGHTS_PX = { macro: 15, sector: 20, trend: 25, momentum: 15, risk: 10, volume: 10, event: 5, fundamental: 10 };
  const GROUP_NAME = { macro: '매크로 환경', trend: '가격 추세', momentum: '탄력·과열', risk: '변동성·위험', volume: '거래·유동성', flow: '수급·심리', event: '일정 위험', sector: '업종 환경', fundamental: '실적·가치' };
  const STABLE = ['USDT', 'USDC', 'DAI', 'USDE', 'FDUSD', 'USD1', 'TUSD', 'PYUSD', 'USDS'];

  // 업종 성격: rate=금리에 약함(1)/보통(0)/금리 오를 때 유리(-1), oil=유가 오르면 유리(1)/불리(-1), defensive=경기방어, exporter=원화 약세 수혜(한국 기업)
  const SECTOR_TRAITS = {
    tech: { rate: 1, oil: 0, defensive: 0, exporter: 1 }, comm: { rate: 1, oil: 0, defensive: 0, exporter: 0 },
    discretionary: { rate: 1, oil: -1, defensive: 0, exporter: 1 }, realestate: { rate: 1, oil: 0, defensive: 0, exporter: 0 },
    utilities: { rate: 1, oil: -1, defensive: 1, exporter: 0 }, staples: { rate: 0, oil: -1, defensive: 1, exporter: 0 },
    health: { rate: 0, oil: 0, defensive: 1, exporter: 1 }, energy: { rate: 0, oil: 1, defensive: 0, exporter: 0 },
    materials: { rate: 0, oil: 1, defensive: 0, exporter: 1 }, industrials: { rate: 0, oil: -1, defensive: 0, exporter: 1 },
    financials: { rate: -1, oil: 0, defensive: 0, exporter: 0 }
  };

  // 지표 계산 도우미
  const last = (a) => a[a.length - 1];
  const ret = (a, n) => (a && a.length > n ? (last(a) / a[a.length - 1 - n] - 1) * 100 : null);
  function rsi(c, n) {
    n = n || 14; if (!c || c.length <= n) return null;
    let g = 0, l = 0;
    for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
    g /= n; l /= n;
    for (let i = n + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; }
    return l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  function stdev(a) { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) * (y - m), 0) / (a.length - 1)); }
  function volAnnual(c, n) { if (!c || c.length <= n) return null; const r = []; for (let i = c.length - n; i < c.length; i++) r.push(Math.log(c[i] / c[i - 1])); return stdev(r) * Math.sqrt(365) * 100; }
  function mdd(c, n) { const a = c.slice(-n); let pk = a[0], m = 0; a.forEach((x) => { pk = Math.max(pk, x); m = Math.min(m, x / pk - 1); }); return m * 100; }
  function atrPct(k, n) {
    n = n || 14; if (!k.h || k.h.length <= n) return null;
    let t = 0; for (let i = k.c.length - n; i < k.c.length; i++) t += Math.max(k.h[i] - k.l[i], Math.abs(k.h[i] - k.c[i - 1]), Math.abs(k.l[i] - k.c[i - 1]));
    return t / n / last(k.c) * 100;
  }
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const pct1 = (v) => (v > 0 ? '+' : '') + v.toFixed(1) + '%';

  // 체크 하나: 구간표(tiers)로 점수 매기기. tiers = [[조건함수, 점수, 설명], ...] 처음 맞는 줄
  function check(group, label, value, max, tiers, show) {
    if (value == null || (typeof value === 'number' && isNaN(value))) return { group, label, pts: null, max, note: '데이터 없음' };
    for (const [ok, pts, note] of tiers) if (ok(value)) return { group, label, pts, max, note: (show ? show(value) + ' · ' : '') + note };
    return { group, label, pts: 0, max, note: show ? show(value) : '' };
  }

  function macroChecks(m, rates) {
    const fed = rates.find((r) => r.key === 'fed') || {};
    const spread = m.us2y ? m.us10y.value - m.us2y.value : null;
    return [
      check('macro', '미 10년물 금리 수준', m.us10y.value, 3, [[(v) => v < 4, 3, '돈 빌리는 값이 싸 위험자산에 우호'], [(v) => v < 4.5, 2, '보통'], [(v) => v < 5, 1, '부담 구간'], [() => true, 0, '5% 이상, 강한 역풍']], (v) => v.toFixed(2) + '%'),
      check('macro', '연준 다음 결정', fed.expect, 3, [[(v) => v === 'cut', 3, '인하 예상 — 돈이 풀림'], [(v) => v === 'hold', 2, '동결 예상'], [() => true, 0, '인상 예상 — 돈이 마름']]),
      check('macro', '장단기 금리차 (10년-2년)', spread, 2, [[(v) => v >= 0.5, 2, '정상 — 경기 기대 살아 있음'], [(v) => v >= 0, 1, '평탄'], [() => true, 0, '역전 — 경기침체 경고']], (v) => (v >= 0 ? '+' : '') + v.toFixed(2) + '%p'),
      check('macro', '달러 강세 정도 (DXY)', m.dxy.value, 3, [[(v) => v < 98, 3, '달러 약세 — 위험자산 순풍'], [(v) => v < 101, 2, '보통'], [(v) => v < 104, 1, '달러 강세 — 신흥국·코인 부담'], [() => true, 0, '매우 강한 달러']], (v) => v.toFixed(2)),
      check('macro', '유가 (브렌트)', m.brent.value, 2, [[(v) => v < 75, 2, '물가 부담 적음'], [(v) => v < 90, 1, '보통'], [() => true, 0, '물가 자극 — 금리 인상 압력']], (v) => '$' + v.toFixed(1)),
      check('macro', '시장 공포 (VIX)', m.vix.value, 3, [[(v) => v < 16, 3, '안정'], [(v) => v < 20, 2, '보통'], [(v) => v < 25, 1, '불안'], [() => true, 0, '공포 — 변동성 큼']], (v) => v.toFixed(1))
    ];
  }

  function eventChecks(events, now) {
    const up = events.map((e) => ({ ...e, d: daysUntil(e.date, now) })).filter((e) => e.d >= 0).sort((a, b) => a.d - b.d);
    const n14 = up.filter((e) => e.d <= 14).length;
    return [
      check('event', '다음 큰 일정까지', up[0] ? up[0].d : 99, 3, [[(v) => v > 21, 3, '여유'], [(v) => v > 7, 2, '조금 남음'], [(v) => v > 2, 1, '임박 — 결과 전 변동'], [() => true, 0, '바로 앞 — 결과 확인 후 대응']], (v) => (up[0] ? up[0].title + ' D-' + v : '없음')),
      check('event', '2주 안 큰 일정 수', n14, 2, [[(v) => v === 0, 2, '없음'], [(v) => v === 1, 1, '1개'], [() => true, 0, '여러 개 겹침']], (v) => v + '개')
    ];
  }

  function trendChecks(k) {
    const c = k && k.c;
    if (!c || c.length < 60) return [{ group: 'trend', label: '가격 추세 전체', pts: null, max: 0, note: '가격 기록 60일 미만 — 계산하지 않음' }];
    const p = last(c), m20 = sma(c, 20), m60 = sma(c, 60), m120 = sma(c, 120), m200 = sma(c, 200);
    const m60prev = c.length >= 70 ? sma(c.slice(0, -10), 60) : null;
    const hi = Math.max.apply(null, c), dd = (p / hi - 1) * 100;
    const above = (label, ma, max) => check('trend', label, ma == null ? null : p / ma - 1, max, [[(v) => v > 0, max, '위'], [() => true, 0, '아래']], (v) => pct1(v * 100));
    return [
      above('가격 vs 20일 평균', m20, 2), above('가격 vs 60일 평균', m60, 2), above('가격 vs 120일 평균', m120, 2), above('가격 vs 200일 평균 (장기 추세)', m200, 3),
      check('trend', '20일 평균 > 60일 평균 (단기 정배열)', m20 / m60 - 1, 2, [[(v) => v > 0, 2, '정배열'], [() => true, 0, '역배열']], (v) => pct1(v * 100)),
      check('trend', '60일 평균 > 120일 평균 (중기 정배열)', m120 == null ? null : m60 / m120 - 1, 2, [[(v) => v > 0, 2, '정배열'], [() => true, 0, '역배열']], (v) => pct1(v * 100)),
      check('trend', '60일 평균의 기울기 (10일 전 대비)', m60prev == null ? null : (m60 / m60prev - 1) * 100, 2, [[(v) => v > 0, 2, '올라가는 중'], [() => true, 0, '내려가는 중']], pct1),
      check('trend', '30일 수익률', ret(c, 30), 2, [[(v) => v > 5, 2, '상승'], [(v) => v > -5, 1, '횡보'], [() => true, 0, '하락']], pct1),
      check('trend', '90일 수익률', ret(c, 90), 2, [[(v) => v > 10, 2, '상승'], [(v) => v > -10, 1, '횡보'], [() => true, 0, '하락']], pct1),
      check('trend', '기간 최고가 대비 위치', dd, 3, [[(v) => v > -10, 3, '고점 근처'], [(v) => v > -25, 2, '조정 구간'], [(v) => v > -40, 1, '깊은 조정'], [() => true, 0, '고점에서 크게 무너짐']], pct1)
    ];
  }

  function momentumChecks(k) {
    const c = k && k.c;
    if (!c || c.length < 30) return [{ group: 'momentum', label: '탄력 지표 전체', pts: null, max: 0, note: '가격 기록 부족' }];
    const r = rsi(c, 14), m20 = sma(c, 20), sd = stdev(c.slice(-20)), p = last(c);
    const pb = sd ? (p - (m20 - 2 * sd)) / (4 * sd) : null;
    let streak = 0; for (let i = c.length - 1; i > 0 && c[i] < c[i - 1]; i--) streak++;
    let upStreak = 0; for (let i = c.length - 1; i > 0 && c[i] > c[i - 1]; i--) upStreak++;
    return [
      check('momentum', 'RSI(14) 과열·침체', r, 3, [[(v) => v > 75, 0, '과열 — 추격 매수 위험'], [(v) => v > 65, 1, '다소 과열'], [(v) => v >= 45, 3, '건강한 탄력'], [(v) => v >= 30, 2, '약세'], [() => true, 2, '과매도 — 반등 여지(역발상)']], (v) => v.toFixed(0)),
      check('momentum', '20일 평균과의 거리 (이격도)', (p / m20 - 1) * 100, 2, [[(v) => v > 15, 0, '평균보다 너무 높음 — 되돌림 위험'], [(v) => v > 5, 1, '다소 높음'], [(v) => v >= -12, 2, '적정 범위'], [() => true, 1, '급락 — 반등 또는 추가 하락 갈림길']], pct1),
      check('momentum', '볼린저밴드 위치', pb, 2, [[(v) => v > 1, 0, '상단 돌파 — 과열'], [(v) => v < 0, 1, '하단 이탈 — 급락'], [(v) => v >= 0.2 && v <= 0.8, 2, '밴드 안 안정'], [() => true, 1, '밴드 가장자리']], (v) => (v * 100).toFixed(0) + '%'),
      check('momentum', '연속 하락·상승일', streak ? -streak : upStreak, 1, [[(v) => v <= -4, 0, '연속 하락 — 매도세 우위'], [(v) => v >= 6, 0, '연속 상승 — 단기 과열'], [() => true, 1, '보통']], (v) => (v < 0 ? (-v) + '일 연속 하락' : v + '일 연속 상승'))
    ];
  }

  function riskChecks(k, stock) {
    const c = k && k.c;
    if (!c || c.length < 31) return [{ group: 'risk', label: '위험 지표 전체', pts: null, max: 0, note: '가격 기록 부족' }];
    return [
      stock
        ? check('risk', '30일 변동성 (연율)', volAnnual(c, 30) * Math.sqrt(252 / 365), 3, [[(v) => v < 25, 3, '안정적'], [(v) => v < 40, 2, '보통 (주식 기준)'], [(v) => v < 60, 1, '거침'], [() => true, 0, '매우 거침 — 비중 작게']], (v) => v.toFixed(0) + '%')
        : check('risk', '30일 변동성 (연율)', volAnnual(c, 30), 3, [[(v) => v < 40, 3, '안정적'], [(v) => v < 70, 2, '보통 (코인 기준)'], [(v) => v < 100, 1, '거침'], [() => true, 0, '매우 거침 — 비중 작게']], (v) => v.toFixed(0) + '%'),
      check('risk', '최근 90일 최대 낙폭', c.length >= 90 ? mdd(c, 90) : null, 3, stock ? [[(v) => v > -10, 3, '얕음'], [(v) => v > -20, 2, '보통'], [(v) => v > -35, 1, '깊음'], [() => true, 0, '크게 무너짐']] : [[(v) => v > -20, 3, '얕음'], [(v) => v > -35, 2, '보통'], [(v) => v > -50, 1, '깊음'], [() => true, 0, '반토막 이상']], pct1),
      check('risk', '하루 평균 흔들림 (ATR)', atrPct(k, 14), 2, stock ? [[(v) => v < 2, 2, '작음'], [(v) => v < 4, 1, '보통'], [() => true, 0, '큼 — 손절폭 넓게 필요']] : [[(v) => v < 3, 2, '작음'], [(v) => v < 6, 1, '보통'], [() => true, 0, '큼 — 손절폭 넓게 필요']], (v) => v.toFixed(1) + '%')
    ];
  }

  function volumeChecks(k) {
    if (!k || !k.v || k.v.length < 25) return [{ group: 'volume', label: '거래 지표 전체', pts: null, max: 0, note: '거래대금 기록 없음' }];
    const v = k.v, c = k.c;
    const r5 = avg(v.slice(-5)) / avg(v.slice(-20)), up5 = ret(c, 5);
    let upV = 0, dnV = 0; for (let i = c.length - 20; i < c.length; i++) { if (c[i] > c[i - 1]) upV += v[i]; else dnV += v[i]; }
    const liq = avg(v.slice(-20));
    return [
      check('volume', '최근 거래대금 변화 (5일/20일)', r5, 3, [[(x) => x > 1.5 && up5 > 0, 3, '돈이 몰리며 상승'], [(x) => x > 1.5, 0, '거래 급증 속 하락 — 투매 가능성'], [(x) => x >= 0.8, 2, '평소 수준'], [() => true, 1, '관심 줄어드는 중']], (x) => 'x' + x.toFixed(2)),
      check('volume', '오른 날 vs 내린 날 거래대금 (20일)', dnV ? upV / dnV : 9, 3, [[(x) => x > 1.2, 3, '사는 힘이 큼'], [(x) => x > 0.9, 2, '팽팽'], [(x) => x > 0.7, 1, '파는 힘이 큼'], [() => true, 0, '매도 우위 뚜렷']], (x) => x.toFixed(2) + '배'),
      check('volume', '유동성 (20일 평균 거래대금)', liq, 3, [[(x) => x >= 1e11, 3, '풍부'], [(x) => x >= 1e10, 2, '보통'], [(x) => x >= 1e9, 1, '얇음 — 큰 주문 시 가격 밀림'], [() => true, 0, '매우 얇음']], (x) => (x / 1e8).toFixed(0) + '억원/일')
    ];
  }

  function flowChecks(ctx, isBtc) {
    const out = [
      check('flow', '시장 심리 (공포·탐욕, 역발상)', ctx.fng, 4, [[(v) => v <= 20, 4, '극단적 공포 — 역사적으로 싸게 살 기회가 많았음'], [(v) => v <= 40, 3, '공포'], [(v) => v <= 60, 2, '보통'], [(v) => v <= 80, 1, '탐욕'], [() => true, 0, '극단적 탐욕 — 과열']], (v) => String(v)),
      check('flow', '현물 ETF 자금 (이번 달)', ctx.etfFlow, 4, [[(v) => v > 20, 4, '큰 순유입'], [(v) => v > 0, 3, '순유입'], [(v) => v > -20, 1, '순유출'], [() => true, 0, '큰 순유출 — 기관이 빠짐']], (v) => (v >= 0 ? '+' : '') + v + '억 달러')
    ];
    const dom = ctx.btcDominance;
    out.push(isBtc
      ? check('flow', '비트코인 도미넌스', dom, 2, [[(v) => v >= 55, 2, '돈이 비트코인으로 모임'], [() => true, 1, '알트로 분산']], (v) => v.toFixed(1) + '%')
      : check('flow', '비트코인 도미넌스 (알트 입장)', dom, 2, [[(v) => v < 52, 2, '알트 시즌 쪽'], [(v) => v < 58, 1, '중립'], [() => true, 0, '비트코인으로 쏠림 — 알트 불리']], (v) => v.toFixed(1) + '%'));
    if (!isBtc) {
      const b = ctx.btc && ctx.btc.c;
      const rs = b && ctx.candles ? (ret(ctx.candles.c, 30) - ret(b, 30)) : null;
      out.push(check('flow', '비트코인 대비 힘 (30일)', rs, 3, [[(v) => v > 5, 3, '비트코인보다 강함'], [(v) => v > -5, 2, '비슷'], [(v) => v > -15, 1, '약함'], [() => true, 0, '크게 약함']], (v) => (v > 0 ? '+' : '') + v.toFixed(1) + '%p'));
      out.push(check('flow', '대장(비트코인) 추세', b && b.length >= 60 ? last(b) / sma(b, 60) - 1 : null, 2, [[(v) => v > 0, 2, '비트코인 60일 평균 위'], [() => true, 0, '비트코인 약세 — 알트는 더 크게 흔들림']], (v) => pct1(v * 100)));
    }
    return out;
  }

  function sectorChecks(ctx) {
    const sec = (ctx.sectors || []).find((x) => x.id === ctx.sectorId);
    if (!sec) return [{ group: 'sector', label: '업종 환경 전체', pts: null, max: 0, note: '업종을 고르면 계산' }];
    const t = SECTOR_TRAITS[sec.id] || { rate: 0, oil: 0, defensive: 0, exporter: 0 };
    const { quads, medM1 } = sectorQuads(ctx.sectors);
    const qk = Object.keys(quads).find((k) => quads[k].some((x) => x.id === sec.id));
    const m = ctx.markets, fed = (ctx.rates || []).find((r) => r.key === 'fed') || {};
    const tight = m.us10y.value >= 4.5 || fed.expect === 'hike', easy = fed.expect === 'cut';
    const fear = m.vix.value >= 25;
    const out = [
      check('sector', '업종 사이클 위치', qk, 4, [[(v) => v === 'lead', 4, '주도'], [(v) => v === 'improve', 3, '살아나는 중'], [(v) => v === 'weak', 1, '힘 빠지는 중'], [() => true, 0, '소외']], () => sec.name),
      check('sector', '업종 최근 1달 힘 (업종 평균 대비)', sec.m1 - medM1, 2, [[(v) => v > 2, 2, '평균보다 강함'], [(v) => v > -2, 1, '평균 수준'], [() => true, 0, '평균보다 약함']], (v) => '1달 ' + pct1(sec.m1)),
      check('sector', '업종 올해 성과', sec.ytd, 2, [[(v) => v > 10, 2, '강함'], [(v) => v > 0, 1, '플러스'], [() => true, 0, '마이너스']], pct1),
      check('sector', '금리 환경과 업종 궁합', t.rate, 3, [[(v) => v === 1 && tight, 0, '금리에 약한 업종 + 긴축 — 불리'], [(v) => v === 1 && easy, 3, '금리에 약한 업종 + 완화 — 유리'], [(v) => v === -1 && tight, 3, '금리 오를 때 유리한 업종(금융)'], [(v) => v === -1 && easy, 1, '금리 내릴 때 마진 감소'], [() => true, 2, '금리 영향 보통']], () => (tight ? '긴축 국면' : easy ? '완화 국면' : '중립')),
      check('sector', '유가와 업종 궁합', t.oil, 2, [[(v) => v === 1 && m.brent.value >= 85, 2, '고유가 수혜'], [(v) => v === -1 && m.brent.value >= 85, 0, '고유가 비용 부담'], [(v) => v === 1 && m.brent.value < 70, 0, '저유가 불리'], [() => true, 1, '유가 영향 보통']], () => '브렌트 $' + m.brent.value.toFixed(0)),
      check('sector', '시장 불안 시 방어력', t.defensive, 2, [[(v) => v === 1 && fear, 2, '경기방어 업종 — 불안장에 강함'], [(v) => v === 0 && fear, 0, '경기민감 업종 + 불안장'], [(v) => v === 1, 1, '방어 업종 (상승장엔 덜 오름)'], [() => true, 2, '불안 낮음 — 경기민감 업종에 무난']], () => 'VIX ' + m.vix.value.toFixed(0))
    ];
    if (ctx.currency === 'USD') {
      out.push(check('sector', '환율 (원화로 미국 주식 살 때)', m.usdkrw.value, 2, [[(v) => v < 1300, 2, '달러 쌈 — 환율 유리'], [(v) => v < 1400, 1, '보통'], [() => true, 0, '달러 비쌈 — 환율 떨어지면 손해']], (v) => v.toFixed(0) + '원'));
    } else {
      const bok = (ctx.rates || []).find((r) => r.key === 'bok') || {};
      out.push(check('sector', '원화 약세 수혜 (수출 기업)', t.exporter ? m.usdkrw.value : null, 2, [[(v) => v >= 1350, 2, '원화 약세 — 수출 기업 이익 늘어남'], [() => true, 1, '보통']], (v) => v.toFixed(0) + '원'));
      out.push(check('sector', '한국은행 금리 방향', bok.expect, 2, [[(v) => v === 'cut', 2, '인하 예상'], [(v) => v === 'hold', 1, '동결 예상'], [() => true, 0, '인상 예상 — 국내 주식 부담']]));
    }
    return out;
  }

  function summarize(checks, weights) {
    const groups = Object.keys(weights).map((g) => {
      const cs = checks.filter((c) => c.group === g);
      const used = cs.filter((c) => c.pts != null && c.max > 0);
      const max = used.reduce((t, c) => t + c.max, 0), pts = used.reduce((t, c) => t + c.pts, 0);
      return { key: g, name: GROUP_NAME[g], weight: weights[g], score: max ? Math.round(pts / max * 100) : null, pts, max, checks: cs };
    });
    const live = groups.filter((g) => g.score != null);
    const wsum = live.reduce((t, g) => t + g.weight, 0);
    const score100 = wsum ? Math.round(live.reduce((t, g) => t + g.score * g.weight, 0) / wsum) : null;
    const used = checks.filter((c) => c.pts != null && c.max > 0).length;
    const g = score100 == null ? '계산 불가' : score100 >= 70 ? '조건 유리' : score100 >= 55 ? '다소 유리' : score100 >= 45 ? '중립' : score100 >= 30 ? '다소 불리' : '조건 불리';
    const plus = checks.filter((c) => c.pts != null && c.max > 0 && c.pts === c.max).sort((a, b) => b.max - a.max).slice(0, 3);
    const minus = checks.filter((c) => c.pts === 0 && c.max > 0).sort((a, b) => b.max - a.max).slice(0, 3);
    return { v: 2, groups, score100, grade: g, checksUsed: used, checksAll: checks.length, coverage: wsum, plus, minus, partial: wsum < Object.values(weights).reduce((a, b) => a + b, 0) };
  }

  // ctx: { symbol, candles{c,h,l,v}, btc{c...}, markets, rates, etfFlow, fng, btcDominance, events, now }
  function scoreCoin2(ctx) {
    const sym = (ctx.symbol || '').toUpperCase();
    if (STABLE.includes(sym)) return { v: 2, stable: true, score100: null, grade: '점수 대상 아님', groups: [], plus: [], minus: [], checksUsed: 0, checksAll: 0, note: '달러에 1:1로 묶인 스테이블코인이라 가격 조건 점수를 매기지 않습니다. 원화 환산 가치는 원/달러 환율을 따라 움직입니다.' };
    const isBtc = sym === 'BTC';
    const k = ctx.candles || (ctx.closes ? { c: ctx.closes } : null);
    const checks = [].concat(macroChecks(ctx.markets, ctx.rates), trendChecks(k), momentumChecks(k), riskChecks(k), volumeChecks(k), flowChecks({ ...ctx, candles: k }, isBtc), eventChecks(ctx.events, ctx.now));
    return summarize(checks, COIN_WEIGHTS);
  }
  // ctx: { sectorId, sectors, currency, markets, rates, events, now, candles?(주가 기록이 있으면) }
  // ctx.candles = { c, h, l, v(원화 거래대금) }, ctx.bench = 같은 시장 지수 종가 배열, ctx.benchName
  function scoreStock2(ctx) {
    const k = ctx.candles && ctx.candles.c && ctx.candles.c.length >= 60 ? ctx.candles : null;
    const fund = [{ group: 'fundamental', label: '실적·밸류에이션', pts: null, max: 0, note: '실적 데이터 연결 후 계산' }];
    if (!k) {
      const checks = [].concat(macroChecks(ctx.markets, ctx.rates), sectorChecks(ctx), [{ group: 'trend', label: '주가 추세', pts: null, max: 0, note: '주가 기록 연결 후 계산' }], eventChecks(ctx.events, ctx.now), fund);
      return summarize(checks, STOCK_WEIGHTS);
    }
    const trend = trendChecks(k);
    const b = ctx.bench;
    const rs = b && b.length > 63 && k.c.length > 63 ? ret(k.c, 63) - ret(b, 63) : null;
    trend.push(check('trend', '시장 대비 힘 (3개월, ' + (ctx.benchName || '지수') + ' 대비)', rs, 3, [[(v) => v > 10, 3, '시장보다 훨씬 강함'], [(v) => v > 0, 2, '시장보다 강함'], [(v) => v > -10, 1, '시장보다 약함'], [() => true, 0, '시장보다 크게 약함']], (v) => (v > 0 ? '+' : '') + v.toFixed(1) + '%p'));
    const vol = volumeChecks(k).map((c) => (c.label.startsWith('유동성') && c.pts != null ? { ...c, pts: Math.min(c.max, c.pts + 1), note: c.note } : c)); // 주식은 대형주 위주라 유동성 기준 완화
    const checks = [].concat(macroChecks(ctx.markets, ctx.rates), sectorChecks(ctx), trend, momentumChecks(k), riskChecks(k, true), vol, eventChecks(ctx.events, ctx.now), fund);
    return summarize(checks, STOCK_WEIGHTS_PX);
  }

  // 지수·원자재·통화 진단 (가격 기록 대신 거시 조건과 자산 성격의 궁합으로)
  // traits: rate(금리 민감 0~2) usdAsset(달러로 사는 자산) haven(안전자산) dollarHurt(달러 강세에 약함) oil kr exporter risk(위험자산) cash
  const ASSET_WEIGHTS = { macro: 25, fit: 45, trend: 20, event: 10 };
  function scoreAsset2(ctx) {
    const t = ctx.traits || {}, m = ctx.markets, fed = (ctx.rates || []).find((r) => r.key === 'fed') || {}, bok = (ctx.rates || []).find((r) => r.key === 'bok') || {};
    const tight = m.us10y.value >= 4.5 || fed.expect === 'hike', easy = fed.expect === 'cut', fear = m.vix.value >= 25;
    const fit = [];
    fit.push(check('fit', '금리 환경과의 궁합', t.cash ? 'cash' : t.rate || 0, 3, [
      [(v) => v === 'cash' && tight, 3, '고금리 — 현금성 자산이 유리'], [(v) => v === 'cash', 1, '금리 하락기엔 현금 매력 감소'],
      [(v) => v === 2 && tight, 0, '금리에 매우 민감한 성장 자산 + 긴축 — 불리'], [(v) => v === 2 && easy, 3, '완화 국면 — 성장 자산에 순풍'],
      [(v) => v === 1 && tight, 1, '금리 부담 있음'], [(v) => v === 1 && easy, 3, '완화 국면 — 유리'], [() => true, 2, '금리 영향 보통']], () => (tight ? '긴축' : easy ? '완화' : '중립')));
    fit.push(check('fit', '달러 흐름과의 궁합', m.dxy.value, 3, [
      [(v) => t.cash && v >= 101, 3, '강달러 — 달러 보유가 유리'], [(v) => t.cash, 1, '약달러 — 달러 매력 낮음'],
      [(v) => t.dollarHurt && v >= 101, 0, '강달러 — 금값에 역풍'], [(v) => t.kr && v >= 103, 0, '강달러 — 외국인 자금 이탈 압력'],
      [(v) => v >= 104, 1, '매우 강한 달러 — 위험자산 부담'], [(v) => v < 98, 3, '약달러 — 순풍'], [() => true, 2, '보통']], (v) => 'DXY ' + v.toFixed(1)));
    fit.push(check('fit', '시장 불안(VIX)과의 궁합', m.vix.value, 3, [
      [(v) => t.haven && v >= 25, 3, '불안장 — 안전자산 선호'], [(v) => t.haven, 1, '안정장 — 안전자산 덜 찾음'],
      [(v) => t.risk && v >= 30, 0, '공포 구간 — 위험자산 급락 위험'], [(v) => t.risk && v >= 25, 1, '불안 — 위험자산 변동 큼'], [() => true, 3, '안정 — 위험자산에 무난']], (v) => 'VIX ' + v.toFixed(0)));
    fit.push(check('fit', '유가와의 궁합', t.cash ? null : m.brent.value, 2, [
      [(v) => t.haven && v >= 85, 2, '고유가 — 물가 방어(인플레이션 헤지) 수요'], [(v) => t.haven, 1, '물가 안정 — 헤지 수요 적음'],
      [(v) => t.oil && v >= 85, 1, '이미 고유가 — 수요 둔화·되돌림 위험'], [(v) => t.oil, 2, '유가 안정'],
      [(v) => v >= 90, 0, '고유가 — 물가·금리 부담'], [(v) => v >= 80, 1, '유가 부담 조금'], [() => true, 2, '부담 적음']], (v) => '$' + v.toFixed(0)));
    fit.push(check('fit', '환율 (원화로 살 때)', t.usdAsset ? m.usdkrw.value : null, 2, [[(v) => v < 1300, 2, '달러 쌈 — 환율 유리'], [(v) => v < 1400, 1, '보통'], [() => true, 0, '달러 비쌈 — 환차손 위험']], (v) => v.toFixed(0) + '원'));
    if (t.kr) {
      fit.push(check('fit', '한국은행 금리 방향', bok.expect, 2, [[(v) => v === 'cut', 2, '인하 예상'], [(v) => v === 'hold', 1, '동결 예상'], [() => true, 0, '인상 예상 — 국내 주식 부담']]));
      if (t.exporter) fit.push(check('fit', '원화 약세 수혜 (수출 기업)', m.usdkrw.value, 2, [[(v) => v >= 1350, 2, '수출 기업 이익 증가'], [() => true, 1, '원화 강세 — 수출 이익 다소 감소']], (v) => v.toFixed(0) + '원'));
    }
    const trend = [
      check('trend', '1년 수익률', ctx.y1, 3, [[(v) => v > 15, 3, '강한 상승 추세'], [(v) => v > 0, 2, '상승'], [(v) => v > -15, 1, '약세'], [() => true, 0, '큰 하락']], pct1),
      check('trend', '최근 하루 흐름', ctx.d1, 1, [[(v) => v > 0, 1, '상승'], [() => true, 0, '하락']], pct1)
    ];
    // 위험자산이 아닌 금·달러는 '금리·달러 높으면 역풍' 같은 위험자산용 매크로 체크를 빼고 궁합으로만 봅니다
    return summarize([].concat(t.risk ? macroChecks(m, ctx.rates) : [], fit, trend, eventChecks(ctx.events, ctx.now)), ASSET_WEIGHTS);
  }
  GROUP_NAME.fit = '자산 궁합';

  // 오늘의 순위: items = [{ id, name, cls, result(점수 결과), action? }] → 점수순 정렬 + 이유 3줄
  function rankList(items) {
    return items.filter((x) => x.result && x.result.score100 != null)
      .sort((a, b) => b.result.score100 - a.result.score100)
      .map((x, i) => {
        const all = x.result.groups.reduce((t, g) => t.concat(g.checks), []).filter((c) => c.pts != null && c.max > 0);
        const order = (c) => (c.group === 'macro' ? 1 : 0); // 종목마다 다른 이유가 먼저 보이게
        const good = all.filter((c) => c.pts === c.max).sort((a, b) => order(a) - order(b) || b.max - a.max).slice(0, 2);
        const bad = all.filter((c) => c.pts === 0).sort((a, b) => order(a) - order(b) || b.max - a.max).slice(0, 1);
        const line = (c) => c.label + ' — ' + c.note.split(' · ').pop();
        return { ...x, rank: i + 1, good: good.map(line), bad: bad.map(line) };
      });
  }

  /* ---------- 4-5. 월가 스크리너: 종목 5축 1~100점 ----------
   * 가치(20) · 성장(20) · 수익성·재무(20) · 모멘텀(25) · 환경·위험(15)
   * 미너비니 트렌드 템플릿, IBD식 상대강도(RS), CAN SLIM, 그레이엄, 버핏식 퀄리티, 애널리스트 컨센서스를 함께 봅니다.
   * 재무 데이터(fund)가 없으면 그 축은 빼고 나머지 가중치로 다시 나눕니다.
   */
  const SCREEN_WEIGHTS = { value: 20, growth: 20, quality: 20, momentum: 25, risk: 15 };
  const SCREEN_NAME = { value: '가치', growth: '성장', quality: '수익성·재무', momentum: '모멘텀', risk: '환경·위험' };
  // 업종별 기준 PER (대략적인 장기 평균 — 비교의 눈금으로만 사용)
  const SECTOR_PE = { tech: 28, comm: 20, discretionary: 22, staples: 20, health: 20, energy: 12, materials: 15, industrials: 20, financials: 13, utilities: 17, realestate: 30 };

  // IBD식 상대강도: 최근 3개월 40% + 그 전 3개월씩 20%×3 가중 수익률을 전체 종목 중 백분위(1~99)로
  // 베타: 최근 1년 일간 수익률로 종목과 지수의 공분산 ÷ 지수 분산
  function betaOf(c, b) {
    if (!c || !b) return null;
    const n = Math.min(c.length, b.length, 251); if (n < 60) return null;
    const rc = [], rb = []; for (let i = 1; i < n; i++) { rc.push(c[c.length - n + i] / c[c.length - n + i - 1] - 1); rb.push(b[b.length - n + i] / b[b.length - n + i - 1] - 1); }
    const mc = avg(rc), mb = avg(rb); let cv = 0, vb = 0; for (let i = 0; i < rc.length; i++) { cv += (rc[i] - mc) * (rb[i] - mb); vb += (rb[i] - mb) * (rb[i] - mb); }
    return vb ? cv / vb : null;
  }
  function rsRaw(c) { if (!c || c.length < 253) return null; const r = (a, b) => c[c.length - 1 - a] / c[c.length - 1 - b] - 1; return 0.4 * r(0, 63) + 0.2 * r(63, 126) + 0.2 * r(126, 189) + 0.2 * r(189, 252); }
  function rsRatings(map) { // map: { 코드: 종가 배열 }
    const xs = Object.entries(map).map(([k, c]) => [k, rsRaw(c)]).filter((x) => x[1] != null).sort((a, b) => a[1] - b[1]);
    const out = {}; xs.forEach(([k], i) => { out[k] = Math.max(1, Math.min(99, Math.round((i + 0.5) / xs.length * 99))); });
    return out;
  }
  // 미너비니 트렌드 템플릿 8개 조건
  function minervini(c, rs) {
    const n = c.length, p = c[n - 1];
    const m50 = sma(c, 50), m150 = sma(c, 150), m200 = sma(c, 200), m200p = n > 222 ? sma(c.slice(0, -22), 200) : null;
    const w = c.slice(-252), hi = Math.max.apply(null, w), lo = Math.min.apply(null, w);
    const items = [
      ['주가 > 150일·200일선', m150 && m200 ? p > m150 && p > m200 : null],
      ['150일선 > 200일선', m150 && m200 ? m150 > m200 : null],
      ['200일선이 1달 넘게 상승 중', m200 && m200p ? m200 > m200p : null],
      ['50일선 > 150일선 > 200일선', m50 && m150 && m200 ? m50 > m150 && m150 > m200 : null],
      ['주가 > 50일선', m50 ? p > m50 : null],
      ['52주 최저가보다 30% 이상 위', lo ? p >= lo * 1.3 : null],
      ['52주 최고가에서 25% 이내', hi ? p >= hi * 0.75 : null],
      ['상대강도(RS) 70 이상', rs == null ? null : rs >= 70]
    ];
    const known = items.filter((x) => x[1] != null);
    return { items, pass: known.filter((x) => x[1]).length, total: known.length, hi, lo };
  }

  // ctx: { candles{c,h,l,v}, bench(지수 종가), fund, rs, sectorId, currency, markets, rates, sectors, events, now, weatherCount }
  function screenStock(ctx) {
    const f = ctx.fund || {}, k = ctx.candles && ctx.candles.c && ctx.candles.c.length >= 60 ? ctx.candles : null;
    const has = (x) => x != null && isFinite(x);
    const P = (x) => (x * 100); // 비율 → %
    const groups = { value: [], growth: [], quality: [], momentum: [], risk: [] };
    const add = (g, c) => groups[g].push({ ...c, group: g });
    const pc = (v) => (v > 0 ? '+' : '') + v.toFixed(1) + '%';
    const isFin = ctx.sectorId === 'financials' || ctx.sectorId === 'realestate';

    // ── 가치
    const norm = SECTOR_PE[ctx.sectorId] || 20;
    add('value', check('value', 'PER (업종 기준 ' + norm + '배 대비)', has(f.pe) ? f.pe : null, 5, [[(v) => v <= 0, 0, '적자 기업'], [(v) => v < norm * 0.6, 5, '업종 기준보다 크게 쌈'], [(v) => v < norm * 0.85, 4, '쌈'], [(v) => v < norm * 1.15, 3, '업종 평균 수준'], [(v) => v < norm * 1.5, 2, '다소 비쌈'], [(v) => v < norm * 2.2, 1, '비쌈'], [() => true, 0, '매우 비쌈 — 높은 성장이 이미 가격에 반영']], (v) => v.toFixed(1) + '배'));
    add('value', check('value', 'PSR (주가매출비율)', has(f.ps) ? f.ps : null, 3, [[(v) => v < 1.5, 3, '매출 대비 쌈'], [(v) => v < 3, 2, '보통'], [(v) => v < 6, 1, '비쌈'], [() => true, 0, '매출 대비 매우 비쌈']], (v) => v.toFixed(1) + '배'));
    add('value', check('value', 'PBR (주가순자산비율)', has(f.pb) ? f.pb : null, 3, [[(v) => v < 1, 3, '자산가치보다 쌈'], [(v) => v < 2, 2, '보통'], [(v) => v < 5, 1, '비쌈'], [() => true, 0, '매우 비쌈']], (v) => v.toFixed(1) + '배'));
    add('value', check('value', 'EV/EBITDA', has(f.evEbitda) && f.evEbitda > 0 ? f.evEbitda : null, 3, [[(v) => v < 8, 3, '현금창출력 대비 쌈'], [(v) => v < 12, 2, '보통'], [(v) => v < 20, 1, '비쌈'], [() => true, 0, '매우 비쌈']], (v) => v.toFixed(1) + '배'));
    add('value', check('value', 'PEG (PER ÷ 성장률)', has(f.peg) && f.peg > 0 ? f.peg : null, 3, [[(v) => v < 1, 3, '성장 대비 쌈 (피터 린치 기준)'], [(v) => v < 1.5, 2, '적정'], [(v) => v < 2.5, 1, '성장 대비 비쌈'], [() => true, 0, '성장 대비 매우 비쌈']], (v) => v.toFixed(2)));
    add('value', check('value', '배당수익률', has(f.divYield) ? P(f.divYield) : null, 2, [[(v) => v >= 3, 2, '높음'], [(v) => v >= 1, 1, '보통'], [() => true, 0, '낮거나 없음']], (v) => v.toFixed(2) + '%'));
    const upside = null; // 애널리스트 목표가: 공식 무료 출처가 없어 제외

    // ── 성장
    add('growth', check('growth', '매출 성장률 (전년 대비)', has(f.revGrowth) ? P(f.revGrowth) : null, 4, [[(v) => v > 25, 4, '고성장'], [(v) => v > 10, 3, '좋은 성장'], [(v) => v > 3, 2, '완만'], [(v) => v > 0, 1, '정체'], [() => true, 0, '매출 감소']], pc));
    add('growth', check('growth', '이익 성장률 (전년 대비)', has(f.epsGrowth) ? P(f.epsGrowth) : null, 4, [[(v) => v > 25, 4, '고성장 (CAN SLIM 기준 통과)'], [(v) => v > 10, 3, '좋음'], [(v) => v > 0, 2, '소폭 증가'], [(v) => v > -15, 1, '감소'], [() => true, 0, '크게 감소']], pc));
    add('growth', check('growth', '분기 이익 성장률', has(f.qEpsGrowth) ? P(f.qEpsGrowth) : null, 3, [[(v) => v >= 25, 3, '최근 분기 급성장'], [(v) => v > 5, 2, '증가'], [(v) => v > -10, 1, '정체'], [() => true, 0, '감소']], pc));
    add('growth', check('growth', '이익 성장 가속 (최근 분기 성장 − 연간 성장)', has(f.qEpsGrowth) && has(f.epsGrowth) ? P(f.qEpsGrowth - f.epsGrowth) : null, 3, [[(v) => v > 10, 3, '최근 들어 이익 성장이 빨라짐'], [(v) => v > -5, 2, '비슷한 속도'], [(v) => v > -25, 1, '성장 둔화'], [() => true, 0, '크게 둔화']], (v) => (v > 0 ? '+' : '') + v.toFixed(1) + '%p'));

    // ── 수익성·재무
    add('quality', check('quality', 'ROE (자기자본이익률)', has(f.roe) ? P(f.roe) : null, 4, [[(v) => v > 20, 4, '매우 높음 (버핏 기준 15% 이상)'], [(v) => v > 15, 3, '높음'], [(v) => v > 8, 2, '보통'], [(v) => v > 0, 1, '낮음'], [() => true, 0, '적자']], (v) => v.toFixed(1) + '%'));
    add('quality', check('quality', 'ROA (총자산이익률)', has(f.roa) ? P(f.roa) : null, 2, [[(v) => v > 8, 2, '높음'], [(v) => v > 3, 1, '보통'], [() => true, 0, '낮음']], (v) => v.toFixed(1) + '%'));
    add('quality', check('quality', '영업이익률', has(f.opMargin) ? P(f.opMargin) : null, 3, [[(v) => v > 25, 3, '경쟁력 높음'], [(v) => v > 12, 2, '양호'], [(v) => v > 5, 1, '얇음'], [() => true, 0, '적자 또는 매우 얇음']], (v) => v.toFixed(1) + '%'));
    add('quality', check('quality', '순이익률', has(f.netMargin) ? P(f.netMargin) : null, 2, [[(v) => v > 15, 2, '높음'], [(v) => v > 5, 1, '보통'], [() => true, 0, '낮음']], (v) => v.toFixed(1) + '%'));
    add('quality', check('quality', '부채비율 (부채총계 ÷ 자본총계)', has(f.de) && !isFin ? f.de : null, 3, [[(v) => v < 80, 3, '튼튼'], [(v) => v < 150, 2, '보통'], [(v) => v < 250, 1, '높음'], [() => true, 0, '매우 높음 — 금리 오를 때 부담']], (v) => v.toFixed(0) + '%'));
    add('quality', check('quality', '유동비율', has(f.current) && !isFin ? f.current : null, 2, [[(v) => v >= 1.5, 2, '단기 지급 능력 충분'], [(v) => v >= 1, 1, '보통'], [() => true, 0, '부족']], (v) => v.toFixed(2) + '배'));
    add('quality', check('quality', '잉여현금흐름', has(f.fcf) ? f.fcf : null, 2, [[(v) => v > 0, 2, '현금을 벌고 있음'], [() => true, 0, '현금이 빠져나감']], (v) => (v > 0 ? '플러스' : '마이너스')));
    add('quality', check('quality', '순현금 (현금 > 부채)', has(f.cash) && has(f.debt) ? f.cash - f.debt : null, 2, [[(v) => v > 0, 2, '빚보다 현금이 많음'], [() => true, 0, '빚이 현금보다 많음']], (v) => (v > 0 ? '순현금' : '순부채')));

    // ── 모멘텀 (미너비니 + RS + RSI·MACD)
    let mv = null;
    if (k) {
      mv = minervini(k.c, ctx.rs);
      mv.items.forEach(([label, ok]) => add('momentum', { label: '트렌드 템플릿: ' + label, pts: ok == null ? null : ok ? 1 : 0, max: 1, note: ok == null ? '데이터 부족' : ok ? '통과' : '미통과' }));
      add('momentum', check('momentum', '상대강도 RS (전체 종목 중 순위)', ctx.rs, 4, [[(v) => v >= 90, 4, '상위 10% 주도주'], [(v) => v >= 80, 3, '강함 (CAN SLIM 기준 통과)'], [(v) => v >= 70, 2, '양호'], [(v) => v >= 50, 1, '보통'], [() => true, 0, '시장보다 약함']], (v) => v + '점'));
      const r = rsi(k.c, 14);
      add('momentum', check('momentum', 'RSI(14)', r, 2, [[(v) => v >= 50 && v <= 70, 2, '건강한 상승 탄력'], [(v) => v > 70, 1, '과열'], [(v) => v >= 40, 1, '중립'], [() => true, 0, '약세']], (v) => v.toFixed(0)));
      const e12 = (() => { const a = 2 / 13, b = 2 / 27, s9 = 2 / 10; let x = k.c[0], y = k.c[0], m = 0, sg = 0; k.c.forEach((p, i) => { x = p * a + x * (1 - a); y = p * b + y * (1 - b); m = x - y; sg = i ? m * s9 + sg * (1 - s9) : m; }); return m - sg; })();
      add('momentum', check('momentum', 'MACD 위치', e12, 2, [[(v) => v > 0, 2, '시그널 위 — 상승 탄력'], [() => true, 0, '시그널 아래 — 하락 탄력']], (v) => (v > 0 ? '위' : '아래')));
      const r3 = ret(k.c, 63), b3 = ctx.bench && ctx.bench.length > 63 ? ret(ctx.bench, 63) : null;
      add('momentum', check('momentum', '3개월 시장 대비 수익률', r3 != null && b3 != null ? r3 - b3 : null, 3, [[(v) => v > 10, 3, '시장보다 훨씬 강함'], [(v) => v > 0, 2, '시장보다 강함'], [(v) => v > -10, 1, '시장보다 약함'], [() => true, 0, '크게 뒤처짐']], (v) => (v > 0 ? '+' : '') + v.toFixed(1) + '%p'));
    } else add('momentum', { label: '가격 기록', pts: null, max: 0, note: '시장 데이터를 받으면 계산' });

    // ── 환경·위험
    const beta = has(f.beta) ? f.beta : betaOf(k && k.c, ctx.bench);
    add('risk', check('risk', '베타 (시장 대비 흔들림, 최근 1년 주가로 계산)', beta, 3, [[(v) => v < 0.8, 3, '시장보다 덜 흔들림'], [(v) => v < 1.2, 2, '시장과 비슷'], [(v) => v < 1.6, 1, '시장보다 많이 흔들림'], [() => true, 0, '매우 크게 흔들림']], (v) => v.toFixed(2)));
    if (k) riskChecks(k, true).forEach((c) => add('risk', c));
    const mc = macroChecks(ctx.markets, ctx.rates), msum = mc.reduce((t, c) => t + (c.pts || 0), 0), mmax = mc.reduce((t, c) => t + (c.pts == null ? 0 : c.max), 0);
    add('risk', { label: '매크로 환경 (금리·달러·유가·불안 6개 조건)', pts: Math.round(msum / (mmax || 1) * 3), max: 3, note: msum + '/' + mmax + '점 — ' + (msum / (mmax || 1) >= 0.6 ? '우호적' : msum / (mmax || 1) >= 0.35 ? '중립' : '역풍') });
    sectorChecks(ctx).filter((c) => c.pts != null).forEach((c) => add('risk', { ...c, max: c.max }));
    eventChecks(ctx.events, ctx.now).slice(0, 1).forEach((c) => add('risk', c));

    // 축 점수
    const axes = Object.keys(SCREEN_WEIGHTS).map((key) => {
      const cs = groups[key], used = cs.filter((c) => c.pts != null && c.max > 0), max = used.reduce((t, c) => t + c.max, 0), pts = used.reduce((t, c) => t + c.pts, 0);
      const enough = key === 'value' || key === 'growth' || key === 'quality' ? used.length >= 2 : used.length >= 1;
      return { key, name: SCREEN_NAME[key], weight: SCREEN_WEIGHTS[key], score: enough && max ? Math.max(1, Math.round(pts / max * 100)) : null, pts, max, checks: cs, used: used.length };
    });
    const live = axes.filter((a) => a.score != null), wsum = live.reduce((t, a) => t + a.weight, 0);
    const total = wsum ? Math.max(1, Math.round(live.reduce((t, a) => t + a.score * a.weight, 0) / wsum)) : null;
    const grade = total == null ? '계산 불가' : total >= 80 ? '매우 우수' : total >= 65 ? '우수' : total >= 50 ? '보통' : total >= 35 ? '미흡' : '취약';

    // 유명 스크리너 체크리스트
    const yes = (b) => (b == null ? null : !!b);
    const p = k ? last(k.c) : null;
    const nearHi = mv && mv.hi ? p >= mv.hi * 0.85 : null;
    const volUp = k && k.v && k.v.length > 50 ? avg(k.v.slice(-10)) > avg(k.v.slice(-50)) * 1.1 : null;
    const mkt = ctx.bench && ctx.bench.length > 200 ? last(ctx.bench) > sma(ctx.bench, 50) && sma(ctx.bench, 50) > sma(ctx.bench, 200) : null;
    const screens = [
      { id: 'minervini', name: '미너비니 트렌드 템플릿', who: '마크 미너비니 · 상승 2단계 종목 고르기', items: mv ? mv.items : [], pass: mv ? mv.pass : 0, total: mv ? mv.total : 0, rule: '8개 모두 통과해야 매수 후보' },
      { id: 'canslim', name: 'CAN SLIM', who: '윌리엄 오닐(IBD) · 성장주 발굴', items: [
        ['C 최근 분기 이익 +25% 이상', has(f.qEpsGrowth) ? f.qEpsGrowth >= 0.25 : null], ['A 연간 이익 +25% 이상', has(f.epsGrowth) ? f.epsGrowth >= 0.25 : null],
        ['N 52주 신고가 근처(15% 이내)', yes(nearHi)], ['S 최근 거래량 증가', yes(volUp)], ['L 상대강도 80 이상(주도주)', ctx.rs == null ? null : ctx.rs >= 80],
        ['M 시장 지수 상승 추세', yes(mkt)] ], rule: '많이 통과할수록 성장주 후보 (I 기관 매수는 공식 무료 출처가 없어 제외)' },
      { id: 'graham', name: '그레이엄 가치 기준', who: '벤저민 그레이엄 · 안전마진', items: [
        ['PER 15배 이하', has(f.pe) ? f.pe > 0 && f.pe <= 15 : null], ['PBR 1.5배 이하', has(f.pb) ? f.pb <= 1.5 : null], ['PER × PBR 22.5 이하', has(f.pe) && has(f.pb) ? f.pe > 0 && f.pe * f.pb <= 22.5 : null],
        ['유동비율 1.5배 이상', has(f.current) ? f.current >= 1.5 : null], ['배당 지급', has(f.divYield) ? f.divYield > 0 : null] ], rule: '전통적 가치주 기준 (성장주는 대부분 미통과가 정상)' },
      { id: 'buffett', name: '버핏식 퀄리티', who: '워런 버핏 · 좋은 기업을 적정 가격에', items: [
        ['ROE 15% 이상', has(f.roe) ? f.roe >= 0.15 : null], ['영업이익률 15% 이상', has(f.opMargin) ? f.opMargin >= 0.15 : null], ['부채비율 100% 이하', has(f.de) && !isFin ? f.de <= 100 : null],
        ['잉여현금흐름 플러스', has(f.fcf) ? f.fcf > 0 : null], ['PER 업종 기준 1.5배 이하', has(f.pe) ? f.pe > 0 && f.pe <= norm * 1.5 : null] ], rule: '꾸준히 돈을 잘 버는 회사인지' }
    ].map((sc) => { const known = sc.items.filter((x) => x[1] != null); return { ...sc, pass: known.filter((x) => x[1]).length, total: known.length }; });
    const analyst = null; // 애널리스트 컨센서스: 공식 무료 출처가 없어 제외

    // 강점·약점 문장
    const all = axes.reduce((t, a) => t.concat(a.checks), []).filter((c) => c.pts != null && c.max > 1);
    const strengths = all.filter((c) => c.pts === c.max).sort((a, b) => b.max - a.max).slice(0, 4).map((c) => c.label.replace('트렌드 템플릿: ', '') + ' — ' + c.note.split(' · ').pop());
    const weaknesses = all.filter((c) => c.pts === 0).sort((a, b) => b.max - a.max).slice(0, 4).map((c) => c.label.replace('트렌드 템플릿: ', '') + ' — ' + c.note.split(' · ').pop());
    const best = live.slice().sort((a, b) => b.score - a.score)[0], worst = live.slice().sort((a, b) => a.score - b.score)[0];
    const summary = total == null ? '' : `${best ? best.name + '(' + best.score + '점)이 가장 강하고 ' : ''}${worst && worst !== best ? worst.name + '(' + worst.score + '점)이 가장 약합니다. ' : ''}${mv ? '미너비니 템플릿 ' + mv.pass + '/' + mv.total + ' 통과' + (mv.pass === mv.total && mv.total === 8 ? ' — 상승 2단계 조건을 모두 갖춤' : mv.pass >= 6 ? ' — 상승 추세에 근접' : ' — 아직 상승 추세 종목이 아님') + '. ' : ''}${!has(f.pe) && !has(f.roe) ? '재무 데이터가 없어 가치·성장·재무 축은 빠졌습니다.' : ''}`;
    // rankList·actionFor 와 같은 모양으로도 쓰이도록
    return { v: 3, screen: true, fundSrc: f.src ? f.src + (f.period ? ' · ' + f.period : '') : null, groups: axes, axes, score100: total, total, grade, partial: wsum < 100, screens, analyst, strengths, weaknesses, summary, rs: ctx.rs, hasFund: has(f.pe) || has(f.roe) || has(f.revGrowth),
      plus: all.filter((c) => c.pts === c.max).slice(0, 3), minus: all.filter((c) => c.pts === 0).slice(0, 3), checksUsed: all.length, checksAll: axes.reduce((t, a) => t + a.checks.length, 0) };
  }

  // 내 포지션 점검(점수와 별개): 손익률·비중으로 행동 체크리스트
  function positionNotes(pnlPct, weightPct) {
    const out = [];
    if (pnlPct != null) {
      if (pnlPct >= 50) out.push('수익 +50% 이상 — 원금만큼 일부 이익 실현을 검토할 구간');
      else if (pnlPct >= 20) out.push('수익 +20% 이상 — 손절선을 본전 위로 올려 이익을 지키기');
      else if (pnlPct <= -30) out.push('손실 -30% 이하 — 처음 산 이유가 아직 유효한지 다시 점검');
      else if (pnlPct <= -15) out.push('손실 -15% 이하 — 미리 정한 손절 기준에 닿았는지 확인');
    }
    if (weightPct != null) {
      if (weightPct >= 40) out.push('한 종목이 자산의 40% 이상 — 이 종목 하나에 계좌가 좌우됨');
      else if (weightPct >= 25) out.push('비중 25% 이상 — 추가 매수보다 분산을 먼저 고려');
    }
    return out;
  }

  /* ---------- 4-3. 행동 가이드 ----------
   * 진단점수 + 추세 + 과열 + 내 손익 + 비중을 함께 보고 다음 중 하나를 고릅니다.
   *   add 분할 매수 검토 · add-small 소량 분할 매수(역발상) · hold 보유 유지 · trim 분할 매도 검토
   *   reduce 비중 축소 검토 · stop 손절 기준 점검 · cash 현금성 자산 · wait 관망(미보유)
   * 계획 가격은 ATR(하루 평균 흔들림)과 이동평균으로 정합니다.
   */
  const ACTION_LABEL = { add: '분할 매수 검토', 'add-small': '소량 분할 매수', hold: '보유 유지', trim: '분할 매도 검토', reduce: '비중 축소 검토', stop: '손절 기준 점검', cash: '현금성 자산', wait: '관망' };
  const ACTION_TONE = { add: 'pos', 'add-small': 'pos', hold: 'neu', trim: 'neg', reduce: 'neg', stop: 'neg', cash: 'neu', wait: 'neu' };

  function technicals(k) {
    const c = k && k.c;
    if (!c || c.length < 60) return null;
    const p = last(c), m20 = sma(c, 20), m60 = sma(c, 60), m200 = sma(c, 200);
    const atr = k.h && k.l ? atrPct(k, 14) : volAnnual(c, 20) / Math.sqrt(365);
    const sd = stdev(c.slice(-20));
    return { p, m20, m60, m200, rsi: rsi(c, 14), atrPct: atr, gap20: (p / m20 - 1) * 100, upper: m20 + 2 * sd, lower: m20 - 2 * sd,
      trendUp: p > m60 && m20 > m60, longUp: m200 ? p > m200 : null };
  }

  // ctx: { score(scoreCoin2/scoreStock2 결과), candles?, pnlPct?, weightPct?, held(bool), fng? }
  function actionFor(ctx) {
    const sc = ctx.score || {};
    if (sc.stable) return { action: 'cash', label: ACTION_LABEL.cash, tone: 'neu', confidence: '—', reasons: ['달러에 묶인 코인 — 하락장에서 쓸 대기 자금 역할'], plan: [] };
    const s = sc.score100, t = technicals(ctx.candles), pnl = ctx.pnlPct, w = ctx.weightPct, held = ctx.held !== false;
    const R = []; let a;
    const overheat = t && (t.rsi > 70 || t.gap20 > 15), oversold = t && t.rsi < 30;
    const pullback = t && t.trendUp && t.gap20 >= -6 && t.gap20 <= 2;
    if (s == null) return { action: held ? 'hold' : 'wait', label: ACTION_LABEL[held ? 'hold' : 'wait'], tone: 'neu', confidence: '낮음', reasons: ['점수를 계산할 데이터가 부족함'], plan: [] };

    if (held && w != null && w >= 40) { a = 'reduce'; R.push('자산의 ' + w.toFixed(0) + '%가 이 종목 하나 — 한 번 크게 빠지면 계좌 전체가 흔들림'); }
    else if (held && pnl != null && pnl <= -15 && s < 40 && (!t || !t.trendUp)) { a = 'stop'; R.push('손실 ' + pnl.toFixed(1) + '% + 조건 불리(' + s + '점) + 하락 추세'); }
    else if (held && pnl != null && ((pnl >= 20 && overheat) || pnl >= 50)) { a = 'trim'; R.push('수익 +' + pnl.toFixed(1) + '%' + (overheat ? ' + 단기 과열(RSI ' + t.rsi.toFixed(0) + ')' : ' — 큰 수익은 나눠서 지키기')); }
    else if (held && s < 35 && t && !t.trendUp && pnl != null && pnl > 0) { a = 'trim'; R.push('조건 불리(' + s + '점)인데 아직 수익 중 — 일부 이익 확정'); }
    else if (s >= 55 && !overheat && (w == null || w < 25) && (pullback || !t)) { a = 'add'; R.push('조건 유리(' + s + '점)' + (pullback ? ' + 상승 추세 속 눌림(20일 평균 ' + (t.gap20 > 0 ? '+' : '') + t.gap20.toFixed(1) + '%)' : '')); }
    else if (oversold && (ctx.fng == null || ctx.fng <= 30) && (w == null || w < 20) && t.longUp !== false) { a = 'add-small'; R.push('과매도(RSI ' + t.rsi.toFixed(0) + ') + 시장 공포 — 역발상 소량만'); }
    else { a = held ? 'hold' : 'wait'; R.push(s >= 55 ? '조건은 유리하지만 ' + (overheat ? '단기 과열이라 추격 금지' : w >= 25 ? '이미 비중이 큼' : '눌림을 기다리는 중') : s >= 40 ? '조건 중립(' + s + '점) — 새로 움직일 이유 부족' : '조건 불리(' + s + '점) — 추가 매수는 보류'); }

    if (t) {
      if (t.trendUp) R.push('추세: 60일 평균 위 정배열'); else R.push('추세: 60일 평균 아래 또는 역배열');
      R.push('RSI ' + t.rsi.toFixed(0) + (t.rsi > 70 ? ' 과열' : t.rsi < 30 ? ' 과매도' : ' 보통') + ' · 하루 평균 흔들림 ' + t.atrPct.toFixed(1) + '%');
    } else R.push('가격 기록이 없어 추세·과열은 판단하지 않음');
    if (held && pnl != null && a !== 'stop' && a !== 'trim') R.push('내 손익 ' + (pnl > 0 ? '+' : '') + pnl.toFixed(1) + '%' + (w != null ? ' · 비중 ' + w.toFixed(1) + '%' : ''));

    // 분할 계획
    const plan = [];
    if (t) {
      const step = t.p * t.atrPct / 100;
      const stopPx = Math.min(t.m60, t.p - 2.5 * step);
      if (a === 'add' || a === 'add-small') {
        const n = a === 'add' ? '3분의 1' : '5분의 1';
        plan.push({ k: '1차', px: t.p, text: '지금 가격 근처 · 계획 금액의 ' + n });
        plan.push({ k: '2차', px: t.p - step, text: '하루 흔들림 1번만큼 내려오면' });
        plan.push({ k: '3차', px: Math.max(t.p - 2 * step, t.lower), text: '20일 밴드 하단 근처' });
        plan.push({ k: '손절', px: stopPx, text: '여기 아래로 닫히면 계획 취소', stop: true });
      } else if (a === 'trim' || a === 'reduce') {
        plan.push({ k: '1차', px: t.p, text: '지금 · 보유량의 3분의 1' });
        plan.push({ k: '2차', px: Math.max(t.p + step, t.upper), text: '반등해 20일 밴드 상단에 닿으면 3분의 1' });
        plan.push({ k: '나머지', px: t.m20, text: '20일 평균 아래로 닫히면 정리(추적 손절)', stop: true });
      } else if (a === 'stop') {
        plan.push({ k: '기준', px: stopPx, text: '처음 정한 손절선이 없다면 이 가격을 기준으로' });
        plan.push({ k: '반등 시', px: t.m20, text: '20일 평균까지 반등하면 비중 줄이기' });
      } else if (a === 'hold') {
        plan.push({ k: '지킬 선', px: stopPx, text: '여기 아래로 닫히면 비중 축소 검토', stop: true });
        if (t.trendUp) plan.push({ k: '추가 기회', px: t.m20, text: '20일 평균까지 눌리면 분할 매수 후보' });
      }
    }
    const conf = !t ? '낮음' : sc.partial ? '보통' : '높음';
    return { action: a, label: ACTION_LABEL[a], tone: ACTION_TONE[a], confidence: conf, reasons: R, plan };
  }

  /* ---------- 4-4. 투자성향과 자산 진단 ----------
   * 투자성향 5단계(금융투자협회 분류 이름 사용)와 일반적인 비중 가이드. 개인 맞춤 자문이 아닌 출발점입니다.
   * 현금 = 예금·현금·MMF·단기채·스테이블코인 / 주식 = 주식·ETF / 코인 = 스테이블코인을 뺀 암호화폐
   */
  const PROFILES = [
    { id: 'stable', name: '안정형', target: { cash: 70, stock: 30, coin: 0 }, coinMax: 0, volTol: 8, desc: '원금 손실을 거의 원하지 않음' },
    { id: 'stable2', name: '안정추구형', target: { cash: 50, stock: 45, coin: 5 }, coinMax: 5, volTol: 12, desc: '손실은 작게, 예금보다 조금 더' },
    { id: 'neutral', name: '위험중립형', target: { cash: 30, stock: 60, coin: 10 }, coinMax: 10, volTol: 18, desc: '시장 평균 수익과 그만큼의 흔들림을 받아들임' },
    { id: 'active', name: '적극투자형', target: { cash: 20, stock: 65, coin: 15 }, coinMax: 20, volTol: 25, desc: '높은 수익을 위해 큰 흔들림도 견딤' },
    { id: 'aggr', name: '공격투자형', target: { cash: 10, stock: 65, coin: 25 }, coinMax: 30, volTol: 35, desc: '큰 손실 가능성을 알고도 최대 수익을 노림' }
  ];
  const PROFILE_Q = [
    { q: '이 돈을 언제까지 투자할 수 있나요?', a: ['1년 안에 써야 함', '1~3년', '3~5년', '5~10년', '10년 이상'] },
    { q: '1년 동안 투자금이 -20%가 되면?', a: ['전부 판다', '일부 판다', '그냥 기다린다', '조금 더 산다', '많이 더 산다'] },
    { q: '투자 경험은?', a: ['예금·적금만', '펀드·ETF', '주식 1~3년', '주식·코인 3년 이상', '레버리지·선물까지'] },
    { q: '투자와 별도로 비상금이 있나요?', a: ['없다', '생활비 1~2달치', '3~5달치', '6달치 이상', '1년치 이상'] },
    { q: '투자 목표는?', a: ['원금 지키기', '물가보다 조금 더', '시장 평균', '시장보다 높게', '큰 손실을 감수하고 큰 수익'] }
  ];
  function profileFromAnswers(ans) { // ans: 각 질문 0~4
    const sum = ans.reduce((a, b) => a + b + 1, 0);
    const i = sum <= 8 ? 0 : sum <= 12 ? 1 : sum <= 16 ? 2 : sum <= 20 ? 3 : 4;
    return { ...PROFILES[i], points: sum };
  }
  // 시장날씨가 나쁘면(역풍 4개 이상) 현금을 5%p 늘리고 나머지를 비율대로 줄임
  function adjustedTarget(profile, weatherCount) {
    const t = { ...profile.target };
    if (weatherCount >= 4 && t.cash < 90) { const add = 5, rest = t.stock + t.coin; t.cash += add; if (rest) { t.stock = Math.round((t.stock - add * t.stock / rest) * 10) / 10; t.coin = Math.round((100 - t.cash - t.stock) * 10) / 10; } }
    return t;
  }

  // 자산 진단. input: { rows: [{ name, type('coin'|'stock'), stable, value, cost, pnlPct, sector, score100, volAnn }], cash, profile, weatherCount, rateSensitive: [업종 id] }
  function reviewPortfolio(input) {
    const P = input.profile, target = adjustedTarget(P, input.weatherCount || 0);
    const rows = input.rows.filter((r) => r.value > 0);
    const stableV = rows.filter((r) => r.stable).reduce((t, r) => t + r.value, 0);
    const coinV = rows.filter((r) => r.type === 'coin' && !r.stable).reduce((t, r) => t + r.value, 0);
    const stockV = rows.filter((r) => r.type === 'stock').reduce((t, r) => t + r.value, 0);
    const cashV = (input.cash || 0) + stableV, total = cashV + coinV + stockV;
    if (!total) return null;
    const actual = { cash: cashV / total * 100, stock: stockV / total * 100, coin: coinV / total * 100 };
    const risky = rows.filter((r) => !r.stable);
    const cats = [], issues = [], won = (v) => Math.round(v / 10000).toLocaleString('ko-KR') + '만 원';
    const pctS = (v) => v.toFixed(1) + '%';

    // A. 배분 적합도 (25)
    const dev = (Math.abs(actual.cash - target.cash) + Math.abs(actual.stock - target.stock) + Math.abs(actual.coin - target.coin)) / 2;
    const A = { key: 'alloc', name: '자산 배분', max: 25, score: Math.round(25 * Math.max(0, 1 - dev / 40)), notes: [] };
    A.notes.push(P.name + ' 목표 현금 ' + target.cash + ' · 주식 ' + target.stock + ' · 코인 ' + target.coin + '% / 지금 ' + pctS(actual.cash) + ' · ' + pctS(actual.stock) + ' · ' + pctS(actual.coin));
    if (dev >= 20) A.verdict = '목표와 크게 어긋남 — 지금 자산은 ' + P.name + '이 아니라 다른 성향의 배분입니다';
    else if (dev >= 10) A.verdict = '목표에서 꽤 벗어남 — 조정이 필요합니다';
    else A.verdict = '목표 비중에 가까움';
    if (actual.coin > P.coinMax + 5) issues.push({ w: 3, text: '코인 비중 ' + pctS(actual.coin) + '는 ' + P.name + ' 한도(' + P.coinMax + '%)를 넘습니다. 코인이 반토막 나면 전체 자산이 ' + pctS(actual.coin / 2) + ' 줄어드는 구조입니다.' });
    if (actual.cash < target.cash - 10) issues.push({ w: 2, text: '현금이 목표보다 ' + pctS(target.cash - actual.cash) + 'p 적습니다. 급락이 와도 살 돈이 없고, 급한 돈이 필요하면 손해를 보고 팔아야 합니다.' });
    if (actual.cash > target.cash + 20) issues.push({ w: 1, text: '현금이 목표보다 ' + pctS(actual.cash - target.cash) + 'p 많습니다. 안전하지만 물가만큼 돈의 가치가 줄어듭니다.' });
    cats.push(A);

    // B. 분산 (20)
    const B = { key: 'div', name: '분산', max: 20, score: 20, notes: [] };
    const riskyV = coinV + stockV, sorted = risky.slice().sort((a, b) => b.value - a.value);
    const top = sorted[0], topW = top ? top.value / total * 100 : 0;
    const hhi = riskyV ? risky.reduce((t, r) => t + Math.pow(r.value / riskyV, 2), 0) : 1, effN = 1 / hhi;
    if (topW > 40) { B.score -= 10; issues.push({ w: 3, text: top.name + ' 한 종목이 전체 자산의 ' + pctS(topW) + '. 이건 분산된 포트폴리오가 아니라 ' + top.name + ' 한 곳에 거는 베팅입니다.' }); }
    else if (topW > 25) { B.score -= 5; issues.push({ w: 2, text: top.name + ' 비중 ' + pctS(topW) + ' — 한 종목이 25%를 넘으면 그 종목 하나가 계좌를 좌우합니다.' }); }
    if (effN < 3) B.score -= 6; else if (effN < 5) B.score -= 3;
    B.notes.push('가장 큰 종목 ' + (top ? top.name + ' ' + pctS(topW) : '없음') + ' · 실질 종목 수 ' + effN.toFixed(1) + '개 (비중을 고려한 분산 정도)');
    const secMap = {}; rows.filter((r) => r.type === 'stock').forEach((r) => { const k = r.sector || '미지정'; secMap[k] = (secMap[k] || 0) + r.value; });
    const topSec = Object.entries(secMap).sort((a, b) => b[1] - a[1])[0];
    if (topSec && stockV && topSec[1] / stockV > 0.6 && Object.keys(secMap).length > 0) { B.score -= 3; B.notes.push('주식의 ' + pctS(topSec[1] / stockV * 100) + '가 한 업종(' + (input.sectorName ? input.sectorName(topSec[0]) : topSec[0]) + ')에 몰려 있음'); }
    const altV = rows.filter((r) => r.type === 'coin' && !r.stable && !['BTC', 'ETH'].includes(r.sym)).reduce((t, r) => t + r.value, 0);
    if (coinV && altV / coinV > 0.5) { B.score -= 3; B.notes.push('코인의 ' + pctS(altV / coinV * 100) + '가 비트코인·이더리움이 아닌 알트코인 — 하락장에서 더 크게 빠지는 쪽'); }
    B.score = Math.max(0, B.score);
    B.verdict = B.score >= 16 ? '잘 나뉘어 있음' : B.score >= 10 ? '쏠림이 있음' : '심하게 쏠려 있음';
    cats.push(B);

    // C. 위험 수준 (20): 종목 변동성과 종류별 상관(코인끼리 0.8, 주식끼리 0.5, 코인-주식 0.3)
    const C = { key: 'risk', name: '위험 수준', max: 20, score: 20, notes: [] };
    let varP = 0;
    risky.forEach((a) => risky.forEach((b) => {
      const vf = (r) => Math.max(r.volAnn || (r.type === 'coin' ? 70 : 30), r.type === 'coin' ? 30 : 12) / 100; // 짧은 잔잔한 구간에 속지 않도록 하한
      const wa = a.value / total, wb = b.value / total, sa = vf(a), sb = vf(b);
      const rho = a === b ? 1 : a.type === b.type ? (a.type === 'coin' ? 0.8 : 0.5) : 0.3;
      varP += wa * wb * sa * sb * rho;
    }));
    const volP = Math.sqrt(varP) * 100, worst = Math.max(-95, (Math.exp(-1.645 * volP / 100) - 1) * 100);
    C.score = volP <= P.volTol ? 20 : Math.max(0, Math.round(20 * (1 - (volP - P.volTol) / P.volTol)));
    C.notes.push('예상 연간 변동성 ' + volP.toFixed(0) + '% (' + P.name + ' 권장 ' + P.volTol + '% 이하)');
    C.notes.push('나쁜 해(20년에 한 번 꼴)에는 1년 새 약 ' + worst.toFixed(0) + '% (' + won(total * worst / 100) + ')까지 빠질 수 있는 구조');
    if (volP > P.volTol * 1.5) issues.push({ w: 3, text: '포트폴리오 흔들림(연 ' + volP.toFixed(0) + '%)이 ' + P.name + ' 권장치의 ' + (volP / P.volTol).toFixed(1) + '배입니다. 나쁜 해에는 ' + won(-total * worst / 100) + ' 가량 줄어들 수 있다는 뜻입니다. 그 손실을 실제로 견딜 수 있는지 스스로 물어보세요.' });
    const rs = rows.filter((r) => (r.type === 'coin' && !r.stable) || (input.rateSensitive || []).includes(r.sector)).reduce((t, r) => t + r.value, 0) / total * 100;
    if ((input.weatherCount || 0) >= 4 && rs > 50) C.notes.push('지금처럼 금리·달러 역풍이 센 시기에 금리 민감 자산이 ' + pctS(rs) + ' — 긴축이 길어지면 가장 먼저 흔들리는 구성');
    C.verdict = C.score >= 16 ? '성향에 맞는 흔들림' : C.score >= 8 ? '성향보다 위험함' : '성향에 비해 매우 위험함';
    C.vol = volP; C.worst = worst;
    cats.push(C);

    // D. 손익 관리 (15)
    const D = { key: 'pnl', name: '손익 관리', max: 15, score: 15, notes: [] };
    const deep = risky.filter((r) => r.pnlPct != null && r.pnlPct <= -30), loss15 = risky.filter((r) => r.pnlPct != null && r.pnlPct <= -15);
    const loss15W = loss15.reduce((t, r) => t + r.value, 0) / total * 100;
    const bigWin = risky.filter((r) => r.pnlPct != null && r.pnlPct >= 50), bigWinW = bigWin.reduce((t, r) => t + r.value, 0) / total * 100;
    D.score -= Math.min(2, deep.length) * 4; if (loss15W > 20) D.score -= 4; if (bigWinW > 20) D.score -= 3;
    D.score = Math.max(0, D.score);
    if (deep.length) issues.push({ w: 2, text: '손실 -30% 이하 종목 ' + deep.length + '개(' + deep.map((r) => r.name).join(', ') + '). "언젠가 오르겠지"는 전략이 아닙니다. 처음 산 이유가 아직 맞는지, 지금 돈이 있다면 이 가격에 새로 살 종목인지 점검하세요.' });
    if (bigWinW > 20) issues.push({ w: 1, text: '수익 +50% 넘는 종목이 자산의 ' + pctS(bigWinW) + '. 수익은 팔기 전까지 숫자일 뿐입니다. 일부라도 이익을 확정할지 계획을 세우세요.' });
    D.notes.push('손실 -15% 이하 ' + loss15.length + '종목(자산의 ' + pctS(loss15W) + ') · -30% 이하 ' + deep.length + '종목 · +50% 이상 ' + bigWin.length + '종목');
    D.verdict = D.score >= 12 ? '관리되고 있음' : D.score >= 7 ? '방치된 손실·수익이 있음' : '손실 관리가 안 되고 있음';
    cats.push(D);

    // E. 보유 종목의 조건 (20): 진단점수 가중 평균
    const E = { key: 'quality', name: '보유 종목 조건', max: 20, score: 10, notes: [] };
    const scored = risky.filter((r) => r.score100 != null), sv = scored.reduce((t, r) => t + r.value, 0);
    if (sv) {
      const avg = scored.reduce((t, r) => t + r.score100 * r.value, 0) / sv;
      E.score = Math.round(Math.max(0, Math.min(20, (avg - 35) / 35 * 20)));
      const bad = scored.filter((r) => r.score100 < 35), badW = bad.reduce((t, r) => t + r.value, 0) / total * 100;
      E.notes.push('진단점수 가중 평균 ' + avg.toFixed(0) + '점 · "조건 불리"(35점 미만) 종목이 자산의 ' + pctS(badW));
      if (badW > 25) issues.push({ w: 2, text: '자산의 ' + pctS(badW) + '가 지금 조건이 불리한 종목입니다(' + bad.map((r) => r.name).slice(0, 4).join(', ') + '). 추가 매수는 멈추고 각 종목의 근거를 다시 보세요.' });
      E.verdict = avg >= 60 ? '대체로 유리한 조건의 종목' : avg >= 45 ? '조건이 엇갈림' : '조건이 불리한 종목이 많음';
    } else { E.notes.push('점수를 계산할 데이터가 아직 없음'); E.verdict = '계산 대기'; }
    cats.push(E);

    const score = cats.reduce((t, c) => t + c.score, 0);
    const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F';
    const headline = { A: '성향에 맞게 잘 짜인 자산입니다.', B: '대체로 괜찮지만 고칠 곳이 있습니다.', C: '구조적인 약점이 분명합니다. 지금 손보는 게 좋습니다.', D: '위험 관리가 안 되는 상태입니다. 시장이 나빠지면 크게 다칩니다.', F: '투자라기보다 운에 맡긴 상태에 가깝습니다. 비중부터 다시 짜야 합니다.' }[grade];
    // 리밸런싱 금액
    const moves = ['cash', 'stock', 'coin'].map((k) => ({ k, name: { cash: '현금', stock: '주식', coin: '코인' }[k], diffPct: target[k] - actual[k], amount: (target[k] - actual[k]) / 100 * total }));
    issues.sort((a, b) => b.w - a.w);
    return { profile: P, target, actual, total, cats, score, grade, headline, issues, moves, vol: volP, worst, effN, topW };
  }

  /* ---------- 5. 포지션 크기 계산 ---------- */
  function positionSize(account, entry, stop, riskPct) {
    if (!(account > 0) || !(entry > 0) || !(stop > 0) || stop >= entry) return null;
    const loss = account * riskPct / 100;
    const drop = (entry - stop) / entry;
    const amount = Math.min(account, loss / drop);
    return { maxLoss: amount * drop, amount, drop: drop * 100 };
  }

  const Rules = { screenStock, rsRatings, minervini, SECTOR_PE, SCREEN_NAME, PROFILES, PROFILE_Q, profileFromAnswers, adjustedTarget, reviewPortfolio, scoreAsset2, rankList, actionFor, ACTION_LABEL, technicals, scoreCoin2, scoreStock2, positionNotes, SECTOR_TRAITS, STABLE, COIN_WEIGHTS, STOCK_WEIGHTS, rsi, volAnnual, WEATHER_LIMITS, marketWeather, sectorQuads, perfTable, scoreCoin, scoreStock, scoreMacro, scoreTrend, scoreSentiment, scoreFlow, scoreEvent, scoreSector, nextEvent, daysUntil, positionSize };
  if (typeof module !== 'undefined' && module.exports) module.exports = Rules;
  else root.Rules = Rules;
})(typeof window !== 'undefined' ? window : globalThis);
