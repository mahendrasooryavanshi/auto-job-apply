"""Minimal Google Gemini client (REST) used when a Gemini key is saved instead of a Claude key."""
import json
import logging
import re
import time

import requests

log = logging.getLogger(__name__)

BASE = "https://generativelanguage.googleapis.com/v1beta"
DEFAULT_MODEL = "gemini-flash-latest"     # Google's alias for the current flash model
BUSY_FALLBACK = "gemini-flash-lite-latest"  # lighter model to try when the main one is overloaded
RETRY_WAITS = (3, 8, 15)
_model_cache: dict[str, str] = {}


class GeminiError(RuntimeError):
    pass


def _pick_model(key: str) -> str:
    """Newest 'flash' model this key can use; Google retires model names over time."""
    resp = requests.get(f"{BASE}/models", headers={"x-goog-api-key": key}, params={"pageSize": 200}, timeout=30)
    resp.raise_for_status()
    names = [m["name"].removeprefix("models/") for m in resp.json().get("models", [])
             if "generateContent" in m.get("supportedGenerationMethods", [])]
    flash = [n for n in names if "flash" in n and not re.search(r"lite|preview|exp|tts|image|audio|live", n)]
    if not (flash or names):
        raise GeminiError("This Gemini key can't use any text model")

    def version(n: str) -> tuple:
        return tuple(int(x) for x in re.findall(r"\d+", n)[:2])
    return sorted(flash or names, key=version)[-1]


def _post(key: str, model: str, body: dict) -> requests.Response:
    return requests.post(f"{BASE}/models/{model}:generateContent", headers={"x-goog-api-key": key},
                         json=body, timeout=180)


def generate(key: str, system: str, prompt: str, schema: dict | None = None, max_tokens: int = 4096) -> str:
    """Return the model's text. With schema (Gemini's OpenAPI-style subset), the text is JSON."""
    model = _model_cache.get(key, DEFAULT_MODEL)
    config = {"maxOutputTokens": max_tokens, "thinkingConfig": {"thinkingLevel": "low"}}
    if schema:
        config.update(responseMimeType="application/json", responseSchema=schema)
    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": config,
    }
    resp = _post(key, model, body)
    if resp.status_code == 404:                      # model retired: switch to one this key can use
        model = _model_cache[key] = _pick_model(key)
        log.info("Gemini model unavailable; using %s", model)
        resp = _post(key, model, body)
    if resp.status_code == 400 and "thinking" in resp.text.lower():
        config.pop("thinkingConfig")                 # older models don't take thinking levels
        resp = _post(key, model, body)
    for wait in RETRY_WAITS:                         # overloaded: wait and retry, then try the lighter model
        if resp.status_code not in (500, 503):
            break
        time.sleep(wait)
        resp = _post(key, model if wait != RETRY_WAITS[-1] else BUSY_FALLBACK, body)
    if resp.status_code in (500, 503):
        raise GeminiError("Gemini is overloaded right now. Try again in a few minutes.")
    if resp.status_code in (400, 401, 403) and "API key" in resp.text:
        raise GeminiError("Gemini rejected the API key. Check it in Settings.")
    if resp.status_code == 429:
        raise GeminiError("Gemini's free usage limit is reached for now. Try again later.")
    resp.raise_for_status()
    data = resp.json()
    candidates = data.get("candidates") or []
    if not candidates:
        reason = (data.get("promptFeedback") or {}).get("blockReason", "no answer")
        raise GeminiError(f"Gemini returned no answer ({reason})")
    text = "".join(p.get("text", "") for p in candidates[0].get("content", {}).get("parts", []))
    if candidates[0].get("finishReason") == "MAX_TOKENS":
        # Never use a half-written email or profile
        raise GeminiError("Gemini's answer was cut off before it finished")
    if not text.strip():
        raise GeminiError(f"Gemini returned an empty answer ({candidates[0].get('finishReason', '')})")
    return text


def schema_for(model_cls) -> dict:
    """Gemini responseSchema for a flat Pydantic model of str / list[str] fields."""
    props = {}
    for name, field in model_cls.model_fields.items():
        is_list = getattr(field.annotation, "__origin__", None) is list
        props[name] = {"type": "ARRAY", "items": {"type": "STRING"}} if is_list else {"type": "STRING"}
    return {"type": "OBJECT", "properties": props, "required": list(props), "propertyOrdering": list(props)}


def parse_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    return json.loads(text)
