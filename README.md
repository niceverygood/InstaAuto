# InstaAuto

인스타그램 콘텐츠 **자동 생성 → 자동 업로드 → 슬랙 보고** 파이프라인.
매일 활동 시간대(기본 09:00~22:00) 안에서 **4시간±지터 간격으로 랜덤 시각**을 여러 회 추첨해
등록된 모든 계정에 카드뉴스를 올린다 (기본 설정 기준 하루 약 4회).

- **콘텐츠 생성**: claude CLI (구독 사용, API 크레딧 X) — 계정별 페르소나 기반 카드 문구 + 캡션 + 해시태그
- **이미지**: **카드뉴스(캐러셀) 5~7장** — 표지 + 내용 카드 3~5장 + CTA 카드. HTML 템플릿 → Playwright 스크린샷 (1080×1350 JPEG, 한글 완벽 렌더). 템플릿: `templates/card.html`(표지) / `card-content.html`(내용) / `card-cta.html`(CTA)
  - 표지 배경: `OPENAI_API_KEY` (`.env`) + `imageMode: "ai-bg"` 면 gpt-image-2 로 생성 (기본 활성화)
- **업로드 (기본)**: **Instagram 공식 API** — R2 공개 URL 업로드 후 Graph API 발행. 캡차/봇감지/세션만료 없음. **[SETUP-API.md](SETUP-API.md) 참고 (계정당 1회, 10분)**
- **업로드 (폴백)**: API 토큰 없는 계정은 Playwright 웹 자동화 (캡차 리스크 있음 — 비권장)
- **스케줄**: launchd 10분 tick + **4시간 간격 랜덤 발행** (잠자기/재부팅에도 그날 회차 안 놓침)
- **보고**: 슬랙 웹훅 (성공/실패/토큰 만료)

*wishket-automation 의 검증된 패턴 재사용: persistent context, reactSafe 검증, 거짓 성공 방지(성공 문구 명시 확인), launchd PATH/caffeinate, 실패 시 재시도.*

---

## 초기 셋업 (1회)

```bash
cd /Users/seungsoohan/Projects/InstaAuto
npm install
npx playwright install chromium
```

그다음 **[SETUP-API.md](SETUP-API.md)** 따라 공식 API 토큰 발급 (10분) →

```bash
cd /Users/seungsoohan/Projects/InstaAuto
node scripts/setup-token.js bobi '<발급받은 토큰>'
```

> (비권장 폴백) 웹 자동화를 쓰려면 `node scripts/login-instagram.js bobi` — 캡차 무한반복 리스크 있음.

## 스케줄러 켜기 / 끄기

```bash
cd /Users/seungsoohan/Projects/InstaAuto
cp com.seungsoohan.instaauto.plist ~/Library/LaunchAgents/
launchctl load -w ~/Library/LaunchAgents/com.seungsoohan.instaauto.plist    # 켜기
```

```bash
launchctl unload -w ~/Library/LaunchAgents/com.seungsoohan.instaauto.plist  # 끄기
```

## 수동 실행

```bash
cd /Users/seungsoohan/Projects/InstaAuto
node scripts/run-once.js bobi                    # 지금 즉시 생성+업로드+보고
node scripts/generate-content.js bobi            # 생성만 (업로드 X)
node scripts/render-card.js --test bobi          # 카드 렌더만 테스트
node scripts/scheduler.js                        # tick 1회 수동 실행
```

---

## 계정 추가 방법

1. `config/personas/<새계정>.md` 생성 (`sample.md` 복사해서 브랜드 브리프 작성)
2. `config/accounts.json` 의 `accounts` 배열에 추가:
   ```json
   {
     "id": "newacc",
     "username": "insta_username",
     "displayName": "표시 이름",
     "persona": "config/personas/newacc.md",
     "enabled": true,
     "theme": { "bg": "#111111", "accent": "#00E5A0", "text": "#FFFFFF", "footer": "@insta_username" }
   }
   ```
3. 로그인 세션 저장:
   ```bash
   cd /Users/seungsoohan/Projects/InstaAuto
   node scripts/login-instagram.js newacc
   ```
끝. 다음 회차부터 자동 포함된다.

---

## 설정 (`config/settings.json`)

