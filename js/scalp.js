/* 시장날씨 · 코인 선물 단타 엔진 (SCALP · Claude가 최종 결정)
 * ------------------------------------------------------------------
 * 15분봉 · 롱/숏 · 무기한 선물 규칙(격리 10배, 청산가, 8시간 펀딩, 테이커 수수료, 미끄러짐)
 * 셋업 두 가지 (엔진이 후보를 찾고, Claude가 들어갈지 결정):
 *  ① 추세 눌림목: 50·200 EMA 정배열(역배열) + 가격이 20 EMA까지 눌렸다가 다시 추세 방향으로 마감 + RSI 50 회복
 *  ② 수축 후 돌파: 볼린저 밴드 폭이 최근 하위 20% → 20봉 고점(저점) 돌파 + 거래량 1.5배
 * 청산: 손절 1.5 ATR(최소 0.6% — 수수료가 손실 한도를 다 먹지 않게) · 목표 2R(익절) · 1R 가면 손절을 본전으로 · 6시간(24봉) 지나도 안 끝나면 정리
 * 리스크: 한 번에 계좌 1% · 동시 2개 · 같은 코인은 정리 후 2시간 쉼 · 전체 레버리지 5배 · 하루 −3% 진입 금지 · 3연패면 4시간 휴식
 *         고점 대비 −20% → 전부 정리 후 3일 휴식
 * 체결: 봉 마감에 판단 → 다음 봉 시가. 손절·익절은 봉 안 고가/저가로(둘 다 닿으면 손절로 가정)
 */
