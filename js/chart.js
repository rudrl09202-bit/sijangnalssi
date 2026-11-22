/*
 * 시장날씨 — 가격 차트 (증권 앱식 캔들 + 이동평균 + 거래량 + 짚어 보기)
 * 외부 라이브러리 없이 SVG로 그립니다. PriceChart.html(데이터, 옵션) → 문자열
 * 데이터: { t[날짜], o[], h[], l[], c[], v[] }  (시가가 없으면 선 차트)
 * 옵션: { range: 봉 수, fmt, afmt, vfmt, lines: [{ px, label, stop }],
 *         ta: { trend, sr, bb, fib, reg, cone, sub: 'vol'|'rsi'|'macd'|'stoch' } }  (계산은 js/ta.js)
 */
(function (root) {
  const H = 372, L = 6, R = 66, PT = 10, PB = 250, VT = 266, VB = 334;
  // 화면 폭에 맞춰 그려서 글자가 작아지지 않게 (휴대폰 ~330, PC 최대 720)
  const width = () => Math.round(Math.min(720, Math.max(300, ((typeof window !== 'undefined' && window.innerWidth) || 720) - 72)));
  const DATA = {};
  let seq = 0;

  function sma(c, n, i) { if (i < n - 1) return null; let s = 0; for (let k = i - n + 1; k <= i; k++) s += c[k]; return s / n; }
  function niceTicks(lo, hi, n) {
    const span = hi - lo || Math.abs(hi) || 1, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
    const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(v);
    return out;
  }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  function html(k, opt) {
    opt = opt || {};
    const W = width();
    const fmt = opt.fmt || ((v) => v.toLocaleString('ko-KR', { maximumFractionDigits: 2 }));
    const af = opt.afmt || fmt; // 축·꼬리표용 짧은 표기
    const n = k.c.length, N = Math.min(opt.range || 130, n), s = n - N;
    if (N < 2) return '<p class="muted sm">차트를 그릴 가격 기록이 부족합니다.</p>';
    const hasO = k.o && k.o.length === n && k.h && k.l;
    const idx = Array.from({ length: N }, (_, i) => s + i);
    const ta = opt.ta || {}, TA = root.TA;
    const F = TA && (ta.cone || ta.reg || ta.trend) ? Math.max(4, Math.round(N * 0.18)) : 0; // 오른쪽 미래 영역(봉 수)
    const hh = hasO ? k.h : k.c, ll = hasO ? k.l : k.c;
    const ov = {};
    if (TA) {
      if (ta.bb) ov.bb = TA.bb(k.c);
      if (ta.reg) ov.reg = TA.regression(k.c, s, n - 1);
      if (ta.trend) ov.tl = TA.trendlines(hh, ll, s, n - 1);
      if (ta.sr) ov.sr = TA.levels(hh, ll, k.c, s, n - 1);
      if (ta.fib) ov.fib = TA.fib(hh, ll, s, n - 1);
      if (ta.cone) ov.cone = TA.cone(k.c, Math.min(60, N));
    }
    const ma20 = idx.map((i) => sma(k.c, 20, i)), ma60 = idx.map((i) => sma(k.c, 60, i));
    let lo = Infinity, hi = -Infinity;
    idx.forEach((i) => { lo = Math.min(lo, hasO ? k.l[i] : k.c[i]); hi = Math.max(hi, hasO ? k.h[i] : k.c[i]); });
    (opt.lines || []).forEach((ln) => { if (ln.px > lo * 0.7 && ln.px < hi * 1.3) { lo = Math.min(lo, ln.px); hi = Math.max(hi, ln.px); } });
    const widen = (v) => { if (v != null && isFinite(v) && v > lo * 0.6 && v < hi * 1.6) { lo = Math.min(lo, v); hi = Math.max(hi, v); } };
    if (ov.bb) idx.forEach((i) => { widen(ov.bb.up[i]); widen(ov.bb.lo[i]); });
    if (ov.reg) { widen(ov.reg.at(s, 2)); widen(ov.reg.at(s, -2)); widen(ov.reg.at(n - 1 + F, 2)); widen(ov.reg.at(n - 1 + F, -2)); }
    if (ov.cone) { widen(ov.cone.at(F, 1.96)); widen(ov.cone.at(F, -1.96)); }
    const pad = (hi - lo) * 0.06 || hi * 0.01; lo -= pad; hi += pad;
    const pw = W - L - R, step = pw / (N + F), cw = Math.max(1, Math.min(14, step * 0.66));
    const X = (j) => L + step * (j + 0.5), Y = (v) => PT + (hi - v) / (hi - lo) * (PB - PT);
    const vmax = k.v ? Math.max.apply(null, idx.map((i) => k.v[i] || 0)) || 1 : 0;
    const up = (i) => (hasO ? k.c[i] >= k.o[i] : i === 0 || k.c[i] >= k.c[i - 1]);
    const id = 'pc' + (++seq);

    let g = '';
    const labels = []; // 글자 겹침을 피해 마지막에 한꺼번에 배치
    const lab = (col, x, y, anchor, cls, text) => labels.push({ col, x, y, anchor, cls, text });
    // 눈금
    niceTicks(lo, hi, 4).forEach((v) => { const y = Y(v).toFixed(1); g += `<line class="pc-grid" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text class="pc-ax" x="${W - R + 6}" y="${(+y + 4).toFixed(1)}">${esc(af(v))}</text>`; });
    (W < 520 ? [0, Math.floor(N / 2), N - 1] : [0, Math.floor(N / 3), Math.floor(2 * N / 3), N - 1]).forEach((j, q, arr) => { q = q === arr.length - 1 ? 3 : q; const t = k.t && k.t[s + j]; if (t) g += `<text class="pc-ax" x="${X(j).toFixed(1)}" y="${H - 6}" text-anchor="${q === 0 ? 'start' : q === 3 ? 'end' : 'middle'}">${esc(String(t).slice(2).replace(/-/g, '.'))}</text>`; });
    // 아래 칸: 거래대금 또는 보조지표
    const sub = TA && ta.sub && ta.sub !== 'vol' ? ta.sub : 'vol';
    let subLabel = '';
    if (sub !== 'vol') {
      const lineIn = (arr, lo2, hi2, cls) => { const pts = idx.map((i, j) => (arr[i] == null ? null : X(j).toFixed(1) + ',' + (VB - (arr[i] - lo2) / (hi2 - lo2) * (VB - VT)).toFixed(1))).filter(Boolean); return pts.length > 1 ? `<polyline class="${cls}" points="${pts.join(' ')}"/>` : ''; };
      const hline = (v, lo2, hi2, t) => { const y = (VB - (v - lo2) / (hi2 - lo2) * (VB - VT)).toFixed(1); return `<line class="pc-sub-ref" x1="${L}" x2="${X(N - 1) + step / 2}" y1="${y}" y2="${y}"/><text class="pc-ax" x="${W - R + 6}" y="${(+y + 4).toFixed(1)}">${t}</text>`; };
      g += `<rect class="pc-sub-bg" x="${L}" y="${VT}" width="${X(N - 1) + step / 2 - L}" height="${VB - VT}"/>`;
      if (sub === 'rsi') { const r = TA.rsi(k.c); g += hline(70, 0, 100, '70') + hline(30, 0, 100, '30') + lineIn(r, 0, 100, 'pc-sub1'); subLabel = 'RSI(14) ' + (r[n - 1] == null ? '' : r[n - 1].toFixed(0)); }
      if (sub === 'stoch') { const st = TA.stoch(hh, ll, k.c); g += hline(80, 0, 100, '80') + hline(20, 0, 100, '20') + lineIn(st.k, 0, 100, 'pc-sub1') + lineIn(st.d, 0, 100, 'pc-sub2'); subLabel = '스토캐스틱 %K ' + (st.k[n - 1] == null ? '' : st.k[n - 1].toFixed(0)) + ' %D ' + (st.d[n - 1] == null ? '' : st.d[n - 1].toFixed(0)); }
      if (sub === 'macd') {
        const md = TA.macd(k.c); let a = 0; idx.forEach((i) => { [md.macd[i], md.signal[i], md.hist[i]].forEach((v) => { if (v != null) a = Math.max(a, Math.abs(v)); }); }); a = a || 1;
        const zy = (VB + VT) / 2;
        idx.forEach((i, j) => { const v = md.hist[i]; if (v == null) return; const hgt = v / a * (VB - VT) / 2; g += `<rect class="pc-vol ${v >= 0 ? 'u' : 'd'}" x="${(X(j) - cw / 2).toFixed(1)}" y="${(hgt >= 0 ? zy - hgt : zy).toFixed(1)}" width="${cw.toFixed(1)}" height="${Math.max(0.5, Math.abs(hgt)).toFixed(1)}"/>`; });
        g += hline(0, -a, a, '0') + lineIn(md.macd, -a, a, 'pc-sub1') + lineIn(md.signal, -a, a, 'pc-sub2');
        const nfm = (v) => (v == null ? '' : Math.abs(v) >= 100 ? Math.round(v).toLocaleString('ko-KR') : v.toFixed(Math.abs(v) >= 1 ? 2 : 4));
        subLabel = 'MACD ' + nfm(md.macd[n - 1]) + ' / 시그널 ' + nfm(md.signal[n - 1]);
      }
      g += `<text class="pc-sub-t" x="${L + 4}" y="${VT + 12}">${esc(subLabel)}</text>`;
    } else if (vmax) idx.forEach((i, j) => { const hgt = (k.v[i] || 0) / vmax * (VB - VT); g += `<rect class="pc-vol ${up(i) ? 'u' : 'd'}" x="${(X(j) - cw / 2).toFixed(1)}" y="${(VB - hgt).toFixed(1)}" width="${cw.toFixed(1)}" height="${Math.max(0.5, hgt).toFixed(1)}"/>`; });
    // 미래 영역
    if (F) g += `<rect class="pc-future" x="${(X(N - 1) + step / 2).toFixed(1)}" y="${PT}" width="${(F * step).toFixed(1)}" height="${PB - PT}"/><text class="pc-future-t" x="${(X(N - 1) + step / 2 + 4).toFixed(1)}" y="${PT + 12}">앞으로</text>`;
    // 볼린저밴드 (채운 띠 + 선)
    if (ov.bb) {
      const upP = idx.map((i, j) => (ov.bb.up[i] == null ? null : [X(j), Y(ov.bb.up[i])])).filter(Boolean), loP = idx.map((i, j) => (ov.bb.lo[i] == null ? null : [X(j), Y(ov.bb.lo[i])])).filter(Boolean);
      if (upP.length > 1) { g += `<polygon class="pc-bb-fill" points="${upP.concat(loP.slice().reverse()).map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}"/>`; g += `<polyline class="pc-bb" points="${upP.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}"/><polyline class="pc-bb" points="${loP.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}"/>`; }
    }
    // 가격
    if (hasO) {
      idx.forEach((i, j) => {
        const x = X(j).toFixed(1), u = up(i), yo = Y(k.o[i]), yc = Y(k.c[i]);
        g += `<line class="pc-wick ${u ? 'u' : 'd'}" x1="${x}" x2="${x}" y1="${Y(k.h[i]).toFixed(1)}" y2="${Y(k.l[i]).toFixed(1)}"/>`;
        g += `<rect class="pc-body ${u ? 'u' : 'd'}" x="${(X(j) - cw / 2).toFixed(1)}" y="${Math.min(yo, yc).toFixed(1)}" width="${cw.toFixed(1)}" height="${Math.max(1, Math.abs(yc - yo)).toFixed(1)}"/>`;
      });
    } else {
      const pts = idx.map((i, j) => X(j).toFixed(1) + ',' + Y(k.c[i]).toFixed(1)).join(' ');
      g += `<polygon class="pc-area" points="${X(0).toFixed(1)},${PB} ${pts} ${X(N - 1).toFixed(1)},${PB}"/><polyline class="pc-line" points="${pts}"/>`;
    }
    const path = (arr, cls) => { const p = arr.map((v, j) => (v == null ? null : X(j).toFixed(1) + ',' + Y(v).toFixed(1))).filter(Boolean); return p.length > 1 ? `<polyline class="${cls}" points="${p.join(' ')}"/>` : ''; };
    g += path(ma20, 'pc-ma20') + path(ma60, 'pc-ma60');
    const clipY = (y) => Math.max(PT, Math.min(PB, y));
    const seg2 = (x1, y1, x2, y2, cls) => `<line class="${cls}" x1="${x1.toFixed(1)}" y1="${clipY(y1).toFixed(1)}" x2="${x2.toFixed(1)}" y2="${clipY(y2).toFixed(1)}"/>`;
    const XE = X(N - 1 + F); // 오른쪽 끝(미래 포함)
    // 선형회귀 채널
    if (ov.reg) [[0, 'pc-reg'], [2, 'pc-reg2'], [-2, 'pc-reg2']].forEach(([z, cls]) => { g += seg2(X(0), Y(ov.reg.at(s, z)), XE, Y(ov.reg.at(n - 1 + F, z)), cls); });
    // 피보나치
    if (ov.fib) ov.fib.levels.forEach((lv) => { const y = Y(lv.px); if (y < PT || y > PB) return; g += `<line class="pc-fib" x1="${L}" x2="${X(N - 1)}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`; lab('fib', L + (X(N - 1) - L) * 0.42, y - 3, 'start', 'pc-fib-t', (lv.r * 100).toFixed(1) + '%'); });
    // 수평 지지·저항
    if (ov.sr) ov.sr.forEach((lv) => { const y = Y(lv.px); if (y < PT || y > PB) return; const cls = lv.kind === 'support' ? 'sup' : 'res'; g += `<rect class="pc-sr ${cls}" x="${L}" y="${(y - 1.5).toFixed(1)}" width="${(XE - L).toFixed(1)}" height="3"/>`; lab('right', X(N - 1) - 2, lv.kind === 'support' ? y + 13 : y - 5, 'end', 'pc-sr-t ' + cls, (lv.kind === 'support' ? '지지 ' : '저항 ') + af(lv.px)); });
    // 자동 추세선 (두 전환점을 잇고 미래까지 연장)
    if (ov.tl) [ov.tl.sup, ov.tl.res].forEach((t) => { if (!t) return; const x1 = X(t.i1 - s), x2 = XE; g += seg2(x1, Y(t.v1), x2, Y(t.at(n - 1 + F)), 'pc-tl ' + (t.kind === 'support' ? 'sup' : 'res')); g += `<circle class="pc-pv" cx="${X(t.i1 - s).toFixed(1)}" cy="${Y(t.v1).toFixed(1)}" r="3"/><circle class="pc-pv" cx="${X(t.i2 - s).toFixed(1)}" cy="${Y(t.v2).toFixed(1)}" r="3"/>`; });
    // 통계적 예상 범위 (68%·95% 원뿔)
    if (ov.cone) {
      const x0 = X(N - 1), band = (z) => { const top = [], bot = []; for (let t = 0; t <= F; t++) { top.push((x0 + t * step).toFixed(1) + ',' + Y(ov.cone.at(t, z)).toFixed(1)); bot.push((x0 + t * step).toFixed(1) + ',' + Y(ov.cone.at(t, -z)).toFixed(1)); } return top.concat(bot.reverse()).join(' '); };
      g += `<polygon class="pc-cone95" points="${band(1.96)}"/><polygon class="pc-cone68" points="${band(1)}"/>`;
      const xe = x0 + F * step;
      [[1.96, '95%'], [1, '68%'], [-1, ''], [-1.96, '']].forEach(([z, t]) => { const v = ov.cone.at(F, z); lab('right', xe - 2, Y(v) + (z > 0 ? -3 : 11), 'end', 'pc-cone-t', (t ? t + ' ' : '') + af(v)); });
    }
    // 계획선
    let lastLabelY = -99;
    (opt.lines || []).filter((ln) => ln.px >= lo && ln.px <= hi).sort((a, b) => b.px - a.px).forEach((ln) => {
      const y = Y(ln.px); let ty = y - 4; if (ty - lastLabelY < 14) ty = lastLabelY + 14; lastLabelY = ty; // 가까운 이름표는 아래로 비켜 쓰기
      g += `<line class="pc-plan ${ln.stop ? 'stop' : ''}" x1="${L}" x2="${W - R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`; lab('plan', L + 4, ty, 'start', 'pc-plan-t' + (ln.stop ? ' stop' : ''), ln.label + ' ' + af(ln.px));
    });
    // 이름표 배치: 같은 칸끼리 위아래 13px 이상 띄우기
    ['plan', 'fib', 'right'].forEach((col) => {
      const ls = labels.filter((x) => x.col === col).sort((a, b) => a.y - b.y);
      for (let i = 1; i < ls.length; i++) if (ls[i].y - ls[i - 1].y < 13) ls[i].y = ls[i - 1].y + 13;
      const over = ls.length ? ls[ls.length - 1].y - (PB - 2) : 0; if (over > 0) ls.forEach((x) => { x.y -= over; });
      ls.forEach((x) => { x.y = Math.max(PT + 9, x.y); g += `<text class="${x.cls}" x="${x.x.toFixed(1)}" y="${x.y.toFixed(1)}" text-anchor="${x.anchor}">${esc(x.text)}</text>`; });
    });
    // 현재가 꼬리표
    const last = k.c[n - 1], yl = Y(last).toFixed(1), lu = up(n - 1);
    g += `<line class="pc-last" x1="${L}" x2="${W - R}" y1="${yl}" y2="${yl}"/><rect class="pc-tag ${lu ? 'u' : 'd'}" x="${W - R + 1}" y="${(+yl - 10).toFixed(1)}" width="${R - 2}" height="20" rx="3"/><text class="pc-tag-t" x="${W - R + 5}" y="${(+yl + 4).toFixed(1)}">${esc(af(last))}</text>`;
    // 짚어 보기 요소
    g += `<g class="pc-x" visibility="hidden"><line class="pc-cross" data-r="v" y1="${PT}" y2="${VB}"/><line class="pc-cross" data-r="h" x1="${L}" x2="${W - R}"/><circle class="pc-dot" r="4"/></g>`;
    g += `<rect class="pc-hit" x="${L}" y="0" width="${(step * N).toFixed(1)}" height="${VB}" fill="transparent"/>`;

    DATA[id] = { k, s, N, step, hi, lo, fmt, vfmt: opt.vfmt, hasO, W };
    const ml = opt.maLabels || ['20일선', '60일선'];
    const leg = `<span><i class="lg20"></i>${ml[0]}</span><span><i class="lg60"></i>${ml[1]}</span>${sub === 'vol' && vmax ? '<span><i class="lgv"></i>거래대금</span>' : ''}${ov.bb ? '<span><i class="lgbb"></i>볼린저</span>' : ''}${ov.reg ? '<span><i class="lgreg"></i>회귀 채널</span>' : ''}${ov.tl ? '<span><i class="lgtl"></i>추세선</span>' : ''}${ov.sr ? '<span><i class="lgsr"></i>지지·저항</span>' : ''}${ov.fib ? '<span><i class="lgfib"></i>피보나치</span>' : ''}${ov.cone ? '<span><i class="lgcone"></i>예상 범위 68·95%</span>' : ''}${(opt.lines || []).length ? '<span><i class="lgp"></i>분할 계획</span>' : ''}`;
    return `<div class="pc" data-pc="${id}"><div class="pc-tip" aria-live="off">${tipHtml(id, n - 1)}</div>
      <svg class="pc-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="가격 차트, 최근 ${N}개 봉">${g}</svg>
      <div class="pc-legend">${leg}</div></div>`;
  }

  function tipHtml(id, i) {
    const d = DATA[id]; if (!d) return '';
    const k = d.k, f = d.fmt, prev = i > 0 ? k.c[i - 1] : null, chg = prev ? (k.c[i] / prev - 1) * 100 : null;
    const cls = chg == null ? '' : chg > 0 ? 'up' : chg < 0 ? 'down' : '';
    return `<span class="muted">${esc(k.t ? k.t[i] : '')}</span>` +
      (d.hasO ? ` 시 <b>${esc(f(k.o[i]))}</b> 고 <b>${esc(f(k.h[i]))}</b> 저 <b>${esc(f(k.l[i]))}</b>` : '') +
      ` 종 <b>${esc(f(k.c[i]))}</b>` + (chg == null ? '' : ` <b class="${cls}">${chg > 0 ? '+' : ''}${chg.toFixed(2)}%</b>`) +
      (k.v && d.vfmt && k.v[i] ? ` <span class="muted">· ${esc(d.vfmt(k.v[i]))}</span>` : '');
  }

  function move(e) {
    const svg = e.target.closest && e.target.closest('.pc-svg'); if (!svg) return;
    const box = svg.closest('.pc'), d = DATA[box.dataset.pc]; if (!d) return;
    const pt = e.touches ? e.touches[0] : e, r = svg.getBoundingClientRect();
    const x = (pt.clientX - r.left) / r.width * d.W;
    const j = Math.max(0, Math.min(d.N - 1, Math.floor((x - L) / d.step)));
    const i = d.s + j, cx = L + d.step * (j + 0.5), cy = PT + (d.hi - d.k.c[i]) / (d.hi - d.lo) * (PB - PT);
    const gx = svg.querySelector('.pc-x'); gx.setAttribute('visibility', 'visible');
    const v = gx.querySelector('[data-r=v]'); v.setAttribute('x1', cx); v.setAttribute('x2', cx);
    const h = gx.querySelector('[data-r=h]'); h.setAttribute('y1', cy); h.setAttribute('y2', cy);
    const dot = gx.querySelector('.pc-dot'); dot.setAttribute('cx', cx); dot.setAttribute('cy', cy);
    box.querySelector('.pc-tip').innerHTML = tipHtml(box.dataset.pc, i);
    if (e.touches && e.cancelable) e.preventDefault();
  }
  function leave(e) {
    const box = e.target.closest && e.target.closest('.pc'); if (!box) return;
    const d = DATA[box.dataset.pc]; if (!d) return;
    const gx = box.querySelector('.pc-x'); if (gx) gx.setAttribute('visibility', 'hidden');
    box.querySelector('.pc-tip').innerHTML = tipHtml(box.dataset.pc, d.k.c.length - 1);
  }
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('mousemove', move);
    document.addEventListener('touchstart', move, { passive: false });
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('mouseout', (e) => { if (e.target.classList && e.target.classList.contains('pc-hit')) leave(e); });
    document.addEventListener('touchend', leave);
  }

  // 일봉 → 주봉('W')·월봉('M'). 날짜는 그 묶음의 마지막 거래일
  function aggregate(k, mode) {
    const out = { t: [], o: [], h: [], l: [], c: [], v: k.v ? [] : undefined, cur: k.cur };
    const keyOf = (t) => { if (mode === 'M') return String(t).slice(0, 7); const d = new Date(t + 'T00:00:00Z'); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day); return d.toISOString().slice(0, 10); };
    let cur = null;
    for (let i = 0; i < k.c.length; i++) {
      if (k.c[i] == null) continue;
      const key = keyOf(k.t[i]), o = k.o && k.o[i] != null ? k.o[i] : k.c[i], h = k.h && k.h[i] != null ? k.h[i] : k.c[i], l = k.l && k.l[i] != null ? k.l[i] : k.c[i];
      if (key !== cur) { cur = key; out.t.push(k.t[i]); out.o.push(o); out.h.push(h); out.l.push(l); out.c.push(k.c[i]); if (out.v) out.v.push(k.v[i] || 0); }
      else { const j = out.c.length - 1; out.t[j] = k.t[i]; out.h[j] = Math.max(out.h[j], h); out.l[j] = Math.min(out.l[j], l); out.c[j] = k.c[i]; if (out.v) out.v[j] += k.v[i] || 0; }
    }
    return out;
  }

  const PriceChart = { html, aggregate };
  if (typeof module !== 'undefined' && module.exports) module.exports = PriceChart;
  else root.PriceChart = PriceChart;
})(typeof window !== 'undefined' ? window : globalThis);
