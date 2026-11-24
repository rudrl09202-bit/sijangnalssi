/* AI 회의 (COUNCIL): Claude · Gemini · GPT 세 명이 같은 자료를 보고 진입 찬성/반대 투표
 * - 엔진(FLUX)이 찾은 후보만 심사. AI는 크기·손절·레버리지를 바꿀 수 없음
 * - 셋 다 찬성(yes)일 때만 진입. 키가 없거나 응답 실패 = 찬성 아님
 * - 키: GitHub Secrets ANTHROPIC_API_KEY · GEMINI_API_KEY · OPENAI_API_KEY
 * - 모델(선택): ANTHROPIC_MODEL · GEMINI_MODEL · OPENAI_MODEL
 */
export const VOTERS = [
  { id: 'claude', name: 'Claude', key: 'ANTHROPIC_API_KEY', model: 'ANTHROPIC_MODEL', def: 'claude-sonnet-5-5' },
  { id: 'gemini', name: 'Gemini', key: 'GEMINI_API_KEY', model: 'GEMINI_MODEL', def: 'gemini-3.6-flash', backup: ['gemini-flash-latest', 'gemini-3.5-flash-lite'] },
  { id: 'gpt', name: 'GPT', key: 'OPENAI_API_KEY', model: 'OPENAI_MODEL', def: 'gpt-5.5' }
];

const SYSTEM = `당신은 코인 무기한 선물 트레이딩 데스크의 진입 심사위원입니다.
규칙 기반 추세추종 엔진이 진입 후보 하나를 올렸습니다. 당신은 그 후보를 승인(yes)할지 거절(no)할지만 정합니다.
- 포지션 크기·손절가·레버리지는 금고 규칙으로 고정되어 있어 당신이 바꿀 수 없습니다.
- 승인되면 계좌의 2.5%를 거는 공격적인 진입이 됩니다. 추세·장세·변동성·위치(추격 매수/과열 여부)·BTC 방향을 보고 판단하세요.
- 주어진 자료만 근거로 하세요. 그 시점 이후의 가격을 안다고 가정하지 마세요.
반드시 JSON 한 줄로만 답하세요: {"vote":"yes" 또는 "no","confidence":0~100 정수,"reason":"한국어 한 문장(60자 이내)"}`;

const withTimeout = (ms) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); return { signal: c.signal, done: () => clearTimeout(t) }; };
export function parseVote(text) {
  const m = String(text || '').match(/\{[\s\S]*?\}/);
  if (!m) throw new Error('JSON 없음');
  const j = JSON.parse(m[0]);
  const vote = String(j.vote || '').toLowerCase().trim();
  if (vote !== 'yes' && vote !== 'no') throw new Error('vote 값 이상: ' + j.vote);
  return { vote, confidence: Math.max(0, Math.min(100, Math.round(Number(j.confidence) || 0))), reason: String(j.reason || '').slice(0, 120) };
}

export async function askClaude(key, model, user, fetchImpl, system = SYSTEM, maxTokens = 300) {
  const to = withTimeout(120000);
  try {
    const r = await fetchImpl('https://api.anthropic.com/v1/messages', { method: 'POST', signal: to.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }) });
    const j = await r.json(); if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + ((j.error && j.error.message) || ''));
    const text = (j.content || []).map((c) => c.text || '').join('');
    if (!text.trim()) throw new Error('빈 응답(stop_reason=' + j.stop_reason + ', 블록=' + (j.content || []).map((c) => c.type).join('/') + ')');
    return text;
  } finally { to.done(); }
}
export async function askGemini(key, model, user, fetchImpl, system = SYSTEM, maxTokens = 300) {
  const to = withTimeout(70000);
  try {
    const r = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', { method: 'POST', signal: to.signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { responseMimeType: 'application/json' } }) });
    const j = await r.json(); if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + ((j.error && j.error.message) || ''));
    return (((j.candidates || [])[0] || {}).content || { parts: [] }).parts.map((p) => p.text || '').join('');
  } finally { to.done(); }
}
export async function askGpt(key, model, user, fetchImpl, system = SYSTEM, maxTokens = 300) {
  const to = withTimeout(150000);
  try {
    const r = await fetchImpl('https://api.openai.com/v1/chat/completions', { method: 'POST', signal: to.signal,
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], response_format: { type: 'json_object' } }) });
    const j = await r.json(); if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + ((j.error && j.error.message) || ''));
    return ((j.choices || [])[0] || { message: {} }).message.content || '';
  } finally { to.done(); }
}
const ASK = { claude: askClaude, gemini: askGemini, gpt: askGpt };

