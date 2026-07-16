#!/usr/bin/env node
/**
 * 콘텐츠 생성 (Phase 1)
 *
 * 1. 계정 페르소나 + 최근 히스토리 로드 (중복 주제 방지)
 * 2. claude CLI (구독) 로 카드 문구 + 캡션 + 해시태그 JSON 생성
 * 3. 카드 이미지 렌더링 (1080x1350 PNG)
 * 4. data/posts/<계정>/<날짜-회차>/ 에 저장
 *
 * Usage: node scripts/generate-content.js <accountId> [--slot morning|afternoon|manual]
 * 출력:  GEN_RESULT:{"imagePath":"...","captionPath":"...","topic":"...","hook":"..."}
 */
require('../lib/env');
const fs = require('fs');
const path = require('path');
const { WORKSPACE, DATA_DIR } = require('../lib/workspace');
const { getAccount, loadSettings } = require('../lib/settings');
const { callClaude, extractJson } = require('../lib/llm');
const { renderSlides } = require('./render-card');
const { generateAiBackground } = require('../lib/aiImage');

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function historyFile(accountId) {
  return path.join(DATA_DIR, `history-${accountId}.json`);
}

function loadHistory(accountId) {
  const f = historyFile(accountId);
  if (!fs.existsSync(f)) return [];
  try { return JSON.parse(fs.readFileSync(f, 'utf-8')); } catch { return []; }
}

function saveHistory(accountId, entry) {
  const list = loadHistory(accountId);
  list.push(entry);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(historyFile(accountId), JSON.stringify(list.slice(-200), null, 2));
}

function buildPrompt(account, persona, recentTopics) {
  const recent = recentTopics.length
    ? recentTopics.map((t, i) => `${i + 1}. ${t}`).join('\n')
    : '(없음 — 첫 게시물)';

  return `당신은 인스타그램 카드뉴스 전문 카피라이터입니다.
아래 브랜드 브리프에 맞는 인스타그램 카드뉴스(캐러셀) 게시물 1개를 만들어주세요.
구성: 표지 1장 + 내용 카드 3~5장 + CTA 카드 1장.

━━━ 브랜드 브리프 ━━━
${persona}
━━━━━━━━━━━━━━━━

━━━ 최근에 이미 다룬 주제 (절대 겹치지 않게, 다른 필러/각도 선택) ━━━
${recent}
━━━━━━━━━━━━━━━━

오늘 날짜: ${todayStr()}

반드시 아래 JSON 형식으로만 응답하세요. JSON 외 다른 텍스트 금지.

\`\`\`json
{
  "topic": "이번 게시물의 주제 한 줄 요약 (히스토리 기록용, 20자 이내)",
  "hook": "표지 상단 작은 훅 문장 (12~20자, 따옴표 없이)",
  "title_lines": ["표지 타이틀 1줄 (4~10자)", "<y>강조 단어 포함 줄</y>"],
  "slides": [
    { "heading": "1. 소제목 (8~16자)", "body": "내용 2~4문장. 문장마다 \\n 으로 줄바꿈. 총 60~140자." },
    { "heading": "2. 소제목", "body": "..." },
    { "heading": "3. 소제목", "body": "..." }
  ],
  "cta": {
    "title_lines": ["CTA 타이틀 1줄", "<y>강조</y> 포함 줄"],
    "sub": "브랜드가 이 문제를 어떻게 해결해주는지 한두 문장 (40~80자)",
    "button": "프로필 링크에서 무료로 써보기"
  },
  "caption": "인스타 캡션 본문. 줄바꿈은 \\n 사용. 300~600자. 카드 내용 요약 + 마지막에 CTA 포함. 해시태그는 여기 넣지 말 것.",
  "hashtags": ["#태그1", "#태그2"]
}
\`\`\`

규칙:
- title_lines: 2~3줄. 강조할 핵심 단어(1~2곳)만 <y></y> 로 감싸기.
- slides: 3~5개. 표지에서 궁금하게 만들고 슬라이드에서 하나씩 해소하는 구조.
- slides 의 heading 은 번호로 시작 (1. 2. 3.), body 는 짧은 문장들로 (한 문장 30자 이내 권장).
- cta.title_lines 에도 <y></y> 강조 사용 가능.
- hashtags: 10~15개, # 포함.
- caption 에 해시태그 넣지 말 것 (별도 배열).
- 브리프의 금지사항 반드시 준수.`;
}

