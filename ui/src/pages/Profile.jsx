import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { Field, Icon } from "../components.jsx";
import { safeUrl } from "../utils.js";

const DRAFT_KEY = "profileBoost.current";
const DONE_KEY = "profileBoost.done";

// Per-browser memory for pasted text and ticked items (survives page switches and reloads)
function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9+#]/g, "");

function buildItems(r, cfg) {
  const roles = cfg?.search?.roles?.join(", ") || "";
  const locations = cfg?.search?.locations?.join(", ") || "";
  const c = cfg?.candidate || {};
  return {
    linkedin: [
      {
        id: "li-headline", title: "Headline", limit: 220,
        where: ["Open your LinkedIn profile", "Click the pencil ✎ on the card with your name and photo", "Replace the text in “Headline”", "Save"],
        current: r.current_linkedin_headline, suggested: r.linkedin_headline, why: r.linkedin_headline_why,
      },
      {
        id: "li-about", title: "About", limit: 2600,
        where: ["Scroll to the “About” section on your profile (or “Add profile section → About”)", "Click the pencil ✎", "Replace the text", "Save"],
        current: r.current_linkedin_about, suggested: r.linkedin_about, why: r.linkedin_about_why,
      },
      {
        id: "li-skills", title: "Skills", skills: true,
        where: ["Scroll to “Skills” on your profile", "Click “+” to add each new skill below", "Optionally remove skills unrelated to your target roles"],
        current: r.current_linkedin_skills, suggested: r.key_skills, why: r.skills_why,
      },
      {
        id: "li-open", title: "Open to work (recruiters only)",
        where: ["Click “Open to” under your name → “Finding a new job”", "Add the job titles and locations below", "Set start date and choose visibility “Recruiters only”", "Save"],
        suggested: `Job titles: ${roles}\nLocations: ${locations}\nStart: ${c.notice_period ? `within ${c.notice_period}` : "as per notice period"}`,
        why: "Recruiters filter by “Open to work”. Choosing “Recruiters only” tells them you're available without showing a banner to your current employer.",
      },
    ],
    naukri: [
      {
        id: "nk-headline", title: "Resume headline", limit: 250,
        where: ["Log in to Naukri and open “View profile”", "Find “Resume headline” and click the pencil ✎", "Replace the text", "Save"],
        current: r.current_naukri_headline, suggested: r.naukri_resume_headline, why: r.naukri_headline_why,
      },
      {
        id: "nk-skills", title: "Key skills", skills: true,
        where: ["On your Naukri profile, find “Key skills” and click the pencil ✎", "Add each new skill below", "Save"],
        current: r.current_naukri_skills, suggested: r.key_skills, why: r.skills_why,
      },
      {
        id: "nk-summary", title: "Profile summary", limit: 1000,
        where: ["On your Naukri profile, find “Profile summary” and click the pencil ✎", "Replace the text", "Save"],
        current: r.current_naukri_summary, suggested: r.naukri_profile_summary, why: r.naukri_summary_why,
      },
      {
        id: "nk-career", title: "Career profile & availability",
        where: ["On your Naukri profile open “Career profile” (pencil ✎)", "Set preferred locations and expected salary", "In your basic details, set the notice period", "Save"],
        suggested: `Preferred job role: ${roles}\nPreferred locations: ${locations}\nExpected CTC: ${c.expected_ctc ? `${c.expected_ctc} LPA` : "—"}\nNotice period: ${c.notice_period || "—"}`,
        why: "Naukri matches you to recruiter searches using these fields. Missing locations or salary means you don't show up in filtered searches.",
      },
    ],
  };
}

