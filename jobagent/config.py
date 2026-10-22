import os
from pathlib import Path

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
