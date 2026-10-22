"""Read and update settings from the dashboard: config.yaml, .env secrets and the resume file."""
import os
import re
import smtplib
from pathlib import Path

import yaml

from .company_jobs import DEFAULT_COMPANIES, company_status
from .config import CONFIG_PATH, ENV_KEYS, ENV_PATH, ROOT, read_env, read_raw_config

SECRET_KEYS = {"GMAIL_APP_PASSWORD", "ANTHROPIC_API_KEY", "RAPIDAPI_KEY", "ADZUNA_APP_KEY",
               "SERPER_API_KEY", "SERPAPI_KEY", "GEMINI_API_KEY",
               "LINKEDIN_CLIENT_SECRET", "JOBSPIPE_API_KEY"}
RESUME_TYPES = {".pdf", ".doc", ".docx"}
MAX_RESUME_BYTES = 5 * 1024 * 1024

CANDIDATE_FIELDS = {"name", "phone", "linkedin", "naukri", "experience_years",
                    "current_ctc", "expected_ctc", "notice_period"}
SEARCH_LISTS = {"roles", "locations", "primary_skills", "secondary_skills", "required_skills", "target_companies",
                "exclude_keywords", "exclude_title_keywords", "exclude_companies"}
# field: (min, max)
SEARCH_NUMBERS = {"posted_within_days": (1, 30), "min_match_percent": (0, 100)}
EMAIL_NUMBERS = {"daily_limit": (1, 500), "delay_seconds": (5, 600), "follow_up_days": (0, 30)}
EMAIL_BOOLS = {"auto_send", "use_claude"}
SEARCH_BOOLS = {"linkedin_jobs", "company_jobs"}


class SettingsError(ValueError):
    pass


def _atomic_write(path: Path, text: str, mode: int | None = None) -> None:
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text)
    if mode is not None:
        os.chmod(tmp, mode)
    os.replace(tmp, path)


def get_settings() -> dict:
    cfg = read_raw_config()
    env = read_env()
    resume = ROOT / cfg["candidate"]["resume_path"]
    return {
        "candidate": {k: cfg["candidate"].get(k, "") for k in CANDIDATE_FIELDS},
        "search": {"target_companies": DEFAULT_COMPANIES, "company_jobs": True, **cfg["search"]},
        "company_sources": company_status(cfg["search"].get("target_companies", DEFAULT_COMPANIES)),
        "email": cfg["email"],
        "gmail_address": env["GMAIL_ADDRESS"],
        "adzuna_app_id": env["ADZUNA_APP_ID"],
        "linkedin_client_id": env["LINKEDIN_CLIENT_ID"],
        # Secrets never leave the server: only whether each one is set
        "secrets": {k: bool(env[k]) for k in SECRET_KEYS},
        "resume": {"name": resume.name, "exists": resume.exists(),
                   "size": resume.stat().st_size if resume.exists() else 0},
    }


def _number(value, lo, hi, name):
    try:
        n = int(value)
    except (TypeError, ValueError):
        raise SettingsError(f"{name} must be a number")
    if not lo <= n <= hi:
        raise SettingsError(f"{name} must be between {lo} and {hi}")
    return n


def update_config(data: dict) -> None:
    cfg = read_raw_config()
    for k, v in (data.get("candidate") or {}).items():
        if k not in CANDIDATE_FIELDS:
            continue
        cfg["candidate"][k] = _number(v or 0, 0, 60, "Experience") if k == "experience_years" else str(v or "").strip()
    for k, v in (data.get("search") or {}).items():
        if k in SEARCH_LISTS:
            cfg["search"][k] = [str(x).strip() for x in v if str(x).strip()]
        elif k in SEARCH_NUMBERS:
            cfg["search"][k] = _number(v, *SEARCH_NUMBERS[k], k.replace("_", " "))
        elif k in SEARCH_BOOLS:
            cfg["search"][k] = bool(v)
    for k, v in (data.get("email") or {}).items():
        if k in EMAIL_NUMBERS:
            cfg["email"][k] = _number(v, *EMAIL_NUMBERS[k], k.replace("_", " "))
        elif k in EMAIL_BOOLS:
            cfg["email"][k] = bool(v)
    if not cfg["search"]["roles"]:
        raise SettingsError("Add at least one job role")
    if not cfg["search"]["primary_skills"]:
        raise SettingsError("Add at least one primary skill")
    _write_config(cfg)


