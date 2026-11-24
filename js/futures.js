/* 시장날씨 · 코인 선물 모의투자 엔진 (FLUX)
 * ------------------------------------------------------------------
 * 무기한 선물(USDT-M) 규칙을 그대로 흉내 낸 가상 계좌:
 *  - 롱/숏, 격리 마진, 레버리지 설정, 청산가 계산(유지증거금 포함)
 *  - 펀딩비: 8시간마다(00·08·16 UTC). 롱이 내고 숏이 받음(음수면 반대)
 *  - 수수료: 테이커 0.05% + 슬리피지(진입 0.02%, 손절 0.05%)
 *  - 체결: 신호는 봉 마감에 판단 → 다음 봉 시가 체결 (미래 데이터 사용 금지)
 *  - 손절: 봉 안에서 고가/저가로 확인. 시가가 손절을 건너뛰면 시가 체결(갭)
 * 전략: 시계열 추세추종 (돌파 + 이동평균 정배열 + BTC 장세 필터)
 *  - 진입: 최근 N봉 고점 돌파(롱) / 저점 이탈(숏), 50·200 EMA 같은 방향
 *  - 숏은 BTC가 장기 평균 아래(하락장)일 때만
 *  - 손절 2.5 ATR, 수익 나면 3 ATR 추적 손절(샹들리에), 추세 꺾이면 청산
 *  - 크기: 한 번에 계좌의 R%만 잃도록 (손절 거리로 역산) → 레버리지는 결과
 * 리스크(금고 F):
 *  - 전체 레버리지 3배, 코인 하나 1.5배 상한 · 동시 포지션 3개
 *  - 손절 거리는 청산 거리의 절반 이내여야 진입 (손절이 항상 청산보다 먼저)
 *  - 하루 −3% → 그날 신규 진입 금지 · 고점 대비 −15% → 위험 절반
 *  - 고점 대비 −25% → 전부 청산 후 30일 휴식(킬 스위치), 재개 시 절반 크기
 */
