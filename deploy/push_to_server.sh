#!/usr/bin/env bash
# Run ON YOUR LAPTOP from the project folder. Copies the app to the server and (re)starts it there.
#
#   First time (also copies your keys, settings, resume and job/HR data):
#     bash deploy/push_to_server.sh ~/Downloads/job-agent.pem ubuntu@<server-ip> --with-data
#   Later code updates (never touches the server's data, keys or settings):
#     bash deploy/push_to_server.sh ~/Downloads/job-agent.pem ubuntu@<server-ip>
set -euo pipefail
KEY="${1:?usage: push_to_server.sh /home/ubuntu/Desktop/auto-apply-JobAgent.pem 34.229.148.30 [--with-data]}"
HOST="${2:?usage: push_to_server.sh /home/ubuntu/Desktop/auto-apply-JobAgent.pem 34.229.148.30 [--with-data]}"
WITH_DATA="${3:-}"
cd "$(dirname "$0")/.."
chmod 400 "$KEY"
SSH="ssh -i $KEY -o StrictHostKeyChecking=accept-new"

echo "==> Building the dashboard"
(cd ui && npm run build >/dev/null)

EXCLUDES=(--exclude .venv --exclude ui/node_modules --exclude .git --exclude logs --exclude '__pycache__'
          --exclude 'data/.*' --exclude '*.tmp.xlsx')
if [ "$WITH_DATA" != "--with-data" ]; then
  # After the first upload the server's copy is the real one (its daily runs keep changing it)
  EXCLUDES+=(--exclude data --exclude .env --exclude config.yaml --exclude resume)
fi

echo "==> Copying to $HOST"
rsync -az --info=stats1 -e "$SSH" "${EXCLUDES[@]}" ./ "$HOST":~/auto-apply-agent/

echo "==> Setting up on the server"
$SSH "$HOST" 'bash ~/auto-apply-agent/deploy/server_setup.sh'

cat <<MSG

All set. To open the dashboard, run this on your laptop and keep it open:
  ssh -i $KEY -N -L 8765:localhost:8765 $HOST
then visit http://localhost:8765
MSG
