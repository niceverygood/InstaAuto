#!/usr/bin/env node
/**
 * InstaAuto 스케줄러 (tick 방식)
 *
 * launchd 가 10분마다 이 스크립트를 실행한다. 각 tick 에서:
 *   1. 오늘의 랜덤 발행 시각이 없으면 생성 (오전/오후 각 1회, 윈도우 내 랜덤)
 *   2. 발행 시각이 지났고 아직 안 올린 슬롯이 있으면 → 계정별 run-once 실행
 *   3. 실패 시 다음 tick(10분 후) 재시도, 계정별 최대 N회 후 포기
 *
 * 고정 시각 + 프로세스 sleep 방식 대신 tick 방식이라
 * 맥이 자다 깨어나도/재부팅해도 그날 회차를 놓치지 않는다.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { WORKSPACE, DATA_DIR, LOGS_DIR } = require('../lib/workspace');
const { loadSettings, enabledAccounts } = require('../lib/settings');
const { sendSlack } = require('../lib/slack');

const STATE_FILE = path.join(DATA_DIR, 'schedule.json');
const LOCK_FILE = path.join(DATA_DIR, '.scheduler.lock');

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function nowHM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// "HH:MM" 문자열 비교용 분 변환
function toMin(hm) {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

function randomTimeBetween(start, end) {
  const s = toMin(start), e = toMin(end);
  const pick = s + Math.floor(Math.random() * (e - s + 1));
  return `${String(Math.floor(pick / 60)).padStart(2, '0')}:${String(pick % 60).padStart(2, '0')}`;
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')); } catch { return {}; }
}

function saveState(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // 14일 이전 기록은 정리
  const keys = Object.keys(state).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - 14))) delete state[k];
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ── 중복 실행 방지 락 ──
function acquireLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const { pid, at } = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8'));
      const ageMs = Date.now() - at;
      let alive = false;
      try { process.kill(pid, 0); alive = true; } catch {}
      if (alive && ageMs < 3 * 60 * 60 * 1000) return false; // 실행 중
      // stale lock 제거
      fs.unlinkSync(LOCK_FILE);
    }
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, at: Date.now() }));
    return true;
  } catch (e) {
    console.error(`lock 오류: ${e.message}`);
    return false;
  }
}

function releaseLock() {
  try { fs.unlinkSync(LOCK_FILE); } catch {}
}

function ensureTodayPlan(state, settings) {
  const today = todayStr();
  if (state[today]) return state[today];
  const plan = { slots: {} };
  for (const [name, win] of Object.entries(settings.slots)) {
    plan.slots[name] = {
      time: randomTimeBetween(win.start, win.end),
      done: false,
      accounts: {},
    };
  }
  state[today] = plan;
  saveState(state);
  console.log(`📅 오늘(${today}) 발행 계획 생성: ` +
    Object.entries(plan.slots).map(([n, s]) => `${n}=${s.time}`).join(', '));
  return plan;
}

function runAccount(accountId, slotName) {
  console.log(`   ▶ run-once: ${accountId} (${slotName})`);
  const result = spawnSync('node', [
    path.join(WORKSPACE, 'scripts/run-once.js'), accountId, '--slot', slotName,
  ], { cwd: WORKSPACE, encoding: 'utf-8', timeout: 30 * 60 * 1000, maxBuffer: 20 * 1024 * 1024 });
  // run-once 가 자체적으로 로그/슬랙 처리. 여기선 exit code 만.
  if (result.stdout) process.stdout.write(result.stdout.slice(-2000));
  if (result.stderr) process.stderr.write(result.stderr.slice(-1000));
  return result.status; // 0 성공 / 1 실패 / 2 로그인 필요
}

async function main() {
  const settings = loadSettings();
  const maxAttempts = settings.maxAttemptsPerSlot || 3;
  const accounts = enabledAccounts();

  if (!acquireLock()) {
    // 이전 tick 이 아직 실행 중 — 조용히 종료
    return;
  }

  try {
    const state = loadState();
    const plan = ensureTodayPlan(state, settings);
    const now = nowHM();

    for (const [slotName, slot] of Object.entries(plan.slots)) {
      if (slot.done) continue;
      if (toMin(now) < toMin(slot.time)) continue; // 아직 발행 시각 전

      console.log(`\n🕐 ${slotName} 슬롯 실행 (예정 ${slot.time} / 현재 ${now})`);

      let allTerminal = true;
      for (const account of accounts) {
        const st = slot.accounts[account.id] || { status: 'pending', attempts: 0 };
        if (st.status === 'success' || st.status === 'given_up' || st.status === 'login_required') continue;

        st.attempts += 1;
        const code = runAccount(account.id, slotName);

        if (code === 0) {
          st.status = 'success';
        } else if (code === 2) {
          // 로그인 필요 — 재시도 무의미, 이 슬롯은 종료 (슬랙 안내는 run-once 가 이미 전송)
          st.status = 'login_required';
        } else if (st.attempts >= maxAttempts) {
          st.status = 'given_up';
          await sendSlack(`⚠️ ${account.displayName} ${slotName} 회차 ${maxAttempts}회 시도 후 포기. 다음 회차에 다시 시도합니다.`);
        } else {
          st.status = 'retry'; // 다음 tick(10분 후) 재시도
          allTerminal = false;
        }
        slot.accounts[account.id] = st;
        saveState(state);
      }

      // 모든 계정이 종결 상태면 슬롯 완료
      const statuses = accounts.map(a => slot.accounts[a.id]?.status);
      if (allTerminal && statuses.every(s => ['success', 'given_up', 'login_required'].includes(s))) {
        slot.done = true;
        saveState(state);
        console.log(`✅ ${slotName} 슬롯 종료: ${JSON.stringify(statuses)}`);
      }
    }
  } catch (err) {
    console.error(`❌ 스케줄러 오류: ${err.message}`);
    await sendSlack(`❌ InstaAuto 스케줄러 오류: ${err.message.slice(0, 200)}`);
  } finally {
    releaseLock();
  }
}

main();
