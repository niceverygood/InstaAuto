/**
 * .env 파일 로더 (외부 의존성 없음, workspace.js 의존 없음 — 순환 참조 방지).
 * 비밀키를 쓰는 모든 lib(r2.js, slack.js, aiImage.js)가 자체적으로 require 해서
 * 호출 순서에 상관없이 안전하게 동작.
 */
const fs = require('fs');
const path = require('path');

const ENV_FILE = path.join(__dirname, '..', '.env');

function loadEnv() {
  if (!fs.existsSync(ENV_FILE)) return;
  const content = fs.readFileSync(ENV_FILE, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv();

module.exports = { loadEnv };
