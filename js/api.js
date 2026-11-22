/*
 * 시장날씨 — 실시간 데이터 가져오기
 * 무료·공개 API만 씁니다(키 필요 없음). 실패하면 마지막으로 받은 값이나 스냅샷을 씁니다.
 *  - 빗썸·업비트: 코인 원화 시세 / 업비트: 코인 목록, 일봉
 *  - CoinGecko: 업비트가 막힐 때 대체 시세, 코인 전체 시가총액·도미넌스
 *  - alternative.me: 코인 공포·탐욕 지수
 *  - Frankfurter: 원/달러 환율(유럽중앙은행 기준, 하루 1번 갱신)
 */
(function () {
  const CACHE_KEY = 'snw.cache.v1';

  function loadCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch (e) { return {}; } }
  function saveCache(c) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch (e) { /* 저장 공간 없음 */ } }

  async function getJSON(url, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms || 8000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally { clearTimeout(t); }
  }

  // 캐시를 쓰는 공통 함수: 성공하면 저장, 실패하면 마지막 값
  async function cached(key, maxAgeMs, loader) {
    const cache = loadCache();
    const hit = cache[key];
    if (hit && Date.now() - hit.at < maxAgeMs) return { ...hit.v, _from: 'cache', _at: hit.at };
    try {
      const v = await loader();
      cache[key] = { at: Date.now(), v };
      saveCache(cache);
      return { ...v, _from: 'live', _at: Date.now() };
    } catch (e) {
      if (hit) return { ...hit.v, _from: 'stale', _at: hit.at };
      throw e;
    }
  }

  const CG_ID = { BTC: 'bitcoin', ETH: 'ethereum', XRP: 'ripple', SOL: 'solana', DOGE: 'dogecoin', ADA: 'cardano', USDT: 'tether', USDC: 'usd-coin', ONDO: 'ondo-finance', TRX: 'tron', LINK: 'chainlink' };

  // 거래소별 원화 마켓 목록(하루 1번). 없는 코인을 섞어 보내면 거래소가 요청 전체를 거절하기 때문에 미리 거릅니다.
  async function marketSet(name, url) {
    try {
      const r = await cached('mk:' + name, 24 * 60 * 60 * 1000, async () => {
        const rows = await getJSON(url);
        return { list: rows.map((x) => x.market).filter((m) => m.startsWith('KRW-')) };
      });
      return new Set(r.list);
    } catch (e) { return null; }
  }
  async function tickerFrom(url, markets) {
    const out = {};
    for (let i = 0; i < markets.length; i += 50) {
      const rows = await getJSON(url + markets.slice(i, i + 50).join(','));
      rows.forEach((r) => { out[r.market] = { krw: Number(r.trade_price), chg24: Number(r.signed_change_rate) * 100 }; });
    }
    return out;
  }

  // 코인 시세(원화). markets: ['KRW-BTC', ...]
  // 순서: 빗썸 → 업비트 → CoinGecko. 한 곳에서 못 구한 코인은 다음 곳에서 찾습니다.
  async function coinPrices(markets) {
    const key = 'prices2:' + markets.slice().sort().join(',');
    return cached(key, 30 * 1000, async () => {
      const out = {}; const used = [];
      const left = () => markets.filter((m) => !out[m]);
      const sources = [
        ['빗썸', 'https://api.bithumb.com/v1/market/all', 'https://api.bithumb.com/v1/ticker?markets='],
        ['업비트', 'https://api.upbit.com/v1/market/all?isDetails=false', 'https://api.upbit.com/v1/ticker?markets=']
      ];
      for (const [name, listUrl, tickUrl] of sources) {
        if (!left().length) break;
        const set = await marketSet(name, listUrl);
        const want = set ? left().filter((m) => set.has(m)) : [];
        if (!want.length) continue;
        try { Object.assign(out, await tickerFrom(tickUrl, want)); used.push(name); } catch (e) { /* 다음 거래소로 */ }
      }
      const rest = left().filter((m) => CG_ID[m.split('-')[1]]);
      if (rest.length) {
        try {
          const ids = rest.map((m) => CG_ID[m.split('-')[1]]);
          const j = await getJSON('https://api.coingecko.com/api/v3/simple/price?ids=' + ids.join(',') + '&vs_currencies=krw,usd&include_24hr_change=true');
          rest.forEach((m) => { const id = CG_ID[m.split('-')[1]]; if (j[id]) out[m] = { krw: j[id].krw, usd: j[id].usd, chg24: j[id].krw_24h_change }; });
          used.push('CoinGecko');
        } catch (e) { /* 없음 */ }
      }
      if (!Object.keys(out).length) throw new Error('시세를 가져오지 못함');
      return { prices: out, source: used.join('·') };
    });
  }

  // 업비트 원화 마켓 전체 목록 (검색용)
  async function coinList() {
    return cached('coinlist', 24 * 60 * 60 * 1000, async () => {
      const rows = await getJSON('https://api.upbit.com/v1/market/all?isDetails=false');
      return { list: rows.filter((r) => r.market.startsWith('KRW-')).map((r) => ({ market: r.market, name: r.korean_name, symbol: r.market.slice(4), en: r.english_name })) };
    });
  }

  // 일봉 200개: 종가·고가·저가·거래대금. 업비트 → 빗썸 → CoinGecko(종가만)
  async function dailyCloses(market) {
    return cached('candles3:' + market, 60 * 60 * 1000, async () => {
      const conv = (rows, src) => {
        const r = rows.slice().reverse();
        return { closes: r.map((x) => Number(x.trade_price)), opens: r.map((x) => Number(x.opening_price)), highs: r.map((x) => Number(x.high_price)), lows: r.map((x) => Number(x.low_price)), vols: r.map((x) => Number(x.candle_acc_trade_price)), times: r.map((x) => String(x.candle_date_time_kst || '').slice(0, 10)), source: src };
      };
      for (const [src, url] of [['업비트', 'https://api.upbit.com/v1/candles/days?market='], ['빗썸', 'https://api.bithumb.com/v1/candles/days?market=']]) {
        try { const rows = await getJSON(url + market + '&count=200'); if (rows && rows.length) return conv(rows, src); } catch (e) { /* 다음 */ }
      }
      const id = CG_ID[market.split('-')[1]];
      if (!id) throw new Error('일봉 없음');
      const j = await getJSON('https://api.coingecko.com/api/v3/coins/' + id + '/market_chart?vs_currency=krw&days=200&interval=daily');
      return { closes: j.prices.map((p) => p[1]), vols: j.total_volumes ? j.total_volumes.map((p) => p[1]) : null, source: 'CoinGecko' };
    });
  }

  async function fearGreed() {
    return cached('fng', 60 * 60 * 1000, async () => {
      const j = await getJSON('https://api.alternative.me/fng/?limit=1');
      const d = j.data[0];
      return { value: Number(d.value), label: d.value_classification };
    });
  }

  async function cryptoGlobal() {
    return cached('global', 10 * 60 * 1000, async () => {
      const j = await getJSON('https://api.coingecko.com/api/v3/global');
      return { totalCapT: j.data.total_market_cap.usd / 1e12, btcDominance: j.data.market_cap_percentage.btc };
    });
  }

  async function usdKrw() {
    return cached('usdkrw', 60 * 60 * 1000, async () => {
      const j = await getJSON('https://api.frankfurter.app/latest?from=USD&to=KRW');
      return { value: j.rates.KRW, date: j.date };
    });
  }

  // 1달러당 각 통화 (세계 돈의 지도 환산용)
  async function fxRates() {
    return cached('fx-multi', 6 * 60 * 60 * 1000, async () => {
      const j = await getJSON('https://api.frankfurter.app/latest?from=USD&to=KRW,JPY,CNY,EUR');
      return { rates: j.rates, date: j.date };
    });
  }

  // 코인 주봉·월봉 200개 (월봉이면 약 16년) — 3·5·10년 차트용
  async function coinHistory(market, unit) {
    return cached('chist:' + unit + ':' + market, 6 * 60 * 60 * 1000, async () => {
      for (const [src, url] of [['업비트', 'https://api.upbit.com/v1/candles/' + unit + '?market='], ['빗썸', 'https://api.bithumb.com/v1/candles/' + unit + '?market=']]) {
        try {
          const rows = await getJSON(url + market + '&count=200');
          if (rows && rows.length) { const r = rows.slice().reverse(); return { t: r.map((x) => String(x.candle_date_time_kst || '').slice(0, 10)), o: r.map((x) => Number(x.opening_price)), h: r.map((x) => Number(x.high_price)), l: r.map((x) => Number(x.low_price)), c: r.map((x) => Number(x.trade_price)), v: r.map((x) => Number(x.candle_acc_trade_price)), source: src }; }
        } catch (e) { /* 다음 */ }
      }
      throw new Error('기록 없음');
    });
  }

  // 실시간 환율 (1분마다): 원화 기준 달러·엔(100엔)·위안·유로
  //  1순위 두나무 환율(하나은행 매매기준율, 장중 수시 갱신) → 2순위 Frankfurter(유럽중앙은행, 하루 1번)
  async function fxLive() {
    return cached('fx-live', 60 * 1000, async () => {
      try {
        const rows = await getJSON('https://quotation-api-cdn.dunamu.com/v1/forex/recent?codes=FRX.KRWUSD,FRX.KRWJPY,FRX.KRWCNY,FRX.KRWEUR', 6000);
        const out = {};
        rows.forEach((r) => {
          const unit = Number(r.currencyUnit) || 1;
          out[r.currencyCode] = { krw: Number(r.basePrice) / unit, unit, chg: Number(r.signedChangePrice) / unit, chgPct: Number(r.signedChangeRate) * 100, at: r.timestamp || Date.now() };
        });
        if (!out.USD || !out.JPY || !out.CNY || !out.EUR) throw new Error('일부 통화 없음');
        return { rates: out, source: '하나은행 고시(두나무)', live: true };
      } catch (e) {
        const j = await getJSON('https://api.frankfurter.app/latest?from=USD&to=KRW,JPY,CNY,EUR');
        const k = j.rates.KRW, out = { USD: { krw: k, unit: 1 } };
        ['JPY', 'CNY', 'EUR'].forEach((c) => { out[c] = { krw: k / j.rates[c], unit: c === 'JPY' ? 100 : 1 }; });
        return { rates: out, source: '유럽중앙은행 기준(하루 1번) ' + j.date, live: false };
      }
    });
  }

  window.Api = { coinPrices, coinList, dailyCloses, fearGreed, cryptoGlobal, usdKrw, fxRates, fxLive, coinHistory };
})();
