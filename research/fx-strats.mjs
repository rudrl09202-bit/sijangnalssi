// 환차익 모의투자 후보 전략 10년 시험 — 전략·비용·합격 기준은 결과 보기 전에 고정 (2026-11-26)
//  자료: 야후 일봉 20개 통화(connect/fxbreadth.mjs 의 FX, 달러 대비) 2016-11 ~ 2026-11 (research/fx-hist.mjs 로 받음)
//  공통: 신호는 그날 종가로 계산 → 다음 날 종가부터 수익 반영 (미래 엿보기 없음). 거래 비용 = 바꾼 비중 × 0.10% (환전 스프레드)
//        이자 차이(캐리)는 자료가 없어 넣지 않음 — 수익은 환율 변화만. 앞 70% = 표본 안, 뒤 30% = 표본 밖
//  S1 통화 추세 (시계열 모멘텀): 매달 첫 거래일, 20개 통화 각각 지난 12개월 동안 달러 대비 올랐으면 그 통화 매수(달러 매도),
//     내렸으면 매도(달러 매수). 각 통화 비중 = (연 10% / 그 통화 60일 변동성) ÷ 20, 합계 최대 2배
//  S2 원화 투자자의 달러 바꾸기: 원/달러가 200일 평균 위면 달러 100% 보유, 아래면 원화(현금) — 달러로 버는 환차익만
//     비교: 원화만(0%) · 달러만 계속 보유
//  합격: 비용 뺀 샤프가 표본 안·밖 모두 0.5 이상 + 무작위(S1: 매달 통화별 방향 무작위 / S2: 같은 보유 일수 비율로 무작위 구간) 200번 중
//        실제 이상이 10% 이하. 합격한 것만 모의투자에 올림
// 사용: MH=/tmp/mh node research/fx-strats.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { FX } from '../connect/fxbreadth.mjs';
const MH = process.env.MH || '/tmp/mh', COST = 0.001;
const load = (k) => { let d; const ctx = { window: { SNW_HIST: (n, x) => { d = x; } } }; vm.runInNewContext(readFileSync(`${MH}/m_${k}.js`, 'utf8'), ctx); return d; };
// 날짜 맞추기: 원/달러 날짜를 기준 달력으로, 각 통화는 그날 이전 마지막 값
const base = load('fx_krw'), CAL = base.t, N = CAL.length;
const S = FX.map((f) => { const d = load('fx_' + f.id), m = new Map(d.t.map((t, i) => [t, d.c[i]])); let last = null; return { id: f.id, ko: f.ko, px: CAL.map((t) => { const v = m.get(t); if (v > 0) last = v; return last; }) }; });
// 통화 가치 수익(달러 대비): 1달러당 통화 수가 줄면 통화가 오른 것
const ret = (px, i) => (px[i] && px[i - 1] ? px[i - 1] / px[i] - 1 : 0);
const vol60 = (px, i) => { let s = 0, s2 = 0, n = 0; for (let k = i - 59; k <= i; k++) { if (k < 1) continue; const r = ret(px, k); s += r; s2 += r * r; n++; } if (n < 40) return null; const m = s / n; return Math.sqrt(Math.max(s2 / n - m * m, 1e-12)) * Math.sqrt(252); };
const monthStart = (i) => i > 0 && CAL[i].slice(0, 7) !== CAL[i - 1].slice(0, 7);
function stats(r, a, b) { const x = r.slice(a, b); let eq = 1, pk = 1, mdd = 0; for (const v of x) { eq *= 1 + v; pk = Math.max(pk, eq); mdd = Math.min(mdd, eq / pk - 1); } const m = x.reduce((p, q) => p + q, 0) / x.length, sd = Math.sqrt(x.reduce((p, q) => p + (q - m) ** 2, 0) / x.length), yrs = x.length / 252;
  return { cagr: +((Math.pow(eq, 1 / yrs) - 1) * 100).toFixed(1), mdd: +(mdd * 100).toFixed(1), sharpe: +(sd ? (m / sd) * Math.sqrt(252) : 0).toFixed(2) }; }
