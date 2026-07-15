/**
 * OpenAI gpt-image-2 로 카드 표지 배경 이미지 생성.
 * settings.json 의 imageMode 가 "ai-bg" 이고 OPENAI_API_KEY 가 있을 때 사용.
 * 실패/키 없음 → null 반환 (단색 배경으로 폴백, 파이프라인은 계속 진행).
 */
require('./env');

async function generateAiBackground(topic, theme) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log('[aiImage] OPENAI_API_KEY 없음 → 단색 배경 사용');
    return null;
  }
  const prompt = [
    `Abstract minimal background for a Korean Instagram card about "${topic}".`,
    `Dominant color ${theme.bg}, subtle gradient and soft geometric shapes,`,
    'no text, no letters, no people, clean, modern, high contrast center area kept dark/simple for overlay text.',
  ].join(' ');

  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-image-2',
        prompt,
        size: '1024x1536',
        quality: 'high',
        n: 1,
      }),
      signal: AbortSignal.timeout(180000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[aiImage] 생성 실패 ${res.status}: ${body.slice(0, 200)} → 단색 배경 폴백`);
      return null;
    }
    const data = await res.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) return null;
    return `data:image/png;base64,${b64}`;
  } catch (err) {
    console.error(`[aiImage] 오류: ${err.message} → 단색 배경 폴백`);
    return null;
  }
}

module.exports = { generateAiBackground };