export function keyStatus(env) { const o = {}; VOTERS.forEach((v) => { o[v.id] = !!env[v.key]; }); return o; }

// 세 명에게 동시에 묻고 결과 모으기
export async function vote(env, brief, fetchImpl = fetch) {
  const user = '후보 자료(JSON):\n' + JSON.stringify(brief);
  const res = await Promise.all(VOTERS.map(async (v) => {
    const key = env[v.key], model = env[v.model] || v.def;
    if (!key) return { ai: v.id, name: v.name, model, vote: 'none', confidence: 0, reason: '키 등록 전' };
    const t0 = Date.now();
    // 같은 회사의 다른 모델로 넘어가며 시도 (바쁨 503·시간 초과 대비). 첫 모델은 한 번 더 재시도
    const tries = [model, model].concat((v.backup || []).filter((m) => m !== model));
    let msg = '';
    for (let k = 0; k < tries.length; k++) {
      try { const t = await ASK[v.id](key, tries[k], user, fetchImpl); return { ai: v.id, name: v.name, model: tries[k], sec: Math.round((Date.now() - t0) / 1000), ...parseVote(t) }; }
      catch (e) {
        msg = e && e.name === 'AbortError' ? '시간 초과' : String(e.message || e);
        if (/HTTP 40[13]/.test(msg)) break; // 키 문제면 다른 모델도 소용없음
        if (/HTTP (429|5\d\d)/.test(msg)) await new Promise((r) => setTimeout(r, 3000));
      }
    }
    return { ai: v.id, name: v.name, model, sec: Math.round((Date.now() - t0) / 1000), vote: 'error', confidence: 0, reason: '응답 실패: ' + msg.slice(0, 80) };
  }));
  const yes = res.filter((x) => x.vote === 'yes').length;
  const result = res.some((x) => x.vote === 'none') ? 'nokey' : yes === VOTERS.length ? 'approved' : 'rejected';
  return { votes: res, yes, result };
}

// 연결 시험: node connect/council.mjs --ping  (키 값은 절대 출력하지 않음)
import { fileURLToPath as _f } from 'node:url';
if (process.argv[1] && _f(import.meta.url) === process.argv[1] && process.argv.includes('--ping')) {
  const sample = { 시험: '연결 확인용 가상 후보입니다. 실제 매매와 무관합니다.', 코인: '비트코인(BTC)', 방향: '롱', 신호: '40봉 고점 돌파 + 50/200 EMA 정배열',
    현재가: 100000, 손절가: 95000, 손절거리_퍼센트: 5, EMA50: 97000, EMA200: 90000, ATR_퍼센트: 2, BTC: { 장세: '상승장(200일선 위)' } };
  const t0 = Date.now();
  vote(process.env, sample).then((r) => {
    r.votes.forEach((v) => console.log((v.vote === 'yes' || v.vote === 'no' ? '✓ ' : '✗ ') + v.name + ' (' + v.model + ', ' + v.sec + '초): ' + v.vote + ' · ' + v.reason));
    console.log('결과: ' + r.result + ' · ' + ((Date.now() - t0) / 1000).toFixed(1) + '초');
    if (r.votes.some((v) => v.vote === 'none' || v.vote === 'error')) process.exitCode = 1;
  });
}
