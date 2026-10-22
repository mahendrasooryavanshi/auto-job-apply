import { useEffect, useState } from "react";
import { api } from "../api.js";
import { CompanyAvatar, Icon, MatchPill, Ring, SourceTag, timeAgo } from "../components.jsx";
import { daysOld, greeting, nextDailyRun, rankJob, safeUrl } from "../utils.js";

const PIPELINE = [
  ["Drafted", "To review"],
  ["Approved", "Approved"],
  ["Emailed", "Emailed"],
  ["Applied", "Applied"],
  ["Replied", "Replied"],
  ["No Contact", "Apply via link"],
  ["Skipped", "Skipped"],
  ["Failed", "Failed"],
];

const FEED_ICON = { search: "search", email: "send", followup: "reply", reply: "reply", bounce: "alert", problem: "alert", you: "profile", filter: "filter", schedule: "clock" };

function PlanCard({ tone, icon, value, title, text, action, onClick, done }) {
  return (
    <button className={`plan-card tone-${tone} ${done ? "plan-done" : ""}`} onClick={onClick}>
      <span className="plan-icon"><Icon name={done ? "check" : icon} size={20} /></span>
      <span className="plan-body">
        <span className="plan-value">{value}</span>
        <strong>{title}</strong>
        <small>{text}</small>
      </span>
      <span className="plan-cta">{action} →</span>
    </button>
  );
}

