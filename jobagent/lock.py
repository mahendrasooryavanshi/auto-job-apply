"""Cross-process locks so the daily run, CLI and UI never write the same file at the same time.

  jobs  - the job tracker sheet
  hr    - the HR outreach sheet
  send  - only one send run at a time (it releases the sheet locks between emails)
"""
import fcntl
import time
from contextlib import contextmanager

from .config import ROOT

LOCK_DIR = ROOT / "data"
MESSAGES = {
    "jobs": "The agent is busy updating your job list; try again in a moment",
    "hr": "The agent is busy updating your HR sheet; try again in a moment",
    "send": "Emails are already being sent; wait for that to finish",
}


class Busy(Exception):
    pass


@contextmanager
def agent_lock(name: str = "jobs", wait: float | None = None):
    """wait=None blocks until free; wait=N gives up with Busy after N seconds."""
    LOCK_DIR.mkdir(parents=True, exist_ok=True)
    with open(LOCK_DIR / f".{name}.lock", "w") as f:
        deadline = None if wait is None else time.monotonic() + wait
        while True:
            try:
                fcntl.flock(f, fcntl.LOCK_EX | (0 if deadline is None else fcntl.LOCK_NB))
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise Busy(MESSAGES.get(name, "The agent is busy; try again shortly"))
                time.sleep(0.2)
        try:
            yield
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)
