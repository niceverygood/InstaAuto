/**
 * Instagram 공식 API (Instagram Login 방식) — 게시물 발행.
 *
 * 캡차/봇감지/세션만료가 없는 공식 경로.
 * 필요: 프로페셔널 계정 + Meta 앱에서 발급한 장기 액세스 토큰 (SETUP-API.md 참고)
 *
 * 토큰 저장: data/credentials-<accountId>.json
 *   { "igUserId": "...", "username": "...", "accessToken": "...", "refreshedAt": "ISO" }
 */
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./workspace');

const GRAPH = 'https://graph.instagram.com/v23.0';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function credentialsFile(accountId) {
  return path.join(DATA_DIR, `credentials-${accountId}.json`);
}

function hasCredentials(accountId) {
  return fs.existsSync(credentialsFile(accountId));
}

function loadCredentials(accountId) {
  return JSON.parse(fs.readFileSync(credentialsFile(accountId), 'utf-8'));
}

function saveCredentials(accountId, creds) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(credentialsFile(accountId), JSON.stringify(creds, null, 2));
}

async function api(pathname, { method = 'GET', params = {} } = {}) {
  const url = new URL(`${GRAPH}${pathname}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { method, signal: AbortSignal.timeout(60000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const err = new Error(body.error?.message || `HTTP ${res.status}`);
    err.code = body.error?.code;
    err.type = body.error?.type;
    // 토큰 문제 (만료/무효/권한) 구분
    err.tokenProblem = body.error?.code === 190 || body.error?.type === 'OAuthException';
    throw err;
  }
  return body;
}

/** 토큰 검증 + 계정 정보 조회 */
async function getMe(accessToken) {
  return api('/me', { params: { fields: 'user_id,username,account_type', access_token: accessToken } });
}

/** 장기 토큰 갱신 (60일 → 60일 연장. 발급 24시간 후부터 가능) */
async function refreshToken(accountId) {
  const creds = loadCredentials(accountId);
  const body = await api('/refresh_access_token', {
    params: { grant_type: 'ig_refresh_token', access_token: creds.accessToken },
  });
  creds.accessToken = body.access_token;
  creds.refreshedAt = new Date().toISOString();
  saveCredentials(accountId, creds);
  return creds;
}

/** 토큰이 7일 이상 안 갱신됐으면 갱신 (실패는 경고만 — 기존 토큰이 아직 유효할 수 있음) */
async function maybeRefreshToken(accountId) {
  try {
    const creds = loadCredentials(accountId);
    const age = Date.now() - new Date(creds.refreshedAt || 0).getTime();
    if (age > 7 * 24 * 60 * 60 * 1000) {
      await refreshToken(accountId);
      console.log('[api] 토큰 갱신 완료 (60일 연장)');
    }
  } catch (e) {
    console.error(`[api] 토큰 갱신 실패 (무시하고 진행): ${e.message}`);
  }
}

/** 컨테이너 처리 완료 대기 (최대 5분) */
async function waitContainer(containerId, accessToken, label = '') {
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const status = await api(`/${containerId}`, {
      params: { fields: 'status_code', access_token: accessToken },
    });
    if (status.status_code === 'FINISHED') return;
    if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') {
      throw new Error(`컨테이너 처리 실패${label ? ` (${label})` : ''}: ${status.status_code} (이미지 URL 접근 불가 or 형식 문제)`);
    }
    await sleep(5000);
  }
  throw new Error(`컨테이너 처리 타임아웃${label ? ` (${label})` : ''}`);
}

/**
 * 게시물 발행 — 이미지 1장이면 단일 게시물, 여러 장이면 캐러셀(카드뉴스).
 * 흐름: (자식) 컨테이너 생성 → 처리 대기 → [캐러셀 부모 생성 → 대기] → 발행 → permalink 검증
 */
async function publishMedia(accountId, { imageUrls, caption }) {
  const creds = loadCredentials(accountId);
  const { igUserId, accessToken } = creds;
  if (!Array.isArray(imageUrls) || imageUrls.length === 0) throw new Error('imageUrls 비어 있음');
  if (imageUrls.length > 10) imageUrls = imageUrls.slice(0, 10); // 캐러셀 최대 10장

  let containerId;

  if (imageUrls.length === 1) {
    console.log('[api] 단일 이미지 컨테이너 생성...');
    const container = await api(`/${igUserId}/media`, {
      method: 'POST',
      params: { image_url: imageUrls[0], caption, access_token: accessToken },
    });
    containerId = container.id;
    if (!containerId) throw new Error('컨테이너 ID 없음');
    await waitContainer(containerId, accessToken);
  } else {
    // 1. 자식 컨테이너들 생성
    console.log(`[api] 캐러셀 자식 컨테이너 ${imageUrls.length}개 생성...`);
    const children = [];
    for (let i = 0; i < imageUrls.length; i++) {
      const child = await api(`/${igUserId}/media`, {
        method: 'POST',
        params: { image_url: imageUrls[i], is_carousel_item: 'true', access_token: accessToken },
      });
      if (!child.id) throw new Error(`자식 컨테이너 생성 실패 (${i + 1}장)`);
      children.push(child.id);
    }
    // 2. 자식 처리 대기
    for (let i = 0; i < children.length; i++) {
      await waitContainer(children[i], accessToken, `${i + 1}/${children.length}장`);
    }
    // 3. 캐러셀 부모 컨테이너
    console.log('[api] 캐러셀 컨테이너 생성...');
    const parent = await api(`/${igUserId}/media`, {
      method: 'POST',
      params: {
        media_type: 'CAROUSEL',
        children: children.join(','),
        caption,
        access_token: accessToken,
      },
    });
    containerId = parent.id;
    if (!containerId) throw new Error('캐러셀 컨테이너 ID 없음');
    await waitContainer(containerId, accessToken, '캐러셀');
  }

  // 발행
  console.log('[api] 게시물 발행...');
  const published = await api(`/${igUserId}/media_publish`, {
    method: 'POST',
    params: { creation_id: containerId, access_token: accessToken },
  });
  const mediaId = published.id;
  if (!mediaId) throw new Error('발행 실패 — media ID 없음');

  // permalink 조회 (발행 성공의 명시적 검증)
  const media = await api(`/${mediaId}`, {
    params: { fields: 'permalink', access_token: accessToken },
  });

  console.log(`✅ 발행 완료: ${media.permalink || mediaId}`);
  return { mediaId, permalink: media.permalink || null };
}

/** 하위호환 래퍼 */
async function publishImage(accountId, { imageUrl, caption }) {
  return publishMedia(accountId, { imageUrls: [imageUrl], caption });
}

module.exports = {
  hasCredentials, loadCredentials, saveCredentials, credentialsFile,
  getMe, refreshToken, maybeRefreshToken, publishImage, publishMedia,
};
