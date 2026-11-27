#!/usr/bin/env bash
# Deploy from this PC (Git Bash) to the LAN VM:
#   scripts/deploy.sh                     # committed HEAD
#   WORKTREE=1 scripts/deploy.sh          # tracked + untracked (not ignored) files as they are now
#   ENV_FILE=path/to/.env scripts/deploy.sh   # first deploy: upload this .env if the VM has none
# Env: VM (deploy@192.168.1.48), SSH_KEY (~/.ssh/deal_search_proxmox), REMOTE_DIR
# (/home/deploy/deal-search), HEALTH_URL (http://192.168.1.48:3000/api/health).
# The remote folder is replaced with the new tree except .env; the data lives in the Docker
# volume, not in that folder. Then: docker compose up -d --build, and a health check.
set -euo pipefail

VM="${VM:-deploy@192.168.1.48}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/deal_search_proxmox}"
REMOTE_DIR="${REMOTE_DIR:-/home/deploy/deal-search}"
HEALTH_URL="${HEALTH_URL:-http://${VM#*@}:3000/api/health}"
SSH=(ssh -i "$SSH_KEY" -o BatchMode=yes "$VM")

cd "$(git rev-parse --show-toplevel)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

if [ "${WORKTREE:-0}" = "1" ]; then
  git ls-files -z --cached --others --exclude-standard | xargs -0 tar -cf "$tmp/release.tar" --ignore-failed-read --
  echo "deploy: packed the working tree"
else
  git -c core.autocrlf=false archive --format=tar -o "$tmp/release.tar" HEAD
  echo "deploy: packed $(git rev-parse --short HEAD)"
fi

"${SSH[@]}" "mkdir -p '$REMOTE_DIR' && find '$REMOTE_DIR' -mindepth 1 -maxdepth 1 ! -name .env -exec rm -rf {} + && tar -xf - -C '$REMOTE_DIR'" < "$tmp/release.tar"

if ! "${SSH[@]}" "test -f '$REMOTE_DIR/.env'"; then
  if [ -n "${ENV_FILE:-}" ]; then
    "${SSH[@]}" "umask 077 && cat > '$REMOTE_DIR/.env'" < "$ENV_FILE"
    echo "deploy: uploaded $ENV_FILE as .env"
  else
    "${SSH[@]}" "cp '$REMOTE_DIR/.env.example' '$REMOTE_DIR/.env' && chmod 600 '$REMOTE_DIR/.env'"
    echo "deploy: WARNING created .env from .env.example; edit it on the VM (APP_HOSTS, Telegram)" >&2
  fi
fi

"${SSH[@]}" "cd '$REMOTE_DIR' && docker compose up -d --build --remove-orphans"

echo "deploy: waiting for $HEALTH_URL"
for _ in $(seq 1 30); do
  if body="$(curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null)"; then
    echo "deploy: healthy: $body"
    exit 0
  fi
  sleep 3
done
echo "deploy: health check failed; see: ssh $VM 'cd $REMOTE_DIR && docker compose logs --tail=100 app'" >&2
exit 1
