#!/usr/bin/env node
/**
 * 인스타그램 로그인 헬퍼 — 계정당 한 번만 실행해서 세션 저장.
 *
 * Usage: node scripts/login-instagram.js <accountId>
 *
 * 100% 순정 Chrome (자동화 플래그 0개, 디버그 연결 0개) 이 뜬다.
 * 로그인 완료 후 Chrome 을 ⌘Q 로 완전히 종료하면,
 * 그때 쿠키 저장소를 오프라인으로 읽어 세션을 검증한다.
 */
const browser = require('../lib/browser');
const { getAccount } = require('../lib/settings');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const accountId = process.argv[2];
  if (!accountId) {
    console.error('사용법: node scripts/login-instagram.js <accountId>  (예: bobi)');
    process.exit(1);
  }
  const account = getAccount(accountId);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🔐 인스타그램 로그인: ${account.displayName} (@${account.username})`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 이미 세션 있으면 스킵
  if (browser.profileExists(accountId) && await browser.checkSessionOffline(accountId)) {
    console.log('✅ 이미 로그인되어 있습니다. 세션 유효 — 그대로 사용합니다.');
    process.exit(0);
  }

  const proc = browser.spawnPlain(accountId, 'https://www.instagram.com/');

  const quitHint = process.platform === 'darwin'
    ? 'Chrome 을 ⌘Q 로 완전히 종료 (창만 닫지 말고 꼭 ⌘Q!)'
    : '이 Chrome 창을 모두 닫아서 완전히 종료';
  console.log('순정 Chrome 창이 열렸습니다 (자동화 연결 일절 없음).\n');
  console.log(`  1. @${account.username} 계정으로 로그인`);
  console.log('  2. ("로그인 정보 저장" 물으면 → 정보 저장)');
  console.log(`  3. 홈 피드가 보이면 → ${quitHint}`);
  console.log('     (그래야 세션 검증이 시작됩니다)\n');
  console.log('Chrome 종료를 기다리는 중... (창이 안 닫히면 터미널에 Enter 를 눌러도 됩니다)');

  // Chrome 종료 대기 (또는 터미널 Enter)
  await new Promise(resolve => {
    proc.once('exit', () => resolve());
    process.stdin.resume();
    process.stdin.once('data', () => {
      // 사용자가 Enter — 이 프로필의 Chrome 강제 종료
      browser.killChromeByProfile(browser.profileDir(accountId));
      resolve();
    });
  });
  process.stdin.pause();

  console.log('\nChrome 종료 감지. 세션 검증 중 (오프라인 쿠키 확인)...');
  await sleep(2000); // 쿠키 flush 여유

  const ok = await browser.checkSessionOffline(accountId);
  if (ok) {
    console.log(`\n✅ 로그인 세션 확인 완료! 이제 자동 업로드 시 @${account.username} 로 자동 로그인됩니다.`);
    process.exit(0);
  } else {
    console.error('\n❌ 세션이 저장되지 않았습니다 (로그인이 안 끝났거나 캡차에서 막힘).');
    console.error(`   다시 실행: node scripts/login-instagram.js ${accountId}`);
    process.exit(1);
  }
})();
