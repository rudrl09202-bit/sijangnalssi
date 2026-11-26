/* 머니 글로브 — "세계 경제 신호" 화면의 3D 지구본 (보여 주기용)
 *  통화 20개의 달러 대비 20거래일 변화로 나라를 칠함: +2% 이상 약세 = 주황, 나머지 추적 나라 = 연한 색, 추적 안 함 = 바탕색
 *  라이브러리는 이 화면을 처음 열 때만 jsDelivr 에서 받음 (globe.gl 2.46.2 · topojson-client 3.1.0 · world-atlas 2.0.2)
 *  세계 경제 신호 A~D 중 켜진 것은 해당 지역(미국·중국)에 주황 물결과 이름표로 표시 — 봇이 새 롱을 쉬는 이유
 *  render() 가 화면을 다시 그려도 지구본은 한 번만 만들고 자리만 옮김 (attach)
 */
(function () {
  'use strict';
  const LIBS = ['https://cdn.jsdelivr.net/npm/globe.gl@2.46.2/dist/globe.gl.min.js', 'https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js'];
  const ATLAS = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json';
  // ISO 숫자 코드 → 두 글자 코드 (한국어 이름은 Intl.DisplayNames)
  const NUM = Object.fromEntries('4:AF,8:AL,12:DZ,16:AS,20:AD,24:AO,660:AI,10:AQ,28:AG,32:AR,51:AM,533:AW,36:AU,40:AT,31:AZ,44:BS,48:BH,50:BD,52:BB,112:BY,56:BE,84:BZ,204:BJ,60:BM,64:BT,68:BO,70:BA,72:BW,74:BV,76:BR,86:IO,96:BN,100:BG,854:BF,108:BI,116:KH,120:CM,124:CA,132:CV,136:KY,140:CF,148:TD,152:CL,156:CN,162:CX,166:CC,170:CO,174:KM,178:CG,180:CD,184:CK,188:CR,384:CI,191:HR,192:CU,196:CY,203:CZ,208:DK,262:DJ,212:DM,214:DO,218:EC,818:EG,222:SV,226:GQ,232:ER,233:EE,231:ET,238:FK,234:FO,242:FJ,246:FI,250:FR,254:GF,258:PF,260:TF,266:GA,270:GM,268:GE,276:DE,288:GH,292:GI,300:GR,304:GL,308:GD,312:GP,316:GU,320:GT,324:GN,624:GW,328:GY,332:HT,334:HM,336:VA,340:HN,344:HK,348:HU,352:IS,356:IN,360:ID,364:IR,368:IQ,372:IE,376:IL,380:IT,388:JM,392:JP,400:JO,398:KZ,404:KE,296:KI,408:KP,410:KR,414:KW,417:KG,418:LA,428:LV,422:LB,426:LS,430:LR,434:LY,438:LI,440:LT,442:LU,446:MO,450:MG,454:MW,458:MY,462:MV,466:ML,470:MT,584:MH,474:MQ,478:MR,480:MU,175:YT,484:MX,583:FM,498:MD,492:MC,496:MN,500:MS,504:MA,508:MZ,104:MM,516:NA,520:NR,524:NP,528:NL,540:NC,554:NZ,558:NI,562:NE,566:NG,570:NU,574:NF,580:MP,807:MK,578:NO,512:OM,586:PK,585:PW,275:PS,591:PA,598:PG,600:PY,604:PE,608:PH,612:PN,616:PL,620:PT,630:PR,634:QA,638:RE,642:RO,643:RU,646:RW,654:SH,659:KN,662:LC,666:PM,670:VC,882:WS,674:SM,678:ST,682:SA,686:SN,690:SC,694:SL,702:SG,703:SK,705:SI,90:SB,706:SO,710:ZA,239:GS,724:ES,144:LK,729:SD,740:SR,744:SJ,748:SZ,752:SE,756:CH,760:SY,158:TW,762:TJ,834:TZ,764:TH,626:TL,768:TG,772:TK,776:TO,780:TT,788:TN,792:TR,795:TM,796:TC,798:TV,800:UG,804:UA,784:AE,826:GB,840:US,581:UM,858:UY,860:UZ,548:VU,862:VE,704:VN,92:VG,850:VI,876:WF,732:EH,887:YE,894:ZM,716:ZW,248:AX,535:BQ,531:CW,831:GG,833:IM,832:JE,499:ME,652:BL,663:MF,688:RS,534:SX,728:SS,983:XK'.split(',').map((x) => x.split(':')).map(([n, a]) => [+n, a]));
  let host = null, globe = null, sigs = [], sigKey = '', aimed = false, loading = null, feats = null, fxBy = {}, onPick = null, picked = null, hover = null, failed = false;
  const koName = (() => { try { const dn = new Intl.DisplayNames(['ko'], { type: 'region' }); return (a, en) => (a ? dn.of(a) : en); } catch (e) { return (a, en) => en; } })();
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const alpha = (hex, a) => { const h = hex.replace('#', ''); if (h.length !== 6) return hex; return 'rgba(' + [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(',') + ',' + a + ')'; };
  const script = (src) => new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.async = true; s.onload = ok; s.onerror = () => no(new Error(src)); document.head.appendChild(s); });
  function load() {
    if (!loading) loading = Promise.all(LIBS.map(script)).then(() => fetch(ATLAS)).then((r) => r.json()).then((w) => {
      feats = window.topojson.feature(w, w.objects.countries).features.filter((f) => f.properties.name !== 'Antarctica').map((f) => { const a = NUM[+f.id] || null; f.properties.iso = a; f.properties.ko = koName(a, f.properties.name); return f; });
    });
    return loading;
  }
  function colors() {
    const dark = document.documentElement.dataset.theme === 'dark';
    return { warn: alpha(css('--warn') || '#E08A00', 0.9), tracked: alpha(css('--ink2') || '#333D4B', dark ? 0.55 : 0.6), base: alpha(css('--muted') || '#8B95A1', dark ? 0.22 : 0.2),
      pick: alpha(css('--accent') || '#3182F6', 0.9), side: alpha(css('--line2') || '#E5E8EB', 0.6), stroke: alpha(css('--card') || '#FFFFFF', dark ? 0.35 : 0.8), globe: css('--sunk') || '#F2F4F6', atmo: css('--accent') || '#3182F6' };
  }
  function cap(f) { const C = colors(), x = fxBy[f.properties.iso]; if (f === picked || f === hover) return C.pick; return x ? (x.weak ? C.warn : C.tracked) : C.base; }
  function badge(d) { const el = document.createElement('div'); el.className = 'glb-badge'; el.innerHTML = '<b>' + d.place + '</b>' + d.items.map((x) => '<span>' + x + '</span>').join(''); return el; }
  function drawSignals() {
    if (!globe) return; const k = JSON.stringify(sigs); if (k === sigKey) return; sigKey = k; const C = colors();
    globe.ringsData(sigs).ringColor(() => (t) => alpha(css('--warn') || '#E08A00', Math.max(0, 1 - t))).ringMaxRadius(7).ringPropagationSpeed(2.5).ringRepeatPeriod(1400)
      .htmlElementsData(sigs).htmlElement(badge).htmlAltitude(0.04);
    if (sigs.length && !aimed) { aimed = true; globe.pointOfView({ lat: sigs[0].lat, lng: sigs[0].lng, altitude: 1.9 }, 0); }
  }
  function repaint() { if (!globe) return; const C = colors(); globe.polygonCapColor(cap).polygonSideColor(() => C.side).polygonStrokeColor(() => C.stroke).polygonAltitude((f) => (f === picked ? 0.03 : f === hover ? 0.018 : 0.008)); const m = globe.globeMaterial(); m.color.set(C.globe); globe.atmosphereColor(C.atmo); }
  function label(f) { const x = fxBy[f.properties.iso]; const t = x ? (x.chg > 0 ? '+' : '') + x.chg.toFixed(2) + '% (20일)' + (x.weak ? ' · 약세' : '') : '추적 안 함'; return '<div class="glb-tip"><b>' + f.properties.ko + '</b><br>' + t + '</div>'; }
  function build() {
    host = document.createElement('div'); host.className = 'glb-host';
    globe = window.Globe()(host).backgroundColor('rgba(0,0,0,0)').showAtmosphere(true).atmosphereAltitude(0.12)
      .polygonsData(feats).polygonLabel(label).polygonsTransitionDuration(150)
      .onPolygonHover((f) => { hover = f; host.style.cursor = f ? 'pointer' : 'grab'; repaint(); })
      .onPolygonClick((f) => { picked = f; repaint(); if (onPick) onPick(f.properties.iso, f.properties.ko); })
      .onGlobeClick(() => { picked = null; repaint(); if (onPick) onPick(null); });
    globe.controls().autoRotate = true; globe.controls().autoRotateSpeed = 0.3; globe.controls().enableZoom = true;
    host.addEventListener('pointerdown', () => { globe.controls().autoRotate = false; }, { once: true });
    globe.pointOfView({ lat: 30, lng: 60, altitude: 1.9 });
    repaint();
  }
  function size(slot) { if (globe && slot) globe.width(slot.clientWidth).height(slot.clientHeight); }
  // slot: 지구본이 들어갈 자리 · fx: macro-live.json 의 fx · pick: 나라를 눌렀을 때 (iso, 이름)
  // signals: [{ place, lat, lng, items:[켜진 신호 이름] }] — 켜진 것만
  function attach(slot, fx, pick, signals) {
    if (!slot) return; onPick = pick || null; sigs = signals || [];
    fxBy = {}; ((fx && fx.rows) || []).forEach((r) => { fxBy[r.iso] = r; });
    if (failed) { slot.innerHTML = '<p class="muted xs glb-msg">지구본을 불러오지 못했어요. 아래 목록은 그대로 볼 수 있어요.</p>'; return; }
    if (!globe) { slot.innerHTML = '<p class="muted xs glb-msg">지구본 불러오는 중…</p>';
      load().then(() => { if (!globe) build(); const s = document.getElementById(slot.id); if (s) { s.innerHTML = ''; s.appendChild(host); size(s); repaint(); drawSignals(); } }).catch(() => { failed = true; const s = document.getElementById(slot.id); if (s) attach(s, fx, pick); });
      return; }
    slot.innerHTML = ''; slot.appendChild(host); size(slot); repaint(); drawSignals();
  }
  window.addEventListener('resize', () => { if (host && host.parentNode) size(host.parentNode); });
  window.SNWGlobe = { attach, repaint, pov: (o) => globe && globe.pointOfView(o), fly: (lat, lng) => globe && globe.pointOfView({ lat, lng, altitude: 2 }, 700) };
})();
