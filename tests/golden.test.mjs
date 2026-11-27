// 규칙 고정 검사: 정해진 가짜 시세로 봇을 돌린 결과(거래 수·최종 금액)를 tests/golden.json 과 비교
//  값이 달라졌다 = 봇의 매매 규칙(진입·청산·크기·손절·필터)이 바뀌었다는 뜻
//  모의 기록 기간(CLAUDE.md 1장)에는 규칙을 바꾸지 않음. 버그 수정처럼 정말 바꿔야 하면:
//   UPDATE_GOLDEN=1 node --test tests/golden.test.mjs 로 새 값을 저장하고, 커밋에 날짜·이유를 적고, connect/bots.json 의 그 봇 기록이 다시 시작됨을 알릴 것
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { coinSeries, world, REGIME, rng } from './helpers.mjs';
import { RCFG, prepareRS, simulate as simRS } from '../connect/rs.mjs';
import { PCFG, align, signals, simulate as simPair } from '../connect/pair.mjs';
import { riskAt } from '../connect/macro.mjs';
import { breadthAt, FX, FXCFG } from '../connect/fxbreadth.mjs';
import { targetWeights, FXC, CFG as FXCARRY } from '../connect/fxpaper.mjs';
import { judge as koreaJudge, KCFG } from '../connect/korea.mjs';
import { loadQuant } from '../connect/paper.mjs';
import { MG, WATCH } from '../connect/mg.mjs';
import { mkCfg } from '../connect/mk.mjs';
import { createHash } from 'node:crypto';
const FILE = new URL('./golden.json', import.meta.url), r0 = (x) => Math.round(x), r4 = (x) => +x.toFixed(4), DAY = 864e5;
function compute() {
  const G = {};
  // 류신영 봇 (규칙만, 학습 필터 없이): 4시간봉 5개 코인
  const SY = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE'], ser = Object.fromEntries(SY.map((s, i) => [s, coinSeries(21 + i)])), W = prepareRS(ser), rs = simRS(W, { ...RCFG }, null, {});
  G.rs = { cfg: RCFG, trades: rs.trades.length, longs: rs.trades.filter((z) => z.side === 'long').length, cash: r0(rs.cash), firstIn: rs.trades[0] && rs.trades[0].in, sumR: r4(rs.trades.reduce((a, z) => a + z.R, 0)) };
  // 상대 모멘텀 (ETH/BTC)
  const D = align(ser.ETH, ser.BTC), Z = signals(D, PCFG), pr = simPair(D, Z, PCFG, null, {});
  G.pair = { cfg: PCFG, trades: pr.trades.length, last: r0((pr.equity.at(-1) || [0, 0])[1]) };
  // 주식·코인 엔진
  const Q = loadQuant(), Wq = Q.buildWorld(world(), { regimeOf: REGIME }), bt = Q.backtest(Wq, { only: ['atlas', 'orbit', 'orbitx', 'nova', 'echo'], from: Wq.cal[300] });
  G.quant = Object.fromEntries(Object.entries(bt.accounts).map(([k, a]) => [k, { trades: a.trades.length, last: r0(a.equity.at(-1)[1]) }]));
  G.quantCfg = { vault: Q.VAULT, cost: Q.COST, bots: Q.BOTS.map((b) => ({ id: b.id, maxPos: b.maxPos, riskPct: b.riskPct ?? null, posPct: b.posPct ?? null, noMarketFilter: !!b.noMarketFilter, stopPct: b.stopPct ?? null, trailPct: b.trailPct ?? null })) };
  // 세계 경제 신호 A~D (봇이 실제로 쓰는 필터) · 보여 주기용 신호들의 기준값
  const dser = (seed, n, px, step = 0.02) => { const r = rng(seed), T = [], c = []; let p = px; for (let i = 0; i < n; i++) { p *= 1 + (r() - 0.5) * step; T.push(Date.UTC(2024, 0, 1) + i * DAY); c.push(p); } return { T, c }; };
  const M = { usdcny: dser(1, 600, 7, 0.01), dxy: dser(2, 600, 100, 0.012), us10y: dser(3, 600, 4, 0.03), nasdaq: dser(4, 600, 15000), vix: dser(5, 600, 20, 0.08) }; let on = 0, blocks = 0; const cnt = { A: 0, B: 0, C: 0, D: 0 };
  for (let i = 220; i < 600; i++) { const R = riskAt(M, M.dxy.T[i] + 3600e3); if (R.blockLongs) blocks++; on += R.n; for (const k of Object.keys(cnt)) if (R.S[k].on) cnt[k]++; }
  G.macro = { blockDays: blocks, onSum: on, each: cnt, th: Object.fromEntries(['A', 'B', 'C', 'D', 'E'].map((k) => [k, riskAt(M, M.dxy.T[599]).S[k].th])) };
  const MF = Object.fromEntries(FX.map((f, i) => ['fx_' + f.id, dser(40 + i, 300, 100 + i, 0.012)])); let gOn = 0; for (let i = 40; i < 300; i++) if (breadthAt(MF, MF.fx_krw.T[i] + 3600e3).on) gOn++;
  G.fxbreadth = { cfg: FXCFG, currencies: FX.map((f) => f.id), onDays: gOn };
  // 외환 캐리
  const N = 200, rows = Object.fromEntries(FXC.map((f, i) => [f.id, dser(70 + i, N, 10 + i, 0.01 + i * 0.001).c])), rates = Object.fromEntries(['US', ...FXC.map((f) => f.c)].map((c, i) => [c, [['2020-01', 1 + (i * 7 % 11) * 0.5]]]));
  const tw = targetWeights(rows, N - 1, '2025-06-02', rates, rates.US[0][1]).W;
  G.fxcarry = { cfg: FXCARRY, currencies: FXC.map((f) => f.id), weights: Object.fromEntries(Object.entries(tw).map(([k, v]) => [k, r4(v)])) };
  // 한국 위기 경보 기준
  G.korea = { cfg: KCFG, stage: koreaJudge({ reserves: { months: 2.5 }, fx: { chg3m: 16 }, ca: { streak: 1 } }).n };
  // 민경기 매매법(섞는 비율·감시 기준) · 민경기 1세대 설정
  G.mg = { MG, WATCH }; G.mk = mkCfg({});
  // 돌려 보는 검사가 아직 없는 봇 파일(학습형·AI 판단·선물): 파일 내용 지문 — 한 글자라도 바뀌면 알림 (주석만 고쳐도 걸림: 그때는 규칙이 안 바뀐 걸 확인하고 값을 새로 저장)
  G.files = Object.fromEntries(['mk.mjs', 'mk3.mjs', 'scalp.mjs', 'futures.mjs', 'council.mjs', 'mg.mjs'].map((f) => [f, createHash('sha256').update(readFileSync(new URL('../connect/' + f, import.meta.url))).digest('hex').slice(0, 16)]));
  return JSON.parse(JSON.stringify(G));
}
test('봇 매매 규칙이 저장된 값과 같음 (모의 기록 기간 동결 — CLAUDE.md 1장)', () => {
  const now = compute();
  if (process.env.UPDATE_GOLDEN || !existsSync(FILE)) { writeFileSync(FILE, JSON.stringify(now, null, 1) + '\n'); console.log('tests/golden.json 저장됨'); return; }
  const want = JSON.parse(readFileSync(FILE, 'utf8'));
  for (const k of Object.keys({ ...want, ...now })) assert.deepEqual(now[k], want[k], `"${k}" 의 규칙·설정이 바뀜 — 모의 기록 기간에는 봇 규칙을 바꾸지 않습니다(CLAUDE.md 1장). 버그 수정이라면 UPDATE_GOLDEN=1 로 값을 새로 저장하고 커밋에 날짜·이유를 남기세요.`);
});
