import { Icon, Ring, StatusBadge } from "../components.jsx";

const PIPELINE = [
  ["Drafted", "To review"],
  ["Approved", "Approved"],
  ["Emailed", "Emailed"],
  ["Replied", "Replied"],
  ["No Contact", "Apply via link"],
  ["Skipped", "Skipped"],
  ["Failed", "Failed"],
];

export default function Overview({ summary, jobs, onOpen, onShowJobs, onGo }) {
  if (!summary) return <div className="empty">Loading…</div>;
  const counts = summary.counts || {};
  const total = jobs.length;
  const setup = Object.entries(summary.setup);
  const done = setup.filter(([, ok]) => ok).length;

  const toReview = jobs.filter((j) => j.Status === "Drafted")
    .sort((a, b) => (b["Match %"] || 0) - (a["Match %"] || 0)).slice(0, 5);
  const recent = jobs.filter((j) => j.Status === "Emailed")
    .sort((a, b) => String(b["Email Sent On"]).localeCompare(String(a["Email Sent On"]))).slice(0, 5);

  return (
    <div className="page">
      {done < setup.length && (
        <section className="card setup-card">
          <div className="setup-head">
            <div>
              <h2>Finish setting up</h2>
              <p className="muted">{done} of {setup.length} done. The agent can't search or send until these are filled in.</p>
            </div>
            <button className="btn btn-primary" onClick={() => onGo("settings")}>Open settings</button>
          </div>
          <div className="progress"><div style={{ width: `${(100 * done) / setup.length}%` }} /></div>
          <ul className="checklist">
            {setup.map(([name, ok]) => (
              <li key={name} className={ok ? "ok" : ""}>
                <span className="check">{ok && <Icon name="check" size={14} />}</span>{name}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="kpis">
        <button className="kpi" onClick={() => onShowJobs("All")}>
          <span className="kpi-label">Jobs found</span>
          <span className="kpi-value">{total}</span>
          <span className="kpi-sub">matching your stack</span>
        </button>
        <button className="kpi kpi-accent" onClick={() => onShowJobs("Drafted")}>
          <span className="kpi-label">Waiting for you</span>
          <span className="kpi-value">{counts.Drafted || 0}</span>
          <span className="kpi-sub">drafts to review</span>
        </button>
        <button className="kpi" onClick={() => onShowJobs("Emailed")}>
          <span className="kpi-label">Emailed</span>
          <span className="kpi-value">{(counts.Emailed || 0) + (counts.Replied || 0)}</span>
          <span className="kpi-sub">{counts.Replied ? `${counts.Replied} replied` : "recruiters contacted"}</span>
        </button>
        <div className="kpi kpi-ring">
          <Ring value={summary.sent_today} max={summary.daily_limit} />
          <span>
            <span className="kpi-label">Sent today</span>
            <span className="kpi-sub">daily limit {summary.daily_limit}</span>
          </span>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Pipeline</h2></div>
        {total === 0 ? (
          <p className="muted pad">No jobs yet. Once setup is done, click “Find jobs now” or wait for the daily run.</p>
        ) : (
          <>
            <div className="pipeline-bar">
              {PIPELINE.filter(([s]) => counts[s]).map(([s]) => (
                <div key={s} className={`seg seg-${s.replace(/\s/g, "").toLowerCase()}`}
                  style={{ flexGrow: counts[s] }} title={`${s}: ${counts[s]}`} />
              ))}
            </div>
            <div className="pipeline-legend">
              {PIPELINE.map(([s, label]) => (
                <button key={s} onClick={() => onShowJobs(s)}>
                  <span className={`swatch seg-${s.replace(/\s/g, "").toLowerCase()}`} />
                  {label} <strong>{counts[s] || 0}</strong>
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      <div className="two-col">
        <section className="card">
          <div className="card-head">
            <h2>Needs your review</h2>
            {counts.Drafted > 5 && <button className="link-btn" onClick={() => onShowJobs("Drafted")}>See all {counts.Drafted}</button>}
          </div>
          {toReview.length === 0 ? <p className="muted pad">Nothing to review right now.</p> : (
            <ul className="list">
              {toReview.map((j) => (
                <li key={j.id} onClick={() => onOpen(j.id)}>
                  <span className="avatar">{(j.Company || "?")[0]}</span>
                  <span className="list-main"><strong>{j.Role}</strong><small>{j.Company} · {j.Location}</small></span>
                  <span className="match-pill">{j["Match %"]}%</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <div className="card-head">
            <h2>Recently emailed</h2>
            {counts.Emailed > 5 && <button className="link-btn" onClick={() => onShowJobs("Emailed")}>See all</button>}
          </div>
          {recent.length === 0 ? <p className="muted pad">No emails sent yet.</p> : (
            <ul className="list">
              {recent.map((j) => (
                <li key={j.id} onClick={() => onOpen(j.id)}>
                  <span className="avatar">{(j.Company || "?")[0]}</span>
                  <span className="list-main"><strong>{j.Company}</strong><small>{j["Recruiter Email"]}</small></span>
                  <span className="list-meta"><StatusBadge status="Emailed" /><small>{j["Email Sent On"]}</small></span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