// Profile URL saved once in Settings; shown here so it never needs typing again
function SavedLink({ label, field, cfg, onSaved, notify }) {
  const saved = cfg?.candidate?.[field] || "";
  const [value, setValue] = useState("");
  if (!cfg) return null;
  if (saved) {
    return (
      <div className="saved-link">
        <span className="saved"><Icon name="check" size={13} /> Saved</span>
        <a href={safeUrl(saved)} target="_blank" rel="noreferrer">{saved.replace(/^https?:\/\/(www\.)?/, "")}</a>
        <a className="btn btn-sm" href={safeUrl(saved)} target="_blank" rel="noreferrer">Open profile ↗</a>
      </div>
    );
  }
  async function store() {
    try {
      onSaved(await api.saveSettings({ candidate: { [field]: value.trim() } }));
      notify(`${label} URL saved`);
    } catch (e) {
      notify(e.message, "error");
    }
  }
  return (
    <div className="input-row saved-link">
      <input placeholder={`Your ${label} profile URL (saved once)`} value={value} onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && value.trim() && store()} />
      <button className="btn btn-sm" disabled={!value.trim()} onClick={store}>Save</button>
    </div>
  );
}

function CopyButton({ text, label, notify }) {
  return (
    <button className="btn btn-sm" onClick={() => navigator.clipboard.writeText(text).then(
      () => notify(`${label} copied`), () => notify("Copy failed", "error"))}>Copy</button>
  );
}

function SkillsCompare({ current = [], suggested = [] }) {
  const have = new Set(current.map(norm));
  const toAdd = suggested.filter((s) => !have.has(norm(s)));
  const kept = suggested.filter((s) => have.has(norm(s)));
  const unrelated = current.filter((s) => !suggested.some((x) => norm(x) === norm(s)));
  return (
    <div className="skills-compare">
      {toAdd.length > 0 && <div><span className="mini-label">Add these</span><div className="tag-cloud">{toAdd.map((s) => <span key={s} className="tag tag-add">+ {s}</span>)}</div></div>}
      {kept.length > 0 && <div><span className="mini-label">Already on your profile</span><div className="tag-cloud">{kept.map((s) => <span key={s} className="tag tag-muted">✓ {s}</span>)}</div></div>}
      {current.length > 0 && unrelated.length > 0 && <div><span className="mini-label">Consider removing or moving lower (not relevant to your target roles)</span><div className="tag-cloud">{unrelated.map((s) => <span key={s} className="tag tag-muted">{s}</span>)}</div></div>}
    </div>
  );
}

