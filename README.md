# skill-scout 🔭

Claude Code 스킬/플러그인을 **GitHub 스타 + 공식·큐레이션 출처 가산점**으로 랭킹해서 추천하고,
디스코드에서 **복붙용 설치 명령**까지 바로 주는 봇.

```
/skills top category:devops      → 랭킹 + "설치할 레포 선택" 메뉴
/skills search query:terraform   → 키워드 검색
/skills info repo:anthropics/skills → 상세 + 설치할 스킬 다중 선택 → 설치 명령
/skills refresh                  → (서버 관리 권한) 인덱스 즉시 갱신
```

## 동작 구조

```
GitHub Search (topic:claude-skills 등) ─┐
시드 레포 (anthropics/* 등) ────────────┼─▶ 후보 레포 (스타순, MAX_REPOS)
awesome-* README 링크 ─────────────────┘          │
                                                  ▼
             .claude-plugin/marketplace.json 있음? ── yes ─▶ 플러그인 목록
                                                  └─ no ──▶ **/SKILL.md 탐색 → frontmatter(name, description)
                                                  ▼
                                   점수 계산 → data/index.json (REFRESH_HOURS 마다 갱신)
                                                  ▼
                                   Discord 슬래시 커맨드 / 셀렉트 메뉴
```

### 점수 (`src/ranking.ts` 의 `WEIGHTS`)

| 항목 | 점수 |
|---|---|
| GitHub 스타 | `log10(stars+1) × 20` (1k★≈60, 10k★≈80, 100k★≈100) |
| 공식 출처 (`OFFICIAL_OWNERS`, 기본 `anthropics`) | +25 |
| awesome 큐레이션 리스트 수록 | 리스트당 +5 (최대 3개) |
| 플러그인 마켓플레이스 형태 (한 번에 설치 가능) | +3 |

로그 스케일이라 스타가 압도적인 레포만 독식하지 않고, 공식 1k★ 레포가 비공식 10k★ 레포보다 위에 옵니다.

### 설치 명령

| 레포 형태 | 봇이 주는 명령 |
|---|---|
| 플러그인 마켓플레이스 | `/plugin marketplace add owner/repo` → `/plugin install <plugin>@<marketplace>` (+ 터미널용 `claude plugin ...`) |
| 공식 마켓플레이스 | `/plugin install <plugin>@claude-plugins-official` (add 불필요) |
| 단일 스킬 폴더 | `npx skills add owner/repo --skill <name>` 또는 git clone → `~/.claude/skills/<name>` 복사 |

레포에서 읽어온 이름·경로는 사용자가 터미널에 붙여넣게 되므로 **화이트리스트 정규식(`src/install.ts`)을 통과한 값만** 명령으로 만듭니다
(`; $( ) \` ..` 등 포함 시 생략). 그래도 스킬은 로컬에서 코드를 실행할 수 있으니, 봇 메시지에 설치 전 확인 경고를 항상 붙입니다.

## 실행

### 1. 준비
1. [Discord Developer Portal](https://discord.com/developers/applications) → New Application → Bot → 토큰 발급
2. OAuth2 → URL Generator: scope `bot`, `applications.commands` / 권한 `Send Messages`, `Embed Links` → 서버 초대
3. GitHub fine-grained PAT 발급 (Public repositories read-only)
4. `cp .env.example .env` 후 값 채우기

### 2. Docker Compose
```bash
docker compose build
docker compose run --rm deploy-commands   # 슬래시 커맨드 등록 (최초 1회 / 커맨드 변경 시)
docker compose up -d
docker compose logs -f bot                # 첫 크롤링은 수 분 걸림
```

### 로컬 개발
```bash
npm ci
npm test                 # 단위 테스트
npm run build
node --env-file=.env dist/src/crawl-once.js       # 봇 없이 크롤링만 → 상위 20개 출력
node --env-file=.env dist/src/deploy-commands.js
node --env-file=.env dist/src/index.js
```

## API 사용량

GitHub 인증 시 core 5,000회/시간, search 30회/분. 기본 설정(검색 7개 쿼리 × 최대 2페이지, 큐레이션 링크 메타 최대 200회,
레포 300개 × 트리 1회)이면 한 번 갱신에 최대 ~550회 정도 쓰고, SKILL.md·marketplace.json 은 `raw.githubusercontent.com` 으로 받아서 API 한도를 쓰지 않습니다.

## 확장 아이디어
- 👍 반응 / 설치 클릭 수를 점수에 반영 (서버 내 인기)
- 새로 급상승한 스킬을 채널에 주간 다이제스트로 자동 게시
- 스킬 SKILL.md 를 LLM으로 요약해 한국어 설명 제공
