# InstaAuto 윈도우 스케줄러 켜기 — 10분마다 자동 실행되도록 작업 스케줄러(Task Scheduler)에 등록.
# Mac 의 launchctl load 에 대응.
#
# 사용법 (관리자 권한 PowerShell 권장 — 최고 권한 실행 옵션 때문):
#   powershell -ExecutionPolicy Bypass -File scripts\setup-scheduler-windows.ps1
#
# 끄기: schtasks /delete /tn "InstaAuto Scheduler" /f
# 상태 확인: schtasks /query /tn "InstaAuto Scheduler" /v /fo list

$ErrorActionPreference = 'Stop'
$Workspace = Split-Path $PSScriptRoot -Parent
$RunScript = Join-Path $Workspace "scripts\run-scheduler.ps1"
$TaskName = "InstaAuto Scheduler"

if (-not (Test-Path $RunScript)) {
  Write-Host "[실패] $RunScript 를 찾을 수 없습니다." -ForegroundColor Red
  exit 1
}

schtasks /query /tn $TaskName *> $null
if ($LASTEXITCODE -eq 0) {
  Write-Host "이미 등록되어 있어 재등록합니다..." -ForegroundColor Yellow
  schtasks /delete /tn $TaskName /f | Out-Null
}

$action = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$RunScript`""
schtasks /create /tn $TaskName /tr $action /sc minute /mo 10 /rl highest /f

if ($LASTEXITCODE -ne 0) {
  Write-Host "`n[실패] 작업 등록 실패 — PowerShell을 '관리자 권한으로 실행'한 뒤 다시 시도하세요." -ForegroundColor Red
  exit 1
}

Write-Host "`n[OK] 10분마다 자동 실행되도록 등록했습니다." -ForegroundColor Green
Write-Host "  확인: 작업 스케줄러 앱 > 작업 스케줄러 라이브러리 > `"$TaskName`""
Write-Host "  로그: $Workspace\logs\scheduler.log"
Write-Host "  끄기: schtasks /delete /tn `"$TaskName`" /f"
Write-Host ""
Write-Host "[중요] 이 PC 하나만 자동 발행을 담당하게 하세요." -ForegroundColor Yellow
Write-Host "  같은 계정을 다른 PC/Mac 에서도 동시에 자동 발행하면 같은 계정에 중복 게시됩니다." -ForegroundColor Yellow
Write-Host "  다른 곳에서 launchd/스케줄러가 켜져 있다면 반드시 꺼주세요." -ForegroundColor Yellow