// S1
function runS1(dirFn) { const w = new Array(S.length).fill(0), out = new Array(N).fill(0); let start = null;
  for (let i = 1; i < N; i++) { let r = 0; S.forEach((s, j) => { r += w[j] * ret(s.px, i); }); out[i] = r;
    if (monthStart(i) && i >= 260) { if (start == null) start = i; let tot = 0; const nw = S.map((s, j) => { const v = vol60(s.px, i), p0 = s.px[i - 252], p1 = s.px[i]; if (!v || !p0 || !p1) return 0; const dir = dirFn(j, i, p0 / p1 - 1); return dir * (0.10 / v) / S.length; });
      tot = nw.reduce((p, q) => p + Math.abs(q), 0); const k = tot > 2 ? 2 / tot : 1; let turn = 0; nw.forEach((x, j) => { const y = x * k; turn += Math.abs(y - w[j]); w[j] = y; }); out[i] -= turn * COST; } }
  return { r: out, start }; }
// S2
const krw = S.find((s) => s.id === 'krw').px;
function runS2(holdFn) { const out = new Array(N).fill(0); let pos = 0, start = null, days = 0;
  for (let i = 1; i < N; i++) { out[i] = pos * (krw[i] / krw[i - 1] - 1); // 달러 보유 → 원/달러 오르면 이익
    if (i >= 200) { if (start == null) start = i; const np = holdFn(i) ? 1 : 0; if (np !== pos) { out[i] -= COST; pos = np; } if (pos) days++; } }
  return { r: out, start, days }; }
const ma200 = (i) => { let s = 0; for (let k = i - 199; k <= i; k++) s += krw[k]; return s / 200; };
const line = (name, r, st) => { const cut = st + Math.floor((N - st) * 0.7), A = stats(r, st, N), I = stats(r, st, cut), O = stats(r, cut, N); console.log(name.padEnd(26), '연', A.cagr + '%', '낙폭', A.mdd + '%', '샤프', A.sharpe, '| 표본 안', I.sharpe, '밖', O.sharpe); return { A, I, O, cut }; };
console.log('기간', CAL[0], '~', CAL[N - 1], '| 거래일', N, '| 통화', S.length);
let seed = 21; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const s1 = runS1((j, i, r12) => (r12 > 0 ? 1 : -1)), R1 = line('S1 통화 추세 (20개)', s1.r, s1.start);
let pass1 = R1.I.sharpe >= 0.5 && R1.O.sharpe >= 0.5, p1 = null;
if (pass1) { const res = []; for (let k = 0; k < 200; k++) { const x = runS1(() => (rnd() < 0.5 ? 1 : -1)); res.push(stats(x.r, s1.start, N).sharpe); } p1 = Math.round(res.filter((v) => v >= R1.A.sharpe).length / 2); pass1 = p1 <= 10; }
console.log('  → S1', pass1 ? '합격' : '불합격', p1 == null ? '(샤프 기준 미달)' : '| 무작위가 실제 이상 ' + p1 + '%');
const s2 = runS2((i) => krw[i] > ma200(i)), R2 = line('S2 원/달러 200일선 위면 달러', s2.r, s2.start);
const hold = runS2(() => true); line('  비교: 달러 계속 보유', hold.r, hold.start);
let pass2 = R2.I.sharpe >= 0.5 && R2.O.sharpe >= 0.5, p2 = null;
if (pass2) { const frac = s2.days / (N - s2.start), res = []; for (let k = 0; k < 200; k++) { let on = rnd() < frac; const x = runS2(() => { if (rnd() < 1 / 40) on = rnd() < frac; return on; }); res.push(stats(x.r, s2.start, N).sharpe); } p2 = Math.round(res.filter((v) => v >= R2.A.sharpe).length / 2); pass2 = p2 <= 10; }
console.log('  → S2', pass2 ? '합격' : '불합격', p2 == null ? '(샤프 기준 미달)' : '| 무작위가 실제 이상 ' + p2 + '%');

