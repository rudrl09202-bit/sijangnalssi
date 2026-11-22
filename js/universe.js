/*
 * 시장날씨 — 시장별 순위 대상 종목 (시가총액 상위 대표 종목)
 * 형식: 코드:한글이름:업종  (업종 id는 js/tickers.js 맨 위 설명 참고)
 * 종목을 더 넣고 싶으면 같은 형식으로 한 줄씩 추가하면 됩니다. 다음 동기화부터 순위에 들어갑니다.
 */
(function (root) {
  const RAW = {
    nasdaq: `AAPL:애플:tech MSFT:마이크로소프트:tech NVDA:엔비디아:tech AMZN:아마존:discretionary GOOGL:알파벳(구글):comm META:메타:comm AVGO:브로드컴:tech TSLA:테슬라:discretionary
COST:코스트코:staples NFLX:넷플릭스:comm AMD:AMD:tech PLTR:팔란티어:tech CSCO:시스코:tech TMUS:T모바일:comm PEP:펩시코:staples ADBE:어도비:tech QCOM:퀄컴:tech
INTU:인튜이트:tech TXN:텍사스인스트루먼트:tech AMGN:암젠:health ISRG:인튜이티브서지컬:health AMAT:어플라이드머티리얼즈:tech BKNG:부킹홀딩스:discretionary HON:하니웰:industrials
CMCSA:컴캐스트:comm MU:마이크론:tech LRCX:램리서치:tech GILD:길리어드:health VRTX:버텍스:health ADP:ADP:industrials PANW:팔로알토:tech KLAC:KLA:tech ADI:아나로그디바이스:tech
SBUX:스타벅스:discretionary APP:앱러빈:tech CRWD:크라우드스트라이크:tech MELI:메르카도리브레:discretionary INTC:인텔:tech SNPS:시놉시스:tech CDNS:케이던스:tech
MRVL:마벨:tech ASML:ASML:tech ARM:ARM:tech MSTR:스트래티지:tech ABNB:에어비앤비:discretionary FTNT:포티넷:tech REGN:리제네론:health MDLZ:몬델리즈:staples`,
    spx: `AAPL:애플:tech MSFT:마이크로소프트:tech NVDA:엔비디아:tech AMZN:아마존:discretionary GOOGL:알파벳(구글):comm META:메타:comm AVGO:브로드컴:tech TSLA:테슬라:discretionary
BRK-B:버크셔해서웨이:financials JPM:JP모건:financials LLY:일라이릴리:health V:비자:financials UNH:유나이티드헬스:health XOM:엑슨모빌:energy MA:마스터카드:financials
JNJ:존슨앤드존슨:health PG:P&G:staples HD:홈디포:discretionary ABBV:애브비:health WMT:월마트:staples COST:코스트코:staples ORCL:오라클:tech KO:코카콜라:staples
BAC:뱅크오브아메리카:financials CVX:셰브론:energy MRK:머크:health NFLX:넷플릭스:comm CRM:세일즈포스:tech PLTR:팔란티어:tech AMD:AMD:tech MCD:맥도날드:discretionary
LIN:린데:materials ABT:애보트:health TMO:써모피셔:health DIS:디즈니:comm WFC:웰스파고:financials GE:GE에어로스페이스:industrials CAT:캐터필러:industrials IBM:IBM:tech
GS:골드만삭스:financials NOW:서비스나우:tech AXP:아메리칸익스프레스:financials MS:모건스탠리:financials RTX:RTX:industrials UBER:우버:industrials NEE:넥스트에라:utilities
PM:필립모리스:staples T:AT&T:comm VZ:버라이즌:comm SPGI:S&P글로벌:financials BA:보잉:industrials LMT:록히드마틴:industrials GEV:GE버노바:industrials CEG:컨스텔레이션:utilities
DE:디어:industrials UNP:유니온퍼시픽:industrials SCHW:찰스슈왑:financials BLK:블랙록:financials PFE:화이자:health COP:코노코필립스:energy NKE:나이키:discretionary PLD:프롤로지스:realestate`,
    kospi: `005930:삼성전자:tech 000660:SK하이닉스:tech 373220:LG에너지솔루션:tech 207940:삼성바이오로직스:health 005380:현대차:discretionary 000270:기아:discretionary
068270:셀트리온:health 035420:NAVER:comm 005490:POSCO홀딩스:materials 105560:KB금융:financials 055550:신한지주:financials 028260:삼성물산:industrials
006400:삼성SDI:tech 051910:LG화학:materials 012330:현대모비스:discretionary 012450:한화에어로스페이스:industrials 042660:한화오션:industrials 329180:HD현대중공업:industrials
035720:카카오:comm 086790:하나금융지주:financials 015760:한국전력:utilities 033780:KT&G:staples 017670:SK텔레콤:comm 032830:삼성생명:financials 000810:삼성화재:financials
138040:메리츠금융지주:financials 009150:삼성전기:tech 066570:LG전자:tech 010130:고려아연:materials 034020:두산에너빌리티:industrials 267260:HD현대일렉트릭:industrials
010120:LS일렉트릭:industrials 316140:우리금융지주:financials 003670:포스코퓨처엠:materials 096770:SK이노베이션:energy 018260:삼성SDS:tech 011200:HMM:industrials
003490:대한항공:industrials 009540:HD한국조선해양:industrials 064350:현대로템:industrials 079550:LIG넥스원:industrials 402340:SK스퀘어:tech 010140:삼성중공업:industrials
047810:한국항공우주:industrials 042700:한미반도체:tech 352820:하이브:comm 259960:크래프톤:comm 323410:카카오뱅크:financials 030200:KT:comm`,
    kosdaq: `086520:에코프로:materials 247540:에코프로비엠:materials 196170:알테오젠:health 028300:HLB:health 141080:리가켐바이오:health 277810:레인보우로보틱스:industrials
403870:HPSP:tech 058470:리노공업:tech 039030:이오테크닉스:tech 240810:원익IPS:tech 036930:주성엔지니어링:tech 095340:ISC:tech 357780:솔브레인:tech 140860:파크시스템스:tech
000250:삼천당제약:health 145020:휴젤:health 214150:클래시스:health 237690:에스티팜:health 298380:에이비엘바이오:health 035900:JYP엔터:comm 041510:에스엠:comm
293490:카카오게임즈:comm 263750:펄어비스:comm 112040:위메이드:comm 253450:스튜디오드래곤:comm 067310:하나마이크론:tech`
  };
  const MARKETS = { nasdaq: '나스닥', spx: 'S&P 500', kospi: '코스피', kosdaq: '코스닥' };
  const BENCH = { nasdaq: '^IXIC', spx: '^GSPC', kospi: '^KS11', kosdaq: '^KQ11' };
  const LIST = {};
  Object.keys(RAW).forEach((mk) => {
    LIST[mk] = RAW[mk].split(/\s+/).filter(Boolean).map((row) => { const [s, n, sec] = row.split(':'); return { s, n, sec, cur: /^[0-9]{6}$/.test(s) ? 'KRW' : 'USD' }; });
  });
  // 야후 파이낸스 기호: 코스피 .KS, 코스닥 .KQ, 미국은 그대로
  function yahooSymbol(s, mk) { return mk === 'kospi' ? s + '.KS' : mk === 'kosdaq' ? s + '.KQ' : s; }
  const Universe = { MARKETS, BENCH, LIST, yahooSymbol };
  if (typeof module !== 'undefined' && module.exports) module.exports = Universe;
  else root.Universe = Universe;
})(typeof window !== 'undefined' ? window : globalThis);
