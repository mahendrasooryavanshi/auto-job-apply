"""Natural interviewer voice: Gemini's neural text-to-speech, returned as WAV for the browser to play.

Each TTS model has its own free daily quota, so models are tried in turn; generated audio is cached on disk
(the same line, e.g. "Repeat question", never costs a second request).
"""
import base64
import hashlib
import io
import logging
import re
import wave

import requests

from .config import ROOT

log = logging.getLogger(__name__)

CACHE_DIR = ROOT / "data" / "tts_cache"
MODELS = ("gemini-3.1-flash-tts-preview", "gemini-3.8-flash-tts", "gemini-2.5-flash-preview-tts")
API = "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent"

# Gemini prebuilt voices that suit an interviewer, with a plain description for the picker
VOICES = {
    "Sulafat": "Warm · female",
    "Kore": "Firm, professional · female",
    "Aoede": "Friendly, relaxed · female",
    "Charon": "Calm, informative · male",
    "Orus": "Confident · male",
    "Achird": "Friendly · male",
}


class VoiceError(RuntimeError):
    pass


def _wav(pcm: bytes, rate: int) -> bytes:
    out = io.BytesIO()
    with wave.open(out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)   # 16-bit samples (Gemini returns linear PCM, L16)
        w.setframerate(rate)
        w.writeframes(pcm)
    return out.getvalue()


def speak(key: str, text: str, voice: str = "Sulafat", indian_accent: bool = True) -> bytes:
    text = re.sub(r"\s+", " ", text).strip()[:1500]
    if not text:
        raise VoiceError("Nothing to say")
    voice = voice if voice in VOICES else "Sulafat"
    style = ("Speak as a warm, professional job interviewer having a real conversation: natural pace, friendly, "
             + ("with a neutral Indian English accent" if indian_accent else "with a neutral accent") + ". Say exactly:")
    cache = CACHE_DIR / (hashlib.sha256(f"{voice}|{indian_accent}|{text}".encode()).hexdigest()[:32] + ".wav")
    if cache.exists():
        return cache.read_bytes()
    body = {"contents": [{"parts": [{"text": f"{style}\n{text}"}]}],
            "generationConfig": {"responseModalities": ["AUDIO"],
                                 "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}}}}
    last = ""
    for model in MODELS:   # separate free quota per model: move on when one is used up or unavailable
        resp = requests.post(API.format(model), headers={"x-goog-api-key": key}, json=body, timeout=120)
        if resp.status_code in (404, 429, 500, 503):
            last = f"{model}: {resp.status_code}"
            continue
        if resp.status_code in (400, 401, 403) and "API key" in resp.text:
            raise VoiceError("Gemini rejected the API key")
        resp.raise_for_status()
        try:
            part = resp.json()["candidates"][0]["content"]["parts"][0]["inlineData"]
        except (KeyError, IndexError, ValueError):
            last = f"{model}: no audio"
            continue
        rate = int((re.search(r"rate=(\d+)", part.get("mimeType", "")) or [0, 24000])[1])
        audio = _wav(base64.b64decode(part["data"]), rate)
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cache.write_bytes(audio)
        return audio
    log.info("Natural voice unavailable (%s)", last)
    raise VoiceError("The natural voice's free limit is used up for now")