def _write_config(cfg: dict) -> None:
    header = "# Managed by the Job Agent dashboard (Settings page). Manual edits are fine too.\n"
    _atomic_write(CONFIG_PATH, header + yaml.safe_dump(cfg, sort_keys=False, allow_unicode=True))


def update_email_template(subject: str, body: str) -> None:
    cfg = read_raw_config()
    cfg["email"]["hr_subject"], cfg["email"]["hr_body"] = subject, body
    _write_config(cfg)


def update_env(updates: dict) -> None:
    """Set the given .env keys. Empty values are ignored, so saved secrets aren't wiped by blank fields."""
    clean = {}
    for k, v in updates.items():
        if k not in ENV_KEYS or v is None or str(v).strip() == "":
            continue
        v = str(v).strip()
        if "\n" in v or "\r" in v:
            raise SettingsError(f"{k} must be a single line")
        if k == "GMAIL_APP_PASSWORD":
            v = v.replace(" ", "")
            if not re.fullmatch(r"[A-Za-z]{16}", v):
                raise SettingsError("Gmail App Password is 16 letters (from myaccount.google.com/apppasswords), not your normal password")
        if k == "GMAIL_ADDRESS" and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", v):
            raise SettingsError("Enter a valid Gmail address")
        clean[k] = v
    if not clean:
        return
    lines = ENV_PATH.read_text().splitlines() if ENV_PATH.exists() else []
    written = set()
    for i, line in enumerate(lines):
        key = line.split("=", 1)[0].strip()
        if key in clean:
            lines[i] = f"{key}={_quote(clean[key])}"
            written.add(key)
    lines += [f"{k}={_quote(v)}" for k, v in clean.items() if k not in written]
    _atomic_write(ENV_PATH, "\n".join(lines) + "\n", mode=0o600)


def clear_env(key: str) -> None:
    if key not in ENV_KEYS or not ENV_PATH.exists():
        return
    lines = [f"{key}=" if l.split("=", 1)[0].strip() == key else l for l in ENV_PATH.read_text().splitlines()]
    _atomic_write(ENV_PATH, "\n".join(lines) + "\n", mode=0o600)


def _quote(v: str) -> str:
    return '"' + v.replace("\\", "\\\\").replace('"', '\\"') + '"'


def save_resume(filename: str, content: bytes) -> str:
    name = Path(filename).name
    ext = Path(name).suffix.lower()
    if ext not in RESUME_TYPES:
        raise SettingsError("Resume must be a PDF or Word file")
    if not content:
        raise SettingsError("The file is empty")
    if len(content) > MAX_RESUME_BYTES:
        raise SettingsError("Resume must be under 5 MB")
    # Recruiters see this filename on the attachment, so keep it readable
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(name).stem).strip("_") or "resume"
    target = ROOT / "resume" / f"{safe}{ext}"
    target.parent.mkdir(exist_ok=True)
    target.write_bytes(content)
    cfg = read_raw_config()
    cfg["candidate"]["resume_path"] = str(target.relative_to(ROOT))
    _write_config(cfg)
    return target.name


def test_gmail() -> str:
    env = read_env()
    if not env["GMAIL_ADDRESS"] or not env["GMAIL_APP_PASSWORD"]:
        raise SettingsError("Save your Gmail address and App Password first")
    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=30) as smtp:
            smtp.login(env["GMAIL_ADDRESS"], env["GMAIL_APP_PASSWORD"])
    except smtplib.SMTPAuthenticationError:
        raise SettingsError("Gmail rejected the login. Check the address and App Password (2-Step Verification must be on).")
    except OSError as e:
        raise SettingsError(f"Couldn't reach Gmail: {e}")
    return f"Connected to Gmail as {env['GMAIL_ADDRESS']}"
