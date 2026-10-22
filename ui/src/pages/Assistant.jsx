import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { CompanyAvatar, Icon } from "../components.jsx";
import Markdown from "../Markdown.jsx";
import VoiceInterview from "./VoiceInterview.jsx";

const MAX_KEPT = 40;
const MAX_FILES = 5;
const ACCEPT = ".png,.jpg,.jpeg,.webp,.gif,.pdf,.docx,.txt,.md,.csv";
const fileUrl = (id) => `/api/assistant/upload/${id}`;
const isImage = (f) => (f.type || "").startsWith("image/");

function Attachment({ file, onRemove }) {
  return (
    <span className={`attach-chip ${isImage(file) ? "is-image" : ""}`} title={file.name}>
      {isImage(file)
        ? <img src={fileUrl(file.id)} alt={file.name} />
        : <span className="attach-icon"><Icon name="file" size={16} /></span>}
      {!isImage(file) && <span className="attach-name">{file.name}</span>}
      {onRemove
        ? <button onClick={onRemove} aria-label={`Remove ${file.name}`}>×</button>
        : <a href={fileUrl(file.id)} target="_blank" rel="noreferrer" aria-label={`Open ${file.name}`} />}
    </span>
  );
}

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
  const [pending, setPending] = useState([]);       // uploaded files waiting to be sent with the next message
  const [uploading, setUploading] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();

  async function addFiles(fileList) {
    const files = [...fileList].slice(0, MAX_FILES - pending.length);
    if (fileList.length > files.length) notify(`Up to ${MAX_FILES} files per message`, "error");
    for (const file of files) {
      setUploading((n) => n + 1);
      try {
        const meta = await api.uploadAttachment(file);
        setPending((p) => [...p, meta]);
      } catch (e) {
        notify(`${file.name || "File"}: ${e.message}`, "error");
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  function onPaste(e) {
    const images = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
    if (images.length) { e.preventDefault(); addFiles(images); }
  }

  async function send(text, retry = false) {
    const files = retry ? [] : pending;
    const content = (text ?? input).trim() || (files.length ? "Please look at the attached file(s) and tell me what's important for me." : "");
    if ((!content && !retry) || thinking || uploading) return;
    setFailed(false);
    const next = retry ? messages : [...messages, { role: "user", content, files }];
    setPending([]);
    setMessages(next);
    saveThread(key, next);
    setInput("");
    setThinking(true);
    try {
      const res = await api.assistant(next.map(({ role, content: c, files: f }) => ({ role, content: c, attachments: (f || []).map((x) => x.id) })),
        jobId ? Number(jobId) : null, mode);
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
      <section className={`card assist-card ${dragOver ? "drag-over" : ""}`}
        onDragOver={(e) => { if (mode !== "voice" && e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragOver(true); } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); }}
        onDrop={(e) => { if (mode === "voice") return; e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}>
        {dragOver && <div className="drop-hint"><Icon name="upload" size={28} /> Drop images or PDFs to attach</div>}
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
                    {m.files?.length > 0 && <div className="msg-files">{m.files.map((f) => <Attachment key={f.id} file={f} />)}</div>}
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

        {(pending.length > 0 || uploading > 0) && (
          <div className="pending-files">
            {pending.map((f) => <Attachment key={f.id} file={f} onRemove={() => setPending((p) => p.filter((x) => x.id !== f.id))} />)}
            {uploading > 0 && <span className="attach-chip uploading"><span className="spinner" /> Uploading…</span>}
          </div>
        )}
        <footer className="assist-input">
          <input ref={fileRef} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          <button className="btn attach-btn" onClick={() => fileRef.current.click()} disabled={pending.length >= MAX_FILES}
            title="Attach images, screenshots, PDFs or documents" aria-label="Attach files">📎</button>
          <textarea ref={inputRef} rows={1} value={input} onPaste={onPaste}
            placeholder={mode === "mock" ? "Type your answer…" : "Ask anything, or attach a screenshot / PDF (you can paste images too)…"}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <button className="btn btn-primary send-btn" onClick={() => send()} disabled={(!input.trim() && !pending.length) || thinking || uploading > 0} aria-label="Send">
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
