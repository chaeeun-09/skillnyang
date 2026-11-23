# 스킬냥 🐱 (skillnyang)

우리 디스코드 서버 전용 **Claude Code 스킬 추천 봇**.
GitHub 스타 + **skills.sh 실제 설치 수** + 공식·큐레이션 출처 + **우리 서버 👍 투표**로 랭킹하고,
고르면 바로 **복붙용 설치 명령**을 준다냥.

웹 디렉터리(skills.sh, Skillselion 등)와 다른 점은 **"우리 팀이 실제로 쓰는 스킬"** 이 보인다는 것:
서버마다 투표·설치 조회가 점수에 따로 반영되고, 매주 한국어 다이제스트가 채널에 올라온다.

```
/skills top [category] [type]   🏆 종합 랭킹 (우리 서버 투표 반영)
/skills search query            🔎 검색
/skills info repo               📦 상세 + 🐱 한국어 요약 + 설치할 스킬 다중 선택 + 👍 추천
/skills server                  💗 우리 서버 인기 (👍·설치 조회)
/skills rising                  📈 최근 7일 스타·설치 급상승
/skills digest set|off|now      📮 (관리자) 주간 다이제스트 채널 설정 / 미리보기
/skills refresh                 🔄 (관리자) 인덱스 즉시 갱신
```

## 구조

```
GitHub Search (topic:claude-skills …) ─┐
시드 레포 (anthropics/* …) ────────────┤
awesome-* README 링크 ─────────────────┼─▶ 후보 레포 ─▶ marketplace.json? → 플러그인 목록
skills.sh 리더보드 (토큰 있을 때) ──────┘                └ 아니면 **/SKILL.md → 스킬 목록
                                                           │
                         skills.sh 공개 검색으로 스킬별 설치 수 매칭
                                                           ▼
                     data/index.json  (전역 점수 + 일별 스냅샷 30일)  ── REFRESH_HOURS 마다
                     data/community.json (서버별 👍·조회·다이제스트 채널)
                     data/summaries.json (한국어 요약 캐시)
                                                           ▼
                          Discord 슬래시 커맨드 · 버튼 · 셀렉트 메뉴 · 주간 다이제스트
```

### 점수 (`src/ranking.ts` 의 `WEIGHTS`)

| 항목 | 점수 |
|---|---|
| GitHub 스타 | `log10(stars+1) × 15` (1k≈45, 100k≈75) |
| skills.sh 설치 수 (레포 내 스킬 합) | `log10(installs+1) × 15` |
| 공식 출처 (`OFFICIAL_OWNERS`, 기본 `anthropics`) | +20 |
| awesome 큐레이션 수록 | 리스트당 +4 (최대 3개) |
| 플러그인 마켓플레이스 형태 | +3 |
| **우리 서버 👍** (서버별) | `log2(votes+1) × 8` (1표 8, 3표 16, 7표 24) |
| **우리 서버 설치 조회** (서버별, 최근 90일) | `log2(clicks+1) × 3` |

스타는 레포 단위라 스킬 100개짜리 레포는 전부 같은 값이 되는데, 설치 수는 스킬별로 잡혀서 그 왜곡을 줄여준다.
서버 가산점은 해당 서버에서만 적용된다.

### 설치 명령

| 레포 형태 | 봇이 주는 명령 |
|---|---|
| 플러그인 마켓플레이스 | `/plugin marketplace add owner/repo` → `/plugin install <plugin>@<marketplace>` (+ 터미널용 `claude plugin ...`) |
| 공식 마켓플레이스 | `/plugin install <plugin>@claude-plugins-official` |
| 단일 스킬 폴더 | `npx skills add owner/repo --skill <name> --agent claude-code -g` 또는 git clone → `~/.claude/skills/<name>` |

레포에서 읽은 이름·경로는 **화이트리스트 정규식(`src/install.ts`)을 통과한 값만** 명령으로 만든다.
봇 메시지는 `allowedMentions: []` 로 보내서 외부 텍스트에 `@everyone` 이 섞여도 멘션되지 않는다.

### 데이터 소스 메모

- **skills.sh 공개 검색** `GET https://skills.sh/api/search?q=&owner=` — `npx skills find` 가 쓰는 엔드포인트로 인증이 필요 없다.
  레포당 최대 `SKILLS_SH_QUERIES_PER_REPO`(기본 8)회 호출. 연속 실패하면 30분간 조회를 멈추고 스타만으로 계속 랭킹한다.
- **skills.sh v1 API** (`/api/v1/skills` 리더보드)는 Vercel OIDC 토큰이 필요해서 `SKILLS_SH_TOKEN` 이 있을 때만 쓴다(선택).
- **한국어 요약**은 `ANTHROPIC_API_KEY` 가 있을 때만. 레포가 새로 푸시되기 전까지 캐시를 재사용한다.

## 실행

### 1. 준비
1. [Discord Developer Portal](https://discord.com/developers/applications) → New Application → Bot → 토큰 발급
2. OAuth2 → URL Generator: scope `bot`, `applications.commands` / 권한 `Send Messages`, `Embed Links` → 서버 초대
3. GitHub fine-grained PAT (Public repositories read-only)
4. (선택) Anthropic API 키 — 한국어 요약
5. `cp .env.example .env` 후 값 채우기

### 2. Docker Compose
```bash
docker compose build
docker compose run --rm deploy-commands   # 슬래시 커맨드 등록 (최초 1회 / 커맨드 변경 시)
docker compose up -d
docker compose logs -f bot                # 첫 크롤링은 수 분 걸림
```
서버에서 `/skills digest set channel:#스킬소식` 하면 매주 월요일 10시(서울)에 다이제스트가 올라온다.

### 로컬 개발
```bash
npm ci
npm test
npm run build
node --env-file=.env dist/src/crawl-once.js       # 봇 없이 크롤링만 → 상위 20개 출력
node --env-file=.env dist/src/deploy-commands.js
node --env-file=.env dist/src/index.js
```

## API 사용량

GitHub 인증 시 core 5,000회/시간, search 30회/분. 기본 설정이면 한 번 갱신에 최대 ~550회.
SKILL.md·marketplace.json 은 `raw.githubusercontent.com` 으로 받아서 API 한도를 쓰지 않는다.
skills.sh 공개 검색은 레포 300개 × 최대 8회 = 최대 2,400회/갱신이므로, 부담되면 `SKILLS_SH_QUERIES_PER_REPO` 를 줄이거나 `REFRESH_HOURS` 를 늘리자.
