"""Natural interviewer voice: Gemini's neural text-to-speech, returned as WAV for the browser to play.

Each TTS model has its own free daily quota, so models are tried in turn; generated audio is cached on disk
(the same line, e.g. "Repeat question", never costs a second request).
"""
import base64
import hashlib
import io
import json
import logging
import re
import time
import wave
from typing import Iterator

import requests

from .config import ROOT

log = logging.getLogger(__name__)

CACHE_DIR = ROOT / "data" / "tts_cache"
MODELS = ("gemini-3.1-flash-tts-preview", "gemini-3.8-flash-tts", "gemini-2.5-flash-preview-tts")
STREAM_API = "https://generativelanguage.googleapis.com/v1beta/models/{}:streamGenerateContent?alt=sse"

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


STYLES = {
    "interviewer": "Speak as a warm, professional job interviewer having a real conversation: natural pace, friendly",
    "assistant": "Speak as a friendly, helpful personal assistant: natural, quick pace, conversational",
}
COOLDOWN = 15 * 60       # skip a model this long after it reports its free quota used up
_cooling: dict[str, float] = {}


def _style(persona: str, indian_accent: bool, text: str) -> str:
    if re.search(r"[\u0900-\u097F]", text):
        accent = "in natural spoken Hindi, pronouncing English words the way Indians do"
    elif indian_accent:
        accent = "with a neutral Indian English accent; if the text is Hinglish, pronounce the Hindi words like a native speaker"
    else:
        accent = "with a neutral accent"
    return f"{STYLES.get(persona, STYLES['interviewer'])}, {accent}. Say exactly:"


def _cache_path(voice: str, style: str, text: str):
    return CACHE_DIR / (hashlib.sha256(f"{voice}|{style}|{text}".encode()).hexdigest()[:32] + ".wav")


def stream(key: str, text: str, voice: str = "Sulafat", indian_accent: bool = True,
           persona: str = "interviewer") -> tuple[int, Iterator[bytes]]:
    """(sample rate, 16-bit mono PCM chunks). Audio starts arriving within about a second and a half instead of
    waiting for the whole clip; the finished clip is cached. Raises VoiceError before any audio if none is available."""
    text = re.sub(r"\s+", " ", text).strip()[:1500]
    if not text:
        raise VoiceError("Nothing to say")
    voice = voice if voice in VOICES else "Sulafat"
    style = _style(persona, indian_accent, text)
    cache = _cache_path(voice, style, text)
    if cache.exists():
        with wave.open(str(cache)) as w:
            return w.getframerate(), iter([w.readframes(w.getnframes())])
    body = {"contents": [{"parts": [{"text": f"{style}\n{text}"}]}],
            "generationConfig": {"responseModalities": ["AUDIO"],
                                 "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}}}}
    last = ""
    for model in MODELS:   # separate free quota per model: move on when one is used up or unavailable
        if _cooling.get(model, 0) > time.time():
            continue
        resp = requests.post(STREAM_API.format(model), headers={"x-goog-api-key": key}, json=body, timeout=60, stream=True)
        if resp.status_code in (404, 429, 500, 503):
            if resp.status_code == 429:
                _cooling[model] = time.time() + COOLDOWN
            last = f"{model}: {resp.status_code}"
            resp.close()
            continue
        if resp.status_code in (400, 401, 403) and "API key" in resp.text:
            raise VoiceError("Gemini rejected the API key")
        resp.raise_for_status()
        chunks = _audio_chunks(resp)
        first = next(chunks, None)
        if not first:
            last = f"{model}: no audio"
            continue
        return first[0], _cached(first[1], chunks, cache, first[0])
    log.info("Natural voice unavailable (%s)", last)
    raise VoiceError("The natural voice's free limit is used up for now")


def _audio_chunks(resp) -> Iterator[tuple[int, bytes]]:
    for line in resp.iter_lines():
        if not line.startswith(b"data:"):
            continue
        try:
            part = json.loads(line[5:])["candidates"][0]["content"]["parts"][0]["inlineData"]
        except (KeyError, IndexError, ValueError):
            continue
        rate = int((re.search(r"rate=(\d+)", part.get("mimeType", "")) or [0, 24000])[1])
        yield rate, base64.b64decode(part["data"])


def _cached(first: bytes, rest: Iterator[tuple[int, bytes]], cache, rate: int) -> Iterator[bytes]:
    pcm = [first]
    yield first
    for _, chunk in rest:
        pcm.append(chunk)
        yield chunk
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache.write_bytes(_wav(b"".join(pcm), rate))


def speak(key: str, text: str, voice: str = "Sulafat", indian_accent: bool = True, persona: str = "interviewer") -> bytes:
    """The whole clip as WAV."""
    rate, chunks = stream(key, text, voice, indian_accent, persona)
    return _wav(b"".join(chunks), rate)
