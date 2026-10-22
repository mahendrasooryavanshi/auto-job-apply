import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { Icon, Toggle } from "../components.jsx";
import { streamSpeak, unlockAudio } from "../voicePlayer.js";
import { BROWSER_VOICE, Recognition, loadPref, pickVoice, savePref } from "./VoiceInterview.jsx";

// Talk to the app: look things up and ask it to do work. Anything that changes data or sends email comes back as a
// pending action that only runs after you say "yes" (or click Confirm).
const KEY = "assistant.agent";
const SILENCE_MS = 1200;
// Spoken replies and what the mic listens for. Chrome's Hindi recognition also catches English words in between,
// so Hinglish speech is heard best with hi-IN; replies are written in Roman letters.
const LANGUAGES = {
  en: { label: "English", listen: "en-IN" },
  hinglish: { label: "Hinglish", listen: "hi-IN" },
  hi: { label: "हिन्दी", listen: "hi-IN" },
};
// Word boundaries that also work for Devanagari (\b only knows Latin letters)
const word = (list) => new RegExp(`(^|[\\s,.!?।])(${list})(?=$|[\\s,.!?।])`, "i");
const YES = word("yes|yeah|yep|yup|confirm|confirmed|go ahead|do it|ok|okay|sure|send it|proceed|please do|haan|haa|han|ha|ji|ji haan|"
  + "theek hai|thik hai|kar do|kardo|bhej do|bhejdo|chalo|bilkul|हाँ|हां|हा|जी|जी हाँ|ठीक है|ठीक|कर दो|करो|भेज दो|भेजो|चलो|बिल्कुल|ओके|यस|कन्फर्म");
const NO = word("no|nope|cancel|stop|don'?t|do not|wait|hold on|never ?mind|but|nahi|nahin|na|mat|ruko|rehne do|lekin|par|"
  + "नहीं|नही|ना|मत|रुको|रहने दो|कैंसल|लेकिन|पर|मगर");
const EXAMPLES = {
  en: ["Which new jobs match me best today?", "Tell me about Blue Yonder: what do they do and how big are they?",
    "How many emails are ready to send?", "Open the Node.js job at Blue Yonder", "Mark the Blue Yonder job as applied",
    "Send the approved emails now"],
  hinglish: ["Aaj meri best matching jobs kaunsi hain?", "Blue Yonder company ke baare mein batao",
    "Kitne emails bhejne ke liye ready hain?", "Blue Yonder wali Node.js job kholo", "Blue Yonder wali job ko applied mark kar do",
    "Approved emails abhi bhej do"],
  hi: ["आज मेरे लिए सबसे अच्छी jobs कौन सी हैं?", "Blue Yonder कंपनी के बारे में बताओ", "कितने emails भेजने के लिए तैयार हैं?",
    "Blue Yonder वाली job खोलो", "Approved emails अभी भेज दो"],
};
const TEXT = {
  en: { ask: "Press the mic and tell me what you need.", waiting: "Waiting for your OK. Say “yes” or “no”, or use the buttons.",
    listenYes: "Listening… say “yes” to go ahead or “no” to cancel", confirm: "Please confirm", yes: "Yes, go ahead", no: "Cancel" },
  hinglish: { ask: "Mic dabaiye aur boliye kya karna hai.", waiting: "Aapki permission chahiye. “Haan” ya “na” boliye, ya button dabaiye.",
    listenYes: "Sun raha hoon… “haan” bolo to kar dunga, “na” bolo to cancel", confirm: "Confirm kijiye", yes: "Haan, kar do", no: "Cancel" },
  hi: { ask: "माइक दबाइए और बोलिए क्या करना है।", waiting: "आपकी अनुमति चाहिए। “हाँ” या “ना” बोलिए, या बटन दबाइए।",
    listenYes: "सुन रहा हूँ… “हाँ” बोलें तो कर दूँगा, “ना” बोलें तो cancel", confirm: "पुष्टि कीजिए", yes: "हाँ, कर दो", no: "Cancel" },
};