(function (root) {
  'use strict';
  const PRESETS = {
    h4: { name: '4시간봉', barH: 4, brk: 40, emaF: 50, emaS: 200, regime: 1200, atrN: 14, stopAtr: 2.5, trailAtr: 3, killBars: 180, dayBars: 6 },
    d1: { name: '일봉', barH: 24, brk: 20, emaF: 20, emaS: 100, regime: 200, atrN: 14, stopAtr: 2.5, trailAtr: 3, killBars: 30, dayBars: 1 }
  };
  const BASE = {
    riskPct: 1.5, maxLevTotal: 3, maxLevCoin: 1.5, maxPos: 3, isoLev: 5, mm: 0.005,
    taker: 0.0005, slipIn: 0.0002, slipStop: 0.0005,
    fundBase: 0.0001, fundHot: 0.0003, atrMaxPct: 8,
    dayLoss: -3, ddHalve: -15, ddResume: -8, ddKill: -25, startCash: 100000000
  };
  const COINS = [
    { sym: 'BTC', name: '비트코인', y: 'BTC-USD' }, { sym: 'ETH', name: '이더리움', y: 'ETH-USD' }, { sym: 'SOL', name: '솔라나', y: 'SOL-USD' },
    { sym: 'XRP', name: '엑스알피', y: 'XRP-USD' }, { sym: 'DOGE', name: '도지코인', y: 'DOGE-USD' }
  ];
  const round = (x, n) => { const p = Math.pow(10, n == null ? 2 : n); return Math.round(x * p) / p; };

  /* ---------- 지표 ---------- */
  function ema(a, n) { const k = 2 / (n + 1), out = new Array(a.length).fill(null); let e = null, s = 0; for (let i = 0; i < a.length; i++) { if (i < n) { s += a[i]; if (i === n - 1) { e = s / n; out[i] = e; } continue; } e = a[i] * k + e * (1 - k); out[i] = e; } return out; }
  function atr(h, l, c, n) { const out = new Array(c.length).fill(null); let a = null; for (let i = 1; i < c.length; i++) { const tr = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])); if (i < n) { a = (a || 0) + tr; if (i === n - 1) { a /= n - 1; out[i] = a; } continue; } a = (a * (n - 1) + tr) / n; out[i] = a; } return out; }
  function hiPrev(h, n) { const out = new Array(h.length).fill(null); for (let i = n; i < h.length; i++) { let m = -Infinity; for (let j = i - n; j < i; j++) if (h[j] > m) m = h[j]; out[i] = m; } return out; }
  function loPrev(l, n) { const out = new Array(l.length).fill(null); for (let i = n; i < l.length; i++) { let m = Infinity; for (let j = i - n; j < i; j++) if (l[j] < m) m = l[j]; out[i] = m; } return out; }

  /* ---------- 데이터: 코인별 봉 → 공통 시간축 ---------- */
  // series: { BTC: { t:[ms], o,h,l,c }, ... }  (t = 봉 시작 시각, UTC ms)
  function prepare(series, P) {
    const syms = Object.keys(series).filter((s) => series[s] && series[s].c && series[s].c.length > P.emaS + 5);
    if (!series.BTC) throw new Error('BTC 시세가 없습니다');
    const T = series.BTC.t.slice();
    const X = {};
    syms.forEach((s) => {
      const d = series[s], idx = {}; d.t.forEach((t, i) => { idx[t] = i; });
      const map = T.map((t) => (idx[t] == null ? -1 : idx[t]));
      X[s] = { d, map, eF: ema(d.c, P.emaF), eS: ema(d.c, P.emaS), atr: atr(d.h, d.l, d.c, P.atrN), hi: hiPrev(d.h, P.brk), lo: loPrev(d.l, P.brk) };
    });
    const btc = X.BTC;
    btc.reg = ema(series.BTC.c, P.regime);
    return { T, X, syms };
  }

  /* ---------- 계좌 ---------- */
  function newAccount(cfg) {
    return { cash: cfg.startCash, start: cfg.startCash, peak: cfg.startCash, pos: {}, pending: [], trades: [], equity: [], events: [],
      dayKey: null, dayStart: cfg.startCash, dayBlock: false, half: false, killUntil: -1, killed: 0, liquidations: 0, fundingPaid: 0, feesPaid: 0, lastT: null };
  }
  const liqPrice = (side, entry, cfg) => (side === 'long' ? entry * (1 - 1 / cfg.isoLev + cfg.mm) : entry * (1 + 1 / cfg.isoLev - cfg.mm));
  function markEquity(acc, px) { let u = 0; Object.values(acc.pos).forEach((p) => { const m = px(p.sym); if (m != null) u += (p.side === 'long' ? 1 : -1) * (m - p.entry) * p.qty; }); return acc.cash + u; }
  function closePos(acc, p, price, t, reason, cfg, ev) {
    const gross = (p.side === 'long' ? 1 : -1) * (price - p.entry) * p.qty;
    const fee = price * p.qty * cfg.taker;
    const pnl = reason === '청산(강제)' ? -p.margin : gross - fee; // 격리 마진: 강제 청산이면 증거금 전부 잃음
    acc.cash += pnl; acc.feesPaid += fee;
    const total = pnl - p.entryFee + p.funding; // 진입 수수료·펀딩 포함 총손익
    const tr = { sym: p.sym, name: p.name, side: p.side, in: iso(p.t), out: iso(t), entry: round(p.entry, 6), exit: round(price, 6), qty: p.qty, lev: round(p.notional0 / p.eq0, 2),
      pnl: Math.round(total), pct: round(total / p.eq0 * 100, 2), R: round(total / p.riskAmt, 2), days: round((t - p.t) / 864e5, 1), funding: Math.round(p.funding), reason };
    acc.trades.push(tr); delete acc.pos[p.sym];
    if (ev) acc.events.push({ t: iso(t), kind: 'close', sym: p.sym, name: p.name, side: p.side, price: tr.exit, pnl: tr.pnl, R: tr.R, reason });
    return tr;
  }
  const iso = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');

  /* ---------- 시뮬레이션: 봉 i0..i1 ---------- */
  function simulate(W, P, cfg, acc, i0, i1, opts) {
    opts = opts || {};
    const { T, X } = W, ev = !!opts.collect;
    const px = (s, i, k) => { const x = X[s]; if (!x) return null; const j = x.map[i]; return j < 0 ? null : x.d[k || 'c'][j]; };
    for (let i = Math.max(i0, P.regime + 2); i <= i1; i++) {
      const t = T[i], hour = new Date(t).getUTCHours(), dk = new Date(t).toISOString().slice(0, 10);
      // 하루 시작
      if (acc.dayKey !== dk) { acc.dayKey = dk; acc.dayStart = markEquity(acc, (s) => px(s, i - 1)); acc.dayBlock = false; }
      // 1) 시가: 대기 주문 처리
      const pend = acc.pending; acc.pending = [];
      pend.forEach((o) => {
        const op = px(o.sym, i, 'o'); if (op == null) return;
        if (o.kind === 'exit') { const p = acc.pos[o.sym]; if (p) closePos(acc, p, op * (p.side === 'long' ? 1 - cfg.slipIn : 1 + cfg.slipIn), t, o.reason, cfg, ev); return; }
        if (acc.pos[o.sym] || acc.dayBlock || i < acc.killUntil) return;
        const entry = op * (o.side === 'long' ? 1 + cfg.slipIn : 1 - cfg.slipIn);
        const eq = markEquity(acc, (s) => px(s, i, 'o'));
        const stopDist = o.atr * P.stopAtr, liqDist = entry - liqPrice('long', entry, cfg);
        if (stopDist > liqDist * 0.5) return; // 손절이 청산보다 확실히 먼저 오도록
        const riskMult = acc.half ? 0.5 : 1;
        const riskAmt = eq * cfg.riskPct / 100 * riskMult;
        let qty = riskAmt / stopDist;
        const used = Object.values(acc.pos).reduce((a, p) => a + p.qty * (px(p.sym, i, 'o') || p.entry), 0);
        const capCoin = eq * cfg.maxLevCoin, capAll = Math.max(0, eq * cfg.maxLevTotal - used);
        qty = Math.min(qty, capCoin / entry, capAll / entry);
        if (qty * entry < eq * 0.02) return; // 너무 작으면 생략
        const notional = qty * entry, fee = notional * cfg.taker;
        acc.cash -= fee; acc.feesPaid += fee;
        const stop = o.side === 'long' ? entry - stopDist : entry + stopDist;
        acc.pos[o.sym] = { sym: o.sym, name: o.name, side: o.side, entry, qty, t, stop, stop0: stop, liq: liqPrice(o.side, entry, cfg), margin: notional / cfg.isoLev,
          ext: o.side === 'long' ? op : op, riskAmt: qty * stopDist, eq0: eq, notional0: notional, entryFee: fee, funding: 0, why: o.why };
        if (ev) acc.events.push({ t: iso(t), kind: 'open', sym: o.sym, name: o.name, side: o.side, price: round(entry, 6), lev: round(notional / eq, 2), stop: round(stop, 6), liq: round(acc.pos[o.sym].liq, 6), why: o.why });
      });
      // 2) 봉 안: 청산·손절
      Object.values(acc.pos).forEach((p) => {
        const o = px(p.sym, i, 'o'), h = px(p.sym, i, 'h'), l = px(p.sym, i, 'l'); if (o == null) return;
        if (p.side === 'long') {
          if (o <= p.liq) { acc.liquidations++; closePos(acc, p, p.liq, t, '청산(강제)', cfg, ev); return; }
          if (o <= p.stop) { closePos(acc, p, o * (1 - cfg.slipStop), t, '손절(갭)', cfg, ev); return; }
          if (l <= p.stop) { closePos(acc, p, p.stop * (1 - cfg.slipStop), t, p.stop > p.stop0 + 1e-12 ? '추적 손절' : '손절', cfg, ev); return; }
        } else {
          if (o >= p.liq) { acc.liquidations++; closePos(acc, p, p.liq, t, '청산(강제)', cfg, ev); return; }
          if (o >= p.stop) { closePos(acc, p, o * (1 + cfg.slipStop), t, '손절(갭)', cfg, ev); return; }
          if (h >= p.stop) { closePos(acc, p, p.stop * (1 + cfg.slipStop), t, p.stop < p.stop0 - 1e-12 ? '추적 손절' : '손절', cfg, ev); return; }
        }
      });
      // 3) 펀딩: 8시간마다 (일봉은 하루 3번 몰아서)
      const fundTimes = P.barH >= 24 ? 3 : [0, 8, 16].filter((x) => x >= hour && x < hour + P.barH).length;
      if (fundTimes) {
        const bc = px('BTC', i - 1), br = X.BTC.reg[X.BTC.map[i - 1]];
        const rate = br == null ? cfg.fundBase : bc > br * 1.1 ? cfg.fundHot : bc < br * 0.9 ? -cfg.fundBase : cfg.fundBase;
        Object.values(acc.pos).forEach((p) => { const m = px(p.sym, i, 'o') || p.entry; const f = m * p.qty * rate * fundTimes * (p.side === 'long' ? -1 : 1); acc.cash += f; p.funding += f; acc.fundingPaid -= f; });
      }
      // 4) 종가: 평가·리스크 상태·추적 손절·신호
      const eq = markEquity(acc, (s) => px(s, i));
      acc.peak = Math.max(acc.peak, eq);
      const dd = (eq / acc.peak - 1) * 100;
      if (!acc.dayBlock && (eq / acc.dayStart - 1) * 100 <= cfg.dayLoss) { acc.dayBlock = true; if (ev) acc.events.push({ t: iso(t), kind: 'vault', msg: '하루 손실 ' + cfg.dayLoss + '% 도달 — 오늘 신규 진입 금지' }); }
      if (dd <= cfg.ddKill && i >= acc.killUntil) {
        Object.values(acc.pos).forEach((p) => acc.pending.push({ kind: 'exit', sym: p.sym, reason: '킬 스위치' }));
        acc.killUntil = i + P.killBars; acc.killed++; acc.half = true; acc.peak = eq; // 재개 기준을 새로 잡음
        if (ev) acc.events.push({ t: iso(t), kind: 'vault', msg: '고점 대비 ' + cfg.ddKill + '% — 전부 청산, ' + Math.round(P.killBars * P.barH / 24) + '일 휴식' });
      } else if (dd <= cfg.ddHalve && !acc.half) { acc.half = true; if (ev) acc.events.push({ t: iso(t), kind: 'vault', msg: '고점 대비 ' + cfg.ddHalve + '% — 위험 절반으로' }); }
      else if (acc.half && dd > cfg.ddResume && i >= acc.killUntil) { acc.half = false; }
      acc.equity.push([t, Math.round(eq)]);
      Object.values(acc.pos).forEach((p) => {
        const x = X[p.sym], j = x.map[i]; if (j < 0) return;
        const a = x.atr[j], c = x.d.c[j];
        if (p.side === 'long') { p.ext = Math.max(p.ext, x.d.h[j]); const tr = p.ext - P.trailAtr * a; if (c > p.entry + a) p.stop = Math.max(p.stop, tr); if (x.eF[j] < x.eS[j]) acc.pending.push({ kind: 'exit', sym: p.sym, reason: '추세 꺾임' }); }
        else { p.ext = Math.min(p.ext, x.d.l[j]); const tr = p.ext + P.trailAtr * a; if (c < p.entry - a) p.stop = Math.min(p.stop, tr); if (x.eF[j] > x.eS[j]) acc.pending.push({ kind: 'exit', sym: p.sym, reason: '추세 꺾임' }); }
      });
      if (acc.dayBlock || i + 1 < acc.killUntil) continue;
      const bj = X.BTC.map[i], btcBear = bj >= 0 && X.BTC.reg[bj] != null && X.BTC.d.c[bj] < X.BTC.reg[bj];
      const cands = [];
      W.syms.forEach((s) => {
        if (acc.pos[s]) return;
        const x = X[s], j = x.map[i]; if (j < 1 || x.hi[j] == null || x.eS[j] == null || x.atr[j] == null) return;
        const c = x.d.c[j], a = x.atr[j];
        if (a / c * 100 > cfg.atrMaxPct) return; // 너무 미친 변동성은 건너뜀
        const meta = (COINS.find((k) => k.sym === s) || { name: s });
        if (x.eF[j] > x.eS[j] && c > x.eS[j] && c > x.hi[j]) cands.push({ sym: s, name: meta.name, side: 'long', atr: a, str: (c - x.hi[j]) / a, why: P.brk + '봉 고점 돌파 + 50/200 EMA 정배열' });
        else if (btcBear && x.eF[j] < x.eS[j] && c < x.eS[j] && c < x.lo[j]) cands.push({ sym: s, name: meta.name, side: 'short', atr: a, str: (x.lo[j] - c) / a, why: P.brk + '봉 저점 이탈 + 역배열 + BTC 하락장' });
      });
      const room = cfg.maxPos - Object.keys(acc.pos).length - acc.pending.filter((o) => o.kind !== 'exit').length;
      cands.sort((a, b) => b.str - a.str).slice(0, Math.max(0, room)).forEach((o) => acc.pending.push({ kind: 'open', ...o }));
    }
    acc.lastT = T[Math.min(i1, T.length - 1)];
    return acc;
  }

  /* ---------- 성적: 일 단위로 묶어서 ---------- */
  function daily(equity) { const out = []; let last = null; equity.forEach(([t, v]) => { const d = new Date(t).toISOString().slice(0, 10); if (last && last[0] === d) last[1] = v; else { last = [d, v]; out.push(last); } }); return out; }
  function monthStats(dailyCurve, goal) {
    const m = {}; let prevM = null, pv = dailyCurve.length ? dailyCurve[0][1] : 0, lastV = pv;
    dailyCurve.forEach(([d, v]) => { const k = d.slice(0, 7); if (prevM && k !== prevM) { m[prevM] = round((lastV / pv - 1) * 100, 2); pv = lastV; } prevM = k; lastV = v; });
    if (prevM) m[prevM] = round((lastV / pv - 1) * 100, 2);
    const arr = Object.values(m), n = arr.length;
    const sorted = arr.slice().sort((a, b) => a - b);
    return { monthly: m, months: n, avg: n ? round(arr.reduce((a, b) => a + b, 0) / n, 2) : null, median: n ? sorted[Math.floor(n / 2)] : null,
      hit: n ? round(arr.filter((x) => x >= goal).length / n * 100, 1) : null, neg: n ? round(arr.filter((x) => x < 0).length / n * 100, 1) : null,
      best: n ? sorted[n - 1] : null, worst: n ? sorted[0] : null };
  }
  function backtest(series, preset, over, opts) {
    const P = PRESETS[preset], cfg = Object.assign({}, BASE, over || {});
    const W = prepare(series, P), acc = newAccount(cfg);
    const i0 = opts && opts.fromT ? Math.max(0, W.T.findIndex((t) => t >= opts.fromT)) : 0;
    simulate(W, P, cfg, acc, i0, W.T.length - 1, opts);
    return { W, P, cfg, acc };
  }
  // 위험(%)을 바꿔 가며: 월 10%를 노리면 낙폭이 얼마나 되는지
  function riskLadder(series, preset, risks, metricsFn, goal) {
    return risks.map((r) => {
      const { acc } = backtest(series, preset, { riskPct: r, maxLevTotal: Math.max(3, r * 2), maxLevCoin: Math.max(1.5, r) });
      const dc = daily(acc.equity), m = metricsFn ? metricsFn(dc, acc.trades) : null, ms = monthStats(dc, goal);
      return { risk: r, cagr: m && m.cagr, mdd: m && m.mdd, sharpe: m && m.sharpe, avgMonth: ms.avg, hit: ms.hit, neg: ms.neg, worstMonth: ms.worst, liq: acc.liquidations, kills: acc.killed };
    });
  }
  function readiness(live, bt) {
    const L = live || {}, B = bt || {};
    const items = [
      ['선물 모의투자 90일 이상', (L.days || 0) >= 90, (L.days || 0) + '일'],
      ['청산된 거래 30번 이상', (L.trades || 0) >= 30, (L.trades || 0) + '번'],
      ['손익비(PF) 1.3 이상', L.pf != null && L.pf >= 1.3, L.pf == null ? '—' : L.pf],
      ['강제 청산 0번', (L.liq || 0) === 0, (L.liq || 0) + '번'],
      ['모의 최대낙폭이 백테스트의 1.5배 이내', L.mdd != null && B.mdd != null && L.mdd >= B.mdd * 1.5, L.mdd == null ? '—' : L.mdd + '%'],
      ['백테스트 표본 밖(최근 30%)도 수익', B.oosCagr != null && B.oosCagr > 0, B.oosCagr == null ? '—' : B.oosCagr + '%/년'],
      ['10년 일봉 교차 검증도 수익', B.d1Cagr != null && B.d1Cagr > 0, B.d1Cagr == null ? '—' : B.d1Cagr + '%/년']
    ].map(([label, ok, val]) => ({ label, ok: !!ok, val }));
    return { items, passed: items.filter((x) => x.ok).length, total: items.length, ready: items.every((x) => x.ok) };
  }

  const Futures = { PRESETS, BASE, COINS, prepare, newAccount, simulate, backtest, daily, monthStats, riskLadder, readiness, liqPrice, _: { ema, atr, hiPrev, loPrev } };
  root.Futures = Futures;
  if (typeof module !== 'undefined' && module.exports) module.exports = Futures;
})(typeof window !== 'undefined' ? window : globalThis);
