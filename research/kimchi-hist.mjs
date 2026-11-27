// 연구용 자료 받기: ① 업비트 KRW-BTC 4시간봉(김치 프리미엄용) ② 바이낸스 공개 자료실의 펀딩비 기록(2020~, 8코인)
//  → <MH>/upbit-BTC-4h.json { t:[ms], c:[] } · <MH>/fund-<코인>.json [[ms, rate], ...]   (키 필요 없음, 공개 자료)
// 사용: node research/kimchi-hist.mjs [폴더]   (기본 /tmp/mh)
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const MH = process.argv[2] || process.env.MH || '/tmp/mh', sleep = (ms) => new Promise((r) => setTimeout(r, ms)); mkdirSync(MH, { recursive: true });
// ① 업비트: 200개씩 과거로
{ const out = new Map(); let to = new Date().toISOString().slice(0, 19) + 'Z';
  while (true) { const r = await fetch('https://api.upbit.com/v1/candles/minutes/240?market=KRW-BTC&count=200&to=' + encodeURIComponent(to), { headers: { accept: 'application/json' } });
    if (r.status === 429) { await sleep(1500); continue; } if (!r.ok) throw new Error('업비트 HTTP ' + r.status); const a = await r.json(); if (!a.length) break;
    a.forEach((k) => out.set(Date.parse(k.candle_date_time_utc + 'Z'), k.trade_price)); const last = a[a.length - 1].candle_date_time_utc; if (last < '2019-12-01') break; to = last + 'Z'; await sleep(130); }
  const t = [...out.keys()].sort((x, y) => x - y); writeFileSync(`${MH}/upbit-BTC-4h.json`, JSON.stringify({ t, c: t.map((x) => out.get(x)) })); console.log('업비트 BTC 4시간봉', t.length, new Date(t[0]).toISOString().slice(0, 10), '~', new Date(t.at(-1)).toISOString().slice(0, 10)); }
// ② 바이낸스 펀딩비 (월별 zip → csv: calc_time, funding_interval_hours, last_funding_rate)
for (const s of ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'ADA', 'LINK']) { const rows = []; let miss = 0;
  for (let y = 2020; y <= 2026; y++) for (let m = 1; m <= 12; m++) { const ym = y + '-' + String(m).padStart(2, '0'); if (ym > new Date().toISOString().slice(0, 7)) continue;
    const url = `https://data.binance.vision/data/futures/um/monthly/fundingRate/${s}USDT/${s}USDT-fundingRate-${ym}.zip`, f = `${MH}/_f.zip`;
    try { const r = await fetch(url); if (!r.ok) { miss++; continue; } writeFileSync(f, Buffer.from(await r.arrayBuffer()));
      const csv = execFileSync('python3', ['-I', '-c', 'import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);sys.stdout.write(z.read(z.namelist()[0]).decode())', f], { maxBuffer: 5e7 }).toString();
      csv.trim().split('\n').forEach((l) => { const p = l.split(','); const t = +p[0], v = +p[p.length - 1]; if (t > 1e12 && isFinite(v)) rows.push([t, v]); }); } catch (e) { miss++; } }
  rows.sort((a, b) => a[0] - b[0]); writeFileSync(`${MH}/fund-${s}.json`, JSON.stringify(rows)); console.log('펀딩비', s, rows.length, rows.length ? new Date(rows[0][0]).toISOString().slice(0, 10) + ' ~ ' + new Date(rows.at(-1)[0]).toISOString().slice(0, 10) : '', '빠진 달', miss); }
