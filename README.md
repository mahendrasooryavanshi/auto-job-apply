# Job Agent

Finds jobs that match your tech stack, drafts and sends emails to recruiters from your Gmail (resume attached),
emails your own HR list, follows up, tracks replies, and suggests LinkedIn / Naukri profile improvements.
Everything is managed from a dashboard at **http://localhost:8765**.

---

## Quick start (already set up on this computer)

The dashboard runs in the background and starts when you log in. Just open:

```
http://localhost:8765
```

If the page doesn't load, start it:

```bash
systemctl --user start jobagent-ui.service
```

---

## First-time setup (new computer)

Requirements: Linux, Python 3.10+, Node.js 18+, and a Gmail account with 2-Step Verification on.

```bash
cd ~/Desktop/auto-apply-agent

# 1. Python backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# 2. Dashboard (React)
cd ui && npm install && npm run build && cd ..

# 3. Settings file for keys (fill it in from the dashboard later).
#    config.yaml (your profile/search settings) is created from config.example.yaml on first start.
cp .env.example .env && chmod 600 .env

# 4. Start the dashboard
.venv/bin/python -m jobagent ui
```

Open **http://localhost:8765**, go to **Settings**, then:

1. **Accounts & keys**: Gmail address + Gmail **App Password** (https://myaccount.google.com/apppasswords),
   a job source key (JSearch / Adzuna / Serper), and a Gemini or Claude key.
2. **Resume**: upload your PDF.
3. **Your profile** and **What to search for**: name, phone, LinkedIn URL, roles, skills, locations.
4. Click **Test Gmail connection**.

### Run it in the background + daily schedule (recommended)

Installs the dashboard as a service (starts at login, restarts if it crashes) and a daily run at 9:30
(find jobs, check replies, send approved emails, HR list and follow-ups):

```bash
cd ~/Desktop/auto-apply-agent
mkdir -p ~/.config/systemd/user
for f in deploy/jobagent-*; do sed "s#/home/ubuntu/Desktop/auto-apply-agent#$PWD#g" "$f" > ~/.config/systemd/user/$(basename "$f"); done
systemctl --user daemon-reload
systemctl --user enable --now jobagent-ui.service jobagent-daily.timer
```

(Stop any `python -m jobagent ui` you started by hand first, or the service can't use port 8765.)

---

## Everyday commands

| What | Command |
|---|---|
| Open the dashboard | http://localhost:8765 |
| Start / stop / restart dashboard | `systemctl --user start\|stop\|restart jobagent-ui.service` |
| Is it running? | `systemctl --user status jobagent-ui.service` |
| When is the next daily run? | `systemctl --user list-timers jobagent-daily.timer` |
| Run the daily job now | `systemctl --user start jobagent-daily.service` |
| Turn the daily run off / on | `systemctl --user disable --now jobagent-daily.timer` / `enable --now` |
| Dashboard server log | `journalctl --user -u jobagent-ui -f` |
| Agent technical log | `tail -f logs/agent.log` |

Command line (run inside the project folder; the dashboard buttons do the same):

```bash
.venv/bin/python -m jobagent find      # search jobs, filter, add to the sheet, draft emails
.venv/bin/python -m jobagent send      # check replies, send approved emails, HR list, follow-ups
.venv/bin/python -m jobagent run       # find + send (what the 9:30 run does)
.venv/bin/python -m jobagent recheck   # re-apply your filters to saved jobs
.venv/bin/python -m jobagent status    # counts per status
.venv/bin/python -m jobagent ui        # start the dashboard by hand (if the service isn't used)
```

### After changing the dashboard code

```bash
cd ui && npm run build && cd .. && systemctl --user restart jobagent-ui.service
```

For live-reload while editing the React code: keep the backend running and use `cd ui && npm run dev`
(opens on http://localhost:5173).

---

## Where things are

| File | What it holds |
|---|---|
| `data/job_tracker.xlsx` | Jobs found, email drafts, statuses |
| `data/hr_contacts.xlsx` | Your HR list (edit in the dashboard or in LibreOffice/Excel) |
| `data/activity.jsonl` | The Activity feed |
| `config.yaml` | Your profile, search and email settings (edited from Settings; private, not in git) |
| `.env` | Keys and Gmail App Password (private; never share or commit) |
| `resume/` | Your uploaded resume |
| `logs/agent.log` | Technical log for troubleshooting |
| `deploy/` | Background service and daily-timer files |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Page doesn't open | `systemctl --user restart jobagent-ui.service`, then check `journalctl --user -u jobagent-ui -n 50` |
| "address already in use" on port 8765 | Something else uses it: `ss -ltnp \| grep 8765`, stop it or the hand-started copy |
| Dashboard looks old after an update | Rebuild (`cd ui && npm run build`) and reload with **Ctrl+Shift+R** |
| "Gmail rejected the login" | Use a 16-letter **App Password**, not your normal password |
| HR emails not sending | Close `hr_contacts.xlsx` in LibreOffice (the agent won't write while it's open) |
| Find jobs returns nothing | Add a job source key in Settings; check the **Activity** page for the reason |
| Emails go out slowly | Intended: there is a gap between emails (Settings → Seconds between emails) so Gmail doesn't flag you |

**Safety notes:** the dashboard only accepts connections from this computer. Keep the daily limit modest
(start around 30/day) so Gmail doesn't mark you as spam. LinkedIn is never logged into or automated.

---

## Deploy to AWS (EC2 free tier)

1. **Launch** EC2 → Ubuntu 24.04 → `t3.micro`/`t2.micro` ("Free tier eligible") → 20 GB disk → new key pair (`.pem`) →
   security group: **SSH (22) from My IP only**. Do not open port 8765.
2. **First upload** (from this folder on your laptop; copies code + keys + settings + resume + data, then sets everything up):
   ```bash
   bash deploy/push_to_server.sh ~/Downloads/job-agent.pem ubuntu@<server-ip> --with-data
   ```
3. **Open the dashboard** through a private SSH tunnel (keep it running), then visit http://localhost:8765:
   ```bash
   ssh -i ~/Downloads/job-agent.pem -N -L 8765:localhost:8765 ubuntu@<server-ip>
   ```
   Stop the laptop's own copy first, or both send emails: `systemctl --user disable --now jobagent-ui.service jobagent-daily.timer`
4. **Later code updates** (never overwrites the server's data, keys or settings):
   ```bash
   bash deploy/push_to_server.sh ~/Downloads/job-agent.pem ubuntu@<server-ip>
   ```
Server logs: `ssh -i <key> ubuntu@<ip> 'journalctl --user -u jobagent-ui -n 50'` · daily run: `systemctl --user list-timers`
