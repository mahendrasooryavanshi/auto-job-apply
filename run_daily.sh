#!/usr/bin/env bash
# Manual run of the daily job. The schedule itself is the systemd timer in deploy/ (see install below):
#   cp deploy/jobagent-* ~/.config/systemd/user/ && systemctl --user daemon-reload
#   systemctl --user enable --now jobagent-ui.service jobagent-daily.timer
cd "$(dirname "$0")"
.venv/bin/python -m jobagent run
