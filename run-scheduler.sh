#!/bin/bash
# launchd 진입점 — 10분마다 실행되는 tick.
# launchd 는 사용자 셸 환경을 상속하지 않으므로 PATH 명시 필수.

export PATH="$HOME/.npm-global/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export LANG="ko_KR.UTF-8"

WORKSPACE="$(cd "$(dirname "$0")" && pwd)"
cd "$WORKSPACE" || exit 1

mkdir -p logs

LOG="logs/scheduler.log"
# 로그 5MB 초과 시 최근 1MB만 유지
if [ -f "$LOG" ] && [ "$(stat -f%z "$LOG" 2>/dev/null || echo 0)" -gt 5242880 ]; then
  tail -c 1048576 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

# caffeinate -i : 실행 중 맥 잠들지 않게
/usr/bin/caffeinate -i node scripts/scheduler.js >> "$LOG" 2>&1
