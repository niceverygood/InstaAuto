#!/usr/bin/env node
/**
 * 콘텐츠 JSON → 1080x1350 카드뉴스 이미지(JPEG) 렌더링.
 * HTML 템플릿을 Playwright headless 로 스크린샷 (LLM 이미지 생성보다 한글 텍스트가 확실).
 *
 * 슬라이드 구성: 표지(cover) + 내용 카드 N장(content) + CTA 카드(cta)
 *
 * 라이브러리: renderSlides(content, theme, outDir) → [경로들]
 *            renderCard(content, theme, outPath)  → 표지 1장 (하위호환)
 * CLI 테스트: node scripts/render-card.js --test [accountId]
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { TEMPLATES_DIR, TEMP_DIR } = require('../lib/workspace');

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** "<y>강조</y>" 마커 → 노란 span (escape 후 마커만 복원) */
function accentHtml(text) {
  return escapeHtml(text)
    .replace(/&lt;y&gt;/g, '<span class="accent">')
    .replace(/&lt;\/y&gt;/g, '</span>');
}

function titleToHtml(titleLines) {
  return (titleLines || []).map(accentHtml).join('<br>');
}

function loadTemplate(name) {
  return fs.readFileSync(path.join(TEMPLATES_DIR, name), 'utf-8');
}

function fillCommon(html, theme, { bgOverride = null } = {}) {
  return html
    .replace(/\{\{BG\}\}/g, bgOverride || theme.bg || '#2B3BE6')
    .replace(/\{\{BG_SOLID\}\}/g, theme.bg || '#2B3BE6')
    .replace(/\{\{OVERLAY\}\}/g, 'transparent')
    .replace(/\{\{TEXT\}\}/g, theme.text || '#FFFFFF')
    .replace(/\{\{ACCENT\}\}/g, theme.accent || '#FFD400')
    .replace(/\{\{FOOTER\}\}/g, escapeHtml(theme.footer || ''));
}

async function shootHtml(page, html, outPath) {
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.waitForTimeout(250); // 폰트 렌더 안정화
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const isJpg = /\.jpe?g$/i.test(outPath);
  await page.locator('#card').screenshot(
    isJpg ? { path: outPath, type: 'jpeg', quality: 92 } : { path: outPath, type: 'png' }
  );
  return outPath;
}

function coverHtml(content, theme, { hasMoreSlides = true, bgOverride = null } = {}) {
  let html = loadTemplate('card.html');
  html = fillCommon(html, theme, { bgOverride });
  return html
    .replace('{{HOOK}}', escapeHtml(content.hook || ''))
    .replace('{{TITLE_HTML}}', titleToHtml(content.title_lines))
    .replace('{{SWIPE}}', hasMoreSlides ? '옆으로 넘겨보세요 →' : '');
}

function contentHtml(slide, theme, pageLabel) {
  let html = loadTemplate('card-content.html');
  html = fillCommon(html, theme);
  return html
    .replace('{{PAGE}}', escapeHtml(pageLabel || ''))
    .replace('{{HEADING}}', accentHtml(slide.heading || ''))
    .replace('{{BODY}}', escapeHtml(slide.body || ''));
}

function ctaHtml(cta, theme) {
  let html = loadTemplate('card-cta.html');
  html = fillCommon(html, theme);
  return html
    .replace('{{TITLE_HTML}}', titleToHtml(cta.title_lines))
    .replace('{{SUB}}', escapeHtml(cta.sub || ''))
    .replace('{{CTA_BUTTON}}', escapeHtml(cta.button || '프로필 링크에서 무료로 써보기'));
}

/**
 * 카드뉴스 전체 렌더: [표지, 내용1..N, CTA] → outDir/card-01.jpg ...
 */
async function renderSlides(content, theme, outDir, { bgImageDataUri = null } = {}) {
  const slides = Array.isArray(content.slides) ? content.slides : [];
  const total = 1 + slides.length + (content.cta ? 1 : 0);
  const bgOverride = bgImageDataUri
    ? `url('${bgImageDataUri}') no-repeat center / cover, ${theme.bg || '#2B3BE6'}`
    : null;

  const browser = await chromium.launch({ headless: true });
  const paths = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
    let idx = 1;

    // 1. 표지
    paths.push(await shootHtml(page,
      coverHtml(content, theme, { hasMoreSlides: total > 1, bgOverride }),
      path.join(outDir, `card-${String(idx).padStart(2, '0')}.jpg`)));

    // 2. 내용 카드
    for (const slide of slides) {
      idx += 1;
      paths.push(await shootHtml(page,
        contentHtml(slide, theme, `${idx} / ${total}`),
        path.join(outDir, `card-${String(idx).padStart(2, '0')}.jpg`)));
    }

    // 3. CTA 카드
    if (content.cta) {
      idx += 1;
      paths.push(await shootHtml(page,
        ctaHtml(content.cta, theme),
        path.join(outDir, `card-${String(idx).padStart(2, '0')}.jpg`)));
    }
  } finally {
    await browser.close();
  }
  return paths;
}

/** 하위호환: 표지 1장만 렌더 */
async function renderCard(content, theme, outPath, { bgImageDataUri = null } = {}) {
  const bgOverride = bgImageDataUri
    ? `url('${bgImageDataUri}') no-repeat center / cover, ${theme.bg || '#2B3BE6'}`
    : null;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1350 } });
    await shootHtml(page, coverHtml(content, theme, { hasMoreSlides: false, bgOverride }), outPath);
  } finally {
    await browser.close();
  }
  return outPath;
}

module.exports = { renderCard, renderSlides };

// CLI 테스트 모드
if (require.main === module) {
  (async () => {
    if (!process.argv.includes('--test')) {
      console.log('사용법: node scripts/render-card.js --test [accountId]');
      process.exit(1);
    }
    const { getAccount } = require('../lib/settings');
    const accountId = process.argv[3] || 'bobi';
    const account = getAccount(accountId);
    const sample = {
      hook: '고객이 소개를 안 해주는 진짜 이유',
      title_lines: ['소개 요청,', '<y>이 한 마디</y>가', '다 망칩니다'],
      slides: [
        { heading: '1. 막연하게 부탁한다', body: '"보험 필요한 분"은 고객이 누굴 떠올려야 할지 모릅니다.\n구체적인 대상을 짚어주세요.' },
        { heading: '2. 계약 직후 바로 요청', body: '고객 입장에선 부담스러운 타이밍.\n계약 후 1~2달, 안부 연락 이후가 황금 타이밍입니다.' },
      ],
      cta: {
        title_lines: ['반복 업무는', '<y>보비</y>에게 맡기세요'],
        sub: 'AI 보험비서 보비가 고지 분석부터 계약 관리까지 도와드립니다',
        button: '프로필 링크에서 무료로 써보기',
      },
    };
    const outDir = path.join(TEMP_DIR, `render-test-slides-${accountId}`);
    const paths = await renderSlides(sample, account.theme, outDir);
    console.log(`✅ ${paths.length}장 렌더 완료:`);
    paths.forEach(p => console.log('   ' + p));
  })();
}
