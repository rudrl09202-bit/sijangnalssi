/* 감시자 — GitHub 봇 루프(15분마다)에서 서울 서버가 살아 있는지 확인
 *  · 서울 서버는 매시 5·20·35·50분에 바이낸스 데모 결과(deriv-data/exec-live.json)를 올림
 *  · 90분 넘게 안 올라오면 휴대폰 알림 (같은 문제는 6시간에 한 번만). 살아나면 "복구" 알림
 *  · 민경기 매매법 감시 단계(정상·주의·경고·비상 정지)가 바뀌면 알림
 *  · 바이낸스 데모의 '통합 자산 방어'가 새로 진입을 막으면 알림
 *  · 거래소에 손절 주문이 걸려 있어 서버가 죽어도 손절은 거래소가 실행함. 다만 추적 손절 이동·정리는 멈추므로 알려야 함
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEnv, push } from './paper.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));
export async function run({ dir = process.env.MK_DIR || process.env.SCALP_DIR || join(HERE, '..', 'data'), env = loadEnv(), now = Date.now(), log = console.log, fetchImpl = fetch } = {}) {
  const repo = env.GITHUB_REPOSITORY || process.env.GITHUB_REPOSITORY || 'rudrl09202-bit/sijangnalssi';
  const f = join(dir, 'watch-state.json'); let st = {}; try { st = JSON.parse(readFileSync(f, 'utf8')); } catch (e) { /* 처음 */ }
  let at = null, X = null; try { const r = await fetchImpl('https://raw.githubusercontent.com/' + repo + '/deriv-data/exec-live.json?t=' + Math.floor(now / 6e4)); if (r.ok) { X = await r.json(); at = Date.parse(X.at); } } catch (e) { /* 못 읽음 */ }
  const age = at ? (now - at) / 60e3 : null, down = age == null || age > 90;
  log('감시자: 서울 서버 마지막 보고 ' + (age == null ? '읽기 실패' : Math.round(age) + '분 전') + (down ? ' — 이상' : ' — 정상'));
  if (down && (!st.alertAt || now - st.alertAt > 6 * 3600e3)) {
    await push(env, { title: '서울 서버 응답 없음', body: (age == null ? '바이낸스 데모 기록을 읽지 못했어요.' : Math.round(age / 60 * 10) / 10 + '시간째 보고가 없어요.') + ' 데모 손절 주문은 거래소에 걸려 있어 그대로 작동하지만, 추적 손절 이동·정리는 멈춰요. Lightsail 에서 서버 상태를 확인해 주세요.', url: './index.html#demo', tag: 'snw-watch' }, log);
    st.alertAt = now; st.down = true;
  } else if (!down && st.down) { await push(env, { title: '서울 서버 복구', body: '바이낸스 데모 계좌 확인이 다시 정상으로 돌아요.', url: './index.html#demo', tag: 'snw-watch' }, log); st.down = false; st.alertAt = null; }
  // 통합 자산 방어가 새로 작동했으면 알림 (처음 실행 때는 지난 기록을 알리지 않고 표시만)
  const G = X && X.guard && X.guard.events ? X.guard.events : [], last = st.guardSeen || null, fresh = last ? G.filter((e) => e.t > last) : [];
  if (G.length) st.guardSeen = G.reduce((m, e) => (e.t > m ? e.t : m), last || '');
  if (fresh.length) { const NM = { mk3: '민경기', rs: '류신영', sc1: '조심형', sc2: '적극형', sc3: 'AI 다수결' };
    await push(env, { title: '통합 자산 방어 작동 ' + fresh.length + '건', body: fresh.slice(0, 3).map((e) => (NM[e.bot] || e.bot) + ' ' + e.sym.replace('USDT', '') + ' 진입 막음 — ' + e.why).join('\n'), url: './index.html#demo', tag: 'snw-guard' }, log); }
  // 민경기 매매법 감시 단계가 바뀌면 알림 (정상→주의→경고→비상 정지, 또는 회복)
  try { const G = JSON.parse(readFileSync(join(dir, 'mg-live.json'), 'utf8')), W = G.live && G.live.watch;
    if (W) { const prevLv = st.mgLevel == null ? W.level : st.mgLevel;
      if (W.level !== prevLv) await push(env, { title: '민경기 매매법 ' + W.label + (W.level < prevLv ? ' (회복)' : ''), body: W.why.length ? W.why.slice(0, 3).join('\n') : '6년 기준 안으로 돌아왔어요.', url: './index.html#bot/mg', tag: 'snw-mgwatch' }, log);
      st.mgLevel = W.level; } } catch (e) { /* 아직 없음 */ }
  st.lastAge = age == null ? null : Math.round(age); st.checkedAt = new Date(now).toISOString();
  mkdirSync(dir, { recursive: true }); writeFileSync(f, JSON.stringify(st)); return st;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run().catch((e) => { console.error('✗ 감시자: ' + e.message); });
