#!/usr/bin/env node
/**
 * 인스타그램 웹 자동 업로드 (Phase 2)
 *
 * persistent 프로필로 instagram.com 접속 → 만들기 → 이미지 업로드 →
 * 원본 비율 선택 → 다음×2 → 캡션 입력 → 공유 → 성공 문구 검증.
 *
 * 거짓 성공 방지: 공유 후 "공유되었습니다" 문구를 명시 확인 못 하면 exit 1.
 * 세션 만료: exit 2 (LOGIN_REQUIRED)
 *
 * Usage: node scripts/post-instagram.js <accountId> <imagePath> <captionPath>
 */
const fs = require('fs');
const path = require('path');
const browser = require('../lib/browser');
const { loadSettings, getAccount } = require('../lib/settings');
const { LOGS_DIR } = require('../lib/workspace');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function clickFirst(page, selectors, { timeout = 6000, optional = false, name = '' } = {}) {
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      await loc.waitFor({ state: 'visible', timeout });
      await loc.click({ timeout: 5000 });
      return true;
    } catch { /* 다음 셀렉터 시도 */ }
  }
  if (!optional) throw new Error(`요소를 찾지 못함: ${name || selectors[0]}`);
  return false;
}

// "나중에 하기" / "Not Now" 류 팝업 정리
async function dismissPopups(page) {
  const dismissSelectors = [
    'button:has-text("나중에 하기")',
    'div[role="button"]:has-text("나중에 하기")',
    'button:has-text("Not Now")',
    'div[role="button"]:has-text("Not Now")',
  ];
  for (let i = 0; i < 3; i++) {
    const clicked = await clickFirst(page, dismissSelectors, { timeout: 2500, optional: true });
    if (!clicked) break;
    await sleep(1000);
  }
}

async function saveShot(page, label) {
  try {
    const dir = path.join(LOGS_DIR, 'shots');
    fs.mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const p = path.join(dir, `${label}-${ts}.png`);
    await page.screenshot({ path: p, fullPage: false });
    console.log(`   📸 스크린샷: ${p}`);
  } catch { /* 스크린샷 실패는 무시 */ }
}

