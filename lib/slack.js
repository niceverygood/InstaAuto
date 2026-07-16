require('./env');
const { loadSettings } = require('./settings');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * 슬랙에 표시되는 "보낸 봇"은 웹훅/토큰을 소유한 Slack 앱이다.
 * 바틀봇으로 보내려면 .env 에 바틀봇 앱의 자격을 넣으면 된다:
 *   - SLACK_BOT_TOKEN=xoxb-… + SLACK_CHANNEL_ID=C… (chat.postMessage, 우선 사용)
 *   - 또는 SLACK_WEBHOOK_URL 을 바틀봇 앱의 웹훅 URL 로 교체
 */
function botConfig() {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_CHANNEL_ID || process.env.SLACK_CHANNEL;
  return token && channel ? { token, channel } : null;
}

function webhookUrl() {
  if (process.env.SLACK_WEBHOOK_URL) return process.env.SLACK_WEBHOOK_URL;
  try {
    return loadSettings().slackWebhookUrl || null; // 하위호환 (신규 셋업은 .env 사용 권장)
  } catch {
    return null;
  }
}

async function postViaBot({ token, channel }, message) {
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ channel, text: message }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    const err = new Error(`chat.postMessage 실패: ${data.error || `HTTP ${res.status}`}`);
    err.permanent = res.status < 500; // invalid_auth/channel_not_found 등은 retry 무의미
    throw err;
  }
}

async function postViaWebhook(url, message) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: message }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`HTTP ${res.status} ${body}`.trim());
    err.permanent = res.status < 500; // 4xx는 retry 무의미
    throw err;
  }
}

async function sendSlack(message, { retries = 3 } = {}) {
  const bot = botConfig();
  const url = bot ? null : webhookUrl();
  if (!bot && !url) {
    console.log('[slack] webhook not set, skip:', message);
    return false;
  }
  let lastErr = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (bot) await postViaBot(bot, message);
      else await postViaWebhook(url, message);
      return true;
    } catch (err) {
      lastErr = err;
      console.error(`[slack] error (${attempt}/${retries}): ${err.message}`);
      if (err.permanent) return false;
    }
    if (attempt < retries) await sleep(2000 * attempt);
  }
  console.error(`[slack] all ${retries} attempts failed: ${lastErr?.message}`);
  return false;
}

module.exports = { sendSlack };
