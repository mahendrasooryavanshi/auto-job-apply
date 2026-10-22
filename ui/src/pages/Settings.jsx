import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { Field, Icon, TagInput, Toggle } from "../components.jsx";

const KEYS = [
  {
    key: "GMAIL_APP_PASSWORD", label: "Gmail App Password",
    hint: "16 letters from Google, not your normal password. Turn on 2-Step Verification first.",
    href: "https://myaccount.google.com/apppasswords", linkText: "Create one",
  },
  {
    key: "GEMINI_API_KEY", label: "Gemini API key (free)",
    hint: "Writes a personal email for each job and powers Profile boost. Google AI Studio has a free tier.",
    href: "https://aistudio.google.com/api-keys", linkText: "Get a key",
  },
  {
    key: "ANTHROPIC_API_KEY", label: "Claude API key (optional, used instead of Gemini if set)",
    hint: "Writes a personal email for each job. Without it a standard template is used.",
    href: "https://console.anthropic.com/settings/keys", linkText: "Get a key",
  },
  {
    key: "SERPER_API_KEY", label: "Serper.dev key (LinkedIn hiring posts)",
    hint: "Finds recruiters' LinkedIn “we're hiring, send CV to …” posts, which usually include an email. 2,500 free searches.",
    href: "https://serper.dev/api-key", linkText: "Get a free key",
  },
  {
    key: "SERPAPI_KEY", label: "SerpAPI key (alternative to Serper)",
    hint: "Only needed if you don't use Serper.dev.",
    href: "https://serpapi.com/manage-api-key", linkText: "Get a key",
  },
  {
    key: "LINKEDIN_CLIENT_SECRET", label: "LinkedIn app Client Secret",
    hint: "From your app's Auth tab (Primary Client Secret). Lets you connect LinkedIn and post. Set up on the LinkedIn page.",
    href: "https://www.linkedin.com/developers/apps", linkText: "Your LinkedIn apps",
  },
  {
    key: "RAPIDAPI_KEY", label: "JSearch (RapidAPI) key",
    hint: "Main job source: Google Jobs, which includes LinkedIn, Naukri, Indeed and more.",
    href: "https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch", linkText: "Get a key",
  },
  {
    key: "ADZUNA_APP_KEY", label: "Adzuna app key",
    hint: "Optional second job source (free). Needs the Adzuna app ID below too.",
    href: "https://developer.adzuna.com", linkText: "Get a key",
  },
];

const pick = (s) => ({ candidate: s.candidate, search: s.search, email: s.email });

