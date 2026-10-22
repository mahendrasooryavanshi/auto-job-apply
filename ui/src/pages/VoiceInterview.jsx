import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { Icon, Toggle } from "../components.jsx";
import Markdown from "../Markdown.jsx";

// Voice runs entirely in the browser: Chrome's speech recognition (your answers) and speech synthesis (the interviewer).
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const SILENCE_MS = 3500;   // pause this long after speaking and the answer is sent (when auto-send is on)
const MODEL_RE = /\n?\s*\**\s*model answer\s*:?\s*\**\s*:?/i;

const spokenPart = (t) => {
  const i = t.search(MODEL_RE);
  return (i >= 0 ? t.slice(0, i) : t).replace(/[*#>`_|]/g, "").replace(/\s+/g, " ").trim();
};
const modelPart = (t) => {
  const i = t.search(MODEL_RE);
  return i >= 0 ? t.slice(i).replace(MODEL_RE, "").trim() : "";
};

function pickVoice() {
  const voices = window.speechSynthesis?.getVoices() || [];
  return voices.find((v) => v.lang === "en-IN" && /google/i.test(v.name))
    || voices.find((v) => v.lang === "en-IN")
    || voices.find((v) => /google uk english female|google us english/i.test(v.name))
    || voices.find((v) => v.lang?.startsWith("en"));
}

const BROWSER_VOICE = "browser";
const PREVIEW = "Hi, I'll be your interviewer today. Let's start with a quick introduction about yourself.";

function loadPref(name, fallback) {
  try { return JSON.parse(localStorage.getItem(`voice.${name}`)) ?? fallback; } catch { return fallback; }
}
function savePref(name, value) {
  try { localStorage.setItem(`voice.${name}`, JSON.stringify(value)); } catch { /* not saved */ }
}

function VoicePicker({ voices, voiceName, setVoiceName, accent, setAccent, onPreview, previewing }) {
  return (
    <div className="voice-picker">
      <label>
        <span className="mini-label">Interviewer voice</span>
        <select value={voiceName} onChange={(e) => setVoiceName(e.target.value)}>
          {Object.entries(voices).map(([name, desc]) => <option key={name} value={name}>{name}: {desc} (natural)</option>)}
          <option value={BROWSER_VOICE}>Browser voice (unlimited, robotic)</option>
        </select>
      </label>
      {voiceName !== BROWSER_VOICE && <Toggle label="Indian accent" checked={accent} onChange={setAccent} />}
      <button className="btn btn-sm" onClick={onPreview} disabled={previewing}>{previewing ? "…" : "▶ Preview"}</button>
    </div>
  );
}

function loadThread(key) {
  try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; }
}
function saveThread(key, m) {
  try { localStorage.setItem(key, JSON.stringify(m.slice(-60))); } catch { /* not saved */ }
}

export default function VoiceInterview({ job, jobId, notify }) {
  const key = `assistant.voice.${jobId || "general"}`;
  const [messages, setMessages] = useState(() => loadThread(key));
  const [phase, setPhase] = useState("idle");          // idle | speaking | listening | thinking
  const [finalText, setFinalText] = useState("");
  const [interim, setInterim] = useState("");
  const [muted, setMuted] = useState(false);
  const [autoSend, setAutoSend] = useState(true);
  const [seconds, setSeconds] = useState(0);
  const [showTranscript, setShowTranscript] = useState(false);
  const [voices, setVoices] = useState({});
  const [voiceName, setVoiceNameState] = useState(() => loadPref("name", "Sulafat"));
  const [accent, setAccentState] = useState(() => loadPref("indianAccent", true));
  const [previewing, setPreviewing] = useState(false);
  const audioRef = useRef(null);
  const setVoiceName = (v) => { setVoiceNameState(v); savePref("name", v); };
  const setAccent = (v) => { setAccentState(v); savePref("indianAccent", v); };
  const recRef = useRef(null);
  const listeningRef = useRef(false);
  const silenceRef = useRef(null);
  const answerRef = useRef("");
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => { setMessages(loadThread(key)); stopAll(); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    window.speechSynthesis?.getVoices();
    api.voices().then((d) => setVoices(d.voices)).catch(() => {});
  }, []);
  useEffect(() => () => stopAll(), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {   // answer timer, like a real interview clock
    if (phase !== "listening") return undefined;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const questionNo = messages.filter((m) => m.role === "assistant").length;

  function stopAll() {
    listeningRef.current = false;
    clearTimeout(silenceRef.current);
    try { recRef.current?.stop(); } catch { /* already stopped */ }
    window.speechSynthesis?.cancel();
    audioRef.current?.pause();
  }

  const browserSpeak = useCallback((text, then) => {
    const synth = window.speechSynthesis;
    if (!synth || muted || !text) { then?.(); return; }
    synth.cancel();
    // Chrome stops long utterances after ~15 s, so speak sentence by sentence
    const chunks = text.match(/[^.!?]+[.!?]*\s*/g) || [text];
    const voice = pickVoice();
    setPhase("speaking");
    // Some systems never report the end of speech: move on anyway after the time the text should take
    let finished = false;
    const finish = () => { if (!finished) { finished = true; clearTimeout(fallback); then?.(); } };
    const fallback = setTimeout(finish, 2500 + text.split(/\s+/).length * 450);
    chunks.forEach((chunk, i) => {
      const u = new SpeechSynthesisUtterance(chunk.trim());
      if (voice) u.voice = voice;
      u.lang = voice?.lang || "en-IN";
      u.rate = 1.0;
      if (i === chunks.length - 1) { u.onend = finish; u.onerror = finish; }
      synth.speak(u);
    });
  }, [muted]);

  const speak = useCallback(async (text, then) => {
    if (muted || !text) { then?.(); return; }
    if (voiceName !== BROWSER_VOICE) {
      try {
        setPhase("preparing");
        const blob = await api.speak(text, voiceName, accent);
        audioRef.current?.pause();
        const audio = new Audio(URL.createObjectURL(blob));
        audioRef.current = audio;
        let finished = false;
        const finish = () => { if (!finished) { finished = true; URL.revokeObjectURL(audio.src); then?.(); } };
        audio.onended = finish;
        audio.onerror = finish;
        setPhase("speaking");
        await audio.play();
        return;
      } catch (e) {
        notify(`${e.message}. Using the browser voice for now.`, "error");
      }
    }
    browserSpeak(text, then);
  }, [muted, voiceName, accent, browserSpeak, notify]);

  async function preview() {
    setPreviewing(true);
    await speak(PREVIEW, () => { setPreviewing(false); setPhase("idle"); });
    setPreviewing(false);
  }

  function startListening() {
    if (!Recognition) { setPhase("idle"); return; }
    window.speechSynthesis?.cancel();
    audioRef.current?.pause();
    answerRef.current = "";
    setFinalText(""); setInterim(""); setSeconds(0);
    listeningRef.current = true;
    setPhase("listening");
    const rec = new Recognition();
    rec.lang = "en-IN";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) answerRef.current = `${answerRef.current} ${r[0].transcript}`.trim();
        else live += r[0].transcript;
      }
      setFinalText(answerRef.current);
      setInterim(live);
      clearTimeout(silenceRef.current);
      if (autoSend && answerRef.current) silenceRef.current = setTimeout(() => submit(), SILENCE_MS);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        listeningRef.current = false;
        setPhase("idle");
        notify("Microphone blocked. Click the 🔒 icon in the address bar and allow the microphone.", "error");
      }
    };
    rec.onend = () => {   // Chrome ends recognition on its own after a while: keep listening until the answer is sent
      if (listeningRef.current) { try { rec.start(); } catch { /* restarting */ } }
    };
    recRef.current = rec;
    try { rec.start(); } catch { /* already started */ }
  }

  function stopListening() {
    listeningRef.current = false;
    clearTimeout(silenceRef.current);
    try { recRef.current?.stop(); } catch { /* already stopped */ }
  }

  async function ask(userText) {
    const next = [...messagesRef.current, { role: "user", content: userText }];
    setMessages(next); saveThread(key, next);
    setPhase("thinking");
    try {
      const res = await api.assistant(next.map(({ role, content }) => ({ role, content })), jobId ? Number(jobId) : null, "voice");
      const done = [...next, { role: "assistant", content: res.reply }];
      setMessages(done); saveThread(key, done);
      const ended = /end the interview/i.test(userText);
      speak(spokenPart(res.reply), () => (ended ? setPhase("idle") : startListening()));
    } catch (e) {
      notify(e.message, "error");
      setPhase("idle");
    }
  }

  function submit() {
    const text = (answerRef.current || `${finalText} ${interim}`).trim();
    stopListening();
    if (!text) { setPhase("idle"); return; }
    setInterim("");
    ask(text);
  }

  function start() {
    if (!Recognition) notify("Voice answers need Google Chrome. You can still type your answers below.", "error");
    setMessages([]); saveThread(key, []);
    messagesRef.current = [];
    ask("Start the interview.");
  }

  const statusText = {
    idle: questionNo ? "Paused. Press the mic to answer, or repeat the question." : "Ready when you are.",
    preparing: "Interviewer is about to speak…",
    speaking: "Interviewer is speaking…",
    listening: autoSend ? "Listening… (pause for a few seconds to send)" : "Listening… press Send when you're done",
    thinking: "Interviewer is thinking…",
  }[phase];
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  if (!questionNo && (phase === "idle" || previewing)) {
    return (
      <div className="voice-start">
        <div className="voice-orb idle"><Icon name="mic" size={34} /></div>
        <h2>Voice interview{job ? ` for ${job.Role} at ${job.Company}` : ""}</h2>
        <p className="muted">The interviewer speaks each question; you answer out loud. You'll hear quick feedback and a score after every answer, and see a model answer on screen. About 6 questions, then an overall verdict.</p>
        <ul className="voice-tips">
          <li>Use <strong>Google Chrome</strong> and allow the microphone when asked.</li>
          <li>Wear headphones so the interviewer's voice isn't picked up as your answer.</li>
          <li>Answer like a real interview: structure it (STAR for behavioural questions).</li>
        </ul>
        <VoicePicker voices={voices} voiceName={voiceName} setVoiceName={setVoiceName} accent={accent} setAccent={setAccent}
          onPreview={preview} previewing={previewing} />
        <button className="btn btn-primary voice-go" onClick={start}><Icon name="mic" size={18} /> Start voice interview</button>
        {!Recognition && <p className="muted small">This browser can't listen. Open the dashboard in Google Chrome for voice answers.</p>}
      </div>
    );
  }

  return (
    <div className="voice-room">
      <div className="voice-top">
        <span className="voice-chip">Question {questionNo}</span>
        {phase === "listening" && <span className="voice-chip rec"><span className="rec-dot" /> {mm}:{ss}</span>}
        <span className="voice-spacer" />
        <Toggle label="Auto-send when I pause" checked={autoSend} onChange={setAutoSend} />
        <select className="voice-mini" value={voiceName} onChange={(e) => setVoiceName(e.target.value)} aria-label="Interviewer voice">
          {Object.keys(voices).map((name) => <option key={name} value={name}>{name}</option>)}
          <option value={BROWSER_VOICE}>Browser</option>
        </select>
        <button className="btn btn-sm" onClick={() => { setMuted(!muted); window.speechSynthesis?.cancel(); audioRef.current?.pause(); }}>{muted ? "🔇 Unmute" : "🔊 Mute"}</button>
      </div>

      <div className="voice-stage">
        <div className={`voice-orb ${phase}`}><Icon name={phase === "listening" ? "mic" : "sparkle"} size={34} /></div>
        <p className="voice-status">{statusText}</p>
        {lastAssistant && <p className="voice-question">{spokenPart(lastAssistant.content)}</p>}
      </div>

      <div className="voice-answer">
        <span className="mini-label">Your answer {phase === "listening" && "(live)"}</span>
        <textarea rows={3} value={`${finalText}${interim ? ` ${interim}` : ""}`} placeholder="Speak, or type your answer here…"
          onChange={(e) => { answerRef.current = e.target.value; setFinalText(e.target.value); setInterim(""); }}
          disabled={phase === "thinking" || phase === "speaking"} />
        <div className="voice-controls">
          {phase === "listening"
            ? <button className="btn mic-btn on" onClick={() => { stopListening(); setPhase("idle"); }}><Icon name="mic" size={18} /> Stop mic</button>
            : <button className="btn mic-btn" disabled={phase === "thinking"} onClick={startListening}><Icon name="mic" size={18} /> {phase === "speaking" ? "Interrupt & answer" : "Answer with mic"}</button>}
          <button className="btn btn-primary" disabled={phase === "thinking" || !(finalText || interim).trim()} onClick={submit}><Icon name="send" size={15} /> Send answer</button>
          <button className="btn" disabled={!lastAssistant || phase === "thinking"} onClick={() => speak(spokenPart(lastAssistant.content), () => setPhase("idle"))}>↺ Repeat question</button>
          <button className="btn btn-ghost" disabled={phase === "thinking"} onClick={() => { stopListening(); ask("End the interview and give me my overall feedback."); }}>End interview</button>
        </div>
      </div>

      {lastAssistant && modelPart(lastAssistant.content) && (
        <details className="voice-model" open>
          <summary>Model answer to the previous question</summary>
          <Markdown text={modelPart(lastAssistant.content)} />
        </details>
      )}

      <button className="link-btn" onClick={() => setShowTranscript(!showTranscript)}>{showTranscript ? "Hide" : "Show"} full transcript</button>
      {showTranscript && (
        <div className="voice-transcript">
          {messages.filter((m) => m.content !== "Start the interview.").map((m, i) => (
            <p key={i}><strong>{m.role === "assistant" ? "Interviewer" : "You"}:</strong> {m.role === "assistant" ? spokenPart(m.content) : m.content}</p>
          ))}
        </div>
      )}
    </div>
  );
}
