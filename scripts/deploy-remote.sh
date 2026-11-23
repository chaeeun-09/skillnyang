#!/usr/bin/env bash
# 서버에서 실행되는 배포 스크립트 (내 PC에서 ssh 로 흘려보내서 실행)
#   ssh -p 21131 ubuntu@ssh.gsmsv.site "bash -s" < scripts\deploy-remote.sh
# 사전 조건: 서버 홈에 ~/skillnyang.env (scp 로 올린 .env) 가 있거나 ~/skillnyang/.env 가 이미 있을 것
set -euo pipefail
export GIT_TERMINAL_PROMPT=0

REPO="https://github.com/chaeeun-09/skillnyang.git"
DIR="$HOME/skillnyang"

say() { printf '\n==> %s\n' "$*"; }
die() { printf '\n[실패] %s\n' "$*" >&2; exit 1; }

say "1/5 환경 확인"
command -v git >/dev/null    || die "git 이 없습니다 (sudo apt install -y git)"
command -v docker >/dev/null || die "docker 가 없습니다"
docker compose version >/dev/null 2>&1 || die "docker compose 플러그인이 없습니다"
docker info >/dev/null 2>&1  || die "이 계정에 docker 권한이 없습니다. 'sudo usermod -aG docker \$USER' 후 다시 접속해서 재시도하세요"

say "2/5 코드 받기"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only
else
  git clone "$REPO" "$DIR" || die "clone 실패 — 레포가 비공개이면 공개로 바꾸거나 다른 방법이 필요합니다"
fi

say "3/5 .env 배치"
if [ -f "$HOME/skillnyang.env" ]; then
  mv "$HOME/skillnyang.env" "$DIR/.env"
fi
[ -f "$DIR/.env" ] || die ".env 가 없습니다. 먼저 'scp -P 21131 .env ubuntu@ssh.gsmsv.site:~/skillnyang.env' 를 실행하세요"
chmod 600 "$DIR/.env"
for k in DISCORD_TOKEN DISCORD_CLIENT_ID GITHUB_TOKEN; do
  grep -Eq "^${k}=.+" "$DIR/.env" || die ".env 에 ${k} 값이 비어 있습니다"
done

cd "$DIR"

say "4/5 빌드 + 슬래시 커맨드 등록"
docker compose build
docker compose run --rm deploy-commands

say "5/5 실행"
docker compose up -d
sleep 12
docker compose ps
echo
docker compose logs --tail 15 bot
echo
echo "완료. 크롤링은 몇 분 걸립니다: docker compose logs -f bot"
