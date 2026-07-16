/**
 * 브라우저 헬퍼 — CDP 연결 방식.
 *
 * Playwright 로 Chrome 을 직접 launch 하면 --no-sandbox, --enable-automation 등
 * 자동화 플래그가 수십 개 붙어서 Meta reCAPTCHA Enterprise 가 즉시 감지한다
 * (풀어도 무한 반복). 대신:
 *
 *   1. 실제 Google Chrome 을 최소 플래그(프로필 + 디버그 포트)로 직접 spawn
 *   2. chromium.connectOverCDP 로 연결해서 조종
 *
 * → JS 핑거프린트가 일반 Chrome 과 동일 (navigator.webdriver=false, 배너 없음).
 * 계정별 프로필(.browser-profiles/<accountId>)로 세션 유지.
 */
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const { chromium } = require('playwright');
const { WORKSPACE } = require('./workspace');

const PROFILE_ROOT = path.join(WORKSPACE, '.browser-profiles');

function findChromeBin() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const candidates = process.platform === 'win32'
    ? [
        `${process.env['ProgramFiles'] || 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env.LOCALAPPDATA || ''}\\Google\\Chrome\\Application\\chrome.exe`,
      ]
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser'];
  return candidates.find(p => p && fs.existsSync(p)) || candidates[0];
}

const CHROME_BIN = findChromeBin();

/** 이 프로필 디렉토리를 쓰는 Chrome 프로세스만 강제 종료 (플랫폼별) */
function killChromeByProfile(dir) {
  try {
    if (process.platform === 'win32') {
      execSync(
        `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*${dir}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`,
        { stdio: 'ignore' }
      );
    } else {
      execSync(`pkill -f -- "--user-data-dir=${dir}"`, { stdio: 'ignore' });
    }
  } catch {}
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function profileDir(accountId) {
  return path.join(PROFILE_ROOT, accountId);
}

function profileExists(accountId) {
  return fs.existsSync(path.join(profileDir(accountId), 'Default'));
}

// 계정별 고정 디버그 포트 (9333~10332)
function portForAccount(accountId) {
  let h = 0;
  for (const c of accountId) h = (h * 31 + c.charCodeAt(0)) % 1000;
  return 9333 + h;
}

async function waitForCDP(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch { /* 아직 안 뜸 */ }
    await sleep(500);
  }
  throw new Error(`Chrome CDP 포트(${port}) 응답 없음`);
}

/**
 * 깨끗한 실제 Chrome 실행 + CDP 연결.
 * @returns {{ context, browser, close: () => Promise<void> }}
 */
async function launch(accountId, { headless = false, startUrl = 'about:blank' } = {}) {
  if (!fs.existsSync(CHROME_BIN)) {
    throw new Error('Google Chrome 이 설치되어 있지 않습니다 — https://www.google.com/chrome/ 에서 설치 (또는 .env 에 CHROME_BIN=<경로> 지정)');
  }
  const dir = profileDir(accountId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const port = portForAccount(accountId);

  const args = [
    `--user-data-dir=${dir}`,
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-crash-restore-bubble',
    '--disable-session-crashed-bubble',
    '--window-size=1440,960',
    '--lang=ko-KR',
  ];
  if (headless) args.push('--headless=new');
  args.push(startUrl);

  const proc = spawn(CHROME_BIN, args, { stdio: 'ignore' });
  await waitForCDP(port);

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  if (!context) throw new Error('CDP 연결됐지만 컨텍스트 없음');

  const close = async () => {
    try { await browser.close(); } catch {}
    try { proc.kill('SIGTERM'); } catch {}
    // 혹시 남은 인스턴스 정리 (프로필 경로가 유니크해서 이 계정 것만 죽음)
    killChromeByProfile(dir);
  };

  return { context, browser, close };
}

async function hasInstagramSession(context) {
  try {
    const cookies = await context.cookies('https://www.instagram.com');
    return cookies.some(c => c.name === 'sessionid' && c.value && c.value.length > 10);
  } catch {
    return false;
  }
}

/**
 * 100% 순정 Chrome 실행 — 디버그 포트도 없음. 로그인 전용.
 * (CDP 연결조차 감지하는 안티봇 대응: 로그인 중에는 어떤 자동화 연결도 하지 않는다)
 */
function spawnPlain(accountId, startUrl = 'https://www.instagram.com/') {
  const dir = profileDir(accountId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const args = [
    `--user-data-dir=${dir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-crash-restore-bubble',
    '--disable-session-crashed-bubble',
    '--window-size=1440,960',
    startUrl,
  ];
  return spawn(CHROME_BIN, args, { stdio: 'ignore' });
}

/**
 * 로그인 여부 오프라인 검증 — 헤드리스로 쿠키 저장소만 읽음.
 * 인스타그램 서버에 요청을 보내지 않아서 어떤 흔적도 안 남는다.
 */
async function checkSessionOffline(accountId) {
  const { context, close } = await launch(accountId, { headless: true, startUrl: 'about:blank' });
  try {
    return await hasInstagramSession(context);
  } finally {
    await close();
  }
}

module.exports = { launch, spawnPlain, checkSessionOffline, profileDir, profileExists, hasInstagramSession, killChromeByProfile, PROFILE_ROOT, CHROME_BIN };