const clean = (t) => String(t || "").replace(/[*#>`_|]/g, "").replace(/\s+/g, " ").trim();
const isShort = (t) => t.split(/\s+/).length <= 6;
const hasDevanagari = (t) => /[\u0900-\u097F]/.test(t);

function hindiVoice() {
  const voices = window.speechSynthesis?.getVoices() || [];
  return voices.find((v) => v.lang === "hi-IN" && /google/i.test(v.name)) || voices.find((v) => v.lang === "hi-IN");
}

function loadThread() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}
function saveThread(m) {
  try { localStorage.setItem(KEY, JSON.stringify(m.slice(-40))); } catch { /* not saved */ }
}

export default function VoiceAgent({ jobId, notify, onOpenJob, onChanged }) {
  const [messages, setMessages] = useState(loadThread);
  const [phase, setPhase] = useState("idle");          // idle | listening | thinking | preparing | speaking
  const [heard, setHeard] = useState("");
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(null);       // {id, summary, details} waiting for your yes/no
  const [handsFree, setHandsFreeState] = useState(() => loadPref("agentHandsFree", true));
  const [voices, setVoices] = useState({});
  const [voiceName, setVoiceNameState] = useState(() => loadPref("name", "Sulafat"));
  const [muted, setMuted] = useState(false);
  const [lang, setLangState] = useState(() => loadPref("agentLanguage", "hinglish"));
  const setLang = (v) => { setLangState(v); savePref("agentLanguage", v); };
  const t = TEXT[lang] || TEXT.en;
  const recRef = useRef(null);
  const listeningRef = useRef(false);
  const silenceRef = useRef(null);
  const heardRef = useRef("");
  const audioRef = useRef(null);
  const messagesRef = useRef(messages);
  const pendingRef = useRef(pending);
  messagesRef.current = messages;
  pendingRef.current = pending;
  const setHandsFree = (v) => { setHandsFreeState(v); savePref("agentHandsFree", v); };
  const setVoiceName = (v) => { setVoiceNameState(v); savePref("name", v); };

  useEffect(() => {
    api.voices().then((d) => setVoices(d.voices)).catch(() => {});
    return () => stopAll();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function stopAll() {
    stopListening();
    window.speechSynthesis?.cancel();
    audioRef.current?.pause();
  }

  const browserSpeak = (text, then) => {
    const synth = window.speechSynthesis;
    if (!synth) { then(); return; }
    synth.cancel();
    let finished = false;
    const finish = () => { if (!finished) { finished = true; clearTimeout(fallback); then(); } };
    const fallback = setTimeout(finish, 2500 + text.split(/\s+/).length * 450);
    const chunks = text.match(/[^.!?]+[.!?]*\s*/g) || [text];
    const voice = (hasDevanagari(text) && hindiVoice()) || pickVoice();
    chunks.forEach((chunk, i) => {
      const u = new SpeechSynthesisUtterance(chunk.trim());
      if (voice) u.voice = voice;
      u.lang = voice?.lang || "en-IN";
      if (i === chunks.length - 1) { u.onend = finish; u.onerror = finish; }
      synth.speak(u);
    });
    setPhase("speaking");
  };

  // Speak a reply, then (hands-free) listen for the next command
  const say = useCallback(async (text) => {
    const after = () => (handsFree && Recognition ? startListening() : setPhase("idle"));
    const spoken = clean(text);
    if (muted || !spoken) { after(); return; }
    if (voiceName !== BROWSER_VOICE) {
      try {
        setPhase("preparing");
        audioRef.current?.pause();
        const playing = await streamSpeak(spoken, { voice: voiceName, indianAccent: true, persona: "assistant" });
        audioRef.current = playing;
        setPhase("speaking");
        playing.done.then((stopped) => { if (!stopped) after(); });
        return;
      } catch { /* fall back to the browser voice */ }
    }
    browserSpeak(spoken, after);
  }, [muted, voiceName, handsFree]); // eslint-disable-line react-hooks/exhaustive-deps

  function startListening() {
    if (!Recognition) { notify("Voice commands need Google Chrome. You can type below.", "error"); setPhase("idle"); return; }
    window.speechSynthesis?.cancel();
    audioRef.current?.pause();
    heardRef.current = "";
    setHeard("");
    listeningRef.current = true;
    setPhase("listening");
    const rec = new Recognition();
    rec.lang = (LANGUAGES[lang] || LANGUAGES.en).listen;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) heardRef.current = `${heardRef.current} ${r[0].transcript}`.trim();
        else live += r[0].transcript;
      }
      setHeard(`${heardRef.current} ${live}`.trim());
      clearTimeout(silenceRef.current);
      silenceRef.current = setTimeout(() => {
        const text = `${heardRef.current} ${live}`.trim();
        if (text) { stopListening(); handle(text); }
      }, SILENCE_MS);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        listeningRef.current = false;
        setPhase("idle");
        notify("Microphone blocked. Click the 🔒 icon in the address bar and allow the microphone.", "error");
      }
    };
    rec.onend = () => { if (listeningRef.current) { try { rec.start(); } catch { /* restarting */ } } };
    recRef.current = rec;
    try { rec.start(); } catch { /* already started */ }
  }

  function stopListening() {
    listeningRef.current = false;
    clearTimeout(silenceRef.current);
    try { recRef.current?.stop(); } catch { /* already stopped */ }
  }

  function append(...msgs) {
    const next = [...messagesRef.current, ...msgs];
    messagesRef.current = next;
    setMessages(next);
    saveThread(next);
    return next;
  }

  // Run or drop the action you were asked about. Nothing changes until this is called with approve=true.
  async function decide(approve, saidText) {
    const action = pendingRef.current;
    if (!action) return;
    setPending(null);
    if (saidText) append({ role: "user", content: saidText });
    setPhase("thinking");
    try {
      const res = await api.confirmAction(action.id, approve, lang);
      append({ role: "assistant", content: res.message, kind: res.done ? "done" : "cancelled" });
      if (res.done) onChanged?.();
      say(res.message);
    } catch (e) {
      append({ role: "assistant", content: `That didn't work: ${e.message}`, kind: "error" });
      say(`That didn't work. ${e.message}`);
    }
  }

  async function handle(text) {
    setHeard("");
    const said = text.trim();
    if (!said) { setPhase("idle"); return; }
    if (pendingRef.current) {
      // "no" (or "but…") anywhere in a short reply cancels; only a clear, short "yes" runs the action
      if (isShort(said) && NO.test(said)) { decide(false, said); return; }
      if (isShort(said) && YES.test(said)) { decide(true, said); return; }
      // Anything else is a new request: the old one is dropped, never run
      api.confirmAction(pendingRef.current.id, false).catch(() => {});
      setPending(null);
    }
    const next = append({ role: "user", content: said });
    setPhase("thinking");
    try {
      const res = await api.assistant(next.map(({ role, content }) => ({ role, content })), jobId ? Number(jobId) : null, "agent", lang);
      (res.ui || []).forEach((u) => { if (u.open_job) onOpenJob?.(u.open_job); });
      append({ role: "assistant", content: res.reply, sources: res.sources, action: res.pending_action || null });
      if (res.pending_action) setPending(res.pending_action);
      say(res.reply);
    } catch (e) {
      notify(e.message, "error");
      setPhase("idle");
    }
  }

  function clear() {
    stopAll();
    if (pending) api.confirmAction(pending.id, false).catch(() => {});
    setPending(null);
    setMessages([]);
    messagesRef.current = [];
    saveThread([]);
    setPhase("idle");
  }

  const status = {
    idle: pending ? t.waiting : t.ask,
    listening: pending ? t.listenYes : "Listening…",
    thinking: "Working on it…",
    preparing: "About to speak…",
    speaking: "Speaking…",
  }[phase];

  return (
    <div className="agent">
      <div className="voice-top">
        <span className="voice-chip">🗣 Voice assistant</span>
        <span className="voice-spacer" />
        <select className="voice-mini" value={lang} onChange={(e) => { stopListening(); setPhase("idle"); setLang(e.target.value); }} aria-label="Language">
          {Object.entries(LANGUAGES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <Toggle label="Hands-free (keep listening)" checked={handsFree} onChange={setHandsFree} />
        <select className="voice-mini" value={voiceName} onChange={(e) => setVoiceName(e.target.value)} aria-label="Assistant voice">
          {Object.keys(voices).map((name) => <option key={name} value={name}>{name}</option>)}
          <option value={BROWSER_VOICE}>Browser</option>
        </select>
        <button className="btn btn-sm" onClick={() => { setMuted(!muted); window.speechSynthesis?.cancel(); audioRef.current?.pause(); }}>{muted ? "🔇 Unmute" : "🔊 Mute"}</button>
        <button className="btn btn-sm btn-ghost" onClick={clear} disabled={!messages.length}>Clear</button>
      </div>

      <div className="agent-stage">
        <button className={`voice-orb ${phase}`} aria-label={phase === "listening" ? "Stop listening" : "Start listening"}
          disabled={phase === "thinking"}
          onClick={() => { unlockAudio(); if (phase === "listening") { stopListening(); setPhase("idle"); } else startListening(); }}>
          <Icon name={phase === "listening" ? "mic" : phase === "thinking" ? "sparkle" : "mic"} size={34} />
        </button>
        <p className="voice-status">{status}</p>
        {heard && <p className="agent-heard">“{heard}”</p>}
      </div>

      {pending && (
        <div className="agent-confirm" role="alertdialog" aria-label="Confirm action">
          <div className="agent-confirm-head"><Icon name="alert" size={16} /> {t.confirm}</div>
          <p className="agent-confirm-what">{pending.summary}</p>
          {pending.details?.length > 0 && <ul>{pending.details.map((d) => <li key={d}>{d.replace(/^•\s*/, "")}</li>)}</ul>}
          <div className="agent-confirm-actions">
            <button className="btn btn-primary" disabled={phase === "thinking"} onClick={() => { unlockAudio(); stopListening(); decide(true); }}>{t.yes}</button>
            <button className="btn" disabled={phase === "thinking"} onClick={() => { unlockAudio(); stopListening(); decide(false); }}>{t.no}</button>
          </div>
        </div>
      )}

      {messages.length === 0 ? (
        <div className="agent-examples">
          <span className="mini-label">Try saying</span>
          {(EXAMPLES[lang] || EXAMPLES.en).map((e) => <button key={e} onClick={() => { unlockAudio(); handle(e); }}>“{e}”</button>)}
          <p className="muted small">I look things up straight away. Anything that changes your data or sends an email is shown here first and only happens after you say “yes”.</p>
        </div>
      ) : (
        <div className="agent-log">
          {messages.slice().reverse().map((m, i) => (
            <p key={messages.length - i} className={`agent-line ${m.role} ${m.kind || ""}`}>
              <strong>{m.role === "user" ? "You" : "Assistant"}</strong> {clean(m.content)}
              {m.sources?.length > 0 && (
                <span className="agent-sources">
                  {m.sources.slice(0, 3).map((s) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer">{(s.title || s.url).slice(0, 40)}</a>)}
                </span>
              )}
            </p>
          ))}
        </div>
      )}

      <form className="agent-type" onSubmit={(e) => { e.preventDefault(); unlockAudio(); const t = typed; setTyped(""); stopListening(); handle(t); }}>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Or type a command…" disabled={phase === "thinking"} />
        <button className="btn btn-primary" disabled={!typed.trim() || phase === "thinking"} aria-label="Send"><Icon name="send" size={15} /></button>
      </form>
    </div>
  );
}