async function generateContent(accountId, slot = 'manual') {
  const account = getAccount(accountId);
  const settings = loadSettings();
  const personaPath = path.join(WORKSPACE, account.persona);
  const persona = fs.readFileSync(personaPath, 'utf-8');

  const history = loadHistory(accountId);
  const recentTopics = history.slice(-30).map(h => h.topic).filter(Boolean);

  console.log(`[생성] ${account.displayName} — LLM 호출 (claude CLI, ${settings.llmModel})...`);
  const prompt = buildPrompt(account, persona, recentTopics);

  let content = null;
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = callClaude(prompt, { model: settings.llmModel });
      content = extractJson(response);
      break;
    } catch (err) {
      lastErr = err;
      console.error(`[생성] LLM 시도 ${attempt}/2 실패: ${err.message.split('\n')[0]}`);
      if (err.retryable === false) break; // 한도 도달/인증 만료 — 즉시 재시도 무의미
    }
  }
  if (!content) throw new Error(`LLM 생성 실패: ${lastErr?.message}`);

  // 필수 필드 검증
  if (!content.topic || !content.hook || !Array.isArray(content.title_lines) || !content.title_lines.length || !content.caption) {
    throw new Error(`LLM 응답 필드 누락: ${JSON.stringify(content).slice(0, 200)}`);
  }
  // slides 검증 (없거나 형식이 깨졌으면 표지 1장으로 폴백)
  if (!Array.isArray(content.slides)) content.slides = [];
  content.slides = content.slides
    .filter(s => s && s.heading && s.body)
    .slice(0, 8); // 표지+CTA 포함 최대 10장
  if (content.cta && (!Array.isArray(content.cta.title_lines) || !content.cta.title_lines.length)) {
    content.cta = null;
  }

  // 출력 디렉토리
  const outDir = path.join(DATA_DIR, 'posts', accountId, `${todayStr()}-${slot}`);
  fs.mkdirSync(outDir, { recursive: true });

  // 캡션 조립 (인스타 최대 2200자 — 여유 있게 2150 컷)
  const hashtags = Array.isArray(content.hashtags) ? content.hashtags.join(' ') : '';
  let caption = `${content.caption.trim()}\n\n${hashtags}`.trim();
  if (caption.length > 2150) caption = caption.slice(0, 2150);

  // 카드 렌더 (imageMode: "ai-bg" 면 gpt-image-2 배경 시도, 실패 시 단색 폴백)
  let bgImageDataUri = null;
  if (settings.imageMode === 'ai-bg') {
    console.log('[생성] gpt-image-2 배경 생성 시도...');
    bgImageDataUri = await generateAiBackground(content.topic, account.theme);
  }

  const imagePaths = await renderSlides(content, account.theme, outDir, { bgImageDataUri });
  console.log(`[생성] 카드뉴스 렌더 완료: ${imagePaths.length}장`);
  imagePaths.forEach(p => console.log('   ' + p));

  const captionPath = path.join(outDir, 'caption.txt');
  fs.writeFileSync(captionPath, caption);
  fs.writeFileSync(path.join(outDir, 'content.json'), JSON.stringify(content, null, 2));

  saveHistory(accountId, { date: todayStr(), slot, topic: content.topic, hook: content.hook });

  return {
    imagePaths,
    imagePath: imagePaths[0], // 하위호환
    captionPath,
    topic: content.topic,
    hook: content.hook,
    slideCount: imagePaths.length,
    outDir,
  };
}

module.exports = { generateContent };

if (require.main === module) {
  (async () => {
    const accountId = process.argv[2];
    if (!accountId) {
      console.error('사용법: node scripts/generate-content.js <accountId> [--slot name]');
      process.exit(1);
    }
    const slotIdx = process.argv.indexOf('--slot');
    const slot = slotIdx > -1 ? process.argv[slotIdx + 1] : 'manual';
    try {
      const result = await generateContent(accountId, slot);
      console.log(`GEN_RESULT:${JSON.stringify(result)}`);
    } catch (err) {
      console.error(`❌ 생성 실패: ${err.message}`);
      process.exit(1);
    }
  })();
}
