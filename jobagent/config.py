import os
from pathlib import Path
from urllib.parse import urlsplit

import yaml
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = ROOT / ".env"
CONFIG_PATH = ROOT / "config.yaml"
ENV_KEYS = (
    "GMAIL_ADDRESS", "GMAIL_APP_PASSWORD", "ANTHROPIC_API_KEY",
    "RAPIDAPI_KEY", "ADZUNA_APP_ID", "ADZUNA_APP_KEY", "SERPER_API_KEY", "SERPAPI_KEY", "GEMINI_API_KEY",
    "LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET", "JOBSPIPE_API_KEY",
)


def read_env() -> dict:
    """Read .env fresh on every call so keys saved from the dashboard apply immediately."""
    file_env = dotenv_values(ENV_PATH) if ENV_PATH.exists() else {}
    return {k: file_env.get(k) or os.getenv(k, "") for k in ENV_KEYS}


def server_settings() -> dict:
    """How the dashboard is served. dev: this computer only. prod: reachable at JOBAGENT_PUBLIC_URL behind a login.
    Set in .env (or the environment); not editable from the dashboard, so the login can't be switched off from there."""
    file_env = dotenv_values(ENV_PATH) if ENV_PATH.exists() else {}
    get = lambda k, default="": (file_env.get(k) or os.getenv(k) or default).strip()
    env = get("JOBAGENT_ENV", "dev").lower()
    if env not in ("dev", "prod"):
        raise SystemExit(f"JOBAGENT_ENV must be dev or prod, not {env!r}")
    port = int(get("JOBAGENT_PORT", "8765"))
    public_url = get("JOBAGENT_PUBLIC_URL", f"http://localhost:{port}").rstrip("/")
    hosts = {h.strip().lower() for h in get("JOBAGENT_ALLOWED_HOSTS").split(",") if h.strip()}
    if env == "prod":
        hosts.add(urlsplit(public_url).hostname or "")
    return {
        "env": env, "port": port, "public_url": public_url, "allowed_hosts": hosts - {""},
        "host": get("JOBAGENT_HOST", "0.0.0.0" if env == "prod" else "127.0.0.1"),
        "user": get("JOBAGENT_USER", "admin"), "password": get("JOBAGENT_PASSWORD"),
    }


def read_raw_config() -> dict:
    if not CONFIG_PATH.exists():   # first start after cloning: begin from the shareable example
        CONFIG_PATH.write_text((ROOT / "config.example.yaml").read_text())
    with open(CONFIG_PATH) as f:
        return yaml.safe_load(f)


def load_config() -> dict:
    cfg = read_raw_config()
    cfg["sheet_path"] = str(ROOT / cfg["sheet_path"])
    cfg["candidate"]["resume_path"] = str(ROOT / cfg["candidate"]["resume_path"])
    cfg["env"] = read_env()
    return cfg
