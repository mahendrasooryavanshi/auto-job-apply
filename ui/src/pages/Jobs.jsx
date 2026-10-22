import { useMemo, useState } from "react";
import { api } from "../api.js";
import { StatusBadge } from "../components.jsx";

const STATUSES = ["Drafted", "Approved", "Emailed", "Replied", "No Contact", "Skipped", "Failed"];
const LABELS = { Drafted: "To review", "No Contact": "Apply via link" };

export default function Jobs({ jobs, counts, filter, setFilter, openId, onOpen, notify, refresh }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(new Set());

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return jobs
      .filter((j) => filter === "All" || j.Status === filter)
      .filter((j) => !q || `${j.Company} ${j.Role} ${j.Location} ${j["Tech Stack"]}`.toLowerCase().includes(q))
      .sort((a, b) => b.id - a.id);
  }, [jobs, filter, query]);

  const changeFilter = (f) => { setFilter(f); setSelected(new Set()); };
  const toggle = (id) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };
  const allSelected = visible.length > 0 && visible.every((j) => selected.has(j.id));

  async function bulk(status) {
    try {
      const res = await api.bulkStatus([...selected], status);
      setSelected(new Set());
      notify(`${res.updated} marked ${status}` + (res.skipped.length ? ` · ${res.skipped.length} unchanged (${res.skipped[0].reason})` : ""));
      refresh();
    } catch (e) {
      notify(e.message, "error");
    }
  }

  return (
    <div className="page">
      <div className="chips">
        {["All", ...STATUSES].map((s) => (
          <button key={s} className={`chip ${filter === s ? "active" : ""}`} onClick={() => changeFilter(s)}>
            {LABELS[s] || s}
            <span>{s === "All" ? jobs.length : counts[s] || 0}</span>
          </button>
        ))}
      </div>

      <section className="card">
        <div className="toolbar">
          <input className="search" placeholder="Search company, role, location or skill…" value={query}
            onChange={(e) => setQuery(e.target.value)} />
          {selected.size > 0 && (
            <div className="bulk">
              <span>{selected.size} selected</span>
              <button className="btn btn-primary btn-sm" onClick={() => bulk("Approved")}>Approve</button>
              <button className="btn btn-sm" onClick={() => bulk("Skipped")}>Skip</button>
              <button className="btn btn-sm" onClick={() => bulk("Drafted")}>Back to draft</button>
            </div>
          )}
        </div>

        {visible.length === 0 ? (
          <p className="empty">{jobs.length === 0 ? "No jobs yet. Click “Find jobs now” once setup is complete." : "No jobs match this filter."}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="col-check"><input type="checkbox" checked={allSelected} aria-label="Select all"
                    onChange={() => setSelected(allSelected ? new Set() : new Set(visible.map((j) => j.id)))} /></th>
                  <th>Role</th>
                  <th>Location</th>
                  <th>Match</th>
                  <th>Posted</th>
                  <th>Budget</th>
                  <th>Contact</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((j) => (
                  <tr key={j.id} className={openId === j.id ? "open" : ""} onClick={() => onOpen(j.id)}>
                    <td className="col-check" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(j.id)} onChange={() => toggle(j.id)} aria-label="Select" />
                    </td>
                    <td>
                      <div className="cell-role">
                        <span className="avatar">{(j.Company || "?")[0]}</span>
                        <span><strong>{j.Role}</strong><small>{j.Source === "LinkedIn post" ? j.Notes : j.Company}</small></span>
                      </div>
                    </td>
                    <td>{j.Location}</td>
                    <td><span className="match-pill">{j["Match %"]}%</span></td>
                    <td className="nowrap">{j["Posted Date"]}</td>
                    <td>{j.Budget}</td>
                    <td className="contact">
                      {j["Recruiter Email"] || <span className="muted">—</span>}
                      {j.Mobile && <small>{j.Mobile}</small>}
                    </td>
                    <td>
                      <StatusBadge status={j.Status} />
                      {j["Email Sent On"] && <small className="block muted">{j["Email Sent On"]}</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
