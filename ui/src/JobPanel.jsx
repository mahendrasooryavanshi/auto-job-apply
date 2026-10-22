import { useEffect, useState } from "react";
import { api } from "./api.js";
import { CompanyAvatar, Icon, MatchPill, SourceTag, StatusBadge, timeAgo } from "./components.jsx";
import { applicantsOf } from "./utils.js";

const fieldsFrom = (job) => ({
  recruiter_email: job["Recruiter Email"],
  subject: job["Email Subject"],
  body: job["Email Body"],
  notes: job.Notes,
});

function siteName(link) {
  try {
    const host = new URL(link).hostname.replace(/^www\.|^in\./, "");
    if (host.includes("linkedin")) return "LinkedIn";
    if (host.includes("myworkdayjobs") || /greenhouse|lever|ashby|smartrecruiters|workable|recruitee|personio|breezy|rippling/.test(host)) return "company site";
    const name = host.split(".").slice(-2, -1)[0] || host;
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return "job site";
  }
}

export default function JobPanel({ job, onClose, onSaved, notify, busy }) {
  const [form, setForm] = useState(fieldsFrom(job));
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showEmail, setShowEmail] = useState(false);

  // Reset when a different job is opened, so polling doesn't wipe unsaved edits
  useEffect(() => { setForm(fieldsFrom(job)); setExpanded(false); setShowEmail(false); }, [job.id]);
  useEffect(() => {
    const esc = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const locked = ["Emailed", "Replied"].includes(job.Status);
  const original = fieldsFrom(job);
  const dirty = Object.keys(form).some((k) => (form[k] || "") !== (original[k] || ""));
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const hasEmailFlow = Boolean(job["Recruiter Email"] || job["Email Subject"]) || ["Drafted", "Approved", "Emailed", "Replied"].includes(job.Status);
  const skills = [...new Set(String(job["Tech Stack"] || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))];
  const applicants = applicantsOf(job);
  const jd = String(job["Full JD"] || job["Profile / JD Summary"] || "").replace(/\*\*/g, "");
  const meta = String(job.Notes || "").split(" · ").filter((x) => x && !/applicants|Target company|apply on/i.test(x));

  async function save(status, message) {
    setSaving(true);
    try {
      await api.updateJob(job.id, { ...form, ...(status ? { status } : {}) });
      notify(message || (status ? `Marked ${status}` : "Saved"));
      onSaved();
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setSaving(false);
    }
  }

  const facts = [
    ["Salary", job.Budget && job.Budget !== "Not disclosed" ? job.Budget : "Not shown"],
    ["Posted", job["Posted Date"] ? `${timeAgo(job["Posted Date"])} · ${String(job["Posted Date"]).slice(0, 10)}` : "—"],
    ["Applicants", applicants ? (applicants > 200 ? "200+" : `${applicants}`) : "Unknown"],
    ["Recruiter", job["Recruiter Email"] || "Not listed"],
    job.Mobile && ["Phone", job.Mobile],
    job["Email Sent On"] && ["Emailed", job["Email Sent On"]],
    job["Follow-up Sent On"] && ["Followed up", job["Follow-up Sent On"]],
    job["Replied On"] && ["Replied", job["Replied On"]],
  ].filter(Boolean);

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <aside className="panel job-sheet" aria-label={`${job.Role} at ${job.Company}`}>
        <header className="js-hero">
          <CompanyAvatar name={job.Company} size={56} />
          <div className="js-head">
            <h2>{job.Role}</h2>
            <p>{job.Company}{job.Location ? ` · ${job.Location}` : ""}</p>
            <div className="js-badges">
              <StatusBadge status={job.Status} />
              <MatchPill value={job["Match %"]} />
              <SourceTag source={job.Source} />
              {meta.slice(0, 2).map((m) => <span key={m} className="source-tag">{m}</span>)}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </header>

        <div className="js-actions">
          {job["Job Link"] && (
            <a className="btn btn-primary" href={job["Job Link"]} target="_blank" rel="noreferrer">
              <Icon name="link" size={15} /> Apply on {siteName(job["Job Link"])}
            </a>
          )}
          {!locked && job.Status !== "Applied" && (
            <button className="btn" disabled={saving || busy} onClick={() => save("Applied", "Marked as applied. Good luck!")}>
              <Icon name="check" size={15} /> I applied
            </button>
          )}
          {!locked && (job.Status !== "Skipped"
            ? <button className="btn btn-ghost" disabled={saving || busy} onClick={() => save("Skipped")}>Not interested</button>
            : <button className="btn btn-ghost" disabled={saving || busy} onClick={() => save("Drafted")}>Restore</button>)}
        </div>

        <div className="facts">
          {facts.map(([k, v]) => (
            <div key={k} className="fact"><span>{k}</span><strong title={v}>{v}</strong></div>
          ))}
        </div>

        {skills.length > 0 && (
          <section className="js-section">
            <h3>Why it matches you</h3>
            <div className="tag-cloud">{skills.map((s) => <span key={s} className="tag tag-add">✓ {s}</span>)}</div>
          </section>
        )}

        <section className="js-section">
          <h3>About the job</h3>
          {jd ? (
            <>
              <div className={`jd ${expanded ? "" : "jd-clamped"}`}>{jd}</div>
              {jd.length > 700 && (
                <button className="link-btn" onClick={() => setExpanded(!expanded)}>{expanded ? "Show less" : "Read full description"}</button>
              )}
            </>
          ) : <p className="muted">No description saved. Open the job post to read it.</p>}
        </section>

        {hasEmailFlow || showEmail ? (
          <section className="js-section email-card">
            <h3>{locked ? "Email that was sent" : "Your email to the recruiter"}</h3>
            <label className="field"><span className="field-label">To</span>
              <input value={form.recruiter_email || ""} onChange={set("recruiter_email")} disabled={locked} placeholder="recruiter@company.com" />
            </label>
            <label className="field"><span className="field-label">Subject</span>
              <input value={form.subject || ""} onChange={set("subject")} disabled={locked} />
            </label>
            <label className="field"><span className="field-label">Message <span className="muted">· resume attached automatically</span></span>
              <textarea rows={11} value={form.body || ""} onChange={set("body")} disabled={locked} />
            </label>
            {!locked && (
              <div className="email-actions">
                {busy && <p className="muted small">The agent is busy; save again when it finishes.</p>}
                {job.Status === "Approved"
                  ? <button className="btn" disabled={saving || busy} onClick={() => save("Drafted")}>Unapprove</button>
                  : <button className="btn btn-primary" disabled={saving || busy || !form.recruiter_email || !form.subject}
                      onClick={() => save("Approved", "Approved: it goes out on the next send")}>
                      <Icon name="send" size={14} /> Approve to send
                    </button>}
                <button className="btn" disabled={saving || busy || !dirty} onClick={() => save()}>Save edits</button>
              </div>
            )}
          </section>
        ) : (
          <button className="add-contact" onClick={() => setShowEmail(true)}>
            <Icon name="mail" size={15} /> Know the recruiter's email? Add it and the agent will write to them
          </button>
        )}

        <label className="field js-notes"><span className="field-label">Your notes</span>
          <input value={form.notes || ""} onChange={set("notes")} placeholder="e.g. referral from Rahul, interview on Friday"
            disabled={locked} onBlur={() => (form.notes || "") !== (original.notes || "") && save(undefined, "Notes saved")} />
        </label>
      </aside>
    </>
  );
}