export default function Settings({ notify, onSaved }) {
  const [server, setServer] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [secrets, setSecrets] = useState({});
  const [ids, setIds] = useState({ GMAIL_ADDRESS: "", ADZUNA_APP_ID: "", LINKEDIN_CLIENT_ID: "" });
  const [savingKeys, setSavingKeys] = useState(false);
  const [testing, setTesting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();
  const unsavedRef = useRef(false);

  // Warn before closing or reloading the tab with unsaved changes
  useEffect(() => {
    const warn = (e) => { if (unsavedRef.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const load = (s) => {
    setServer(s);
    setForm(pick(s));
    setIds({ GMAIL_ADDRESS: s.gmail_address || "", ADZUNA_APP_ID: s.adzuna_app_id || "", LINKEDIN_CLIENT_ID: s.linkedin_client_id || "" });
  };

  useEffect(() => {
    api.settings().then(load).catch((e) => notify(e.message, "error"));
  }, [notify]);

  if (!form) return <div className="empty">Loading settings…</div>;

  const dirty = JSON.stringify(form) !== JSON.stringify(pick(server));
  const set = (section, key) => (value) => setForm({ ...form, [section]: { ...form[section], [key]: value } });
  const setInput = (section, key) => (e) => set(section, key)(e.target.value);
  const keysDirty = Object.values(secrets).some((v) => v && v.trim()) ||
    ids.GMAIL_ADDRESS !== (server.gmail_address || "") || ids.ADZUNA_APP_ID !== (server.adzuna_app_id || "") ||
    ids.LINKEDIN_CLIENT_ID !== (server.linkedin_client_id || "");
  unsavedRef.current = dirty || keysDirty;

  async function saveAll() {
    setSaving(true);
    try {
      load(await api.saveSettings({ ...(dirty ? form : {}), ...(keysDirty ? { secrets: { ...secrets, ...ids } } : {}) }));
      setSecrets({});
      notify(keysDirty ? "Settings and keys saved" : "Settings saved");
      onSaved();
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setSaving(false);
    }
  }

  function discardAll() {
    setForm(pick(server));
    setSecrets({});
    setIds({ GMAIL_ADDRESS: server.gmail_address || "", ADZUNA_APP_ID: server.adzuna_app_id || "", LINKEDIN_CLIENT_ID: server.linkedin_client_id || "" });
  }

  async function saveKeys() {
    if (savingKeys || !keysDirty) return;
    setSavingKeys(true);
    try {
      load(await api.saveSettings({ secrets: { ...secrets, ...ids } }));
      setSecrets({});
      notify("Keys saved securely");
      onSaved();
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setSavingKeys(false);
    }
  }

  async function removeKey(key, label) {
    if (!window.confirm(`Remove the saved ${label}?`)) return;
    try {
      load(await api.clearSecret(key));
      notify(`${label} removed`);
      onSaved();
    } catch (e) {
      notify(e.message, "error");
    }
  }

  async function recheck() {
    try {
      await api.startAction("recheck");
      notify("Re-checking saved jobs against your filters…");
      setTimeout(onSaved, 1500);
    } catch (e) {
      notify(e.message, "error");
    }
  }

  async function testGmail() {
    setTesting(true);
    try {
      notify((await api.testGmail()).message);
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setTesting(false);
    }
  }

  async function upload(file) {
    if (!file) return;
    setUploading(true);
    try {
      const res = await api.uploadResume(file);
      load(await api.settings());
      notify(`Resume uploaded: ${res.name}`);
      onSaved();
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setUploading(false);
    }
  }

  const c = form.candidate, s = form.search, m = form.email;

  return (
    <div className="page settings">
      {/* ---------- Accounts & keys ---------- */}
      <section className="card">
        <div className="card-head">
          <div>
            <h2><Icon name="key" size={18} /> Accounts &amp; keys</h2>
            <p className="muted small">Saved only on this computer in the <code>.env</code> file. Saved keys are never shown again; type a new value to replace one.</p>
          </div>
        </div>
        <div className="pad grid-2">
          <Field label="Gmail address" hint="Emails are sent from this account.">
            <input type="email" value={ids.GMAIL_ADDRESS} onChange={(e) => setIds({ ...ids, GMAIL_ADDRESS: e.target.value })} />
          </Field>
          <Field label="Adzuna app ID" hint="Only needed if you use Adzuna.">
            <input value={ids.ADZUNA_APP_ID} onChange={(e) => setIds({ ...ids, ADZUNA_APP_ID: e.target.value })} />
          </Field>
          <Field label="LinkedIn app Client ID" hint="From your LinkedIn app's Auth tab. Used with the Client Secret below.">
            <input value={ids.LINKEDIN_CLIENT_ID} onChange={(e) => setIds({ ...ids, LINKEDIN_CLIENT_ID: e.target.value })}
              onBlur={() => ids.LINKEDIN_CLIENT_ID !== (server.linkedin_client_id || "") && saveKeys()} />
          </Field>
          {KEYS.map((k) => {
            const saved = server.secrets[k.key];
            return (
              <div key={k.key} className="field">
                <span className="field-label">
                  {k.label}
                  {saved ? <span className="saved"><Icon name="check" size={13} /> Saved</span> : <span className="missing">Not set</span>}
                </span>
                <div className="input-row">
                  <input type="password" autoComplete="new-password"
                    placeholder={saved ? "•••••••••••• (type to replace)" : "Paste here"}
                    value={secrets[k.key] || ""} onChange={(e) => setSecrets({ ...secrets, [k.key]: e.target.value })}
                    onBlur={() => (secrets[k.key] || "").trim() && saveKeys()}
                    onKeyDown={(e) => e.key === "Enter" && saveKeys()} />
                  {saved && <button type="button" className="btn btn-sm btn-ghost" onClick={() => removeKey(k.key, k.label)}>Remove</button>}
                </div>
                <span className="hint">{k.hint} <a href={k.href} target="_blank" rel="noreferrer">{k.linkText} ↗</a></span>
              </div>
            );
          })}
        </div>
        <div className="card-foot">
          <button className="btn" onClick={testGmail} disabled={testing || !server.secrets.GMAIL_APP_PASSWORD}>
            {testing ? "Testing…" : "Test Gmail connection"}
          </button>
          <button className="btn btn-primary" onClick={saveKeys} disabled={savingKeys || !keysDirty}>
            {savingKeys ? "Saving…" : "Save keys"}
          </button>
        </div>
      </section>

      {/* ---------- Resume ---------- */}
      <section className="card">
        <div className="card-head"><h2><Icon name="file" size={18} /> Resume</h2></div>
        <div className="pad">
          <div className={`dropzone ${dragOver ? "over" : ""}`}
            onClick={() => fileRef.current.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); upload(e.dataTransfer.files[0]); }}>
            <input ref={fileRef} type="file" accept=".pdf,.doc,.docx" hidden onChange={(e) => upload(e.target.files[0])} />
            {server.resume.exists ? (
              <>
                <span className="file-icon ok"><Icon name="file" size={22} /></span>
                <span><strong>{server.resume.name}</strong><small>{(server.resume.size / 1024).toFixed(0)} KB · attached to every email · click or drop a file to replace</small></span>
              </>
            ) : (
              <>
                <span className="file-icon"><Icon name="upload" size={22} /></span>
                <span><strong>{uploading ? "Uploading…" : "Upload your resume"}</strong><small>PDF or Word, up to 5 MB. Click or drag the file here.</small></span>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ---------- Profile ---------- */}
      <section className="card">
        <div className="card-head"><h2>Your profile</h2><span className="muted small">Used in emails and application forms</span></div>
        <div className="pad grid-2">
          <Field label="Full name"><input value={c.name} onChange={setInput("candidate", "name")} /></Field>
          <Field label="Mobile number" hint="Shown in your email signature"><input value={c.phone} onChange={setInput("candidate", "phone")} /></Field>
          <Field label="LinkedIn profile URL"><input value={c.linkedin} onChange={setInput("candidate", "linkedin")} placeholder="https://linkedin.com/in/…" /></Field>
          <Field label="Naukri profile URL"><input value={c.naukri} onChange={setInput("candidate", "naukri")} /></Field>
          <Field label="Years of experience"><input type="number" min="0" max="60" value={c.experience_years} onChange={setInput("candidate", "experience_years")} /></Field>
          <Field label="Notice period"><input value={c.notice_period} onChange={setInput("candidate", "notice_period")} placeholder="e.g. 30 days" /></Field>
          <Field label="Current CTC"><input value={c.current_ctc} onChange={setInput("candidate", "current_ctc")} placeholder="e.g. 6 LPA" /></Field>
          <Field label="Expected CTC"><input value={c.expected_ctc} onChange={setInput("candidate", "expected_ctc")} placeholder="e.g. 9 LPA" /></Field>
        </div>
      </section>

      {/* ---------- Job search ---------- */}
      <section className="card">
        <div className="card-head">
          <div><h2>What to search for</h2><p className="muted small">Press Enter or comma to add each item. Internships, roles far above your experience and “N+ years” beyond yours are skipped automatically.</p></div>
          <button className="btn btn-sm" onClick={recheck} disabled={dirty} title={dirty ? "Save your changes first" : ""}>Re-check existing jobs</button>
        </div>
        <div className="pad grid-2">
          <Field label="Job roles"><TagInput value={s.roles} onChange={set("search", "roles")} placeholder="e.g. Python Developer" /></Field>
          <Field label="Locations"><TagInput value={s.locations} onChange={set("search", "locations")} placeholder="e.g. Indore, Remote" /></Field>
          <Field label="Primary skills" hint="Must-have skills; count double in the match score">
            <TagInput value={s.primary_skills} onChange={set("search", "primary_skills")} placeholder="e.g. Python, React" />
          </Field>
          <Field label="Secondary skills" hint="Nice-to-have">
            <TagInput value={s.secondary_skills} onChange={set("search", "secondary_skills")} placeholder="e.g. AWS, Docker" />
          </Field>
          <div className="span-2">
            <Toggle label="Include LinkedIn job listings" checked={s.linkedin_jobs ?? true} onChange={set("search", "linkedin_jobs")}
              hint="Reads LinkedIn's public job pages (no login, so your account is never used). Full descriptions; about 20 jobs per role and location." />
          </div>
          <Field label="Job must mention at least one of" hint="Keeps out jobs in other stacks">
            <TagInput value={s.required_skills || []} onChange={set("search", "required_skills")} placeholder="e.g. nodejs, reactjs" />
          </Field>
          <Field label="Skip job titles with" hint="Other stacks, e.g. Java, .NET (kept if the title also names your skill)">
            <TagInput value={s.exclude_title_keywords || []} onChange={set("search", "exclude_title_keywords")} placeholder="e.g. java" />
          </Field>
          <Field label="Skip jobs mentioning"><TagInput value={s.exclude_keywords} onChange={set("search", "exclude_keywords")} placeholder="e.g. intern" /></Field>
          <Field label="Skip these companies"><TagInput value={s.exclude_companies} onChange={set("search", "exclude_companies")} placeholder="Company name" /></Field>
          <Field label={`Posted within the last ${s.posted_within_days} day(s)`}>
            <input type="range" min="1" max="30" value={s.posted_within_days} onChange={(e) => set("search", "posted_within_days")(+e.target.value)} />
          </Field>
          <Field label={`Minimum match: ${s.min_match_percent}%`} hint="Jobs below this score are ignored">
            <input type="range" min="0" max="100" step="5" value={s.min_match_percent} onChange={(e) => set("search", "min_match_percent")(+e.target.value)} />
          </Field>
        </div>
      </section>

      {/* ---------- Email ---------- */}
      <section className="card">
        <div className="card-head"><h2>Email sending</h2></div>
        <div className="pad">
          <Toggle label="Send automatically" checked={m.auto_send} onChange={set("email", "auto_send")}
            hint={m.auto_send ? "Every draft is emailed during the daily run without your review." : "Recommended: only emails you approve on the Jobs page are sent."} />
          <Toggle label="Personalise each email with AI" checked={m.use_claude} onChange={set("email", "use_claude")}
            hint="Uses your Gemini or Claude key. Without one, a standard template is used." />
          <div className="grid-2 top-gap">
            <Field label="Daily email limit" hint="Start around 30 a day on a new Gmail and raise it gradually to avoid spam flags.">
              <input type="number" min="1" max="500" value={m.daily_limit} onChange={(e) => set("email", "daily_limit")(e.target.value)} />
            </Field>
            <Field label="Follow up after (days)" hint="One polite follow-up in the same thread if the recruiter hasn't replied. 0 turns it off.">
              <input type="number" min="0" max="30" value={m.follow_up_days ?? 3} onChange={(e) => set("email", "follow_up_days")(e.target.value)} />
            </Field>
            <Field label="Seconds between emails">
              <input type="number" min="5" max="600" value={m.delay_seconds} onChange={(e) => set("email", "delay_seconds")(e.target.value)} />
            </Field>
          </div>
        </div>
      </section>

      {(dirty || keysDirty) && (
        <div className="savebar">
          <span>You have unsaved changes</span>
          <button className="btn btn-ghost" onClick={discardAll}>Discard</button>
          <button className="btn btn-primary" onClick={saveAll} disabled={saving || savingKeys}>{saving ? "Saving…" : "Save changes"}</button>
        </div>
      )}
    </div>
  );
}
