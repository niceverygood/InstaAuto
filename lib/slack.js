require('./env');
const { loadSettings } = require('./settings');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function webhookUrl() {
  if (process.env.SLACK_WEBHOOK_URL) return process.env.SLACK_WEBHOOK_URL;
  try {
    return loadSettings().slackWebhookUrl || null; // 하위호환 (신규 셋업은 .env 사용 권장)
  } catch {
    return null;
  }
}

async function sendSlack(message, { retries = 3 } = {}) {
  const url = webhookUrl();
  if (!url) {
    console.log('[slack] webhook not set, skip:', message);
    return false;
  }
  let lastErr = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`[slack] failed (${attempt}/${retries}): ${res.status} ${body}`);
        if (res.status < 500) return false; // 4xx는 retry 무의미
        lastErr = new Error(`HTTP ${res.status}`);
      } else {
        return true;
      }
    } catch (err) {
      lastErr = err;
      console.error(`[slack] error (${attempt}/${retries}): ${err.message}`);
    }
    if (attempt < retries) await sleep(2000 * attempt);
  }
  console.error(`[slack] all ${retries} attempts failed: ${lastErr?.message}`);
  return false;
}

module.exports = { sendSlack };
