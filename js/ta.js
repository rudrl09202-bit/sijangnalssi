/*
 * 시장날씨 — 기술적 분석 계산 (월가·증권사에서 흔히 쓰는 도구들)
 * 모든 함수는 배열(오래된 → 최근)을 받아 같은 길이의 배열이나 결과 객체를 돌려줍니다.
 *  - 볼린저밴드(20, 2σ), RSI(14), MACD(12·26·9), 스토캐스틱(14·3·3)
 *  - 전환점(스윙 고점·저점) → 자동 추세선, 수평 지지·저항
 *  - 선형회귀 채널(로그 가격, ±2σ), 피보나치 되돌림
 *  - 통계적 예상 범위: 최근 변동성으로 계산한 확률 범위(68%·95%). 예측이 아니라 "이 정도 흔들릴 수 있다"는 폭입니다.
 */
(function (root) {
  const last = (a) => a[a.length - 1];

  function sma(a, n) { const out = new Array(a.length).fill(null); let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) out[i] = s / n; } return out; }
  function ema(a, n) { const out = new Array(a.length).fill(null), k = 2 / (n + 1); let e = null; for (let i = 0; i < a.length; i++) { if (a[i] == null) continue; e = e == null ? a[i] : a[i] * k + e * (1 - k); if (i >= n - 1) out[i] = e; } return out; }
  function rollStd(a, n) { const out = new Array(a.length).fill(null); for (let i = n - 1; i < a.length; i++) { let m = 0; for (let j = i - n + 1; j <= i; j++) m += a[j]; m /= n; let v = 0; for (let j = i - n + 1; j <= i; j++) v += (a[j] - m) * (a[j] - m); out[i] = Math.sqrt(v / n); } return out; }

  function bb(c, n, m) { n = n || 20; m = m || 2; const mid = sma(c, n), sd = rollStd(c, n); return { mid, up: mid.map((v, i) => (v == null ? null : v + m * sd[i])), lo: mid.map((v, i) => (v == null ? null : v - m * sd[i])) }; }

  function rsi(c, n) {
    n = n || 14; const out = new Array(c.length).fill(null); if (c.length <= n) return out;
    let g = 0, l = 0; for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
    g /= n; l /= n; out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    for (let i = n + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
    return out;
  }

  function macd(c, f, s, sig) {
    const ef = ema(c, f || 12), es = ema(c, s || 26);
    const line = c.map((_, i) => (ef[i] == null || es[i] == null ? null : ef[i] - es[i]));
    const start = line.findIndex((v) => v != null);
    const sigArr = new Array(c.length).fill(null);
    if (start >= 0) { const e = ema(line.slice(start), sig || 9); e.forEach((v, j) => { sigArr[start + j] = v; }); }
    return { macd: line, signal: sigArr, hist: line.map((v, i) => (v == null || sigArr[i] == null ? null : v - sigArr[i])) };
  }

  function stoch(h, l, c, n, ks, ds) {
    n = n || 14; ks = ks || 3; ds = ds || 3;
    const raw = c.map((v, i) => { if (i < n - 1) return null; let hi = -Infinity, lo = Infinity; for (let j = i - n + 1; j <= i; j++) { hi = Math.max(hi, h[j]); lo = Math.min(lo, l[j]); } return hi === lo ? 50 : (v - lo) / (hi - lo) * 100; });
    const smooth = (a, m) => { const out = new Array(a.length).fill(null); for (let i = 0; i < a.length; i++) { const w = a.slice(Math.max(0, i - m + 1), i + 1); if (w.length === m && w.every((x) => x != null)) out[i] = w.reduce((x, y) => x + y, 0) / m; } return out; };
    const k = smooth(raw, ks); return { k, d: smooth(k, ds) };
  }

  // 스윙 전환점: 좌우 w개 봉보다 높으면 고점, 낮으면 저점
  function pivots(h, l, from, to, w) {
    const highs = [], lows = [];
    for (let i = from + w; i <= to - w; i++) {
      let isH = true, isL = true;
      for (let j = i - w; j <= i + w; j++) { if (j === i) continue; if (h[j] >= h[i]) isH = false; if (l[j] <= l[i]) isL = false; if (!isH && !isL) break; }
      if (isH) highs.push({ i, v: h[i] }); if (isL) lows.push({ i, v: l[i] });
    }
    return { highs, lows };
  }

  // 자동 추세선: 최근 두 저점(지지 추세선), 최근 두 고점(저항 추세선)을 잇고 오른쪽으로 연장
  function trendlines(h, l, from, to) {
    const w = Math.max(3, Math.round((to - from) / 25));
    const p = pivots(h, l, from, to, w);
    const line = (pts, kind) => {
      if (pts.length < 2) return null;
      const a = pts[pts.length - 2], b = pts[pts.length - 1];
      const slope = (b.v - a.v) / (b.i - a.i);
      return { kind, i1: a.i, v1: a.v, i2: b.i, v2: b.v, at: (x) => a.v + slope * (x - a.i), rising: slope > 0 };
    };
    return { sup: line(p.lows, 'support'), res: line(p.highs, 'resistance'), pivots: p };
  }

  // 수평 지지·저항: 전환점 가격을 1.5% 안쪽끼리 묶어, 여러 번 닿은 가격대를 강한 순으로
  function levels(h, l, c, from, to) {
    const w = Math.max(2, Math.round((to - from) / 40));
    const p = pivots(h, l, from, to, w), pts = p.highs.concat(p.lows).map((x) => x.v).sort((a, b) => a - b);
    const groups = [];
    pts.forEach((v) => { const g = groups[groups.length - 1]; if (g && v / g.avg - 1 < 0.015) { g.items.push(v); g.avg = g.items.reduce((a, b) => a + b, 0) / g.items.length; } else groups.push({ items: [v], avg: v }); });
    const px = c[to];
    const lv = groups.map((g) => ({ px: g.avg, touches: g.items.length, kind: g.avg < px ? 'support' : 'resistance' }));
    const below = lv.filter((x) => x.kind === 'support').sort((a, b) => b.px - a.px).slice(0, 2);
    const above = lv.filter((x) => x.kind === 'resistance').sort((a, b) => a.px - b.px).slice(0, 2);
    return below.concat(above);
  }

  // 선형회귀 채널 (로그 가격): 가운데 추세선 ± 2 표준편차
  function regression(c, from, to) {
    const n = to - from + 1; if (n < 10) return null;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = from; i <= to; i++) { const x = i - from, y = Math.log(c[i]); sx += x; sy += y; sxx += x * x; sxy += x * y; }
    const b = (n * sxy - sx * sy) / (n * sxx - sx * sx), a = (sy - b * sx) / n;
    let ss = 0, st = 0; const my = sy / n;
    for (let i = from; i <= to; i++) { const y = Math.log(c[i]), f = a + b * (i - from); ss += (y - f) * (y - f); st += (y - my) * (y - my); }
    const sd = Math.sqrt(ss / n), r2 = st ? 1 - ss / st : 0;
    const at = (i, z) => Math.exp(a + b * (i - from) + (z || 0) * sd);
    const z = (Math.log(c[to]) - (a + b * (to - from))) / (sd || 1);
    return { a, b, sd, r2, at, z, slopePerBar: b };
  }

  // 통계적 예상 범위: 최근 m개 봉의 로그수익률 표준편차 σ로, t봉 뒤 가격의 68%(±1σ√t)·95%(±1.96σ√t) 범위
  function cone(c, m) {
    m = Math.min(m || 60, c.length - 1); if (m < 10) return null;
    const r = []; for (let i = c.length - m; i < c.length; i++) r.push(Math.log(c[i] / c[i - 1]));
    const mu = r.reduce((a, b) => a + b, 0) / r.length, sig = Math.sqrt(r.reduce((a, b) => a + (b - mu) * (b - mu), 0) / (r.length - 1));
    const p0 = last(c);
    return { sigma: sig, p0, at: (t, z) => p0 * Math.exp(z * sig * Math.sqrt(t)) };
  }

  // 피보나치 되돌림: 구간 최고·최저 사이 23.6·38.2·50·61.8·78.6%
  function fib(h, l, from, to) {
    let hi = -Infinity, lo = Infinity, hiI = from, loI = from;
    for (let i = from; i <= to; i++) { if (h[i] > hi) { hi = h[i]; hiI = i; } if (l[i] < lo) { lo = l[i]; loI = i; } }
    const up = loI < hiI; // 저점 다음 고점 → 상승 뒤 되돌림
    const lv = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].map((r) => ({ r, px: up ? hi - (hi - lo) * r : lo + (hi - lo) * r }));
    return { hi, lo, hiI, loI, up, levels: lv };
  }

  // 분석 요약: 사람이 읽을 문장과 숫자
  function analyze(k, opt) {
    opt = opt || {};
    const c = k.c, h = k.h || c, l = k.l || c, n = c.length, to = n - 1, p = c[to];
    if (n < 60) return null;
    const perYear = opt.perYear || 252, from = Math.max(0, n - (opt.window || 250));
    const out = { rows: [], bullets: [] };
    const pct = (v) => (v > 0 ? '+' : '') + v.toFixed(1) + '%';
    const rg = regression(c, from, to);
    if (rg) {
      const yr = (Math.exp(rg.b * perYear) - 1) * 100;
      const dir = rg.r2 < 0.2 ? '뚜렷한 방향 없음(횡보)' : yr > 0 ? '상승 추세' : '하락 추세';
      out.rows.push(['회귀 추세 (1년)', dir + ' · 연 ' + pct(yr), '추세 설명력 R² ' + rg.r2.toFixed(2)]);
      out.rows.push(['채널 안 위치', (rg.z > 0 ? '추세선 위 ' : '추세선 아래 ') + Math.abs(rg.z).toFixed(1) + 'σ', Math.abs(rg.z) >= 2 ? '채널 끝 — 되돌림 가능성 커짐' : Math.abs(rg.z) >= 1 ? '채널 가장자리 쪽' : '채널 가운데']);
      out.trend = { yr, r2: rg.r2, z: rg.z };
    }
    const b = bb(c), up = last(b.up), lo = last(b.lo), mid = last(b.mid);
    const pb = (p - lo) / (up - lo), bw = (up - lo) / mid;
    const bws = b.up.map((u, i) => (u == null ? null : (u - b.lo[i]) / b.mid[i])).slice(-125).filter((x) => x != null).sort((x, y) => x - y);
    const bwRank = bws.length ? bws.findIndex((x) => x >= bw) / bws.length : 0.5;
    out.rows.push(['볼린저밴드', '%B ' + (pb * 100).toFixed(0) + '%', pb > 1 ? '상단 돌파 — 과열' : pb < 0 ? '하단 이탈 — 과매도' : bwRank < 0.15 ? '밴드가 좁아짐(스퀴즈) — 큰 움직임 직전일 수 있음' : '밴드 안']);
    const m = macd(c), mh = m.hist; let cross = null;
    for (let i = to; i > Math.max(0, to - 30); i--) { if (mh[i] != null && mh[i - 1] != null && Math.sign(mh[i]) !== Math.sign(mh[i - 1])) { cross = { ago: to - i, up: mh[i] > 0 }; break; } }
    out.rows.push(['MACD (12·26·9)', last(m.macd) > last(m.signal) ? '시그널 위 (상승 탄력)' : '시그널 아래 (하락 탄력)', cross ? (cross.up ? '골든크로스 ' : '데드크로스 ') + (cross.ago === 0 ? '오늘' : cross.ago + '봉 전') : '최근 30봉 교차 없음']);
    const r = last(rsi(c));
    out.rows.push(['RSI (14)', r.toFixed(0), r > 70 ? '과열' : r < 30 ? '과매도' : r >= 50 ? '매수세 우위' : '매도세 우위']);
    const st = stoch(h, l, c), sk = last(st.k), sd = last(st.d);
    if (sk != null) out.rows.push(['스토캐스틱 (14·3·3)', '%K ' + sk.toFixed(0) + ' / %D ' + (sd == null ? '—' : sd.toFixed(0)), sk > 80 ? '과열 구간' : sk < 20 ? '침체 구간' : sk > sd ? '%K가 %D 위 (단기 반등 쪽)' : '%K가 %D 아래 (단기 약세 쪽)']);
    const lv = levels(h, l, c, Math.max(0, n - 250), to);
    const sup = lv.filter((x) => x.kind === 'support')[0], res = lv.filter((x) => x.kind === 'resistance')[0];
    out.rows.push(['가까운 지지선', sup ? opt.fmt(sup.px) : '—', sup ? Math.abs((sup.px / p - 1) * 100).toFixed(1) + '% 아래 · ' + sup.touches + '번 닿음' : '1년 안에 뚜렷한 지지 없음']);
    out.rows.push(['가까운 저항선', res ? opt.fmt(res.px) : '—', res ? Math.abs((res.px / p - 1) * 100).toFixed(1) + '% 위 · ' + res.touches + '번 닿음' : '1년 최고가 위 — 저항 없음(신고가 구간)']);
    const f = fib(h, l, Math.max(0, n - 250), to);
    const near = f.levels.slice().sort((x, y) => Math.abs(x.px - p) - Math.abs(y.px - p))[0];
    out.rows.push(['피보나치 (1년 고저)', (near.r * 100).toFixed(1) + '% 선 근처', (f.up ? '상승 뒤 되돌림' : '하락 뒤 반등') + ' 기준 · ' + opt.fmt(near.px)]);
    const cn = cone(c, 60);
    if (cn) {
      const d1 = opt.barsPerMonth || 21, d3 = d1 * 3;
      const rng = (t, z) => opt.fmt(cn.at(t, -z)) + ' ~ ' + opt.fmt(cn.at(t, z));
      out.rows.push(['1달 뒤 예상 범위', '68%: ' + rng(d1, 1), '95%: ' + rng(d1, 1.96)]);
      out.rows.push(['3달 뒤 예상 범위', '68%: ' + rng(d3, 1), '95%: ' + rng(d3, 1.96)]);
      out.vol = cn.sigma * Math.sqrt(perYear) * 100;
    }
    // 종합 문장
    const bull = [rg && rg.r2 >= 0.2 && out.trend.yr > 0, last(m.macd) > last(m.signal), r >= 50, p > mid].filter(Boolean).length;
    out.verdict = bull >= 3 ? '상승 쪽 신호가 많습니다' : bull <= 1 ? '하락 쪽 신호가 많습니다' : '신호가 엇갈립니다';
    out.bullets.push('추세·MACD·RSI·볼린저 중간선 4가지 가운데 ' + bull + '가지가 상승 쪽 — ' + out.verdict + '.');
    if (sup && res) out.bullets.push('지금은 지지 ' + opt.fmt(sup.px) + '와 저항 ' + opt.fmt(res.px) + ' 사이. 저항을 넘으면 다음 구간이 열리고, 지지가 깨지면 추가 하락을 조심할 자리입니다.');
    if (out.vol != null) out.bullets.push('최근 변동성(연율) ' + out.vol.toFixed(0) + '% 기준으로, 1달 뒤 가격은 68% 확률로 위 범위 안에 있었던 것이 통계적 평균입니다. 방향을 맞히는 예측이 아닙니다.');
    return out;
  }

  const TA = { sma, ema, bb, rsi, macd, stoch, pivots, trendlines, levels, regression, cone, fib, analyze };
  if (typeof module !== 'undefined' && module.exports) module.exports = TA;
  else root.TA = TA;
})(typeof window !== 'undefined' ? window : globalThis);
