// Plays the natural (Gemini) voice while it is still being generated: the server streams raw 16-bit PCM and each
// piece is scheduled right after the previous one, so speech starts in about a second and a half.
let ctx = null;

// Call from a click/tap first: browsers only allow audio after the user has interacted with the page.
export function unlockAudio() {
  ctx ||= new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

// Returns { pause(), done } once audio is on its way; throws (before any sound) if the natural voice is unavailable.
// `done` resolves when playback finishes (false) or is stopped with pause() (true).
export async function streamSpeak(text, { voice, indianAccent = true, persona = "interviewer" } = {}) {
  const audio = unlockAudio();
  const abort = new AbortController();
  const res = await fetch("/api/assistant/speak-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Job-Agent": "1" },
    body: JSON.stringify({ text, voice, indian_accent: indianAccent, persona }),
    signal: abort.signal,
  });
  if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).detail || "Voice unavailable");
  const rate = Number(res.headers.get("X-Sample-Rate")) || 24000;
  const reader = res.body.getReader();
  const sources = new Set();
  let stopped = false;
  let nextAt = audio.currentTime + 0.08;
  let carry = new Uint8Array(0);   // an odd trailing byte waits for the next piece
  let finish;
  const done = new Promise((resolve) => { finish = resolve; });

  const schedule = (bytes) => {
    const all = new Uint8Array(carry.length + bytes.length);
    all.set(carry); all.set(bytes, carry.length);
    const even = all.length - (all.length % 2);
    carry = all.slice(even);
    if (!even) return;
    const samples = new Int16Array(all.buffer, 0, even / 2);
    const buffer = audio.createBuffer(1, samples.length, rate);
    const out = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) out[i] = samples[i] / 32768;
    const src = audio.createBufferSource();
    src.buffer = buffer;
    src.connect(audio.destination);
    nextAt = Math.max(nextAt, audio.currentTime + 0.03);
    src.start(nextAt);
    nextAt += buffer.duration;
    sources.add(src);
    src.onended = () => sources.delete(src);
  };

  (async () => {
    try {
      for (;;) {
        const { value, done: ended } = await reader.read();
        if (ended || stopped) break;
        schedule(value);
      }
    } catch { /* stopped or connection dropped: play what arrived */ }
    if (stopped) return;
    const left = Math.max(0, nextAt - audio.currentTime);
    setTimeout(() => { if (!stopped) finish(false); }, left * 1000 + 60);
  })();

  return {
    done,
    pause() {
      if (stopped) return;
      stopped = true;
      abort.abort();
      sources.forEach((s) => { try { s.stop(); } catch { /* already ended */ } });
      finish(true);
    },
  };
}