| 키 | 설명 | 기본값 |
|---|---|---|
| `posting.activeStart` / `activeEnd` | 발행이 일어날 수 있는 하루 활동 시간대 | 09:00 ~ 22:00 |
| `posting.intervalHours` | 발행 간 목표 간격(시간) | 4 |
| `posting.jitterMinutes` | 간격에 더해지는 랜덤 오차(±분) — 매번 정확히 4시간이 아니라 자연스럽게 흔들림 | 40 |
| `maxAttemptsPerSlot` | 회차당 계정별 최대 재시도 (10분 간격) | 3 |
| `headlessPosting` | 웹 자동화 폴백 사용 시 headless 여부. `false` 권장 (봇 감지 회피) | false |
| `imageMode` | `"card"`(단색 카드) 또는 `"ai-bg"`(gpt-image-2 배경) | ai-bg |
| `llmModel` | claude CLI 모델 | sonnet |

슬랙 웹훅 / R2 / OpenAI 키는 `config/settings.json`이 아니라 **`.env`** 에 저장 (git에 커밋되지 않음).

### 슬랙 알림을 보내는 봇 바꾸기 (예: 도모봇 → 바틀봇)

슬랙에 표시되는 "보낸 봇"은 **웹훅/토큰을 소유한 Slack 앱**이다. `.env` 를 바꾸면 된다 (코드 수정 불필요):

- **방법 1 (웹훅, 권장)**: `.env` 의 `SLACK_WEBHOOK_URL` 값을 바틀봇 앱의 웹훅 URL 로 교체.
  wishket-automation 이 바틀봇으로 같은 채널에 보내고 있다면 그쪽 `.env` 의 웹훅 URL 을 그대로 복사하면 끝.
- **방법 2 (봇 토큰)**: `.env` 에 `SLACK_BOT_TOKEN=xoxb-…` 와 `SLACK_CHANNEL_ID=C…` 추가.
  둘 다 있으면 웹훅 대신 `chat.postMessage` 로 전송하며, 토큰 소유 앱(바틀봇)으로 표시된다.

## 동작 구조

```
launchd (10분마다) → run-scheduler.sh → scheduler.js
  ├─ 오늘 계획 없으면: activeStart~activeEnd 사이 4시간±지터 간격으로 여러 회차 시각 추첨 → data/schedule.json
  └─ 발행 시각 지난 슬롯 → 계정별 run-once.js
       ├─ generate-content.js  (claude CLI → JSON → 카드 PNG 렌더)
       ├─ post-instagram.js    (만들기 → 업로드 → 원본비율 → 다음×2 → 캡션 → 공유 → 성공 문구 검증)
       └─ 슬랙 보고 (✅/❌/🔑)
```

- 실패 → 10분 뒤 tick 에서 자동 재시도 (최대 3회, 이후 포기 알림)
- 세션 만료 → 🔑 슬랙 알림 + 해당 회차 스킵 (login-instagram.js 재실행 필요)
- 생성물 보관: `data/posts/<계정>/<날짜-회차>/` (card.png, caption.txt, content.json)
- 주제 중복 방지: `data/history-<계정>.json` 최근 30개 주제를 LLM 프롬프트에 주입
- 실행 로그: `logs/` (실패 시 스크린샷: `logs/shots/`)

## 알려진 이슈 및 대응

| 이슈 | 원인 | 대응 |
|---|---|---|
| 업로드 버튼 못 찾음 | 인스타 UI 개편 | `post-instagram.js` 셀렉터 배열에 새 셀렉터 추가 (ko/en 병기) |
| 세션 만료 반복 | 인스타 보안 로그아웃 | login-instagram.js 재실행. 같은 IP/기기 유지 권장 |
| 계정 잠금/인증 요구 | 자동화 감지 | headlessPosting=false 유지, 하루 2회 이하 유지 (현재 설계) |
| launchd 미발화 | 폴더 권한 | ~/Projects 는 OK. ~/Desktop, ~/Documents 로 이동 금지 |
| LLM JSON 파싱 실패 | 형식 이탈 | 자동 2회 재시도. 지속 시 `config/personas/*.md` 의 형식 지시 강화 |
| LLM 생성 실패 (⏳ 사용 한도) | Claude 구독 사용 한도(5시간 윈도우) 도달 — 같은 구독을 쓰는 다른 자동화(wishket 등)와 공유됨 | 리셋 시각 이후 회차에서 자동 재시도. 슬랙 메시지에 리셋 시각 표시 |
| LLM 생성 실패 (🔑 인증 만료) | claude CLI 로그인 세션 만료 | 터미널에서 `claude` 실행 후 `/login` |