function Item({ item, done, onDone, notify }) {
  const suggestedText = Array.isArray(item.suggested) ? item.suggested.join(", ") : item.suggested;
  const hasCurrent = Array.isArray(item.current) ? item.current.length > 0 : Boolean(item.current);
  const over = item.limit && suggestedText.length > item.limit;
  return (
    <article className={`fix ${done ? "fix-done" : ""}`}>
      <header className="fix-head">
        <label className="fix-check">
          <input type="checkbox" checked={done} onChange={(e) => onDone(e.target.checked)} />
          <h3 className="fix-title">{item.title}</h3>
        </label>
        {done && <span className="saved">Updated</span>}
      </header>

      {item.why && <p className="fix-why"><strong>Why change it:</strong> {item.why}</p>}

      {item.skills ? (
        <>
          <SkillsCompare current={item.current} suggested={item.suggested} />
          {!hasCurrent && <p className="muted small">Your current skills weren't provided, so all suggested skills are listed as new.</p>}
          <div className="fix-actions"><CopyButton text={suggestedText} label="Skills" notify={notify} /></div>
        </>
      ) : (
        <div className={`compare ${item.current === undefined ? "compare-single" : ""}`}>
          {item.current !== undefined && (
            <div className="compare-col">
              <span className="mini-label">Now on your profile</span>
              {hasCurrent ? <p className="compare-text">{item.current}</p>
                : <p className="compare-text muted">Not provided. Upload your LinkedIn PDF or paste it above to compare.</p>}
            </div>
          )}
          <div className="compare-col compare-new">
            <span className="mini-label">
              Change it to
              {item.limit && <span className={`count ${over ? "over" : ""}`}>{suggestedText.length} / {item.limit}</span>}
            </span>
            <p className="compare-text">{suggestedText}</p>
            <div className="fix-actions"><CopyButton text={suggestedText} label={item.title} notify={notify} /></div>
          </div>
        </div>
      )}

      <details className="fix-where">
        <summary>Where to change it</summary>
        <ol>{item.where.map((w) => <li key={w}>{w}</li>)}</ol>
      </details>
    </article>
  );
}

export default function Profile({ notify, setup }) {
  const aiReady = setup ? setup["AI key (Claude or Gemini)"] : true;
  const resumeReady = setup ? setup["Resume file"] : true;
  const [current, setCurrentState] = useState(() => load(DRAFT_KEY, {}));
  const [done, setDoneState] = useState(() => load(DONE_KEY, {}));
  const [result, setResult] = useState(null);
  const [linkedinPdf, setLinkedinPdf] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [tab, setTab] = useState("linkedin");
  const [loading, setLoading] = useState(false);
  const fileRef = useRef();

  useEffect(() => {
    api.profile().then((d) => { setResult(d.result); setLinkedinPdf(d.linkedin_pdf); }).catch(() => {});
    api.settings().then(setCfg).catch(() => {});
  }, []);

  const setCurrent = (v) => { setCurrentState(v); save(DRAFT_KEY, v); };
  const doneKey = (id) => `${result?.generated_at}:${id}`;
  const setDone = (id, value) => {
    const next = { ...done, [doneKey(id)]: value };
    setDoneState(next);
    save(DONE_KEY, next);
  };

  async function uploadPdf(file) {
    if (!file) return;
    try {
      setLinkedinPdf((await api.uploadLinkedinPdf(file)).linkedin_pdf);
      notify("LinkedIn profile PDF uploaded. Click Generate to compare.");
    } catch (e) {
      notify(e.message, "error");
    }
  }

  async function generate() {
    setLoading(true);
    try {
      setResult((await api.makeProfile(current)).result);
      notify("Your profile comparison is ready");
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setLoading(false);
    }
  }

  const items = result && result.linkedin_about_why !== undefined ? buildItems(result, cfg) : null;
  const all = items ? [...items.linkedin, ...items.naukri] : [];
  const doneCount = all.filter((i) => done[doneKey(i.id)]).length;
  const paste = (key, label, rows, placeholder) => (
    <Field label={label}>
      <textarea rows={rows} placeholder={placeholder} value={current[key] || ""}
        onChange={(e) => setCurrent({ ...current, [key]: e.target.value })} />
    </Field>
  );

  return (
    <div className="page">
      {(!aiReady || !resumeReady) && (
        <div className="alert">
          <strong>Before generating:</strong>{" "}
          {!aiReady && <>save a Gemini (free) or Claude key</>}
          {!aiReady && !resumeReady && " and "}
          {!resumeReady && <>upload your resume</>} in <a href="#/settings">Settings</a>.
        </div>
      )}

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Step 1 · Show the agent your current profiles</h2>
            <p className="muted small">The agent can't log in to LinkedIn or Naukri, so give it your current profile here. It compares that with your resume and tells you exactly what to change. Nothing is posted for you.</p>
          </div>
        </div>
        <div className="pad grid-2">
          <div>
            <h3 className="step-title">LinkedIn</h3>
            <SavedLink label="LinkedIn" field="linkedin" cfg={cfg} onSaved={setCfg} notify={notify} />
            <div className="dropzone" onClick={() => fileRef.current.click()}
              onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); uploadPdf(e.dataTransfer.files[0]); }}>
              <input ref={fileRef} type="file" accept=".pdf" hidden onChange={(e) => uploadPdf(e.target.files[0])} />
              <span className={`file-icon ${linkedinPdf ? "ok" : ""}`}><Icon name={linkedinPdf ? "check" : "upload"} size={22} /></span>
              <span>
                <strong>{linkedinPdf ? "LinkedIn profile PDF uploaded" : "Upload your LinkedIn profile PDF"}</strong>
                <small>{linkedinPdf ? `Uploaded ${linkedinPdf.uploaded_at} · click to replace` : "Best option: the agent reads your current headline, About and skills from it"}</small>
              </span>
            </div>
            <ol className="howto">
              <li>Open your LinkedIn profile ({cfg?.candidate?.linkedin ? "use “Open profile” above" : "in a browser"})</li>
              <li>Click <strong>Resources</strong> (or <strong>More</strong>) under your name</li>
              <li>Click <strong>Save to PDF</strong> and upload that file here</li>
            </ol>
            <details className="fix-where">
              <summary>Or paste your LinkedIn text instead</summary>
              {paste("linkedin_headline", "Current headline", 2, "The line under your name, e.g. Software Engineer at XYZ")}
              {paste("linkedin_about", "Current About", 4, "Paste your About section")}
            </details>
          </div>
          <div>
            <h3 className="step-title">Naukri <span className="muted small">(no export available: paste these)</span></h3>
            <SavedLink label="Naukri" field="naukri" cfg={cfg} onSaved={setCfg} notify={notify} />
            {paste("naukri_headline", "Current resume headline", 2, "Naukri → View profile → Resume headline")}
            {paste("naukri_skills", "Current key skills (comma separated)", 2, "e.g. Node.js, React, MongoDB")}
            {paste("naukri_summary", "Current profile summary", 4, "Naukri → View profile → Profile summary")}
          </div>
        </div>
        <div className="card-foot">
          {loading && <span className="running"><span className="spinner" /> Comparing your profiles with your resume (about a minute)…</span>}
          <button className="btn btn-primary" onClick={generate} disabled={loading || !aiReady || !resumeReady}>
            {result ? "Compare again" : "Generate my profile fixes"}
          </button>
        </div>
      </section>

      {result && !items && (
        <div className="alert">These suggestions were made by an older version. Click <strong>Compare again</strong> to see the before → after guide.</div>
      )}

      {items && (
        <>
          <section className="card">
            <div className="card-head">
              <div>
                <h2>Step 2 · Update your profiles</h2>
                <p className="muted small">
                  Generated {result.generated_at}{result.used_linkedin_pdf ? " · compared with your LinkedIn PDF" : ""}.
                  Fill in any [placeholders] with your real numbers, then tick each item when it's done.
                </p>
              </div>
              <span className="progress-label">{doneCount} of {all.length} updated</span>
            </div>
            <div className="progress inset"><div style={{ width: `${(100 * doneCount) / all.length}%` }} /></div>
            <nav className="tabs inset-tabs">
              {[["linkedin", "LinkedIn", items.linkedin], ["naukri", "Naukri", items.naukri], ["resume", "Resume", null]].map(([id, label, list]) => (
                <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
                  {label}{list && ` (${list.filter((i) => done[doneKey(i.id)]).length}/${list.length})`}
                </button>
              ))}
            </nav>
            <div className="pad fixes">
              {tab === "resume" ? (
                <>
                  <h3 className="step-title">Improve your resume</h3>
                  <ol className="tips">{result.resume_improvements.map((t, i) => <li key={i}>{t}</li>)}</ol>
                  {result.missing_keywords.length > 0 && (
                    <>
                      <h3 className="step-title">Skills recruiters look for that your resume doesn't mention</h3>
                      <p className="muted small">Add them only if you've actually used them.</p>
                      <div className="tag-cloud">{result.missing_keywords.map((s) => <span key={s} className="tag tag-muted">{s}</span>)}</div>
                    </>
                  )}
                  <p className="muted small top-gap">After updating your resume, upload the new file in Settings so emails attach the latest version.</p>
                </>
              ) : (
                items[tab].map((item) => (
                  <Item key={item.id} item={item} notify={notify}
                    done={Boolean(done[doneKey(item.id)])} onDone={(v) => setDone(item.id, v)} />
                ))
              )}
            </div>
          </section>
          {tab === "naukri" && (
            <p className="muted small">Tip: Naukri ranks recently updated profiles higher in recruiter searches. Making a small edit every few days keeps you near the top.</p>
          )}
        </>
      )}
    </div>
  );
}