async function postToInstagram(accountId, imagePath, captionText) {
  const settings = loadSettings();
  const account = getAccount(accountId);

  if (!browser.profileExists(accountId)) {
    console.error(`LOGIN_REQUIRED: 프로필 없음. 먼저 실행: node scripts/login-instagram.js ${accountId}`);
    process.exit(2);
  }

  console.log(`[업로드] @${account.username} 브라우저 시작 (headless=${settings.headlessPosting})...`);
  const { context, close } = await browser.launch(accountId, { headless: settings.headlessPosting });
  const page = context.pages()[0] || await context.newPage();

  try {
    // 1. 접속 + 로그인 확인 (sessionid 쿠키가 가장 확실한 판별)
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(5000);
    await dismissPopups(page);

    const hasSession = await browser.hasInstagramSession(context);
    const loginNeeded =
      !hasSession ||
      page.url().includes('/accounts/login') ||
      await page.locator('input[name="username"]').first().isVisible().catch(() => false);
    if (loginNeeded) {
      console.error(`LOGIN_REQUIRED: 세션 만료. 다시 실행: node scripts/login-instagram.js ${accountId}`);
      process.exit(2);
    }
    console.log('   ✅ 로그인 세션 유효');

    // 2. 만들기(새 게시물) 진입
    console.log('[업로드] 만들기 메뉴 진입...');
    await clickFirst(page, [
      'svg[aria-label="새로운 게시물"]',
      'svg[aria-label="새 게시물"]',
      'svg[aria-label="New post"]',
      'svg[aria-label="만들기"]',
      'svg[aria-label="Create"]',
      'a:has-text("만들기")',
      'div[role="button"]:has-text("만들기")',
    ], { timeout: 10000, name: '만들기 버튼' });
    await sleep(1500);

    // 신형 UI: 만들기 클릭 시 "게시 / 릴스 / 라이브 방송" 서브메뉴가 뜨는 경우
    await clickFirst(page, [
      'svg[aria-label="게시물"] ~ *',
      'a:has-text("게시")',
      'div[role="button"]:has-text("게시")',
      'span:text-is("게시")',
      'a:has-text("Post")',
      'span:text-is("Post")',
    ], { timeout: 3000, optional: true });
    await sleep(1500);

    // 3. 파일 업로드 다이얼로그 (쉼표 구분 다중 이미지 = 캐러셀)
    const files = imagePath.split(',').map(s => s.trim()).filter(Boolean);
    console.log(`[업로드] 이미지 파일 첨부 (${files.length}장)...`);
    const fileInput = page.locator('div[role="dialog"] input[type="file"], form[enctype="multipart/form-data"] input[type="file"], input[type="file"]').first();
    await fileInput.waitFor({ state: 'attached', timeout: 15000 });
    await fileInput.setInputFiles(files);
    await sleep(4000);

    // "동영상 게시물은 릴스로 공유됩니다" 안내 모달 (이미지엔 안 뜨지만 방어)
    await clickFirst(page, ['button:has-text("확인")', 'button:has-text("OK")'], { timeout: 2000, optional: true });

    // 4. 자르기 단계 — 원본 비율(4:5 유지) 선택 (실패해도 진행)
    console.log('[업로드] 원본 비율 선택 (best-effort)...');
    const cropOpened = await clickFirst(page, [
      'svg[aria-label="자르기 선택"]',
      'svg[aria-label="Select crop"]',
      'svg[aria-label="사진 크기 선택"]',
    ], { timeout: 4000, optional: true });
    if (cropOpened) {
      await sleep(800);
      await clickFirst(page, [
        'span:text-is("원본")',
        'div[role="button"]:has-text("원본")',
        'span:text-is("Original")',
      ], { timeout: 3000, optional: true });
      await sleep(800);
      // 메뉴 닫기 (같은 버튼 재클릭)
      await clickFirst(page, ['svg[aria-label="자르기 선택"]', 'svg[aria-label="Select crop"]'], { timeout: 2000, optional: true });
    }

    // 5. 다음 ×2 (자르기 → 편집 → 상세)
    for (let step = 1; step <= 2; step++) {
      console.log(`[업로드] 다음 (${step}/2)...`);
      await clickFirst(page, [
        'div[role="dialog"] div[role="button"]:text-is("다음")',
        'div[role="button"]:text-is("다음")',
        'button:has-text("다음")',
        'div[role="dialog"] div[role="button"]:text-is("Next")',
        'div[role="button"]:text-is("Next")',
      ], { timeout: 15000, name: `다음 버튼(${step})` });
      await sleep(2500);
    }

    // 6. 캡션 입력
    console.log('[업로드] 캡션 입력...');
    const captionBox = page.locator([
      'div[role="dialog"] div[contenteditable="true"][aria-label*="문구"]',
      'div[role="dialog"] div[contenteditable="true"][aria-label*="caption" i]',
      'div[role="dialog"] div[contenteditable="true"]',
    ].join(', ')).first();
    await captionBox.waitFor({ state: 'visible', timeout: 15000 });
    await captionBox.click();
    await sleep(500);
    await page.keyboard.insertText(captionText);
    await sleep(1500);

    // 7. 공유
    console.log('[업로드] 공유하기 클릭...');
    await clickFirst(page, [
      'div[role="dialog"] div[role="button"]:text-is("공유하기")',
      'div[role="button"]:text-is("공유하기")',
      'button:has-text("공유하기")',
      'div[role="dialog"] div[role="button"]:text-is("Share")',
      'div[role="button"]:text-is("Share")',
    ], { timeout: 10000, name: '공유하기 버튼' });

    // 8. 결과 검증 (거짓 성공 방지 — 성공 문구를 명시적으로 확인)
    console.log('[업로드] 게시 완료 대기 (최대 3분)...');
    const successLocator = page.locator(
      'text=/공유되었습니다|게시물이 공유|has been shared|Post shared/'
    ).first();
    const failLocator = page.locator(
      'text=/공유하지 못했|게시물을 공유할 수 없|couldn\'t be shared|Something went wrong|문제가 발생/'
    ).first();

    const deadline = Date.now() + 180000;
    let result = null;
    while (Date.now() < deadline) {
      if (await successLocator.isVisible().catch(() => false)) { result = 'success'; break; }
      if (await failLocator.isVisible().catch(() => false)) { result = 'fail'; break; }
      await sleep(3000);
    }

    if (result !== 'success') {
      await saveShot(page, `post-fail-${accountId}`);
      throw new Error(result === 'fail' ? '인스타그램이 공유 실패 응답' : '성공 문구 확인 타임아웃 (3분)');
    }

    console.log('✅ 게시물 공유 완료 확인');
    await sleep(3000);
    return true;
  } catch (err) {
    await saveShot(page, `error-${accountId}`);
    throw err;
  } finally {
    await close().catch(() => {});
  }
}

module.exports = { postToInstagram };

if (require.main === module) {
  (async () => {
    const [accountId, imagePath, captionPath] = process.argv.slice(2);
    if (!accountId || !imagePath || !captionPath) {
      console.error('사용법: node scripts/post-instagram.js <accountId> <imagePath[,path2,...]> <captionPath>');
      process.exit(1);
    }
    for (const p of imagePath.split(',').map(s => s.trim()).filter(Boolean)) {
      if (!fs.existsSync(p)) { console.error(`이미지 없음: ${p}`); process.exit(1); }
    }
    if (!fs.existsSync(captionPath)) { console.error(`캡션 없음: ${captionPath}`); process.exit(1); }
    const caption = fs.readFileSync(captionPath, 'utf-8').trim();
    try {
      await postToInstagram(accountId, imagePath, caption);
      process.exit(0);
    } catch (err) {
      console.error(`❌ 업로드 실패: ${err.message}`);
      process.exit(1);
    }
  })();
}
