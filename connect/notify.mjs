/* 알림 보조: 텔레그램 (설정돼 있을 때만) */
// 텔레그램으로도 보내기 (TELEGRAM_BOT_TOKEN · TELEGRAM_CHAT_ID 가 있을 때만) — 폰 웹 알림이 안 올 때 대비
export async function telegram(env, payload, log = () => {}) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return 0;
  try {
    const url = (payload.url || '').replace(/^\.\//, 'https://' + (env.APP_HOST || 'rudrl09202-bit.github.io/sijangnalssi') + '/');
    const r = await fetch('https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/sendMessage', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: '📈 ' + (payload.title || '시장날씨') + '\n' + (payload.body || '') + (url ? '\n' + url : ''), disable_web_page_preview: true }) });
    if (!r.ok) { log('텔레그램 실패: HTTP ' + r.status); return 0; }
    return 1;
  } catch (e) { log('텔레그램 실패: ' + e.message); return 0; }
}
