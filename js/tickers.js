/*
 * 시장날씨 — 종목 → 업종 자동 분류표
 * 토스증권에서 가져온 종목의 업종을 자동으로 채웁니다. 여기 없는 종목은 앱에서 직접 고르면 기억합니다.
 * 업종 id: tech 기술(IT) · comm 커뮤니케이션 · discretionary 경기소비재 · staples 필수소비재 · health 헬스케어
 *          energy 에너지 · materials 소재 · industrials 산업재 · financials 금융 · utilities 유틸리티 · realestate 부동산
 */
(function (root) {
  const G = {
    tech: 'AAPL MSFT NVDA AVGO AMD INTC QCOM TXN MU AMAT LRCX KLAC ASML TSM ARM ORCL CRM ADBE NOW INTU IBM CSCO ANET PLTR SNOW CRWD PANW FTNT ZS NET DDOG MDB SMCI DELL HPQ HPE MRVL ON NXPI ADI MCHP SNPS CDNS WDAY TEAM SHOP SQ XYZ PYPL IONQ RGTI QBTS SOUN AI PATH U APP MSTR COIN HOOD SOXL TQQQ QQQ SMH SOXX XLK TECL ' +
      '402340 005930 000660 009150 011070 042700 403870 058470 240810 039030 357780 095340 036930 166090 140860 005935 018260 022100 034220 066570 006400 373220 247540 086520 450080 012510 000990 108320 067310 053800',
    comm: 'GOOGL GOOG META NFLX DIS CMCSA T VZ TMUS CHTR SPOT RBLX EA TTWO WBD PARA SNAP PINS RDDT TTD ROKU XLC ' +
      '035420 035720 017670 030200 032640 259960 251270 036570 293490 263750 112040 194480 352820 041510 122870 035900 253450 078340',
    discretionary: 'AMZN TSLA HD MCD NKE SBUX LOW BKNG TJX ABNB UBER DASH CMG LULU MAR HLT GM F RIVN LCID NIO XPEV LI BYDDY ORLY AZO ROST YUM DPZ EBAY ETSY CVNA TGT XLY ' +
      '005380 000270 012330 204320 161390 011210 064960 069960 023530 004170 139480 008770 031430 081660 383220 060980',
    staples: 'WMT COST PG KO PEP PM MO MDLZ CL KMB GIS KHC STZ KDP MNST EL HSY KR SYY XLP ' +
      '033780 097950 271560 004370 007310 280360 005180 003230 051900 090430 192820 161890 278470 001680 001800',
    health: 'LLY UNH JNJ ABBV MRK PFE TMO ABT DHR AMGN GILD ISRG VRTX REGN BMY MDT SYK BSX ZTS CVS CI ELV HCA MRNA BNTX NVO HIMS XLV IBB XBI ' +
      '207940 068270 000100 326030 196170 128940 302440 145020 028300 009420 006280 141080 185750 069620 214150 237690 298380 091990 000250',
    energy: 'XOM CVX COP EOG SLB OXY PSX MPC VLO KMI WMB OKE HAL DVN FANG BKR CEG VST OKLO SMR CCJ LEU NNE XLE XOP USO ' +
      '096770 010950 267250 078930 034020 052690 051600 006260',
    materials: 'LIN APD SHW ECL NEM FCX DOW DD NUE STLD MLM VMC ALB MP GOLD AA CLF X GLD SLV GDX XLB LIT ' +
      '005490 051910 011170 010130 003670 004020 009830 001570 011780 006650 103140 298050 120110 005420 285130 010060 393890 457190',
    industrials: '277810 028260 034730 003550 GE CAT BA HON UNP UPS RTX LMT NOC GD DE MMM ETN EMR ITW CSX NSC FDX WM URI PH TT CARR JCI GEV PWR AXON LHX HWM RKLB LUNR ASTS JOBY ACHR XLI ITA ' +
      '012450 042660 329180 009540 010140 010620 064350 047810 079550 272210 003490 020560 011200 028050 000720 047040 006360 267260 298040 010120 034020 000880 241560 017800 071970 077970 443060 454910',
    financials: 'JPM BAC WFC C GS MS BLK SCHW AXP V MA SPGI MCO ICE CME CB PGR MMC AON MET PRU AIG BK USB PNC TFC COF BX KKR APO BRK.B BRKB XLF KRE ' +
      '105560 055550 086790 316140 138040 024110 323410 377300 032830 000810 005830 001450 071050 039490 006800 016360 029780 088350 138930 175330',
    utilities: 'NEE DUK SO D AEP EXC SRE XEL PEG ED WEC ES AWK PCG EIX XLU ' +
      '015760 036460 017390 117460',
    realestate: 'PLD AMT EQIX CCI PSA O SPG WELL DLR VICI AVB EQR CBRE IRM SBAC XLRE VNQ ' +
      '088980 330590 395400 348950 365550 293940 357120'
  };

  // 종목 이름 → 코드 (한글·영문 이름으로 찾기). 형식: 이름|이름|...=코드
  const NAMES = `삼성전자=005930;삼성전자우=005935;SK하이닉스|하이닉스=000660;LG에너지솔루션|엘지에너지솔루션=373220;삼성바이오로직스=207940;현대차|현대자동차=005380;기아=000270;셀트리온=068270;
NAVER|네이버=035420;카카오=035720;POSCO홀딩스|포스코홀딩스=005490;KB금융=105560;신한지주=055550;하나금융지주=086790;우리금융지주=316140;삼성물산=028260;삼성SDI=006400;LG화학=051910;
현대모비스=012330;한화에어로스페이스=012450;한화오션=042660;HD현대중공업=329180;HD한국조선해양=009540;삼성중공업=010140;HD현대일렉트릭=267260;두산에너빌리티=034020;LS ELECTRIC|LS일렉트릭=010120;
한국전력|한전=015760;KT&G=033780;SK텔레콤=017670;KT=030200;LG유플러스=032640;삼성생명=032830;삼성화재=000810;메리츠금융지주=138040;카카오뱅크=323410;
삼성전기=009150;LG이노텍=011070;한미반도체=042700;LG전자=066570;LG디스플레이=034220;삼성SDS=018260;HMM=011200;대한항공=003490;고려아연=010130;포스코퓨처엠=003670;
에코프로=086520;에코프로비엠=247540;알테오젠=196170;HLB=028300;리가켐바이오=141080;삼천당제약=000250;유한양행=000100;한미약품=128940;SK바이오팜=326030;
크래프톤=259960;엔씨소프트=036570;넷마블=251270;하이브=352820;JYP|JYP엔터=035900;에스엠|SM엔터=041510;CJ제일제당=097950;오리온=271560;농심=004370;아모레퍼시픽=090430;
레인보우로보틱스=277810;HPSP=403870;리노공업=058470;이오테크닉스=039030;원익IPS=240810;주성엔지니어링=036930;ISC=095340;솔브레인=357780;파크시스템스=140860;
현대로템=064350;LIG넥스원=079550;한국항공우주|KAI=047810;풍산=103140;SK이노베이션=096770;S-Oil|에쓰오일=010950;SK스퀘어=402340;SK=034730;LG=003550;
애플|apple=AAPL;마이크로소프트|microsoft|마소=MSFT;엔비디아|nvidia=NVDA;아마존|amazon=AMZN;알파벳|구글|google=GOOGL;메타|페이스북|meta=META;테슬라|tesla=TSLA;브로드컴|broadcom=AVGO;
AMD|에이엠디=AMD;인텔|intel=INTC;퀄컴=QCOM;마이크론=MU;TSMC|대만반도체=TSM;ASML=ASML;ARM|암홀딩스=ARM;오라클|oracle=ORCL;세일즈포스=CRM;어도비=ADBE;팔란티어|palantir=PLTR;
넷플릭스|netflix=NFLX;디즈니=DIS;스포티파이=SPOT;로블록스=RBLX;우버=UBER;에어비앤비=ABNB;쇼피파이=SHOP;페이팔=PYPL;코인베이스=COIN;로빈후드=HOOD;마이크로스트래티지|스트래티지=MSTR;
아이온큐|ionq=IONQ;리게티=RGTI;슈퍼마이크로=SMCI;델=DELL;크라우드스트라이크=CRWD;팔로알토=PANW;스노우플레이크=SNOW;
버크셔해서웨이|버크셔=BRK.B;JP모건|제이피모건=JPM;뱅크오브아메리카=BAC;골드만삭스=GS;모건스탠리=MS;비자=V;마스터카드=MA;블랙록=BLK;
일라이릴리|릴리=LLY;유나이티드헬스=UNH;존슨앤드존슨=JNJ;노보노디스크=NVO;화이자=PFE;머크=MRK;애브비=ABBV;모더나=MRNA;
월마트=WMT;코스트코=COST;코카콜라=KO;펩시코=PEP;프록터앤드갬블|P&G=PG;맥도날드=MCD;스타벅스=SBUX;나이키=NKE;홈디포=HD;
엑슨모빌=XOM;셰브론=CVX;컨스텔레이션에너지=CEG;비스트라=VST;오클로=OKLO;카메코=CCJ;
보잉=BA;록히드마틴=LMT;캐터필러=CAT;GE에어로스페이스=GE;GE버노바=GEV;로켓랩=RKLB;
넥스트에라=NEE;리얼티인컴=O;프롤로지스=PLD;
QQQ|나스닥100ETF=QQQ;SPY=SPY;TQQQ=TQQQ;SOXL=SOXL;SCHD=SCHD`;
  const NAME_TO = {};
  NAMES.split(';').forEach((row) => { const [ns, code] = row.split('='); if (!code) return; ns.split('|').forEach((n) => { NAME_TO[norm(n)] = code.trim(); }); });
  const DISPLAY = {};
  NAMES.split(';').forEach((row) => { const [ns, code] = row.split('='); if (code) DISPLAY[code.trim()] = ns.split('|')[0].trim(); });
  function norm(t) { return String(t || '').toLowerCase().replace(/[\s.()\-·]/g, ''); }
  const SECTOR_OF = {};
  Object.keys(G).forEach((sec) => G[sec].split(/\s+/).filter(Boolean).forEach((t) => { if (!SECTOR_OF[t]) SECTOR_OF[t] = sec; }));

  // 코인 분류
  const C = {
    major: 'BTC ETH',
    stable: 'USDT USDC DAI USDE FDUSD USD1 TUSD PYUSD USDS',
    l1: 'SOL XRP ADA AVAX DOT TRX TON SUI APT NEAR ATOM ALGO HBAR XLM ICP SEI INJ KAIA KLAY BNB ETC BCH LTC XTZ EOS EGLD FLOW MINA KAS TIA BERA S SONIC HYPE',
    l2: 'ARB OP MATIC POL STRK IMX MNT ZK BLAST METIS LRC SKL',
    defi: 'UNI AAVE LINK MKR SKY CRV COMP SNX LDO PENDLE JUP RAY DYDX GMX 1INCH SUSHI CAKE ENA ETHFI EIGEN PYTH JTO',
    rwa: 'ONDO PLUME CFG POLYX OM MPL TRU SYRUP',
    ai: 'FET RENDER TAO AR AKT GRT WLD VIRTUAL AI16Z ARKM IO NEAR',
    meme: 'DOGE SHIB PEPE BONK WIF FLOKI TRUMP PENGU MEW BRETT POPCAT MOODENG',
    game: 'SAND MANA AXS GALA ENJ IMX BIGTIME YGG ILV BEAM',
    exchange: 'BNB OKB CRO GT LEO KCS'
  };
  const COIN_CAT = {};
  Object.keys(C).forEach((k) => C[k].split(/\s+/).filter(Boolean).forEach((t) => { if (!COIN_CAT[t]) COIN_CAT[t] = k; }));
  const COIN_CAT_NAME = { major: '대장 코인 (BTC·ETH)', stable: '스테이블코인', l1: '레이어1 플랫폼', l2: '레이어2', defi: '디파이·오라클', rwa: '실물자산(RWA)', ai: 'AI 코인', meme: '밈 코인', game: '게임·메타버스', exchange: '거래소 코인', etc: '기타 알트' };

  // 주식 찾기: 코드·한글 이름·영문 이름 → { symbol, name, sector, currency }
  function findStock(q) {
    const raw = String(q || '').trim(); if (!raw) return null;
    const m = raw.match(/\(([A-Za-z0-9.]+)\)\s*$/);
    const cands = [m && m[1], raw.replace(/\s*\(.*\)\s*$/, '')].filter(Boolean);
    for (const c of cands) {
      const code = NAME_TO[norm(c)] || (/^[0-9]{6}$/.test(c) || SECTOR_OF[c.toUpperCase()] ? c.toUpperCase() : null);
      if (code) {
        const sec = SECTOR_OF[code] || '';
        return { symbol: code, name: DISPLAY[code] || code, sector: sec, currency: /^[0-9]{6}$/.test(code) ? 'KRW' : 'USD' };
      }
    }
    return null;
  }
  const STOCK_LIST = Object.keys(DISPLAY).map((code) => ({ symbol: code, name: DISPLAY[code] }));

  const Tickers = {
    findStock, STOCK_LIST,
    sectorOf: (sym) => SECTOR_OF[String(sym || '').toUpperCase()] || SECTOR_OF[String(sym || '').replace(/^A/, '')] || '',
    coinCat: (sym) => COIN_CAT[String(sym || '').toUpperCase()] || 'etc',
    COIN_CAT_NAME, COIN_ORDER: ['major', 'l1', 'l2', 'defi', 'rwa', 'ai', 'game', 'exchange', 'meme', 'etc', 'stable']
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Tickers;
  else root.Tickers = Tickers;
})(typeof window !== 'undefined' ? window : globalThis);
