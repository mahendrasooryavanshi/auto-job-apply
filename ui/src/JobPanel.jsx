import { useEffect, useState } from "react";
import { api } from "./api.js";
import { Icon, StatusBadge } from "./components.jsx";

const fieldsFrom = (job) => ({
  recruiter_email: job["Recruiter Email"],
  subject: job["Email Subject"],
  body: job["Email Body"],
  notes: job.Notes,
});

export default function JobPanel({ job, onClose, onSaved, notify, busy }) {
  const [form, setForm] = useState(fieldsFrom(job));
  const [saving, setSaving] = useState(false);

  // Reset the form only when a different job is opened, so polling doesn't wipe unsaved edits
  useEffect(() => setForm(fieldsFrom(job)), [job.id]);

  const locked = job.Status === "Emailed" || job.Status === "Replied";
  const original = fieldsFrom(job);
  const dirty = Object.keys(form).some((k) => (form[k] || "") !== (original[k] || ""));
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function save(status) {
    setSaving(true);
    try {
      await api.updateJob(job.id, { ...form, ...(status ? { status } : {}) });
      notify(status ? `Marked ${status}` : "Saved");
      onSaved();
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setSaving(false);
    }
  }

  const details = [
    ["Company", job.Company],
    ["Location", job.Location],
    ["Posted", job["Posted Date"]],
    ["Budget", job.Budget],
    ["Match", `${job["Match %"]}%`],
    ["Tech stack", job["Tech Stack"]],
    ["Mobile", job.Mobile || "—"],
    ["Source", job.Source],
    ["Email sent", job["Email Sent On"] || "—"],
    ["Follow-up sent", job["Follow-up Sent On"] || "—"],
    ["Replied", job["Replied On"] || "—"],
  ];

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <aside className="panel">
        <div className="panel-head">
          <div>
            <h2>{job.Role}</h2>
            <StatusBadge status={job.Status} />
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>

        <a className="btn btn-sm post-link" href={job["Job Link"]} target="_blank" rel="noreferrer"><Icon name="link" size={14} /> Open job post</a>

        <dl className="details">
          {details.map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>

        <h3>Job description</h3>
        {job["Full JD"] ? (
          <div className="jd">{job["Full JD"].replace(/\*\*/g, "")}</div>
        ) : (
          <>
            <p className="summary">{job["Profile / JD Summary"]}</p>
            <p className="muted small top-gap">Only a summary was saved for this older job. The full description is added on the next “Find jobs now”, or read it on the job post.</p>
          </>
        )}

        <h3>{locked ? "Email that was sent" : "Email draft"}</h3>
        {job.Status === "No Contact" && !form.recruiter_email && (
          <p className="muted small">No email found in the post. Add one below to contact them, or apply through the job link.</p>
        )}
        <label className="field"><span className="field-label">Recruiter email</span>
          <input value={form.recruiter_email || ""} onChange={set("recruiter_email")} disabled={locked} />
        </label>
        <label className="field"><span className="field-label">Subject</span>
          <input value={form.subject || ""} onChange={set("subject")} disabled={locked} />
        </label>
        <label className="field"><span className="field-label">Body <span className="muted">· resume attached automatically</span></span>
          <textarea rows={12} value={form.body || ""} onChange={set("body")} disabled={locked} />
        </label>
        <label className="field"><span className="field-label">Notes</span>
          <input value={form.notes || ""} onChange={set("notes")} disabled={locked} />
        </label>

        {!locked && (
          <div className="panel-actions">
            {busy && <p className="muted small">The agent is running; changes can be saved when it finishes.</p>}
            <button className="btn btn-primary" disabled={saving || busy || !form.recruiter_email || !form.subject}
              onClick={() => save("Approved")}>Approve to send</button>
            <button className="btn" disabled={saving || busy || !dirty} onClick={() => save()}>Save edits</button>
            {job.Status !== "Skipped"
              ? <button className="btn" disabled={saving || busy} onClick={() => save("Skipped")}>Skip</button>
              : <button className="btn" disabled={saving || busy} onClick={() => save("Drafted")}>Restore</button>}
            {job.Status === "Approved" && <button className="btn" disabled={saving || busy} onClick={() => save("Drafted")}>Unapprove</button>}
          </div>
        )}
      </aside>
    </>
  );
}
