/* 감시자 — GitHub 봇 루프(15분마다)에서 서울 서버가 살아 있는지 확인
 *  · 서울 서버는 매시 5·20·35·50분에 바이낸스 데모 결과(deriv-data/exec-live.json)를 올림
 *  · 90분 넘게 안 올라오면 휴대폰 알림 (같은 문제는 6시간에 한 번만). 살아나면 "복구" 알림
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
  let at = null; try { const r = await fetchImpl('https://raw.githubusercontent.com/' + repo + '/deriv-data/exec-live.json?t=' + Math.floor(now / 6e4)); if (r.ok) at = Date.parse((await r.json()).at); } catch (e) { /* 못 읽음 */ }
  const age = at ? (now - at) / 60e3 : null, down = age == null || age > 90;
  log('감시자: 서울 서버 마지막 보고 ' + (age == null ? '읽기 실패' : Math.round(age) + '분 전') + (down ? ' — 이상' : ' — 정상'));
  if (down && (!st.alertAt || now - st.alertAt > 6 * 3600e3)) {
    await push(env, { title: '서울 서버 응답 없음', body: (age == null ? '바이낸스 데모 기록을 읽지 못했어요.' : Math.round(age / 60 * 10) / 10 + '시간째 보고가 없어요.') + ' 데모 손절 주문은 거래소에 걸려 있어 그대로 작동하지만, 추적 손절 이동·정리는 멈춰요. Lightsail 에서 서버 상태를 확인해 주세요.', url: './index.html#demo', tag: 'snw-watch' }, log);
    st.alertAt = now; st.down = true;
  } else if (!down && st.down) { await push(env, { title: '서울 서버 복구', body: '바이낸스 데모 계좌 확인이 다시 정상으로 돌아요.', url: './index.html#demo', tag: 'snw-watch' }, log); st.down = false; st.alertAt = null; }
  st.lastAge = age == null ? null : Math.round(age); st.checkedAt = new Date(now).toISOString();
  mkdirSync(dir, { recursive: true }); writeFileSync(f, JSON.stringify(st)); return st;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run().catch((e) => { console.error('✗ 감시자: ' + e.message); });
