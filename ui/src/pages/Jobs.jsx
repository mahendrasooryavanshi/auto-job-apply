import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { CompanyAvatar, Icon, MatchPill, SourceTag, StatusBadge, timeAgo } from "../components.jsx";

const STATUSES = ["Drafted", "Approved", "Emailed", "Applied", "Replied", "No Contact", "Skipped", "Failed"];
const LABELS = { Drafted: "To review", "No Contact": "Apply via link" };
const PAGE_SIZES = [25, 50, 100];

const DEFAULT_FILTERS = { sort: "newest", source: "all", minMatch: 0, maxAge: 0, hasEmail: false };
const SOURCES = [["all", "All sources"], ["company", "Company sites"], ["linkedin", "LinkedIn"], ["boards", "Job boards"]];

function loadFilters() {
  try { return { ...DEFAULT_FILTERS, ...JSON.parse(localStorage.getItem("jobs.filters")) }; } catch { return DEFAULT_FILTERS; }
}

function loadPageSize() {
  try { return Number(localStorage.getItem("jobs.pageSize")) || 25; } catch { return 25; }
}

export default function Jobs({ jobs, counts, filter, setFilter, openId, onOpen, notify, refresh }) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");          // query after typing pauses
  const [limit, setLimit] = useState(loadPageSize);
  // Cursor-based paging: cursors[i] is where page i starts ("" = newest). Going back pops the stack.
  const [cursors, setCursors] = useState([""]);
  const [page, setPage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [filters, setFiltersState] = useState(loadFilters);
  const cursor = cursors[cursors.length - 1];
  const setFilters = (f) => {
    setFiltersState(f);
    try { localStorage.setItem("jobs.filters", JSON.stringify(f)); } catch { /* not saved */ }
  };
  const activeFilters = Object.keys(DEFAULT_FILTERS).filter((k) => k !== "sort" && filters[k] !== DEFAULT_FILTERS[k]).length;

  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  // A new filter, search or page size starts again from the newest jobs
  useEffect(() => { setCursors([""]); setSelected(new Set()); }, [filter, search, limit, filters]);

  const load = useCallback(async (quiet) => {
    if (!quiet) setLoading(true);
    try {
      setPage(await api.jobsPage({ status: filter, q: search, limit, cursor, ...filters }));
    } catch (e) {
      if (!quiet) notify(e.message, "error");
      if (e.message.includes("cursor")) setCursors([""]);
    } finally {
      setLoading(false);
    }
  }, [filter, search, limit, cursor, filters, notify]);

  useEffect(() => { load(false); }, [load]);
  // Keep the current page fresh (statuses change while emails send); the cursor keeps it in place
  useEffect(() => { load(true); }, [jobs.length, counts]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = page?.items || [];
  const toggle = (id) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };
  const allSelected = items.length > 0 && items.every((j) => selected.has(j.id));

  async function bulk(status) {
    try {
      const res = await api.bulkStatus([...selected], status);
      setSelected(new Set());
      notify(`${res.updated} marked ${status}` + (res.skipped.length ? ` · ${res.skipped.length} unchanged (${res.skipped[0].reason})` : ""));
      refresh();
      load(true);
    } catch (e) {
      notify(e.message, "error");
    }
  }

  function changePageSize(e) {
    const value = Number(e.target.value);
    setLimit(value);
    try { localStorage.setItem("jobs.pageSize", String(value)); } catch { /* not saved */ }
  }

  const from = page && page.total ? page.start + 1 : 0;
  const to = page ? page.start + items.length : 0;

  return (
    <div className="page">
      <div className="chips">
        {["All", ...STATUSES].map((s) => (
          <button key={s} className={`chip ${filter === s ? "active" : ""}`} onClick={() => setFilter(s)}>
            {LABELS[s] || s}
            <span>{s === "All" ? jobs.length : counts[s] || 0}</span>
          </button>
        ))}
      </div>

      <section className="card">
        <div className="toolbar">
          <input className="search" placeholder="Search company, role, location, skill or email…" value={query}
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

        <div className="filter-bar">
          <div className="seg-control">
            {SOURCES.map(([v, label]) => (
              <button key={v} className={filters.source === v ? "active" : ""} onClick={() => setFilters({ ...filters, source: v })}>{label}</button>
            ))}
          </div>
          <select value={filters.minMatch} onChange={(e) => setFilters({ ...filters, minMatch: Number(e.target.value) })} aria-label="Match">
            <option value={0}>Any match</option>
            <option value={60}>60%+ match</option>
            <option value={85}>85%+ match</option>
            <option value={100}>100% match</option>
          </select>
          <select value={filters.maxAge} onChange={(e) => setFilters({ ...filters, maxAge: Number(e.target.value) })} aria-label="Posted">
            <option value={0}>Posted any time</option>
            <option value={1}>Last 24 hours</option>
            <option value={3}>Last 3 days</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
          </select>
          <button className={`chip ${filters.hasEmail ? "active" : ""}`} onClick={() => setFilters({ ...filters, hasEmail: !filters.hasEmail })}>
            <Icon name="mail" size={13} /> Has recruiter email
          </button>
          <label className="sort-by">
            Sort
            <select value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value })}>
              <option value="newest">Newest added</option>
              <option value="match">Best match</option>
              <option value="posted">Latest posted</option>
            </select>
          </label>
          {activeFilters > 0 && (
            <button className="link-btn" onClick={() => setFilters({ ...DEFAULT_FILTERS, sort: filters.sort })}>Clear {activeFilters} filter{activeFilters > 1 ? "s" : ""}</button>
          )}
        </div>

        {page === null ? (
          <p className="empty">Loading…</p>
        ) : items.length === 0 ? (
          <p className="empty">{jobs.length === 0 ? "No jobs yet. Click “Find jobs now” once setup is complete." : "No jobs match this filter."}</p>
        ) : (
          <div className={`job-list ${loading ? "is-loading" : ""}`} role="list">
            <div className="job-row job-head" aria-hidden="true">
              <span className="jr-check">
                <input type="checkbox" checked={allSelected} aria-label="Select all on this page"
                  onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((j) => j.id)))} />
              </span>
              <span>Role</span><span>Location</span><span>Match</span><span>Posted</span><span>Salary</span><span>Contact</span><span>Status</span>
            </div>
            {items.map((j) => {
              const salary = j.Budget && j.Budget !== "Not disclosed" ? j.Budget : "";
              return (
                <div key={j.id} role="listitem" tabIndex={0}
                  className={`job-row ${openId === j.id ? "open" : ""} ${selected.has(j.id) ? "selected" : ""} ${j.Status === "Skipped" ? "dim" : ""}`}
                  onClick={() => onOpen(j.id)} onKeyDown={(e) => e.key === "Enter" && onOpen(j.id)}>
                  <span className="jr-check" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(j.id)} onChange={() => toggle(j.id)} aria-label={`Select ${j.Role}`} />
                  </span>
                  <span className="jr-main">
                    <CompanyAvatar name={j.Company} />
                    <span className="jr-title">
                      <strong>{j.Role}</strong>
                      <small>
                        <span className="jr-company">{j.Source === "LinkedIn post" ? (j.Notes || "LinkedIn post") : j.Company}</span>
                        <SourceTag source={j.Source} />
                      </small>
                    </span>
                  </span>
                  <span className="jr-loc"><Icon name="pin" size={13} />{j.Location || "—"}</span>
                  <span className="jr-match"><MatchPill value={j["Match %"]} /></span>
                  <span className="jr-posted" title={String(j["Posted Date"]).slice(0, 10)}>{timeAgo(j["Posted Date"]) || "—"}</span>
                  <span className={`jr-salary ${salary ? "" : "muted"}`}>{salary || "Not shown"}</span>
                  <span className="jr-contact">
                    {j["Recruiter Email"]
                      ? <span className="contact-chip" title={j["Recruiter Email"]}><Icon name="mail" size={13} />{j["Recruiter Email"].split(",")[0]}</span>
                      : <span className="muted">Apply on site</span>}
                  </span>
                  <span className="jr-status">
                    <StatusBadge status={j.Status} />
                    {j["Email Sent On"] && <small className="muted">{j["Email Sent On"]}</small>}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {page && page.total > 0 && (
          <div className="pager">
            <span className="muted">Showing <strong>{from}–{to}</strong> of <strong>{page.total}</strong></span>
            <label className="pager-size">
              Per page
              <select value={limit} onChange={changePageSize}>
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <div className="pager-buttons">
              <button className="btn btn-sm" disabled={cursors.length === 1 || loading}
                onClick={() => setCursors(cursors.slice(0, -1))}>← Newer</button>
              <button className="btn btn-sm" disabled={!page.next_cursor || loading}
                onClick={() => setCursors([...cursors, page.next_cursor])}>Older →</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
