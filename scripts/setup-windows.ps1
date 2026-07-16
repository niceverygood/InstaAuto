# InstaAuto 윈도우 셋업 + 실행 (원클릭)
#
# 사용법 (프로젝트 루트 또는 아무 위치에서):
#   powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1
#
# 하는 일: 의존성 설치 → claude CLI 설치/로그인 확인 → .env 작성(값 물어봄)
#          → 인스타 토큰 등록(값 물어봄) → 보비/더원 업로드 실행
# 이미 끝난 단계는 자동으로 건너뛰므로 몇 번을 다시 실행해도 안전하다.

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

function Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Fail($msg) { Write-Host "`n[실패] $msg" -ForegroundColor Red; exit 1 }

# ── 1. node 확인 ──
Step "1/6 Node.js 확인"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail "Node.js 가 없습니다. https://nodejs.org 에서 LTS 설치 후 다시 실행하세요."
}
Ok "node $(node --version)"

# ── 2. npm 의존성 ──
Step "2/6 npm 의존성 설치"
if (-not (Test-Path "node_modules")) {
  npm install
  if ($LASTEXITCODE -ne 0) { Fail "npm install 실패" }
} else { Ok "node_modules 이미 있음 (건너뜀)" }

# ── 3. Playwright chromium (카드 이미지 렌더용) ──
Step "3/6 Playwright chromium"
npx playwright install chromium
if ($LASTEXITCODE -ne 0) { Fail "playwright chromium 설치 실패" }
Ok "chromium 준비 완료"

# ── 4. claude CLI 설치 + 로그인 확인 ──
Step "4/6 claude CLI"
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  Write-Host "  claude CLI 설치 중..."
  npm install -g "@anthropic-ai/claude-code"
  if ($LASTEXITCODE -ne 0) { Fail "claude CLI 설치 실패" }
}
Write-Host "  로그인 상태 확인 중 (몇 초 걸림)..."
# cmd 경유: PS 5.1 에서 stderr 리다이렉트 + ErrorActionPreference=Stop 조합의 오탐 방지
cmd /c "claude -p ok --max-turns 1 >nul 2>&1"
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "  claude 로그인이 필요합니다. 지금 새 창에서:" -ForegroundColor Yellow
  Write-Host "    1) claude          <- 실행" -ForegroundColor Yellow
  Write-Host "    2) /login          <- 브라우저로 구독 계정 로그인" -ForegroundColor Yellow
  Write-Host "    3) /exit 로 종료 후 이 스크립트를 다시 실행" -ForegroundColor Yellow
  exit 1
}
Ok "claude CLI 로그인 확인"

# ── 5. .env 작성 (R2 필수 / 슬랙·OpenAI 선택) ──
Step "5/6 .env 설정"
if (Test-Path ".env") {
  Ok ".env 이미 있음 (건너뜀 — 수정하려면 notepad .env)"
} else {
  Write-Host "  R2 값은 Cloudflare 대시보드 > R2 에서 확인 (Access Key 는 'R2 API 토큰 관리'에서 새로 발급 가능)"
  do { $r2endpoint = Read-Host "  R2_ACCOUNT_ENDPOINT (https://<계정ID>.r2.cloudflarestorage.com)" } while (-not $r2endpoint)
  do { $r2key      = Read-Host "  R2_ACCESS_KEY_ID" } while (-not $r2key)
  do { $r2secret   = Read-Host "  R2_SECRET_ACCESS_KEY" } while (-not $r2secret)
  do { $r2bucket   = Read-Host "  R2_BUCKET (버킷 이름)" } while (-not $r2bucket)
  do { $r2public   = Read-Host "  R2_PUBLIC_URL (버킷 공개 URL, https://...)" } while (-not $r2public)
  $slack  = Read-Host "  SLACK_WEBHOOK_URL (바틀봇 웹훅 — 없으면 Enter, 슬랙 보고 생략됨)"
  $openai = Read-Host "  OPENAI_API_KEY (표지 AI 배경용 — 없으면 Enter, 단색 배경 사용)"

  $lines = @(
    "# InstaAuto .env (setup-windows.ps1 생성)",
    "R2_ACCOUNT_ENDPOINT=$r2endpoint",
    "R2_ACCESS_KEY_ID=$r2key",
    "R2_SECRET_ACCESS_KEY=$r2secret",
    "R2_BUCKET=$r2bucket",
    "R2_PUBLIC_URL=$r2public"
  )
  if ($slack)  { $lines += "SLACK_WEBHOOK_URL=$slack" }
  if ($openai) { $lines += "OPENAI_API_KEY=$openai" }
  $lines -join "`n" | Out-File -FilePath ".env" -Encoding utf8
  Ok ".env 저장 완료"
}

# ── 6. 인스타 토큰 등록 + 업로드 실행 ──
Step "6/6 인스타 토큰 + 업로드"
$accounts = @(
  @{ id = "bobi";   name = "보비 (@bobiai2026)" },
  @{ id = "theone"; name = "더원 (@the_one_meet)" }
)
foreach ($acc in $accounts) {
  $credFile = "data\credentials-$($acc.id).json"
  if (Test-Path $credFile) {
    Ok "$($acc.name) 토큰 이미 등록됨"
    continue
  }
  Write-Host ""
  Write-Host "  $($acc.name) 토큰이 필요합니다." -ForegroundColor Yellow
  Write-Host "  developers.facebook.com > 내 앱 > 이용 사례 > 맞춤 설정 > 액세스 토큰 생성 에서 복사 (IGAA... 로 시작)"
  do { $token = Read-Host "  $($acc.name) 액세스 토큰 붙여넣기" } while (-not $token)
  node scripts\setup-token.js $($acc.id) $token
  if ($LASTEXITCODE -ne 0) { Fail "$($acc.name) 토큰 등록 실패 — 토큰을 다시 발급해서 스크립트를 재실행하세요." }
}

Write-Host ""
$go = Read-Host "지금 바로 두 계정 업로드를 실행할까요? (Y/n)"
if ($go -eq "" -or $go -match "^[yY]") {
  foreach ($acc in $accounts) {
    Step "업로드 실행: $($acc.name)"
    node scripts\run-once.js $($acc.id)
    if ($LASTEXITCODE -eq 0)      { Ok "$($acc.name) 업로드 완료" }
    elseif ($LASTEXITCODE -eq 2)  { Write-Host "  [토큰 문제] $($acc.name) — 위 로그 확인" -ForegroundColor Yellow }
    else                          { Write-Host "  [실패] $($acc.name) — 위 로그 확인" -ForegroundColor Red }
  }
  Write-Host "`n끝. 결과는 위 로그와 슬랙 알림을 확인하세요." -ForegroundColor Cyan
} else {
  Write-Host "`n셋업만 완료. 업로드는 다음 명령으로:" -ForegroundColor Cyan
  Write-Host "  node scripts\run-once.js bobi"
  Write-Host "  node scripts\run-once.js theone"
}