// ───────── 2차 (같은 날, 1차 진단 뒤 결과 보기 전에 고정) ─────────
//  1차 진단: S1 수익의 77%가 리라 매도(97% 기간)에서 나옴 — 실제로는 리라 매도에 연 10~50% 이자를 내야 하는데 1차는 이자를 뺐음.
//    리라만 빼도 샤프 0.79 → 0.19. 그래서 1차 S1 합격은 무효로 봄
//  2차: 금리 자료가 있는 11개 통화(원·엔·위안·멕시코·폴란드·헝가리·체코·이스라엘·칠레·남아공·인도네시아)만,
//       매일 수익에 이자 차이 = 비중 × (그 나라 3개월 금리 − 미국 3개월 금리) / 252 를 더함. 금리는 한 달 늦게 씀(발표 지연)
//  S1c 통화 추세 + 이자: 1차 S1 규칙 그대로 (11개, 비중 ÷ 11)
//  S3 캐리: 매달 첫 거래일, 금리 차이 상위 3개 매수 · 하위 3개 매도, 각 비중 = (연 10% / 60일 변동성) ÷ 6
//  합격 기준은 1차와 같음. 무작위: S1c 방향 무작위 / S3 매수·매도 3개씩 무작위
const RC = { krw: 'KR', jpy: 'JP', cny: 'CN', mxn: 'MX', pln: 'PL', huf: 'HU', czk: 'CZ', ils: 'IL', clp: 'CL', zar: 'ZA', idr: 'ID' };
const rate = (c) => { const rows = readFileSync(`${MH}/r_${c}.csv`, 'utf8').trim().split('\n').slice(1).map((l) => l.split(',')).filter((x) => x[1] && x[1] !== '.' && !isNaN(+x[1]));
  const m = rows.map(([d, v]) => [d.slice(0, 7), +v]); return CAL.map((t) => { const [y, mo] = t.slice(0, 7).split('-').map(Number), lag = new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 7); let v = null; for (const [k, x] of m) { if (k <= lag) v = x; else break; } return v; }); };
const RUS = rate('US'), S2c = S.filter((s) => RC[s.id]).map((s) => ({ ...s, r: rate(RC[s.id]) }));
const carry = (s, i) => (s.r[i] != null && RUS[i] != null ? (s.r[i] - RUS[i]) / 100 / 252 : 0);
function runC(pick) { const w = new Array(S2c.length).fill(0), out = new Array(N).fill(0); let st = null;
  for (let i = 1; i < N; i++) { S2c.forEach((s, j) => { out[i] += w[j] * (ret(s.px, i) + carry(s, i)); });
    if (monthStart(i) && i >= 260) { if (st == null) st = i; const dir = pick(i); let turn = 0; const nw = S2c.map((s, j) => { const v = vol60(s.px, i); return v && dir[j] ? dir[j] * (0.10 / v) / dir.den : 0; });
      const tot = nw.reduce((p, q) => p + Math.abs(q), 0), k = tot > 2 ? 2 / tot : 1; nw.forEach((x, j) => { turn += Math.abs(x * k - w[j]); w[j] = x * k; }); out[i] -= turn * COST; } }
  return { r: out, start: st }; }
const pickTrend = (rnd0) => (i) => { const d = S2c.map((s) => { const p0 = s.px[i - 252], p1 = s.px[i]; if (!p0 || !p1) return 0; return rnd0 ? (rnd() < 0.5 ? 1 : -1) : p0 / p1 - 1 > 0 ? 1 : -1; }); d.den = S2c.length; return d; };
const pickCarry = (rnd0) => (i) => { const ok = S2c.map((s, j) => [j, s.r[i] != null && RUS[i] != null ? s.r[i] - RUS[i] : null]).filter((x) => x[1] != null);
  const ord = rnd0 ? ok.map((x) => [x[0], rnd()]).sort((a, b) => b[1] - a[1]) : ok.sort((a, b) => b[1] - a[1]); const d = new Array(S2c.length).fill(0);
  if (ok.length >= 6) { ord.slice(0, 3).forEach(([j]) => { d[j] = 1; }); ord.slice(-3).forEach(([j]) => { d[j] = -1; }); } d.den = 6; return d; };
console.log('\n2차 (이자 차이 포함, 11개 통화)');
for (const [nm, label, pk] of [['S1c', 'S1c 통화 추세 + 이자', pickTrend], ['S3', 'S3 캐리 (상위3 매수·하위3 매도)', pickCarry]]) {
  const x = runC(pk(false)), R = line(label, x.r, x.start); let pass = R.I.sharpe >= 0.5 && R.O.sharpe >= 0.5, pp = null;
  if (pass) { const res = []; for (let k = 0; k < 200; k++) res.push(stats(runC(pk(true)).r, x.start, N).sharpe); pp = Math.round(res.filter((v) => v >= R.A.sharpe).length / 2); pass = pp <= 10; }
  console.log('  →', nm, pass ? '합격' : '불합격', pp == null ? '(샤프 기준 미달)' : '| 무작위가 실제 이상 ' + pp + '%'); }