export default function Overview({ summary, jobs, onOpen, onShowJobs, onGo }) {
  const [name, setName] = useState("");
  const [feed, setFeed] = useState([]);

  useEffect(() => {
    api.settings().then((s) => setName((s.candidate?.name || "").split(" ")[0])).catch(() => {});
    const load = () => api.activity().then((d) => setFeed(d.items.slice(0, 6))).catch(() => {});
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  if (!summary) return <div className="empty">Loading…</div>;
  const counts = summary.counts || {};
  const total = jobs.length;
  const setup = Object.entries(summary.setup);
  const missing = setup.filter(([, ok]) => !ok);

  const toReview = counts.Drafted || 0;
  const strong = jobs.filter((j) => j.Status === "No Contact" && (j["Match %"] || 0) >= 85 && daysOld(j) <= 7);
  const hrReady = summary.hr_ready || 0;
  const picks = jobs.filter((j) => j.Status === "No Contact" || j.Status === "Drafted").sort((a, b) => rankJob(b) - rankJob(a)).slice(0, 6);
  const contacted = (counts.Emailed || 0) + (counts.Replied || 0) + (counts.Applied || 0);
  const newToday = jobs.filter((j) => daysOld(j) === 0).length;

  return (
    <div className="page overview">
      <section className="hero">
        <div>
          <h2 className="hero-title">{greeting()}{name ? `, ${name}` : ""} 👋</h2>
          <p className="hero-sub">
            {toReview + strong.length > 0
              ? <>You have <strong>{toReview} email{toReview !== 1 ? "s" : ""} to review</strong> and <strong>{strong.length} strong match{strong.length !== 1 ? "es" : ""}</strong> to apply to.</>
              : "You're all caught up. New jobs arrive with the next search."}
            {newToday > 0 && <> {newToday} job{newToday !== 1 ? "s were" : " was"} posted today.</>}
          </p>
        </div>
        <div className="hero-meta">
          <span className="hero-chip"><Icon name="clock" size={14} /> Next automatic search {nextDailyRun()}</span>
          <span className={`hero-chip ${summary.auto_send ? "warn" : ""}`}>
            <span className="mode-dot" /> {summary.auto_send ? "Auto-send on" : "Review mode: nothing is sent without you"}
          </span>
        </div>
      </section>

      {missing.length > 0 && (
        <section className="card setup-card">
          <div className="setup-head">
            <div>
              <h2>Finish setting up</h2>
              <p className="muted">{setup.length - missing.length} of {setup.length} done. Still needed: {missing.map(([n]) => n).join(", ")}.</p>
            </div>
            <button className="btn btn-primary" onClick={() => onGo("settings")}>Open settings</button>
          </div>
        </section>
      )}

      <section>
        <h3 className="section-title">Your plan for today</h3>
        <div className="plan-grid">
          <PlanCard tone="lavender" icon="mail" value={toReview} title="Emails to review"
            text={toReview ? "Recruiter emails drafted for you. Approve, then send." : "No drafts waiting."}
            action={toReview ? "Review" : "View"} done={!toReview} onClick={() => onShowJobs("Drafted")} />
          <PlanCard tone="mint" icon="link" value={strong.length} title="Strong matches to apply"
            text={strong.length ? "85%+ match, posted this week. Apply on the company site." : "None right now."}
            action="Apply" done={!strong.length} onClick={() => onShowJobs("No Contact")} />
          <PlanCard tone="peach" icon="send" value={hrReady} title="HR contacts ready"
            text={hrReady ? "Will be emailed on the next send." : "Add HRs you know to email them."}
            action={hrReady ? "Send" : "Add"} done={false} onClick={() => onGo("hr")} />
        </div>
      </section>

      <section className="kpis">
        <button className="kpi" onClick={() => onShowJobs("All")}>
          <span className="kpi-label">Jobs found</span>
          <span className="kpi-value">{total}</span>
          <span className="kpi-sub">matching your stack</span>
        </button>
        <button className="kpi kpi-accent" onClick={() => onShowJobs("Drafted")}>
          <span className="kpi-label">Waiting for you</span>
          <span className="kpi-value">{toReview}</span>
          <span className="kpi-sub">drafts to review</span>
        </button>
        <button className="kpi" onClick={() => onShowJobs("Emailed")}>
          <span className="kpi-label">Applications</span>
          <span className="kpi-value">{contacted}</span>
          <span className="kpi-sub">{counts.Replied ? `${counts.Replied} replied` : "emailed or applied"}</span>
        </button>
        <div className="kpi kpi-ring">
          <Ring value={summary.sent_today} max={summary.daily_limit} />
          <span>
            <span className="kpi-label">Sent today</span>
            <span className="kpi-sub">daily limit {summary.daily_limit}</span>
          </span>
        </div>
      </section>

      <div className="two-col wide-left">
        <section className="card">
          <div className="card-head">
            <div>
              <h2><Icon name="search" size={17} /> Top picks for you</h2>
              <p className="muted small">Best fit, fresh, good companies and fewer applicants first</p>
            </div>
            <button className="link-btn" onClick={() => onShowJobs("No Contact")}>See all</button>
          </div>
          {picks.length === 0 ? <p className="muted pad">No open jobs yet. Click “Find jobs now”.</p> : (
            <ul className="picks">
              {picks.map((j) => (
                <li key={j.id} onClick={() => onOpen(j.id)}>
                  <CompanyAvatar name={j.Company} size={42} />
                  <span className="pick-main">
                    <strong>{j.Role}</strong>
                    <small>{j.Company} · {j.Location || "—"} · {timeAgo(j["Posted Date"])}</small>
                    <span className="pick-tags"><SourceTag source={j.Source} />{j.Status === "Drafted" && <span className="source-tag source-company">Email ready</span>}</span>
                  </span>
                  <MatchPill value={j["Match %"]} />
                  {j.Status === "Drafted" ? (
                    <button className="btn btn-sm btn-primary" onClick={(e) => { e.stopPropagation(); onOpen(j.id); }}>Review</button>
                  ) : (
                    <a className="btn btn-sm" href={safeUrl(j["Job Link"])} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Apply ↗</a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2><Icon name="activity" size={17} /> Recent activity</h2>
            <button className="link-btn" onClick={() => onGo("activity")}>See all</button>
          </div>
          {feed.length === 0 ? <p className="muted pad">Nothing yet.</p> : (
            <ul className="mini-feed">
              {feed.map((f, i) => (
                <li key={`${f.time}-${i}`}>
                  <span className={`feed-icon tone-${["problem", "bounce"].includes(f.kind) ? "err" : f.kind === "reply" ? "ok" : "accent"}`}><Icon name={FEED_ICON[f.kind] || "profile"} size={14} /></span>
                  <span className="feed-body"><strong>{f.title}</strong><small>{timeAgo(f.time) === "Today" ? f.time.slice(11, 16) : timeAgo(f.time)}</small></span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-head"><h2>Pipeline</h2><span className="muted small">{total} jobs tracked</span></div>
        {total > 0 && (
          <>
            <div className="pipeline-bar">
              {PIPELINE.filter(([s]) => counts[s]).map(([s]) => (
                <div key={s} className={`seg seg-${s.replace(/\s/g, "").toLowerCase()}`} style={{ flexGrow: counts[s] }} title={`${s}: ${counts[s]}`} />
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
    </div>
  );
}