(function (root) {
  'use strict';
  const CFG = {
    bar: 15, riskPct: 1, maxPos: 2, maxLevTotal: 5, maxLevCoin: 3, isoLev: 10, mm: 0.005,
    taker: 0.0005, slipIn: 0.0002, slipStop: 0.0005, fundBase: 0.0001, fundHot: 0.0003,
    stopAtr: 1.5, minStopPct: 0.6, tpR: 2, beR: 1, maxBars: 24, coolBars: 8, emaF: 50, emaS: 200, emaP: 20, rsiN: 14, atrN: 14,
    bbN: 20, bbK: 2, sqzLook: 96, sqzPct: 0.2, brk: 20, volK: 1.5, atrMaxPct: 3,
    dayLoss: -3, streakPause: 3, pauseBars: 16, ddKill: -20, killBars: 288, startCash: 100000000
  };
  const COINS = [
    { sym: 'BTC', name: '비트코인', y: 'BTC-USD' }, { sym: 'ETH', name: '이더리움', y: 'ETH-USD' }, { sym: 'SOL', name: '솔라나', y: 'SOL-USD' },
    { sym: 'XRP', name: '엑스알피', y: 'XRP-USD' }, { sym: 'DOGE', name: '도지코인', y: 'DOGE-USD' }
  ];
  const round = (x, n) => { const p = Math.pow(10, n == null ? 2 : n); return Math.round(x * p) / p; };
  const iso = (t) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');

  /* ---------- 지표 ---------- */
  function ema(a, n) { const k = 2 / (n + 1), out = new Array(a.length).fill(null); let e = null, s = 0; for (let i = 0; i < a.length; i++) { if (i < n) { s += a[i]; if (i === n - 1) { e = s / n; out[i] = e; } continue; } e = a[i] * k + e * (1 - k); out[i] = e; } return out; }
  function atr(h, l, c, n) { const out = new Array(c.length).fill(null); let a = null; for (let i = 1; i < c.length; i++) { const tr = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])); if (i < n) { a = (a || 0) + tr; if (i === n - 1) { a /= n - 1; out[i] = a; } continue; } a = (a * (n - 1) + tr) / n; out[i] = a; } return out; }
  function rsi(c, n) { const out = new Array(c.length).fill(null); let g = 0, l = 0; for (let i = 1; i < c.length; i++) { const d = c[i] - c[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0); if (i <= n) { g += up; l += dn; if (i === n) { g /= n; l /= n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } continue; } g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } return out; }
  function sma(a, n) { const out = new Array(a.length).fill(null); let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) out[i] = s / n; } return out; }
  function bbWidth(c, n, k) { const m = sma(c, n), out = new Array(c.length).fill(null); for (let i = n - 1; i < c.length; i++) { let v = 0; for (let j = i - n + 1; j <= i; j++) v += (c[j] - m[i]) ** 2; out[i] = (2 * k * Math.sqrt(v / n)) / m[i]; } return out; }
  function hiPrev(h, n) { const out = new Array(h.length).fill(null); for (let i = n; i < h.length; i++) { let m = -Infinity; for (let j = i - n; j < i; j++) if (h[j] > m) m = h[j]; out[i] = m; } return out; }
  function loPrev(l, n) { const out = new Array(l.length).fill(null); for (let i = n; i < l.length; i++) { let m = Infinity; for (let j = i - n; j < i; j++) if (l[j] < m) m = l[j]; out[i] = m; } return out; }
  function pctRank(a, look) { const out = new Array(a.length).fill(null); for (let i = look; i < a.length; i++) { if (a[i] == null) continue; let lo = 0, n = 0; for (let j = i - look; j < i; j++) { if (a[j] == null) continue; n++; if (a[j] < a[i]) lo++; } out[i] = n ? lo / n : null; } return out; }

  // series: { BTC: { t:[ms], o,h,l,c,v } } — 15분봉 (봉 시작 시각)
  function prepare(series, P) {
    P = P || CFG;
    if (!series.BTC) throw new Error('BTC 15분봉이 없습니다');
    const T = series.BTC.t.slice(), X = {};
    Object.keys(series).forEach((s) => {
      const d = series[s]; if (!d || !d.c || d.c.length < P.emaS + 10) return;
      const idx = {}; d.t.forEach((t, i) => { idx[t] = i; });
      const bw = bbWidth(d.c, P.bbN, P.bbK);
      X[s] = { d, map: T.map((t) => (idx[t] == null ? -1 : idx[t])), eF: ema(d.c, P.emaF), eS: ema(d.c, P.emaS), eP: ema(d.c, P.emaP), atr: atr(d.h, d.l, d.c, P.atrN), rsi: rsi(d.c, P.rsiN),
        bw, bwR: pctRank(bw, P.sqzLook), hi: hiPrev(d.h, P.brk), lo: loPrev(d.l, P.brk), vAvg: sma(d.v || d.c.map(() => 0), 20) };
      Object.assign(X[s], mkFeatures(d, X[s].atr));
    });
    return { T, X, syms: Object.keys(X) };
  }

  /* ---------- 지금 이 코인 상태를 한 줄로 (판단 기록용) ---------- */
  function describe(x, j, P) {
    if (j < 1 || x.eS[j] == null) return { trend: 'na', text: '데이터 준비 중' };
    const c = x.d.c[j], up = x.eF[j] > x.eS[j] && c > x.eS[j], dn = x.eF[j] < x.eS[j] && c < x.eS[j];
    const trend = up ? 'up' : dn ? 'down' : 'flat', T = { up: '상승추세', down: '하락추세', flat: '횡보' }[trend];
    const sq = x.bwR[j] != null && x.bwR[j] <= P.sqzPct;
    const dist = (c / x.eP[j] - 1) * 100;
    let wait = trend === 'flat' ? (sq ? '변동성 수축 — 돌파 대기' : '방향 없음 — 쉼') : trend === 'up' ? (dist > 0.6 ? '20EMA에서 ' + dist.toFixed(1) + '% 위 — 눌림 대기' : '눌림 구간 — 반등 확인 대기') : (dist < -0.6 ? '20EMA에서 ' + Math.abs(dist).toFixed(1) + '% 아래 — 반등 대기' : '반등 구간 — 재하락 확인 대기');
    return { trend, text: T + ' · RSI ' + Math.round(x.rsi[j]) + ' · ' + wait };
  }

  /* ---------- 민경기 봇(MK) 지표: 리만 가설·나비에-스토크스에서 착안한 비유 지표 ----------
   * 수학 난제를 푼 것이 아니라, 두 이론의 '모양'을 가격에 빌려 온 것입니다.
   * [리만] 제타 함수 ζ(s)=Σ n^-s 처럼, 여러 주기(8~144봉)의 방향을 n^-1/2 무게로 더한 '파동 정렬 점수' Z(-1~+1)
   *        모든 영점이 한 줄(임계선 1/2) 위에 있다는 가설처럼, 여러 이동평균의 평균을 '균형선'으로 보고 거기서 얼마나 벗어났는지(ATR 배수)
   *        영점 사이 간격이 서로 밀어내며 고르게 퍼지는 성질처럼, 변곡점(8EMA 방향 바뀜) 간격이 고른지·다음 변곡이 올 때가 됐는지
   * [나비에-스토크스] 흐름이 매끄러우면(층류) 따라가고, 소용돌이(난류)면 피함
   *        효율비 ER(16봉 순이동 ÷ 움직인 거리 합) = 매끄러움, 단기/장기 변동성 비 × (1-ER) 의 순위 = 난류 지수 TI(0~1) */
  const MK_N = [8, 13, 21, 34, 55, 89, 144];
  function mkFeatures(d, A) {
    const c = d.c, n = c.length, S = MK_N.map((k) => sma(c, k)), W = MK_N.map((k) => 1 / Math.sqrt(k)), WS = W.reduce((a, b) => a + b, 0);
    const Z = new Array(n).fill(null), eq = new Array(n).fill(null), dev = new Array(n).fill(null), er = new Array(n).fill(null), tiRaw = new Array(n).fill(null);
    const phase = new Array(n).fill(null), reg = new Array(n).fill(null), turn = new Array(n).fill(0), e8 = ema(c, 8);
    const r = c.map((v, i) => (i ? Math.log(v / c[i - 1]) : 0));
    const sd = (i, k) => { let m = 0; for (let j = i - k + 1; j <= i; j++) m += r[j]; m /= k; let v = 0; for (let j = i - k + 1; j <= i; j++) v += (r[j] - m) ** 2; return Math.sqrt(v / k); };
    let lastTurn = null, prevSgn = 0; const gaps = [];
    for (let i = 0; i < n; i++) {
      if (S[S.length - 1][i] != null) {
        let z = 0, e = 0; S.forEach((a, k) => { z += W[k] * Math.sign(c[i] - a[i]); e += a[i]; });
        Z[i] = z / WS; eq[i] = e / S.length; if (A[i]) dev[i] = (c[i] - eq[i]) / A[i];
      }
      if (i >= 16) { let path = 0; for (let j = i - 15; j <= i; j++) path += Math.abs(c[j] - c[j - 1]); er[i] = path ? Math.abs(c[i] - c[i - 16]) / path : 0; }
      if (i >= 96 && er[i] != null) { const lg = sd(i, 96); tiRaw[i] = lg ? (sd(i, 16) / lg) * (1 - er[i]) : null; }
      if (i >= 9 && e8[i] != null && e8[i - 1] != null) {
        const sg = Math.sign(e8[i] - e8[i - 1]);
        if (sg && prevSgn && sg !== prevSgn) { turn[i] = sg; if (lastTurn != null) { gaps.push(i - lastTurn); if (gaps.length > 12) gaps.shift(); } lastTurn = i; }
        if (sg) prevSgn = sg;
        if (gaps.length >= 6 && lastTurn != null) {
          const m = gaps.reduce((a, b) => a + b, 0) / gaps.length, v = Math.sqrt(gaps.reduce((a, b) => a + (b - m) ** 2, 0) / gaps.length);
          phase[i] = (i - lastTurn) / m; reg[i] = Math.max(0, 1 - v / m);
          if (turn[i]) phase[i] = gaps[gaps.length - 1] / m; // 방금 변곡: 직전 간격이 평균 대비 어땠는지
        }
      }
    }
    return { mkZ: Z, mkEq: eq, mkDev: dev, mkEr: er, mkTi: pctRank(tiRaw, 192), mkPhase: phase, mkReg: reg, mkTurn: turn };
  }
  function mkRead(x, j) {
    const z = x.mkZ[j], dv = x.mkDev[j], ti = x.mkTi[j], er = x.mkEr[j];
    if (z == null || dv == null || ti == null) return null;
    const flow = ti >= 0.85 ? '난류' : ti >= 0.6 ? '소용돌이 조짐' : er >= 0.3 ? '층류' : '잔잔함';
    return { z: round(z, 2), dev: round(dv, 2), ti: round(ti, 2), er: round(er, 2), phase: x.mkPhase[j] == null ? null : round(x.mkPhase[j], 2), reg: x.mkReg[j] == null ? null : round(x.mkReg[j], 2), flow,
      text: '파동 정렬 ' + (z > 0 ? '+' : '') + z.toFixed(2) + ' · 균형선 ' + (dv > 0 ? '+' : '') + dv.toFixed(1) + 'ATR · 난류 ' + Math.round(ti * 100) + '% (' + flow + ')' };
  }
  function mkSetups(x, j, P) {
    const out = [];
    if (j < 2 || x.atr[j] == null) return out;
    const c = x.d.c[j], a = x.atr[j]; if (a / c * 100 > P.atrMaxPct) return out;
    const z = x.mkZ[j], z1 = x.mkZ[j - 1], dv = x.mkDev[j], ti = x.mkTi[j], er = x.mkEr[j], ph = x.mkPhase[j], rg = x.mkReg[j], tn = x.mkTurn[j];
    if (z == null || z1 == null || dv == null || ti == null || er == null) return out;
    const tiMax = P.mkTiMax == null ? 0.85 : P.mkTiMax;
    if (ti > tiMax) return out; // 나비에-스토크스: 난류면 쉼
    const size = P.mkNoSize ? 1 : ti <= 0.5 ? 1 : 0.5;
    const tiTxt = ' · 난류 ' + Math.round(ti * 100) + '%' + (size < 1 ? ' → 절반 크기' : '');
    // ① 층류 추세: 여러 주기가 막 한 방향으로 정렬(Z가 문턱을 새로 넘음) + 흐름이 매끄러움 + 균형선에서 너무 멀지 않음
    const zk = P.mkZ || 0.7;
    if (!P.mkOnly || P.mkOnly === 'flow') {
      if (z >= zk && z1 < zk && er >= 0.3 && dv >= 0 && dv <= 2) out.push({ side: 'long', kind: 'mk-flow', size, why: '파동 정렬 +' + z.toFixed(2) + ' (7개 주기 중 대부분 위) · 층류 ER ' + er.toFixed(2) + tiTxt });
      if (z <= -zk && z1 > -zk && er >= 0.3 && dv <= 0 && dv >= -2) out.push({ side: 'short', kind: 'mk-flow', size, why: '파동 정렬 ' + z.toFixed(2) + ' (7개 주기 중 대부분 아래) · 층류 ER ' + er.toFixed(2) + tiTxt });
    }
    // ② 균형선 복귀: 균형선에서 2.5ATR 넘게 벗어난 뒤, 변곡 간격이 고르고(밀어내기) 제때 방향이 꺾임
    if (!P.mkOnly || P.mkOnly === 'revert') {
      const due = ph != null && ph >= 0.7 && ph <= 1.6 && rg != null && rg >= 0.15;
      if (dv >= 2.5 && tn === -1 && due) out.push({ side: 'short', kind: 'mk-revert', size, why: '균형선 위 ' + dv.toFixed(1) + 'ATR 과열 · 변곡 간격 고름(' + Math.round(rg * 100) + '%) · 제때 꺾임' + tiTxt });
      if (dv <= -2.5 && tn === 1 && due) out.push({ side: 'long', kind: 'mk-revert', size, why: '균형선 아래 ' + Math.abs(dv).toFixed(1) + 'ATR 과매도 · 변곡 간격 고름(' + Math.round(rg * 100) + '%) · 제때 꺾임' + tiTxt });
    }
    if (P.mkFlip) out.forEach((s) => { s.side = s.side === 'long' ? 'short' : 'long'; s.why = '[반대로] ' + s.why; });
    out.forEach((s) => { s.setup = s.kind; delete s.kind; s.atr = a; s.str = s.setup === 'mk-flow' ? 2 : 1; s.ref = c; s.hl = [x.d.h[j], x.d.l[j]]; });
    return out;
  }

  /* ---------- 후보 찾기 (봉 마감 j 기준) ---------- */
  function setups(x, j, P) {
    if (P.mk) return mkSetups(x, j, P);
    const out = [];
    if (j < 2 || x.eS[j] == null || x.atr[j] == null || x.rsi[j - 1] == null) return out;
    const c = x.d.c[j], o = x.d.o[j], h = x.d.h[j], l = x.d.l[j], a = x.atr[j];
    if (a / c * 100 > P.atrMaxPct) return out;
    const up = x.eF[j] > x.eS[j] && c > x.eS[j], dn = x.eF[j] < x.eS[j] && c < x.eS[j];
    // ① 눌림목: 최근 3봉 안에 20EMA를 건드리고, 이번 봉이 추세 방향 양봉/음봉으로 20EMA 위/아래 마감 + RSI 50 회복
    const touchedL = [0, 1, 2].some((k) => x.d.l[j - k] <= x.eP[j - k] * 1.001), touchedH = [0, 1, 2].some((k) => x.d.h[j - k] >= x.eP[j - k] * 0.999);
    if (up && touchedL && c > x.eP[j] && c > o && x.rsi[j] > 50 && x.rsi[j - 1] <= 55) out.push({ side: 'long', kind: 'pullback', why: '상승추세 눌림목 반등 (20EMA 지지, RSI ' + Math.round(x.rsi[j]) + ')' });
    if (dn && touchedH && c < x.eP[j] && c < o && x.rsi[j] < 50 && x.rsi[j - 1] >= 45) out.push({ side: 'short', kind: 'pullback', why: '하락추세 반등 실패 (20EMA 저항, RSI ' + Math.round(x.rsi[j]) + ')' });
    // ② 수축 후 돌파 + 거래량
    const sq = x.bwR[j - 1] != null && x.bwR[j - 1] <= P.sqzPct, volOk = !x.vAvg[j] || (x.d.v && x.d.v[j] >= x.vAvg[j] * P.volK);
    if (sq && volOk && x.hi[j] != null && c > x.hi[j] && !dn) out.push({ side: 'long', kind: 'squeeze', why: '변동성 수축 후 ' + P.brk + '봉 고점 돌파 + 거래량' });
    if (sq && volOk && x.lo[j] != null && c < x.lo[j] && !up) out.push({ side: 'short', kind: 'squeeze', why: '변동성 수축 후 ' + P.brk + '봉 저점 이탈 + 거래량' });
    if (P.only) for (let k = out.length - 1; k >= 0; k--) if (out[k].kind !== P.only) out.splice(k, 1);
    if (P.strong) { const slope = x.eS[j - 16] ? (x.eS[j] / x.eS[j - 16] - 1) * 100 : 0; for (let k = out.length - 1; k >= 0; k--) if (out[k].side === 'long' ? slope < 0.15 : slope > -0.15) out.splice(k, 1); }
    out.forEach((s) => { s.setup = s.kind; delete s.kind; s.atr = a; s.str = s.setup === 'squeeze' ? 2 : 1; s.ref = c; s.hl = [h, l]; });
    return out;
  }

  /* ---------- 계좌 ---------- */
  function newAccount(P) {
    P = P || CFG;
    return { cash: P.startCash, start: P.startCash, peak: P.startCash, pos: {}, pending: [], trades: [], equity: [], events: [], log: [],
      dayKey: null, dayStart: P.startCash, dayBlock: false, streak: 0, pauseUntilT: 0, killUntilT: 0, cool: {}, killed: 0, liquidations: 0, fundingPaid: 0, feesPaid: 0, lastT: null };
  }
  const liqPrice = (side, entry, P) => (side === 'long' ? entry * (1 - 1 / P.isoLev + P.mm) : entry * (1 + 1 / P.isoLev - P.mm));
  function markEq(acc, px) { let u = 0; Object.values(acc.pos).forEach((p) => { const m = px(p.sym); if (m != null) u += (p.side === 'long' ? 1 : -1) * (m - p.entry) * p.qty; }); return acc.cash + u; }
  function closePos(acc, p, price, t, reason, P, ev) {
    const BM = P.bar * 60e3;
    const gross = (p.side === 'long' ? 1 : -1) * (price - p.entry) * p.qty, fee = price * p.qty * P.taker;
    const pnl = reason === '청산(강제)' ? -p.margin : gross - fee;
    acc.cash += pnl; acc.feesPaid += fee;
    const total = pnl - p.entryFee + p.funding;
    const tr = { sym: p.sym, name: p.name, side: p.side, kind: p.kind, in: iso(p.t), out: iso(t), entry: round(p.entry, 6), exit: round(price, 6), qty: p.qty, lev: round(p.notional0 / p.eq0, 2),
      pnl: Math.round(total), pct: round(total / p.eq0 * 100, 2), R: round(total / p.riskAmt, 2), days: round((t - p.t) / 864e5, 3), mins: Math.round((t - p.t) / 60e3), funding: Math.round(p.funding), reason, ai: p.ai || null };
    acc.trades.push(tr); delete acc.pos[p.sym];
    acc.cool = acc.cool || {}; acc.cool[p.sym] = t + P.coolBars * BM;
    acc.streak = total < 0 ? acc.streak + 1 : 0;
    if (acc.streak >= P.streakPause) { acc.pauseUntilT = t + P.pauseBars * BM; acc.streak = 0; if (ev) acc.events.push({ t: iso(t), kind: 'vault', msg: P.streakPause + '연패 — ' + (P.pauseBars * P.bar / 60) + '시간 쉬기' }); }
    if (ev) acc.events.push({ t: iso(t), kind: 'close', sym: p.sym, name: p.name, side: p.side, price: tr.exit, pnl: tr.pnl, R: tr.R, reason });
    return tr;
  }

  /* ---------- 시뮬레이션 i0..i1 (opts.vote: 후보를 Claude 결정 대기로) ---------- */
  function simulate(W, P, acc, i0, i1, opts) {
    P = P || CFG; opts = opts || {};
    const { T, X } = W, ev = !!opts.collect;
    const px = (s, i, k) => { const x = X[s]; if (!x) return null; const j = x.map[i]; return j < 0 ? null : x.d[k || 'c'][j]; };
    for (let i = Math.max(i0, P.emaS + P.sqzLook + 2); i <= i1; i++) {
      const t = T[i], dk = new Date(t).toISOString().slice(0, 10), mins = new Date(t).getUTCHours() * 60 + new Date(t).getUTCMinutes();
      if (acc.dayKey !== dk) { acc.dayKey = dk; acc.dayStart = markEq(acc, (s) => px(s, i - 1)); acc.dayBlock = false; }
      // 1) 시가: 대기 주문
      const pend = acc.pending; acc.pending = [];
      pend.forEach((o) => {
        const op = px(o.sym, i, 'o'); if (op == null) return;
        if (o.kind === 'exit') { const p = acc.pos[o.sym]; if (p) closePos(acc, p, op * (p.side === 'long' ? 1 - P.slipIn : 1 + P.slipIn), t, o.reason, P, ev); return; }
        if (o.needVote && !o.approved) return;
        if (acc.pos[o.sym] || acc.dayBlock || t < acc.killUntilT || t < acc.pauseUntilT) return;
        if (Object.keys(acc.pos).length >= P.maxPos) return;
        const entry = op * (o.side === 'long' ? 1 + P.slipIn : 1 - P.slipIn), eq = markEq(acc, (s) => px(s, i, 'o'));
        const stopDist = Math.max(o.atr * P.stopAtr, entry * P.minStopPct / 100), liqDist = Math.abs(entry - liqPrice(o.side, entry, P));
        if (stopDist > liqDist * 0.5) return;
        let qty = eq * P.riskPct / 100 / stopDist * (o.size || 1);
        const used = Object.values(acc.pos).reduce((a, p) => a + p.qty * (px(p.sym, i, 'o') || p.entry), 0);
        qty = Math.min(qty, eq * P.maxLevCoin / entry, Math.max(0, eq * P.maxLevTotal - used) / entry);
        if (qty * entry < eq * 0.05) return;
        const notional = qty * entry, fee = notional * P.taker; acc.cash -= fee; acc.feesPaid += fee;
        const sgn = o.side === 'long' ? 1 : -1, stop = entry - sgn * stopDist, tp = entry + sgn * stopDist * P.tpR;
        acc.pos[o.sym] = { sym: o.sym, name: o.name, side: o.side, kind: o.setup, entry, qty, t, stop, stop0: stop, tp, R: stopDist, liq: liqPrice(o.side, entry, P), margin: notional / P.isoLev,
          riskAmt: qty * stopDist, eq0: eq, notional0: notional, entryFee: fee, funding: 0, why: o.why, ai: o.ai || null, be: false };
        if (ev) acc.events.push({ t: iso(t), kind: 'open', sym: o.sym, name: o.name, side: o.side, price: round(entry, 6), lev: round(notional / eq, 2), stop: round(stop, 6), tp: round(tp, 6), why: o.why, ai: o.ai || null });
      });
      // 2) 봉 안: 손절/익절 (둘 다 닿으면 손절로)
      Object.values(acc.pos).forEach((p) => {
        const o = px(p.sym, i, 'o'), h = px(p.sym, i, 'h'), l = px(p.sym, i, 'l'); if (o == null) return;
        const L = p.side === 'long';
        if (L ? o <= p.liq : o >= p.liq) { acc.liquidations++; closePos(acc, p, p.liq, t, '청산(강제)', P, ev); return; }
        if (L ? o <= p.stop : o >= p.stop) { closePos(acc, p, o * (L ? 1 - P.slipStop : 1 + P.slipStop), t, p.be ? '본전 손절(갭)' : '손절(갭)', P, ev); return; }
        if (L ? o >= p.tp : o <= p.tp) { closePos(acc, p, o, t, '익절(갭)', P, ev); return; }
        if (L ? l <= p.stop : h >= p.stop) { closePos(acc, p, p.stop * (L ? 1 - P.slipStop : 1 + P.slipStop), t, p.be ? '본전 손절' : '손절', P, ev); return; }
        if (L ? h >= p.tp : l <= p.tp) { closePos(acc, p, p.tp, t, '익절 ' + P.tpR + 'R', P, ev); return; }
      });
      // 3) 펀딩 (00·08·16 UTC 봉)
      if (mins % 480 === 0) {
        const bx = X.BTC, bj = bx.map[i - 1], hot = bj >= 0 && bx.eS[bj] != null && bx.d.c[bj] > bx.eS[bj] * 1.03, cold = bj >= 0 && bx.eS[bj] != null && bx.d.c[bj] < bx.eS[bj] * 0.97;
        const rate = hot ? P.fundHot : cold ? -P.fundBase : P.fundBase;
        Object.values(acc.pos).forEach((p) => { const m = px(p.sym, i, 'o') || p.entry, f = m * p.qty * rate * (p.side === 'long' ? -1 : 1); acc.cash += f; p.funding += f; acc.fundingPaid -= f; });
      }
      // 4) 종가: 평가·리스크·본전 이동·시간 손절·신호
      const eq = markEq(acc, (s) => px(s, i));
      acc.peak = Math.max(acc.peak, eq);
      if (!acc.dayBlock && (eq / acc.dayStart - 1) * 100 <= P.dayLoss) { acc.dayBlock = true; if (ev) acc.events.push({ t: iso(t), kind: 'vault', msg: '하루 손실 ' + P.dayLoss + '% — 오늘 신규 진입 금지' }); }
      if ((eq / acc.peak - 1) * 100 <= P.ddKill && t >= acc.killUntilT) {
        Object.values(acc.pos).forEach((p) => acc.pending.push({ kind: 'exit', sym: p.sym, reason: '킬 스위치' }));
        acc.killUntilT = t + P.killBars * P.bar * 60e3; acc.killed++; acc.peak = eq;
        if (ev) acc.events.push({ t: iso(t), kind: 'vault', msg: '고점 대비 ' + P.ddKill + '% — 전부 정리, ' + Math.round(P.killBars * P.bar / 1440) + '일 휴식' });
      }
      acc.equity.push([t, Math.round(eq)]);
      Object.values(acc.pos).forEach((p) => {
        const c = px(p.sym, i), L = p.side === 'long'; if (c == null) return;
        if (!p.be && (L ? c >= p.entry + p.R * P.beR : c <= p.entry - p.R * P.beR)) { p.stop = p.entry; p.be = true; }
        if ((t - p.t) / (P.bar * 60e3) >= P.maxBars - 1) acc.pending.push({ kind: 'exit', sym: p.sym, reason: '시간 정리(' + (P.maxBars * P.bar / 60) + '시간)' });
      });
      const tn = t + P.bar * 60e3, blocked = acc.dayBlock || tn < acc.killUntilT || tn < acc.pauseUntilT;
      const cands = [];
      if (!blocked) W.syms.forEach((s) => {
        if (acc.pos[s] || (acc.cool && acc.cool[s] > tn)) return;
        const x = X[s], j = x.map[i]; if (j < 0) return;
        const meta = COINS.find((k) => k.sym === s) || { name: s };
        setups(x, j, P).forEach((c) => cands.push({ sym: s, name: meta.name, ...c }));
      });
      const room = P.maxPos - Object.keys(acc.pos).length;
      const picked = cands.sort((a, b) => b.str - a.str).filter((c, k, arr) => arr.findIndex((z) => z.sym === c.sym) === k).slice(0, Math.max(0, room));
      picked.forEach((o) => acc.pending.push({ kind: 'open', ...o, t: iso(t), i, needVote: !!opts.vote }));
      if (ev && opts.log) {
        const lines = W.syms.map((s) => { const x = X[s], j = x.map[i]; return j < 0 ? null : { sym: s, ...describe(x, j, P) }; }).filter(Boolean);
        acc.log.push({ t: iso(t), state: blocked ? (acc.dayBlock ? '하루 손실 한도로 쉬는 중' : tn < acc.killUntilT ? '킬 스위치 휴식 중' : '연패 휴식 중') : null, coins: lines, cands: picked.map((o) => o.name + ' ' + (o.side === 'long' ? '롱' : '숏')) });
        if (acc.log.length > 96) acc.log.splice(0, acc.log.length - 96);
      }
    }
    acc.lastT = T[Math.min(i1, T.length - 1)];
    return acc;
  }

  function daily(equity) { const out = []; let last = null; equity.forEach(([t, v]) => { const d = new Date(t).toISOString().slice(0, 10); if (last && last[0] === d) last[1] = v; else { last = [d, v]; out.push(last); } }); return out; }
  function backtest(series, over) { const P = Object.assign({}, CFG, over || {}), W = prepare(series, P), acc = newAccount(P); simulate(W, P, acc, 0, W.T.length - 1); return { W, P, acc }; }
  function stats(acc) {
    const tr = acc.trades, n = tr.length, w = tr.filter((x) => x.pnl > 0), gw = w.reduce((a, x) => a + x.pnl, 0), gl = -tr.filter((x) => x.pnl <= 0).reduce((a, x) => a + x.pnl, 0);
    const byKind = {}; tr.forEach((x) => { const k = byKind[x.kind] || (byKind[x.kind] = { n: 0, win: 0, R: 0 }); k.n++; if (x.pnl > 0) k.win++; k.R += x.R; });
    Object.values(byKind).forEach((k) => { k.winRate = round(k.win / k.n * 100, 1); k.avgR = round(k.R / k.n, 2); });
    return { trades: n, winRate: n ? round(w.length / n * 100, 1) : null, pf: gl ? round(gw / gl, 2) : null, avgR: n ? round(tr.reduce((a, x) => a + x.R, 0) / n, 2) : null,
      avgMins: n ? Math.round(tr.reduce((a, x) => a + x.mins, 0) / n) : null, perDay: null, byKind, fees: Math.round(acc.feesPaid), funding: Math.round(acc.fundingPaid), liq: acc.liquidations, kills: acc.killed };
  }

  const MK_CFG = Object.assign({}, CFG, { mk: true });
  const Scalp = { CFG, MK_CFG, mkRead, COINS, prepare, setups, describe, newAccount, simulate, backtest, daily, stats, liqPrice, _: { ema, atr, rsi, bbWidth, pctRank } };
  root.Scalp = Scalp;
  if (typeof module !== 'undefined' && module.exports) module.exports = Scalp;
})(typeof window !== 'undefined' ? window : globalThis);
