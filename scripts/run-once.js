#!/usr/bin/env node
/**
 * 한 계정의 전체 파이프라인 실행: 콘텐츠 생성 → 업로드 → 슬랙 보고
 * (wishket-scheduler 의 spawnSync + 로그 보존 패턴)
 *
 * Usage: node scripts/run-once.js <accountId> [--slot post-1|post-2|...|manual]
 * Exit:  0 성공 / 1 실패 / 2 로그인 필요
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { WORKSPACE, LOGS_DIR } = require('../lib/workspace');
const { getAccount } = require('../lib/settings');
const { sendSlack } = require('../lib/slack');

function slotLabelFor(slot) {
  if (slot === 'manual') return '수동 실행';
  const m = /^post-(\d+)$/.exec(slot);
  return m ? `${m[1]}회차` : `${slot} 회차`;
}

function saveLog(name, result) {
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const logPath = path.join(LOGS_DIR, `${name}-${ts}.log`);
    fs.writeFileSync(logPath,
      `=== exit code: ${result.status} ===\n` +
      `=== stdout ===\n${result.stdout || ''}\n` +
      `=== stderr ===\n${result.stderr || ''}\n`);
    console.log(`   log: ${logPath}`);
  } catch (e) { console.error(`   log 저장 실패: ${e.message}`); }
}

function nowKR() {
  return new Date().toLocaleString('ko-KR', { hour12: false });
}

async function main() {
  const accountId = process.argv[2];
  if (!accountId) {
    console.error('사용법: node scripts/run-once.js <accountId> [--slot name]');
    process.exit(1);
  }
  const slotIdx = process.argv.indexOf('--slot');
  const slot = slotIdx > -1 ? process.argv[slotIdx + 1] : 'manual';
  const slotLabel = slotLabelFor(slot);
  const account = getAccount(accountId);
  const tag = `${account.displayName} (@${account.username}) · ${slotLabel}`;

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🚀 InstaAuto 실행: ${tag} — ${nowKR()}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // ── Phase 1: 콘텐츠 생성 ──
  console.log('[Phase 1] 콘텐츠 생성...');
  const genResult = spawnSync('node', [
    path.join(WORKSPACE, 'scripts/generate-content.js'), accountId, '--slot', slot,
  ], { cwd: WORKSPACE, encoding: 'utf-8', timeout: 15 * 60 * 1000, maxBuffer: 20 * 1024 * 1024 });
  saveLog(`gen-${accountId}-${slot}`, genResult);

  if (genResult.status !== 0) {
    // 원인 요약은 "❌ 생성 실패:" 줄 앞부분에 있음 — 무작정 tail 을 자르면 명령어만 남는다
    const combined = `${genResult.stderr || ''}\n${genResult.stdout || ''}`;
    const failMatch = combined.match(/❌ 생성 실패:([\s\S]{0,400})/);
    const errText = (failMatch ? failMatch[1] : combined.slice(-300)).trim().slice(0, 400);
    await sendSlack(`❌ 인스타 콘텐츠 생성 실패 | ${tag}\n오류: ${errText}`);
    console.error(`❌ 생성 실패`);
    process.exit(1);
  }

  const genMatch = (genResult.stdout || '').match(/GEN_RESULT:(\{.+\})/);
  if (!genMatch) {
    await sendSlack(`❌ 인스타 콘텐츠 생성 실패 | ${tag}\nGEN_RESULT 출력 없음`);
    process.exit(1);
  }
  const gen = JSON.parse(genMatch[1]);
  const imagePaths = Array.isArray(gen.imagePaths) && gen.imagePaths.length ? gen.imagePaths : [gen.imagePath];
  console.log(`   주제: ${gen.topic}`);
  console.log(`   카드: ${imagePaths.length}장\n`);

  // ── Phase 2: 인스타 업로드 ──
  // API 토큰이 등록돼 있으면 공식 API (캡차/봇감지 없음 — 권장), 없으면 웹 자동화 폴백
  const igApi = require('../lib/instagramApi');
  const useApi = igApi.hasCredentials(accountId);
  const postScript = useApi ? 'scripts/post-instagram-api.js' : 'scripts/post-instagram.js';
  console.log(`[Phase 2] 인스타그램 업로드 (${useApi ? '공식 API' : '웹 자동화'})...`);
  const postResult = spawnSync('node', [
    path.join(WORKSPACE, postScript), accountId, imagePaths.join(','), gen.captionPath,
  ], { cwd: WORKSPACE, encoding: 'utf-8', timeout: 10 * 60 * 1000, maxBuffer: 20 * 1024 * 1024 });
  saveLog(`post-${accountId}-${slot}`, postResult);

  if (postResult.status === 2) {
    await sendSlack(useApi ? [
      `🔑 인스타 API 토큰 만료/무효 | ${tag}`,
      `Meta 대시보드에서 토큰 재발급 후 터미널에서:`,
      '```cd ' + WORKSPACE,
      `node scripts/setup-token.js ${accountId} '<새토큰>'` + '```',
    ].join('\n') : [
      `🔑 인스타 로그인 필요 | ${tag}`,
      `세션이 없거나 만료되었습니다. 터미널에서:`,
      '```cd ' + WORKSPACE,
      `node scripts/login-instagram.js ${accountId}` + '```',
    ].join('\n'));
    console.error('🔑 인증 필요');
    process.exit(2);
  }

  if (postResult.status !== 0) {
    const errTail = (postResult.stderr || postResult.stdout || '').slice(-300);
    await sendSlack(`❌ 인스타 업로드 실패 | ${tag}\n📌 주제: ${gen.topic}\n오류: ${errTail.slice(-200)}`);
    console.error('❌ 업로드 실패');
    process.exit(1);
  }

  // ── 성공 보고 ──
  const caption = fs.readFileSync(gen.captionPath, 'utf-8');
  const preview = caption.split('\n')[0].slice(0, 80);
  const permalinkMatch = (postResult.stdout || '').match(/PERMALINK:(https:\/\/\S+)/);
  const link = permalinkMatch ? permalinkMatch[1] : `https://www.instagram.com/${account.username}/`;
  await sendSlack([
    `✅ 인스타 업로드 완료 | ${tag}`,
    `📌 주제: ${gen.topic} (카드뉴스 ${imagePaths.length}장)`,
    `🪝 훅: ${gen.hook}`,
    `📝 캡션: ${preview}${caption.length > 80 ? '…' : ''}`,
    `🔗 ${link}`,
    `🕐 ${nowKR()}`,
  ].join('\n'));

  console.log(`\n✅ 완료: ${tag}\n`);
  process.exit(0);
}

main().catch(async (err) => {
  console.error(`❌ run-once 오류: ${err.message}`);
  await sendSlack(`❌ InstaAuto run-once 오류: ${err.message.slice(0, 200)}`);
  process.exit(1);
});
