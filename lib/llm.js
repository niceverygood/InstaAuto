/**
 * claude CLI 래퍼 — 구독 사용, API 크레딧 안 씀.
 * (wishket-automation phase1 의 검증된 hang 방지 옵션 그대로 사용)
 */
const fs = require('fs');
const { execSync } = require('child_process');

function findClaudeBin() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const home = process.env.HOME || `/Users/${process.env.USER || ''}`;
  const candidates = [
    `${home}/.npm-global/bin/claude`,
    `${home}/.local/bin/claude`,
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  try {
    return execSync('which claude', { encoding: 'utf-8' }).trim();
  } catch {}
  return 'claude';
}

const CLAUDE_BIN = findClaudeBin();

function callClaude(prompt, { model = 'sonnet', timeoutMs = 10 * 60 * 1000 } = {}) {
  const out = execSync(
    `"${CLAUDE_BIN}" --print --max-turns 5 --model ${model} --tools ""`,
    {
      input: prompt,
      encoding: 'utf-8',
      maxBuffer: 20 * 1024 * 1024,
      timeout: timeoutMs,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: [
          (process.env.HOME || '') + '/.npm-global/bin',
          (process.env.HOME || '') + '/.local/bin',
          '/opt/homebrew/bin',
          '/usr/local/bin',
          '/usr/bin',
          '/bin',
          process.env.PATH,
        ].filter(Boolean).join(':'),
      },
    }
  );
  return (out || '').trim();
}

/**
 * LLM 응답에서 JSON 오브젝트 추출. ```json fence 우선, 없으면 첫 { ~ 마지막 }.
 */
function extractJson(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(candidate);
}

module.exports = { callClaude, extractJson, CLAUDE_BIN };
