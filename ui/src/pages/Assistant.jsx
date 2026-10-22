import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { CompanyAvatar, Icon } from "../components.jsx";
import Markdown from "../Markdown.jsx";
import VoiceInterview from "./VoiceInterview.jsx";

const MAX_KEPT = 40;

function threadKey(mode, jobId) {
  return `assistant.${mode}.${jobId || "general"}`;
}
function loadThread(key) {
  try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; }
}
function saveThread(key, messages) {
  try { localStorage.setItem(key, JSON.stringify(messages.slice(-MAX_KEPT))); } catch { /* not saved */ }
}

function suggestions(job, mode) {
  if (mode === "mock") {
    return ["Start the mock interview", "Ask me system design questions", "Ask me behavioural (HR) questions", "Ask me Node.js deep-dive questions"];
  }
  if (job) {
    const c = job.Company || "this company";
    return [
      "Summarise this job: what do they really want?",
      "Who posted this job and how can I contact them?",
      `Tell me about ${c}: product, size, tech stack, culture`,
      `What is ${c}'s interview process and rounds?`,
      "What questions are asked in this interview? Give me answers too",
      "How well do I fit? What gaps should I prepare for?",
      "Write my 'Tell me about yourself' for this job",
      "What salary should I ask for this role?",
    ];
  }
  return [
    "Which of my saved jobs should I apply to first?",
    "Common Node.js backend interview questions with answers",
    "How do I explain my projects in an interview?",
    "Help me negotiate a better salary",
    "How to answer 'why are you leaving your current job?'",
  ];
}

export default function Assistant({ jobs, notify, initialJobId }) {
  const [jobId, setJobId] = useState(initialJobId || "");
  const [mode, setMode] = useState("chat");
  const key = threadKey(mode, jobId);
  const [messages, setMessages] = useState(() => loadThread(key));
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const endRef = useRef();
  const inputRef = useRef();

  useEffect(() => { if (initialJobId) setJobId(initialJobId); }, [initialJobId]);
  useEffect(() => { setMessages(loadThread(key)); }, [key]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, thinking]);

  const job = useMemo(() => jobs.find((j) => String(j.id) === String(jobId)), [jobs, jobId]);
  const jobOptions = useMemo(() => [...jobs].filter((j) => j.Status !== "Skipped").sort((a, b) => b.id - a.id), [jobs]);

  const [failed, setFailed] = useState(false);

  async function send(text, retry = false) {
    const content = (text ?? input).trim();
    if ((!content && !retry) || thinking) return;
    setFailed(false);
    const next = retry ? messages : [...messages, { role: "user", content }];
    setMessages(next);
    saveThread(key, next);
    setInput("");
    setThinking(true);
    try {
      const res = await api.assistant(next.map(({ role, content: c }) => ({ role, content: c })), jobId ? Number(jobId) : null, mode);
      const done = [...next, { role: "assistant", content: res.reply, sources: res.sources }];
      setMessages(done);
      saveThread(key, done);
    } catch (e) {
      notify(e.message, "error");
      setMessages(next);
      setFailed(true);
    } finally {
      setThinking(false);
      inputRef.current?.focus();
    }
  }

  function newChat() {
    setMessages([]);
    saveThread(key, []);
  }

  return (
    <div className="page assistant">
      <section className="card assist-card">
        <header className="assist-head">
          <div className="assist-context">
            {job ? <CompanyAvatar name={job.Company} size={36} /> : <span className="assist-logo"><Icon name="sparkle" size={18} /></span>}
            <select value={jobId} onChange={(e) => setJobId(e.target.value)} aria-label="Talk about">
              <option value="">General career help</option>
              {jobOptions.map((j) => <option key={j.id} value={j.id}>{j.Role} · {j.Company}</option>)}
            </select>
          </div>
          <div className="seg-control">
            <button className={mode === "chat" ? "active" : ""} onClick={() => setMode("chat")}>Ask &amp; research</button>
            <button className={mode === "mock" ? "active" : ""} onClick={() => setMode("mock")}>Mock interview</button>
            <button className={mode === "voice" ? "active" : ""} onClick={() => setMode("voice")}>🎙 Voice interview</button>
          </div>
          {mode !== "voice" && <button className="btn btn-sm btn-ghost" onClick={newChat} disabled={!messages.length}>New chat</button>}
        </header>

        {mode === "voice" ? (
          <div className="assist-body"><VoiceInterview job={job} jobId={jobId} notify={notify} /></div>
        ) : (
          <>
        <div className="assist-body">
          {messages.length === 0 ? (
            <div className="assist-empty">
              <span className="assist-logo big"><Icon name="sparkle" size={26} /></span>
              <h2>{mode === "mock" ? "Practise your interview" : job ? `Ask anything about ${job.Role} at ${job.Company}` : "Your AI career assistant"}</h2>
              <p className="muted">
                {mode === "mock"
                  ? "I'll interview you one question at a time for this role, score each answer and show a stronger one."
                  : "I know your resume and this job. I can research the company, who posted it, published contact emails, the interview process and real questions."}
              </p>
              <div className="suggestions">
                {suggestions(job, mode).map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}
              </div>
            </div>
          ) : (
            <div className="messages">
              {messages.map((m, i) => (
                <div key={i} className={`msg msg-${m.role}`}>
                  {m.role === "assistant" && <span className="msg-avatar"><Icon name="sparkle" size={15} /></span>}
                  <div className="msg-bubble">
                    {m.role === "assistant" ? <Markdown text={m.content} /> : <p>{m.content}</p>}
                    {m.sources?.length > 0 && (
                      <div className="msg-sources">
                        <span>Sources</span>
                        {m.sources.map((s) => (
                          <a key={s.url} href={s.url} target="_blank" rel="noreferrer" title={s.url}>{(s.title || s.url).slice(0, 50)}</a>
                        ))}
                      </div>
                    )}
                    {m.role === "assistant" && (
                      <button className="copy-reply" onClick={() => navigator.clipboard.writeText(m.content).then(() => notify("Copied"))}>Copy</button>
                    )}
                  </div>
                </div>
              ))}
              {thinking && (
                <div className="msg msg-assistant">
                  <span className="msg-avatar"><Icon name="sparkle" size={15} /></span>
                  <div className="msg-bubble typing">
                    <span className="dots"><i /><i /><i /></span> {mode === "mock" ? "Thinking…" : "Researching…"}
                  </div>
                </div>
              )}
              {failed && !thinking && (
                <div className="msg msg-assistant">
                  <span className="msg-avatar"><Icon name="alert" size={15} /></span>
                  <div className="msg-bubble retry-bubble">
                    That reply didn't come through.
                    <button className="btn btn-sm" onClick={() => send("", true)}>Retry</button>
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>
          )}
        </div>

        <footer className="assist-input">
          <textarea ref={inputRef} rows={1} value={input} placeholder={mode === "mock" ? "Type your answer…" : "Ask about the job, company, contacts, interview…"}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <button className="btn btn-primary send-btn" onClick={() => send()} disabled={!input.trim() || thinking} aria-label="Send">
            <Icon name="send" size={16} />
          </button>
        </footer>
        <p className="assist-note muted small">Contact details are shown only when published on a cited page. Answers can be wrong: check important facts.</p>
          </>
        )}
      </section>
    </div>
  );
}
