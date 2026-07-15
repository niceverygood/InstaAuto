#!/usr/bin/env node
/**
 * 인스타그램 공식 API 업로드 (Phase 2 — 기본 경로)
 *
 * 카드 이미지들을 R2 공개 URL로 올린 뒤 Graph API 로 발행.
 * 1장이면 단일 게시물, 여러 장이면 캐러셀(카드뉴스).
 * 캡차/봇감지/세션만료 없음. permalink 조회로 발행 성공을 명시 검증.
 *
 * Usage: node scripts/post-instagram-api.js <accountId> <imagePath[,imagePath2,...]> <captionPath>
 * Exit:  0 성공 / 1 실패 / 2 토큰 필요·만료 (setup-token.js 재실행)
 */
const fs = require('fs');
const path = require('path');
const igApi = require('../lib/instagramApi');
const { uploadToR2 } = require('../lib/r2');
const { getAccount } = require('../lib/settings');

(async () => {
  const [accountId, imagePathsArg, captionPath] = process.argv.slice(2);
  if (!accountId || !imagePathsArg || !captionPath) {
    console.error('사용법: node scripts/post-instagram-api.js <accountId> <imagePath[,path2,...]> <captionPath>');
    process.exit(1);
  }
  getAccount(accountId); // 계정 존재 검증

  if (!igApi.hasCredentials(accountId)) {
    console.error(`TOKEN_REQUIRED: API 토큰 없음. 먼저 실행: node scripts/setup-token.js ${accountId} '<토큰>'`);
    process.exit(2);
  }

  const imagePaths = imagePathsArg.split(',').map(s => s.trim()).filter(Boolean);
  for (const p of imagePaths) {
    if (!fs.existsSync(p)) { console.error(`이미지 없음: ${p}`); process.exit(1); }
  }
  const caption = fs.readFileSync(captionPath, 'utf-8').trim();

  try {
    // 토큰 7일 주기 자동 갱신 (60일 만료 방지)
    await igApi.maybeRefreshToken(accountId);

    // 1. R2 업로드 (공개 URL 확보 — Instagram 서버가 가져갈 수 있어야 함)
    console.log(`[api] R2 업로드 (${imagePaths.length}장)...`);
    const stamp = Date.now();
    const imageUrls = [];
    for (let i = 0; i < imagePaths.length; i++) {
      const ext = path.extname(imagePaths[i]) || '.jpg';
      const key = `instaauto/${accountId}/${stamp}-${String(i + 1).padStart(2, '0')}${ext}`;
      const url = await uploadToR2(imagePaths[i], key);
      console.log(`   ${url}`);
      imageUrls.push(url);
    }

    // 2. 발행 (1장=단일 / 여러 장=캐러셀)
    const { permalink } = await igApi.publishMedia(accountId, { imageUrls, caption });
    if (permalink) console.log(`PERMALINK:${permalink}`);
    process.exit(0);
  } catch (err) {
    if (err.tokenProblem) {
      console.error(`TOKEN_REQUIRED: 토큰 만료/무효 — ${err.message}`);
      console.error(`   재발급 후: node scripts/setup-token.js ${accountId} '<새토큰>'`);
      process.exit(2);
    }
    console.error(`❌ API 업로드 실패: ${err.message}`);
    process.exit(1);
  }
})();
