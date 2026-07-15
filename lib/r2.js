/**
 * Cloudflare R2 업로드 — 카드 이미지를 공개 URL로 올림 (Instagram API 는 공개 URL 필수).
 * 자격 증명은 .env 에서 로드 (레포에 커밋되지 않음).
 */
require('./env');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');

function r2Config() {
  const {
    R2_ACCOUNT_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL,
  } = process.env;
  if (!R2_ACCOUNT_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET || !R2_PUBLIC_URL) {
    throw new Error(
      'R2 설정 누락 — .env 에 R2_ACCOUNT_ENDPOINT / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET / R2_PUBLIC_URL 필요'
    );
  }
  return {
    endpoint: R2_ACCOUNT_ENDPOINT,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    bucket: R2_BUCKET,
    publicUrl: R2_PUBLIC_URL,
  };
}

const CONTENT_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

async function uploadToR2(localPath, r2Key) {
  const config = r2Config();
  const client = new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  const file = fs.readFileSync(localPath);
  const ext = path.extname(localPath).toLowerCase();

  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: r2Key,
    Body: file,
    ContentType: CONTENT_TYPES[ext] || 'application/octet-stream',
  }));

  return `${config.publicUrl}/${r2Key}`;
}

module.exports = { uploadToR2 };
