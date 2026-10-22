#!/usr/bin/env bash
# Run ON THE SERVER (Ubuntu 22.04/24.04) from the project folder. Safe to run again after updates.
#   bash deploy/server_setup.sh
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

echo "==> India time, so the daily run happens at 9:30 IST"
sudo timedatectl set-timezone Asia/Kolkata

echo "==> 2 GB swap (micro servers have only 1 GB memory)"
if ! swapon --show | grep -q .; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "==> Python"
sudo apt-get update -qq && sudo apt-get install -y -qq python3-venv python3-pip >/dev/null
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install -q --upgrade pip && .venv/bin/pip install -q -r requirements.txt

echo "==> Files and permissions"
mkdir -p data logs resume
[ -f .env ] || cp .env.example .env
chmod 600 .env
[ -f ui/dist/index.html ] || echo "WARNING: ui/dist is missing; build it on your laptop (cd ui && npm run build) and push again."

echo "==> Background services (dashboard + 9:30 daily run), kept running after you log out"
sudo loginctl enable-linger "$USER"
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
mkdir -p ~/.config/systemd/user
for f in deploy/jobagent-*; do
  sed "s#/home/ubuntu/Desktop/auto-apply-agent#$APP_DIR#g" "$f" > ~/.config/systemd/user/"$(basename "$f")"
done
systemctl --user daemon-reload
systemctl --user enable jobagent-ui.service jobagent-daily.timer >/dev/null
systemctl --user restart jobagent-ui.service
systemctl --user start jobagent-daily.timer

# 401 = running in prod mode, behind its login. A micro server takes a few seconds to start it.
up() { [[ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8765/api/version)" =~ ^(200|401)$ ]]; }
for _ in $(seq 20); do up && break; sleep 1; done
if up; then
  echo "==> Done. Dashboard is running on the server (port 8765)."
  systemctl --user list-timers jobagent-daily.timer --no-pager | sed -n '1,2p'
else
  echo "Dashboard didn't start; see: journalctl --user -u jobagent-ui -n 50"
  exit 1
fi
