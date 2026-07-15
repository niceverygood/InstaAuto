#!/usr/bin/env node
/**
 * Instagram API 토큰 등록 — 계정당 1회.
 *
 * Usage: node scripts/setup-token.js <accountId> '<ACCESS_TOKEN>'
 *
 * Meta 개발자 대시보드에서 발급한 장기 토큰을 검증하고 저장한다.
 * 발급 방법은 SETUP-API.md 참고.
 */
const igApi = require('../lib/instagramApi');
const { getAccount } = require('../lib/settings');

(async () => {
  const [accountId, token] = process.argv.slice(2);
  if (!accountId || !token) {
    console.error("사용법: node scripts/setup-token.js <accountId> '<ACCESS_TOKEN>'");
    console.error("예:     node scripts/setup-token.js bobi 'IGAAxxxxxxxx...'");
    process.exit(1);
  }
  const account = getAccount(accountId);

  console.log('토큰 검증 중 (Instagram API /me 호출)...');
  let me;
  try {
    me = await igApi.getMe(token.trim());
  } catch (err) {
    console.error(`\n❌ 토큰 검증 실패: ${err.message}`);
    console.error('   토큰을 다시 확인하세요. (SETUP-API.md 의 발급 절차 참고)');
    process.exit(1);
  }

  console.log(`\n✅ 토큰 유효!`);
  console.log(`   계정: @${me.username} (user_id: ${me.user_id})`);
  console.log(`   유형: ${me.account_type || '?'}`);

  if (me.username && account.username && me.username.toLowerCase() !== account.username.toLowerCase()) {
    console.log(`\n⚠️  주의: accounts.json 의 username(@${account.username})과 토큰 계정(@${me.username})이 다릅니다.`);
    console.log('   의도한 계정이 맞는지 확인하세요.');
  }

  igApi.saveCredentials(accountId, {
    igUserId: String(me.user_id),
    username: me.username,
    accessToken: token.trim(),
    refreshedAt: new Date().toISOString(),
  });

  console.log(`\n💾 저장 완료: data/credentials-${accountId}.json`);
  console.log('이제 업로드가 공식 API 로 나갑니다 (캡차/봇감지 없음).');
  console.log(`테스트: node scripts/run-once.js ${accountId}`);
  process.exit(0);
})();
