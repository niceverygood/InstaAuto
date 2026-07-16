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

function tail(s, n) {
  const t = (s || '').toString().trim();
  return t.length > n ? '…' + t.slice(-n) : t;
}

/**
 * claude 비정상 종료를 사람이 읽을 수 있는 에러로 변환.
 * -p 모드에서 claude 는 사용 한도/로그인 만료 같은 오류를 stdout 에 찍고
 * non-zero 로 종료하는데, execSync 의 "Command failed" 메시지에는 stderr 만
 * 붙기 때문에 stdout 을 직접 읽지 않으면 원인이 사라진다.
 * retryable === false 면 즉시 재시도 무의미 (한도 리셋/재로그인 필요).
 */
function describeFailure(err) {
  const stdout = (err.stdout || '').toString();
  const stderr = (err.stderr || '').toString();
  const combined = `${stdout}\n${stderr}`;

  if (err.code === 'ETIMEDOUT' || err.signal === 'SIGTERM') {
    const e = new Error('claude CLI 응답 시간 초과');
    e.retryable = true;
    return e;
  }

  const limit = combined.match(/usage limit reached\|?(\d{10,13})?/i);
  if (limit) {
    let until = '';
    if (limit[1]) {
      const ms = limit[1].length >= 13 ? Number(limit[1]) : Number(limit[1]) * 1000;
      until = ` (${new Date(ms).toLocaleString('ko-KR', { hour12: false })} 리셋)`;
    }
    const e = new Error(`⏳ Claude 구독 사용 한도 도달${until} — 리셋 이후 회차에서 자동 재시도됩니다`);
    e.retryable = false;
    return e;
  }

  if (/invalid api key|please run \/login|not logged in|authentication_error|oauth token (has )?(expired|been revoked)/i.test(combined)) {
    const e = new Error('🔑 claude CLI 인증 만료 — 터미널에서 `claude` 실행 후 `/login` 필요');
    e.retryable = false;
    return e;
  }

  const detail = tail(stderr, 200) || tail(stdout, 200) || '(출력 없음)';
  const e = new Error(`claude CLI 실패 (exit ${err.status ?? '?'}): ${detail}`);
  e.retryable = true;
  return e;
}

function callClaude(prompt, { model = 'sonnet', timeoutMs = 10 * 60 * 1000 } = {}) {
  const run = (toolsFlag) => execSync(
    `"${CLAUDE_BIN}" --print --max-turns 5 --model ${model}${toolsFlag}`,
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

  try {
    return (run(' --tools ""') || '').trim();
  } catch (err) {
    // CLI 버전에 따라 --tools 플래그가 없을 수 있음 → 플래그 없이 1회 호환 재시도
    if (/unknown option.*--tools/i.test(`${err.stderr || ''}${err.message || ''}`)) {
      try {
        return (run('') || '').trim();
      } catch (err2) {
        throw describeFailure(err2);
      }
    }
    throw describeFailure(err);
  }
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
