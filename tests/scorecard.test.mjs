// 성적표 채점(CLAUDE.md 2장 기준)이 뜻대로 되는지
import test from 'node:test';
import assert from 'node:assert/strict';
import { judge, metrics } from '../connect/scorecard.mjs';
const C = { minDays: 90, minSharpe: 0.5, mddFactor: 1.5, minTradesCoin: 20, minSwapsMonthly: 3 }, coin = { kind: 'coin', btMdd: -20 };
test('성적표: 통과·미달·기록 중·판단 보류', () => {
  assert.equal(judge(coin, { days: 95, sharpe: 0.8, mdd: -22, count: 25 }, C).verdict, '통과');
  assert.equal(judge(coin, { days: 30, sharpe: 2.0, mdd: -5, count: 25 }, C).verdict, '기록 중', '90일 전에는 성적이 좋아도 통과가 아님');
  assert.equal(judge(coin, { days: 30, sharpe: 2.0, mdd: -31, count: 5 }, C).verdict, '미달', '낙폭 한도(−30%)는 기간 중에도 넘으면 바로 미달');
  assert.equal(judge(coin, { days: 95, sharpe: 0.3, mdd: -10, count: 25 }, C).verdict, '미달');
  assert.equal(judge(coin, { days: 95, sharpe: 0.9, mdd: -10, count: 8 }, C).verdict, '미달', '거래 수 부족');
  assert.equal(judge({ kind: 'coin', btMdd: null }, { days: 95, sharpe: 0.9, mdd: -10, count: 30 }, C).verdict, '판단 보류', '백테스트 낙폭이 없으면 통과시키지 않음');
  assert.equal(judge({ kind: 'stock', btMdd: -29.1, monthly: true }, { days: 95, sharpe: 0.9, mdd: -12, count: 3 }, C).verdict, '통과');
  assert.equal(judge({ kind: 'stock', btMdd: -29.1, monthly: true }, { days: 95, sharpe: 0.9, mdd: -12, count: 2 }, C).verdict, '미달');
  assert.equal(judge({ kind: 'stock', btMdd: -40, retired: true }, { days: 95, sharpe: 0.9, mdd: -12, count: 30 }, C).verdict, '은퇴');
});
test('성적표: 수익률·낙폭·샤프 계산', () => {
  const s = [['d1', 100], ['d2', 110], ['d3', 99], ['d4', 120]], m = metrics(s, 365);
  assert.equal(m.ret, 20); assert.equal(m.mdd, -10); assert.equal(m.sharpe, null, '20일 미만이면 샤프를 내지 않음');
  const up = Array.from({ length: 40 }, (_, i) => ['d' + i, 100 * 1.01 ** i * (i % 2 ? 1.002 : 0.998)]); assert.ok(metrics(up, 365).sharpe > 5);
});
