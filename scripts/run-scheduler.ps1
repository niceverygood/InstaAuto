# Windows 작업 스케줄러 진입점 — 10분마다 실행되는 tick.
# Mac 의 run-scheduler.sh + launchd 를 대신하는 윈도우용 스크립트.
# 직접 실행하지 말고 setup-scheduler-windows.ps1 로 등록해서 쓴다.

$ErrorActionPreference = 'Continue'
$Workspace = Split-Path $PSScriptRoot -Parent
Set-Location $Workspace

New-Item -ItemType Directory -Force -Path "logs" | Out-Null
$Log = "logs\scheduler.log"

# 로그 5MB 초과 시 최근 2000줄만 유지
if ((Test-Path $Log) -and ((Get-Item $Log).Length / 1MB -gt 5)) {
  $tail = Get-Content $Log -Tail 2000
  Set-Content -Path $Log -Value $tail -Encoding utf8
}

Add-Content -Path $Log -Value ("[{0}] tick 시작" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
node scripts\scheduler.js *>> $Log
