#!/usr/bin/env node
/*
 * 시장날씨 — 푸시 알림 키 만들기 (한 번만 실행)
 *  - VAPID 키 한 쌍을 만들어 connect/.env 에 저장하고, 공개키를 js/config.js 에 넣습니다.
 *  - 이미 키가 있으면 그대로 씁니다(키를 바꾸면 휴대폰에서 알림을 다시 켜야 하므로).
 *  - 화면에 나오는 값을 GitHub 저장소 Settings → Secrets 에 넣습니다.
 * 실행: 이 폴더에서  node push-setup.mjs  [이메일]
 */
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV = join(HERE, '.env'), CONFIG = join(HERE, '..', 'js', 'config.js');
const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export function makeVapidKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = publicKey.export({ format: 'jwk' }), pri = privateKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), fromB64u(pub.x), fromB64u(pub.y)]); // 65바이트 비압축 공개키
  return { publicKey: b64u(raw), privateKey: pri.d };
}
function readEnv() {
  const env = {}; if (!existsSync(ENV)) return env;
  for (const line of readFileSync(ENV, 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
  return env;
}
export function setEnv(text, key, val) {
  const re = new RegExp('^\\s*' + key + '\\s*=.*$', 'm');
  return re.test(text) ? text.replace(re, key + '=' + val) : (text.replace(/\s*$/, '') + '\n' + key + '=' + val + '\n');
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const env = readEnv();
  let keys = env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY } : null;
  const fresh = !keys;
  if (!keys) keys = makeVapidKeys();
  const email = process.argv[2] || env.SEC_CONTACT || env.VAPID_EMAIL || '';
  let text = existsSync(ENV) ? readFileSync(ENV, 'utf8') : '';
  text = setEnv(setEnv(text, 'VAPID_PUBLIC_KEY', keys.publicKey), 'VAPID_PRIVATE_KEY', keys.privateKey);
  if (email) text = setEnv(text, 'VAPID_EMAIL', email);
  writeFileSync(ENV, text);
  writeFileSync(CONFIG, "/* 시장날씨 — 설정. connect/push-setup.mjs 가 채웁니다. (공개해도 되는 값) */\nwindow.SNW_CONFIG = { vapidPublicKey: '" + keys.publicKey + "' };\n");
  console.log(fresh ? '✓ 새 알림 키를 만들었습니다.' : '✓ 기존 알림 키를 그대로 씁니다.');
  console.log('  js/config.js 에 공개키를 넣었고, connect/.env 에 두 키를 저장했습니다.\n');
  console.log('GitHub 저장소 → Settings → Secrets and variables → Actions → New repository secret 에 아래를 하나씩 넣으세요:\n');
  console.log('  VAPID_PUBLIC_KEY  = ' + keys.publicKey);
  console.log('  VAPID_PRIVATE_KEY = (connect/.env 파일의 VAPID_PRIVATE_KEY 줄 값 — 화면에 띄우지 않았습니다)');
  console.log('  VAPID_EMAIL       = ' + (email || '(본인 이메일)'));
  if (!email) console.log('\n※ 이메일을 같이 쓰려면:  node push-setup.mjs 내이메일@example.com');
}
