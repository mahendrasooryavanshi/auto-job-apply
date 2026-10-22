"""Plain-language activity feed for the dashboard (the technical log stays in logs/agent.log)."""
import json
import os
import threading
from contextlib import contextmanager
import time
from datetime import datetime

import requests

from .config import ROOT

FEED_PATH = ROOT / "data" / "activity.jsonl"
_lock = threading.Lock()

# kind: search | email | followup | reply | bounce | you | filter | schedule | problem


# What a run is doing right now (e.g. "Sent 1 of 3 · next email in 45s") and which run is going.
# Kept in files so the dashboard also sees runs started by the daily schedule (a separate process).
PROGRESS_PATH = ROOT / "data" / ".progress"
RUNNING_PATH = ROOT / "data" / ".running.json"


def set_progress(text: str) -> None:
    try:
        PROGRESS_PATH.write_text(text)
    except OSError:
        pass


def get_progress() -> str:
    try:
        return PROGRESS_PATH.read_text()
    except OSError:
        return ""


@contextmanager
def running(name: str):
    """Mark a scheduled/CLI run as in progress for the dashboard."""
    RUNNING_PATH.parent.mkdir(exist_ok=True)
    RUNNING_PATH.write_text(json.dumps({"name": name, "pid": os.getpid(),
                                        "started": datetime.now().isoformat(timespec="seconds")}))
    try:
        yield
    finally:
        RUNNING_PATH.unlink(missing_ok=True)
        set_progress("")


def external_run() -> dict | None:
    """The run started outside the dashboard (daily schedule / CLI), if one is still alive."""
    try:
        info = json.loads(RUNNING_PATH.read_text())
        os.kill(info["pid"], 0)
        return info
    except (OSError, ValueError, KeyError):
        return None


def wait_between(seconds: int, label: str) -> None:
    """Gap between emails so Gmail doesn't flag them; no sheet lock is held meanwhile."""
    for left in range(seconds, 0, -1):
        set_progress(f"{label} · next email in {left}s")
        time.sleep(1)


def record(kind: str, title: str, detail: str = "", job_id: int | None = None) -> None:
    entry = {"time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"), "kind": kind, "title": title, "detail": detail}
    if job_id:
        entry["job_id"] = job_id
    FEED_PATH.parent.mkdir(exist_ok=True)
    with _lock, open(FEED_PATH, "a") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def recent(limit: int = 300) -> list[dict]:
    if not FEED_PATH.exists():
        return []
    lines = FEED_PATH.read_text().splitlines()[-limit:]
    return [json.loads(l) for l in reversed(lines) if l.strip()]


def friendly_error(e: Exception) -> str:
    """Turn an exception into something a non-developer can act on."""
    if isinstance(e, requests.HTTPError) and e.response is not None:
        code = e.response.status_code
        if code in (401, 403):
            return "The key was rejected. Check it in Settings → Accounts & keys."
        if code == 429:
            return "The free search limit for this service is used up. It resets with your plan's period."
        if code == 404:
            return "The service changed how it works. The agent needs an update."
        return f"The service had a problem (error {code}). It will try again on the next run."
    if isinstance(e, (requests.ConnectionError, requests.Timeout)):
        return "Couldn't connect. Check your internet connection."
    text = str(e)
    if "Username and Password not accepted" in text or "AUTHENTICATIONFAILED" in text:
        return "Gmail rejected the login. Check your Gmail App Password in Settings."
    return text[:200]
