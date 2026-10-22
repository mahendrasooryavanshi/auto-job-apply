import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { CompanyAvatar, Icon, MatchPill, SourceTag, StatusBadge, timeAgo } from "../components.jsx";

const STATUSES = ["Drafted", "Approved", "Emailed", "Applied", "Replied", "No Contact", "Skipped", "Failed"];
const LABELS = { Drafted: "To review", "No Contact": "Apply via link" };
const PAGE_SIZES = [25, 50, 100];

const DEFAULT_FILTERS = { sort: "newest", source: "all", minMatch: 0, maxAge: 0, hasEmail: false };
const SOURCES = [["all", "All"], ["company", "Company sites"], ["linkedin", "LinkedIn"], ["boards", "Job boards"]];
const SORT_LABELS = { newest: "Newest added", match: "Best match", posted: "Latest posted" };

function FilterGroup({ label, value, options, onChange }) {
  return (
    <div className="filter-group">
      <span className="mini-label">{label}</span>
      <div className="option-pills">
        {options.map(([v, text]) => (
          <button key={v} className={value === v ? "active" : ""} onClick={() => onChange(v)}>{text}</button>
        ))}
      </div>
    </div>
  );
}

function FilterChip({ label, onClear }) {
  return (
    <span className="filter-chip">{label}<button onClick={onClear} aria-label={`Remove ${label}`}>×</button></span>
  );
}

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
  const [panel, setPanel] = useState(null);   // open dropdown: "filters" | "sort" | null
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
      <section className="card jobs-card">
        <nav className="status-tabs" aria-label="Job status">
          {["All", ...STATUSES].map((s) => (
            <button key={s} className={filter === s ? "active" : ""} onClick={() => setFilter(s)} aria-current={filter === s}>
              {LABELS[s] || s}
              <span>{s === "All" ? jobs.length : counts[s] || 0}</span>
            </button>
          ))}
        </nav>

        <div className="jobs-toolbar">
          <label className="search-box">
            <Icon name="search" size={16} />
            <input placeholder="Search jobs, companies, skills…" value={query} onChange={(e) => setQuery(e.target.value)} />
            {query && <button className="clear-x" onClick={() => setQuery("")} aria-label="Clear search">×</button>}
          </label>
          <div className="toolbar-right">
            <div className="dropdown">
              <button className={`btn tool-btn ${activeFilters ? "has-active" : ""}`} onClick={() => setPanel(panel === "filters" ? null : "filters")}
                aria-expanded={panel === "filters"}>
                <Icon name="sliders" size={15} /> Filters{activeFilters > 0 && <span className="count-badge">{activeFilters}</span>}
              </button>
              {panel === "filters" && (
                <>
                  <div className="popover-backdrop" onClick={() => setPanel(null)} />
                  <div className="popover filters-pop" role="dialog" aria-label="Filters">
                    <FilterGroup label="Source" value={filters.source} onChange={(v) => setFilters({ ...filters, source: v })}
                      options={SOURCES} />
                    <FilterGroup label="Match with your skills" value={filters.minMatch} onChange={(v) => setFilters({ ...filters, minMatch: v })}
                      options={[[0, "Any"], [60, "60%+"], [85, "85%+"], [100, "100%"]]} />
                    <FilterGroup label="Posted" value={filters.maxAge} onChange={(v) => setFilters({ ...filters, maxAge: v })}
                      options={[[0, "Any time"], [1, "24 hours"], [3, "3 days"], [7, "7 days"], [30, "30 days"]]} />
                    <label className="toggle-row compact-toggle">
                      <span><span className="toggle-label">Has recruiter email</span><span className="hint">Jobs you can email directly</span></span>
                      <button type="button" role="switch" aria-checked={filters.hasEmail} className={`toggle ${filters.hasEmail ? "on" : ""}`}
                        onClick={() => setFilters({ ...filters, hasEmail: !filters.hasEmail })}><span /></button>
                    </label>
                    <div className="pop-foot">
                      <button className="link-btn" disabled={!activeFilters} onClick={() => setFilters({ ...DEFAULT_FILTERS, sort: filters.sort })}>Clear all</button>
                      <button className="btn btn-primary btn-sm" onClick={() => setPanel(null)}>Show {page?.total ?? ""} jobs</button>
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="dropdown">
              <button className="btn tool-btn" onClick={() => setPanel(panel === "sort" ? null : "sort")} aria-expanded={panel === "sort"}>
                <span className="muted">Sort:</span> {SORT_LABELS[filters.sort]} <span className="caret">▾</span>
              </button>
              {panel === "sort" && (
                <>
                  <div className="popover-backdrop" onClick={() => setPanel(null)} />
                  <div className="popover menu-pop" role="menu">
                    {Object.entries(SORT_LABELS).map(([v, label]) => (
                      <button key={v} role="menuitemradio" aria-checked={filters.sort === v} className={filters.sort === v ? "active" : ""}
                        onClick={() => { setFilters({ ...filters, sort: v }); setPanel(null); }}>
                        {label}{filters.sort === v && <Icon name="check" size={14} />}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {(activeFilters > 0 || selected.size > 0) && (
          <div className="active-bar">
            {selected.size > 0 ? (
              <div className="bulk">
                <span>{selected.size} selected</span>
                <button className="btn btn-primary btn-sm" onClick={() => bulk("Approved")}>Approve</button>
                <button className="btn btn-sm" onClick={() => bulk("Applied")}>Mark applied</button>
                <button className="btn btn-sm" onClick={() => bulk("Skipped")}>Not interested</button>
                <button className="link-btn" onClick={() => setSelected(new Set())}>Cancel</button>
              </div>
            ) : (
              <>
                {filters.source !== "all" && <FilterChip label={SOURCES.find(([v]) => v === filters.source)[1]} onClear={() => setFilters({ ...filters, source: "all" })} />}
                {filters.minMatch > 0 && <FilterChip label={`${filters.minMatch}%+ match`} onClear={() => setFilters({ ...filters, minMatch: 0 })} />}
                {filters.maxAge > 0 && <FilterChip label={`Posted ≤ ${filters.maxAge === 1 ? "24 hours" : `${filters.maxAge} days`}`} onClear={() => setFilters({ ...filters, maxAge: 0 })} />}
                {filters.hasEmail && <FilterChip label="Has recruiter email" onClear={() => setFilters({ ...filters, hasEmail: false })} />}
                <button className="link-btn" onClick={() => setFilters({ ...DEFAULT_FILTERS, sort: filters.sort })}>Clear all</button>
              </>
            )}
          </div>
        )}

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
                      <strong title={j.Role}>{j.Role}</strong>
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
