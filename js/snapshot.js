/*
 * 시장날씨 — 기준 데이터(스냅샷)
 * 실시간으로 못 받아오는 거시경제 숫자를 여기에 둡니다.
 * 숫자를 새로 넣을 때는 asOf(기준일)도 같이 바꾸세요.
 * 출처는 각 항목의 src에 적어 둡니다.
 */
window.SNAPSHOT = {
  asOf: '2026-11-19',

  // 시장 지표 (live: true 인 항목은 앱이 실시간 값으로 덮어씁니다)
  markets: {
    us10y:  { name: '미국 10년물 금리', value: 5.06, unit: '%', chg: -1, chgUnit: 'bp', hint: '세계 모든 자산의 기준 이자', src: 'StreetStats 11/19' },
    us2y:   { name: '미국 2년물 금리', value: 4.79, unit: '%', src: 'StreetStats 11/19' },
    dxy:    { name: '달러지수', value: 103.78, unit: '', chg: 0.21, chgUnit: '%', hint: '19개월 만의 최고 수준', src: 'BabyPips 11/18' },
    usdkrw: { name: '원/달러', value: 1330.0, unit: '원', chg: -2.7, chgUnit: '원', hint: '수출 호황에 원화 강세', src: '뉴시스 11/19', live: true },
    brent:  { name: '브렌트유', value: 92.27, unit: '$', chg: 0.35, chgUnit: '%', hint: '10/30 고점 113.43달러', src: 'The Weekend Spread 11/19' },
    gold:   { name: '금', value: 3674.7, unit: '$', chg: -1.36, chgUnit: '%', hint: '2025년 9월 이후 최저권', src: 'The Weekend Spread 11/19' },
    spx:    { name: 'S&P 500', value: 7175.83, unit: '', chg: -2.02, chgUnit: '%', hint: '6거래일 연속 하락', src: 'Capp Notes 11/19' },
    nasdaq: { name: '나스닥', value: 24429.88, unit: '', chg: 0.42, chgUnit: '%', hint: '11/18 종가 · 4일 연속 하락 끊음', src: 'AP 11/18' },
    kosdaq: { name: '코스닥', value: 684, unit: '', chg: 3.32, chgUnit: '%', hint: '', src: 'KB증권 11/19' },
    kospi:  { name: '코스피', value: 5137.89, unit: '', chg: 1.39, chgUnit: '%', hint: '', src: '아시아경제 11/19' },
    vix:    { name: '공포지수 VIX', value: 28.44, unit: '', chg: 15.8, chgUnit: '%', hint: '20 넘으면 불안, 30 넘으면 공포', src: 'Capp Notes 11/19' }
  },

  // 중앙은행
  rates: [
    { key: 'fed', name: '미국 연준', rate: '3.75~4.00%', upper: 4.00, next: '2026-12-10', expect: 'hike', expectText: '12월 0.25%p 인상 거의 확실(약 95~100%)' },
    { key: 'bok', name: '한국은행', rate: '3.00%', upper: 3.00, next: '2026-11-26', expect: 'hike', expectText: '3.25%로 인상 전망 우세' },
    { key: 'ecb', name: 'ECB', rate: '2.50%', upper: 2.50, next: '', expect: 'hold', expectText: '동결 기조' },
    { key: 'boj', name: '일본은행', rate: '1.25%', upper: 1.25, next: '', expect: 'hike', expectText: '추가 인상 신호' }
  ],

  // 코인 시장 보조 데이터 (공포탐욕·시총은 앱이 실시간으로 덮어씀)
  crypto: {
    etfFlowMonth: -29,   // 미국 비트코인 현물 ETF 이번 달 누적 순유입(억 달러). 음수 = 유출
    etfFlowLabel: '11월 누적(11/18까지)',
    fng: 10,
    totalCapT: 2.18,
    btcDominance: 58.4
  },

  // 다가오는 일정 (date = 한국 시간 기준 날짜)
  events: [
    { date: '2026-11-26', title: '한국은행 기준금리 결정', when: '11/26(목) 오전', why: '3.00% → 3.25% 인상 여부' },
    { date: '2026-12-10', title: '미국 FOMC 결과 발표', when: '12/10(목) 새벽 4시', why: '인상보다 "내년에도 더 올릴지" 신호가 핵심' },
    { date: '2026-12-10', title: '미국 11월 소비자물가(CPI)', when: '12/10(목) 밤 10시 30분', why: 'FOMC 바로 다음. 예상보다 높으면 추가 인상 우려' }
  ],

  // 어제 시장은 왜 움직였나 (매일 3줄)
  why: [
    '연준 의사록이 매파적 — 12월 인상이 사실상 확정 분위기',
    '앤트로픽 상장 첫날, 개인 자금이 다른 AI주를 팔고 이동',
    '엔비디아는 실적 호조에도 CEO 교체 여파로 하락'
  ],

  // 1년 성적표 (2025-11-19 → 2026-11-19)
  perf: {
    period: '2025.11.19 → 2026.11.19',
    usdkrwThen: 1465.6, usdkrwNow: 1330.0,
    rows: [
      { name: '코스피', ccy: 'KRW', then: 3929.51, now: 5137.89 },
      { name: 'S&P 500', ccy: 'USD', then: 6642.16, now: 7175.83 },
      { name: '비트코인', ccy: 'USD', then: 91538.10, now: 63747.99 },
      { name: '이더리움', ccy: 'USD', then: 3024.70, now: 1801.95 },
      { name: '금', ccy: 'USD', then: 4076.55, now: 3674.7 },
      { name: '브렌트유', ccy: 'USD', then: 63.51, now: 92.27 },
      { name: 'WTI유', ccy: 'USD', then: 59.44, now: 83.86 },
      { name: '달러 현금', ccy: 'FX', then: 1465.6, now: 1330.0 }
    ]
  },


  // 세계 돈의 지도 — 시장 크기·돈의 양·통화 파워 (공식 발표 기준, 발표 주기가 길어 손으로 갱신)
  // 금·은·암호화폐 금액과 원화 환산은 앱이 실시간 가격·환율로 다시 계산합니다.
  world: {
    assets: [
      { id: 'realestate', name: '부동산', usdT: 393.3, asOf: '2025년 초', src: 'Savills', note: '주거 286.9조·상업 58.5조 달러 + 농지. 중국 23.5%, 미국 20.7%' },
      { id: 'bonds', name: '채권', usdT: 160.7, asOf: '2025년 말', src: 'SIFMA', note: '미국이 38.1%(61.2조 달러)로 1위' },
      { id: 'stocks', name: '주식', usdT: 157.8, asOf: '2025년 말', src: 'SIFMA', note: '미국 증시가 43.7%로 1위' },
      { id: 'gold', name: '금', tonnes: 224200, usdT: 30.0, asOf: '2026년 3분기 말', src: '세계금협회(WGC)', note: '지금까지 캔 금 22만 4,200톤. 장신구 44%·중앙은행 18%·골드바·코인 21%' },
      { id: 'silver', name: '은', ozB: 19.3, asOf: '추정치', src: '실버인스티튜트 보고서 인용', note: '남아 있는 은 약 193억 온스(약 60만 톤). 많은 양이 산업용으로 써서 사라짐' },
      { id: 'crypto', name: '암호화폐 전체', live: true, src: 'CoinGecko 실시간', note: '비트코인이 절반 이상' },
      { id: 'btc', name: '비트코인', live: true, src: 'CoinGecko 실시간', note: '최대 2,100만 개로 정해진 디지털 자산' }
    ],
    // 나라별 돈의 양(M2: 현금+예금 등 바로 쓸 수 있는 돈). value 는 각 나라 통화, unitT 는 1조 단위 배수
    money: [
      { id: 'CNY', name: '중국', cur: '위안', value: 359.06, unit: '조 위안', asOf: '2026년 10월', src: '중국인민은행', yoy: 7.1 },
      { id: 'USD', name: '미국', cur: '달러', value: 23.41, unit: '조 달러', asOf: '2026년 9월', src: '미 연준(FRED)', yoy: null },
      { id: 'EUR', name: '유로존', cur: '유로', value: 16.436, unit: '조 유로', asOf: '2026년 7월', src: '유럽중앙은행', yoy: 3.3 },
      { id: 'JPY', name: '일본', cur: '엔', value: 1296.4, unit: '조 엔', asOf: '2026년 8월', src: '일본은행', yoy: null },
      { id: 'KRW', name: '한국', cur: '원', value: 4283.9, unit: '조 원', asOf: '2026년 9월', src: '한국은행', yoy: null }
    ],
    // 하루 외환거래에서 각 통화가 낀 비중(거래마다 통화가 2개라 합계 200%) — BIS 2025년 4월
    fxTurnoverPerDayT: 9.6, fxAsOf: '2025년 4월', fxSrc: 'BIS 3년 주기 조사',
    fxShare: [ { name: '달러', v: 89.2 }, { name: '유로', v: 28.9 }, { name: '엔', v: 16.8 }, { name: '파운드', v: 10.2 }, { name: '위안', v: 8.5 }, { name: '원', v: 1.8, note: '12위' } ],
    // 세계 중앙은행 외환보유액 통화 구성 — IMF COFER 2026년 2분기
    reservesT: 13.22, resAsOf: '2026년 2분기', resSrc: 'IMF COFER',
    reserves: [ { name: '달러', v: 56.7 }, { name: '유로', v: 20.6 }, { name: '그 밖의 통화', v: 22.7 } ]
  },

  // 오늘의 자산 순위에 넣는 대표 자산 (코인은 앱이 실시간 200일 가격으로 계산)
  // y1 = 1년 수익률(현지 통화, %), d1 = 최근 하루 변화(%). 숫자를 새로 넣을 때 asOf 와 함께 바꾸세요.
  rankAssets: [
    { id: 'nasdaq', name: '나스닥', cls: '미국 주식', y1: 8.3, d1: 0.42, traits: { rate: 2, usdAsset: 1, risk: 1 } },
    { id: 'spx', name: 'S&P 500', cls: '미국 주식', y1: 8.0, d1: -2.02, traits: { rate: 1, usdAsset: 1, risk: 1 } },
    { id: 'kospi', name: '코스피', cls: '한국 주식', y1: 30.8, d1: 1.39, traits: { rate: 1, kr: 1, risk: 1, exporter: 1 } },
    { id: 'kosdaq', name: '코스닥', cls: '한국 주식', y1: null, d1: 3.32, traits: { rate: 2, kr: 1, risk: 1 } },
    { id: 'gold', name: '금', cls: '원자재', y1: -9.9, d1: -1.36, traits: { rate: 1, usdAsset: 1, haven: 1, dollarHurt: 1 } },
    { id: 'brent', name: '원유 (브렌트)', cls: '원자재', y1: 45.3, d1: 0.35, traits: { usdAsset: 1, oil: 1, risk: 1 } },
    { id: 'usd', name: '달러 (현금)', cls: '통화', y1: -9.3, d1: null, traits: { usdAsset: 1, haven: 1, cash: 1 } }
  ],
  rankCoins: ['KRW-BTC', 'KRW-ETH', 'KRW-XRP', 'KRW-SOL', 'KRW-DOGE', 'KRW-ADA', 'KRW-LINK', 'KRW-AVAX', 'KRW-SUI', 'KRW-TRX'],

  // 미국 11개 업종 (올해 수익률 ytd, 최근 1달 m1, %) — ChartRow 11/18
  sectors: [
    { id: 'energy', name: '에너지', ytd: 39.8, m1: -10.2 },
    { id: 'staples', name: '필수소비재', ytd: 19.6, m1: 4.1 },
    { id: 'health', name: '헬스케어', ytd: 18.5, m1: 2.5 },
    { id: 'tech', name: '기술(IT)', ytd: 14.2, m1: -10.7 },
    { id: 'materials', name: '소재', ytd: 12.7, m1: -0.9 },
    { id: 'realestate', name: '부동산', ytd: 10.7, m1: 3.5 },
    { id: 'industrials', name: '산업재', ytd: 7.0, m1: -1.8 },
    { id: 'financials', name: '금융', ytd: 4.3, m1: 1.6 },
    { id: 'utilities', name: '유틸리티', ytd: 4.1, m1: 3.2 },
    { id: 'discretionary', name: '경기소비재', ytd: 0.4, m1: 6.0 },
    { id: 'comm', name: '커뮤니케이션', ytd: -9.5, m1: -4.3 }
  ],

  // 코인 기본 목록 (업비트 목록을 못 받아올 때 사용)
  coinList: [
    { market: 'KRW-BTC', name: '비트코인', symbol: 'BTC' },
    { market: 'KRW-ETH', name: '이더리움', symbol: 'ETH' },
    { market: 'KRW-XRP', name: '리플', symbol: 'XRP' },
    { market: 'KRW-SOL', name: '솔라나', symbol: 'SOL' }
  ]
};
