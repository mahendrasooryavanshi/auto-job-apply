import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";
import { Icon } from "./components.jsx";
import JobPanel from "./JobPanel.jsx";
import Overview from "./pages/Overview.jsx";
import Jobs from "./pages/Jobs.jsx";
import Settings from "./pages/Settings.jsx";
import Activity from "./pages/Activity.jsx";
import Profile from "./pages/Profile.jsx";
import HrOutreach from "./pages/HrOutreach.jsx";
import LinkedIn from "./pages/LinkedIn.jsx";

const PAGES = [
  { id: "overview", label: "Overview", icon: "overview" },
  { id: "jobs", label: "Jobs", icon: "jobs" },
  { id: "hr", label: "HR outreach", icon: "mail" },
  { id: "linkedin", label: "LinkedIn", icon: "linkedin" },
  { id: "profile", label: "Profile boost", icon: "profile" },
  { id: "settings", label: "Settings", icon: "settings" },
  { id: "activity", label: "Activity", icon: "activity" },
];

const pageFromHash = () => {
  const id = window.location.hash.replace("#/", "").split("?")[0];
  return PAGES.some((p) => p.id === id) ? id : "overview";
};

export default function App() {
  const [page, setPage] = useState(pageFromHash);
  const [summary, setSummary] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [jobsFilter, setJobsFilter] = useState("All");
  const [toast, setToast] = useState(null);
  const [serverDown, setServerDown] = useState(false);

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = (id) => { window.location.hash = `#/${id}`; };

  const notify = useCallback((msg, kind = "ok") => {
    setToast({ msg, kind, key: Date.now() });
    setTimeout(() => setToast((t) => (t && t.msg === msg ? null : t)), 4500);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [s, j] = await Promise.all([api.summary(), api.jobs()]);
      setSummary(s);
      setJobs(j);
      setServerDown(false);
    } catch {
      setServerDown(true);
    }
  }, []);

  const busy = Boolean(summary?.action?.name);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, busy ? 2000 : 5000);   // faster while emails are going out
    return () => clearInterval(t);
  }, [refresh, busy]);

  const running = summary?.action?.name;
  const counts = summary?.counts || {};
  const setupMissing = summary ? Object.values(summary.setup).filter((ok) => !ok).length : 0;
  const noJobSource = summary && !summary.setup["Job source key"];

  // Tell the user how a run ended once it stops running
  const [wasRunning, setWasRunning] = useState(null);
  useEffect(() => {
    if (wasRunning && !running && summary?.action) {
      const { error, result } = summary.action;
      if (error) notify(error, "error");
      else if (result) notify(result);
    }
    setWasRunning(running || null);
  }, [running, summary?.action?.finished]); // eslint-disable-line react-hooks/exhaustive-deps

  async function runAction(name) {
    try {
      await api.startAction(name);
      setWasRunning(name);  // so a run that ends before the next poll still reports its result
      notify(name === "find" ? "Searching for new jobs…" : "Sending emails (one every few seconds)…");
      refresh();
    } catch (e) {
      notify(e.message, "error");
    }
  }

  const showJobs = (status) => { setJobsFilter(status); go("jobs"); };
  const title = PAGES.find((p) => p.id === page).label;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">JA</span>
          <span>
            <strong>Job Agent</strong>
            <small>Applying on your behalf</small>
          </span>
        </div>
        <nav>
          {PAGES.map((p) => (
            <button key={p.id} className={`nav-item ${page === p.id ? "active" : ""}`} onClick={() => go(p.id)}>
              <Icon name={p.icon} />
              <span>{p.label}</span>
              {p.id === "jobs" && counts.Drafted > 0 && <span className="nav-count" title="Waiting for your review">{counts.Drafted}</span>}
              {p.id === "settings" && setupMissing > 0 && <span className="nav-dot" title="Setup incomplete" />}
            </button>
          ))}
        </nav>
        {summary && (
          <div className="sidebar-foot">
            <div className={`mode ${summary.auto_send ? "mode-auto" : ""}`}>
              <span className="mode-dot" />
              {summary.auto_send ? "Auto-send is ON" : "Review mode"}
            </div>
            <p>{summary.auto_send ? "Drafts are emailed automatically." : "Only emails you approve are sent."}</p>
          </div>
        )}
      </aside>

      <main className="main">
        <header className="topbar">
          <h1>{title}</h1>
          <div className="actions">
            {running && <span className="running"><span className="spinner" /> {summary?.action?.progress || (running === "find" ? "Finding jobs…" : running === "send" ? "Sending emails…" : "Working…")}</span>}
            <button className="btn" onClick={() => runAction("find")} disabled={!!running || serverDown || noJobSource}
              title={noJobSource ? "Add a JSearch or Adzuna key in Settings first" : "Search job sites now"}>
              <Icon name="search" size={16} /> Find jobs now
            </button>
            <button className="btn btn-primary" onClick={() => runAction("send")} disabled={!!running || !(counts.Approved || summary?.hr_ready)}>
              <Icon name="send" size={16} /> Send now{(counts.Approved || 0) + (summary?.hr_ready || 0) ? ` (${(counts.Approved || 0) + (summary?.hr_ready || 0)})` : ""}
            </button>
          </div>
        </header>

        {serverDown && (
          <div className="alert alert-error">Can't reach the agent server. Start it with <code>.venv/bin/python -m jobagent ui</code>.</div>
        )}
        {noJobSource && !serverDown && (
          <div className="alert">
            <strong>No job source connected, so “Find jobs now” has nothing to search.</strong> Add a free{" "}
            <a href="https://serper.dev/api-key" target="_blank" rel="noreferrer">Serper.dev</a> key (LinkedIn hiring posts),{" "}
            <a href="https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch" target="_blank" rel="noreferrer">JSearch</a> or{" "}
            <a href="https://developer.adzuna.com" target="_blank" rel="noreferrer">Adzuna</a> key in{" "}
            <a href="#/settings">Settings → Accounts &amp; keys</a>.
          </div>
        )}
        {summary?.action?.error && !running && (
          <div className="alert alert-error">Last run failed: {summary.action.error}</div>
        )}

        {page === "overview" && <Overview summary={summary} jobs={jobs} onOpen={setOpenId} onShowJobs={showJobs} onGo={go} />}
        {page === "jobs" && <Jobs jobs={jobs} counts={counts} filter={jobsFilter} setFilter={setJobsFilter}
          openId={openId} onOpen={setOpenId} notify={notify} refresh={refresh} />}
        {page === "settings" && <Settings notify={notify} onSaved={refresh} />}
        {page === "activity" && <Activity onOpen={setOpenId} />}
        {page === "profile" && <Profile notify={notify} setup={summary?.setup} />}
        {page === "linkedin" && <LinkedIn notify={notify} />}
        {page === "hr" && <HrOutreach notify={notify} summary={summary} onRunSend={() => runAction("send")} refreshSummary={refresh} />}
      </main>

      {jobs.find((j) => j.id === openId) && (
        <JobPanel job={jobs.find((j) => j.id === openId)} onClose={() => setOpenId(null)}
          notify={notify} onSaved={refresh} busy={!!running} />
      )}

      {toast && <div key={toast.key} className={`toast ${toast.kind === "error" ? "toast-error" : ""}`}>{toast.msg}</div>}
    </div>
  );
}
