import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { Field, Icon, StatusBadge } from "../components.jsx";

const EMPTY = { name: "", email: "", company: "", role: "", notes: "" };
const fill = (text, values) => text.replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));

function ContactPanel({ row, onClose, onChanged, notify }) {
  const [form, setForm] = useState({ name: row["HR Name"], email: row["HR Email"], company: row.Company, role: row.Role, notes: row.Notes });
  // Row numbers shift when the Excel file is edited: start again when this panel now shows a different contact
  useEffect(() => setForm({ name: row["HR Name"], email: row["HR Email"], company: row.Company, role: row.Role, notes: row.Notes }), [row.id, row["HR Email"]]);
  const expect_email = row["HR Email"];   // the server refuses the change if this row now holds someone else
  const sent = row.Status === "Emailed" || row.Status === "Replied";
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function act(fn, msg) {
    try {
      await fn();
      notify(msg);
      onChanged();
    } catch (e) {
      notify(e.message, "error");
    }
  }

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <aside className="panel">
        <div className="panel-head">
          <div>
            <h2>{row["HR Name"] || row["HR Email"]}</h2>
            <StatusBadge status={row.Status} />
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        <dl className="details">
          <div><dt>Company</dt><dd>{row.Company || "—"}</dd></div>
          <div><dt>Added</dt><dd>{row["Added On"] || "—"}</dd></div>
          <div><dt>Emailed</dt><dd>{row["Sent On"] || "—"}</dd></div>
          <div><dt>Follow-up</dt><dd>{row["Follow-up Sent On"] || "—"}</dd></div>
          <div><dt>Replied</dt><dd>{row["Replied On"] || "—"}</dd></div>
        </dl>

        <h3>Contact</h3>
        <div className="grid-2">
          <Field label="HR name"><input value={form.name} onChange={set("name")} disabled={sent} /></Field>
          <Field label="HR email"><input value={form.email} onChange={set("email")} disabled={sent} /></Field>
          <Field label="Company"><input value={form.company} onChange={set("company")} disabled={sent} /></Field>
          <Field label="Role (optional)"><input value={form.role} onChange={set("role")} disabled={sent} placeholder="Uses your first target role if empty" /></Field>
        </div>
        <Field label="Notes"><input value={form.notes} onChange={set("notes")} /></Field>

        <h3>{sent ? "Email that was sent" : "Email that will be sent"}</h3>
        <div className="email-preview">
          <div className="email-meta"><span>To</span> {row["HR Email"]}</div>
          <div className="email-meta"><span>Subject</span> {row.preview_subject}</div>
          <pre>{row.preview_body}</pre>
          <div className="email-attach"><Icon name="file" size={14} /> Resume attached</div>
        </div>

        <div className="panel-actions">
          <button className="btn btn-primary" onClick={() => act(() => api.hrUpdate(row.id, { ...form, expect_email }), "Contact saved")}>Save</button>
          {!sent && (row.Status === "Paused"
            ? <button className="btn" onClick={() => act(() => api.hrUpdate(row.id, { status: "Ready", expect_email }), "Will be emailed on the next send")}>Resume</button>
            : <button className="btn" onClick={() => act(() => api.hrUpdate(row.id, { status: "Paused", expect_email }), "Paused: won't be emailed")}>Pause</button>)}
          <button className="btn btn-ghost" onClick={() => window.confirm("Remove this contact from your HR list?") &&
            act(() => api.hrBulk([row.id], "delete", [expect_email]), "Contact removed").then(onClose)}>Delete</button>
        </div>
      </aside>
    </>
  );
}

const COLS = [
  ["name", "HR Name", "HR name", "15%"],
  ["email", "HR Email", "email@company.com", "22%"],
  ["company", "Company", "Company", "16%"],
  ["role", "Role", "default role", "15%"],
  ["notes", "Notes", "", "14%"],
];

// One spreadsheet cell: edits locally, saves when you leave it (Enter moves down, Esc cancels)
function Cell({ value, onCommit, disabled, placeholder, col, row }) {
  const [v, setV] = useState(value || "");
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setV(value || ""); }, [value]);
  const move = (target, dRow) => {
    const next = document.querySelector(`[data-col="${col}"][data-row="${row + dRow}"]`);
    if (next) next.focus(); else target.blur();
  };
  return (
    <input className="cell" value={v} disabled={disabled} placeholder={placeholder} data-col={col} data-row={row}
      onFocus={(e) => { focused.current = true; e.target.select(); }}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        focused.current = false;
        if (v.trim() !== (value || "").trim()) onCommit(v.trim()).catch(() => setV(value || ""));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); move(e.target, e.shiftKey ? -1 : 1); }
        if (e.key === "ArrowDown") { e.preventDefault(); move(e.target, 1); }
        if (e.key === "ArrowUp") { e.preventDefault(); move(e.target, -1); }
        if (e.key === "Escape") { setV(value || ""); focused.current = false; e.target.blur(); }
      }} />
  );
}

function HrSheetGrid({ rows, file, notify, onChanged, onPreview }) {
  const locked = Boolean(file?.open);
  const [selected, setSelected] = useState(new Set());
  const [draft, setDraft] = useState(EMPTY);
  const [adding, setAdding] = useState(false);
  const [hrQuery, setHrQuery] = useState("");
  const [hrStatus, setHrStatus] = useState("All");
  const words = hrQuery.toLowerCase().split(/\s+/).filter(Boolean);
  // same order as the Excel file, narrowed by the search box and status filter
  const ordered = rows.filter((r) => (hrStatus === "All" || r.Status === hrStatus) &&
    words.every((w) => `${r["HR Name"]} ${r["HR Email"]} ${r.Company} ${r.Role} ${r.Notes}`.toLowerCase().includes(w)));
  const statusCounts = rows.reduce((acc, r) => ({ ...acc, [r.Status]: (acc[r.Status] || 0) + 1 }), {});

  const save = (id, field) => async (value) => {
    try {
      await api.hrUpdate(id, { [field]: value, expect_email: rows.find((r) => r.id === id)?.["HR Email"] });
      onChanged();
    } catch (e) {
      notify(e.message, "error");
      throw e;
    }
  };

  async function addDraft() {
    if (adding) return undefined;
    if (!draft.email.trim()) return notify("Type the HR email to add a row", "error");
    setAdding(true);
    try {
      const res = await api.hrAdd([draft]);
      if (!res.added) return notify(res.problems[0], "error");
      setDraft(EMPTY);
      notify("Row added");
      onChanged();
      requestAnimationFrame(() => document.querySelector(`[data-col="name"][data-row="${ordered.length + 1}"]`)?.focus());
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setAdding(false);
    }
    return undefined;
  }

  async function openFile() {
    try {
      await api.hrOpen();
      notify("Opening hr_contacts.xlsx in LibreOffice…");
    } catch (e) {
      notify(e.message, "error");
    }
  }

  async function bulk(action) {
    if (action === "delete" && !window.confirm(`Delete ${selected.size} row(s) from your HR list?`)) return;
    try {
      const ids = [...selected];
      const res = await api.hrBulk(ids, action, ids.map((id) => rows.find((r) => r.id === id)?.["HR Email"] || ""));
      notify(`${res.changed} row${res.changed !== 1 ? "s" : ""} ${action === "delete" ? "deleted" : action === "pause" ? "paused" : "resumed"}`);
      setSelected(new Set());
      onChanged();
    } catch (e) {
      notify(e.message, "error");
    }
  }

  const toggle = (id) => { const n = new Set(selected); n.has(id) ? n.delete(id) : n.add(id); setSelected(n); };
  const allSelected = ordered.length > 0 && ordered.every((r) => selected.has(r.id));

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Your HR sheet ({rows.length})</h2>
          <p className="muted small">Edit here like Excel (changes save when you leave a cell), or open the real file in LibreOffice. Both stay in sync.</p>
        </div>
        <div className="actions">
          {selected.size > 0 && (
            <div className="bulk">
              <span>{selected.size} selected</span>
              <button className="btn btn-sm" onClick={() => bulk("pause")}>Pause</button>
              <button className="btn btn-sm" onClick={() => bulk("resume")}>Resume</button>
              <button className="btn btn-sm btn-danger" onClick={() => bulk("delete")}>Delete</button>
            </div>
          )}
          <button className="btn btn-sm btn-primary" onClick={openFile}><Icon name="file" size={14} /> Open in LibreOffice</button>
          <a className="btn btn-sm" href="/api/hr/download">Download</a>
        </div>
      </div>
      <div className="filter-bar">
        <input className="search" placeholder="Search name, email, company or role…" value={hrQuery} onChange={(e) => setHrQuery(e.target.value)} />
        <div className="chips">
          {["All", "Ready", "Emailed", "Replied", "Paused", "Failed", "Check email"].map((st) => (
            <button key={st} className={`chip ${hrStatus === st ? "active" : ""}`} onClick={() => setHrStatus(st)}>
              {st}<span>{st === "All" ? rows.length : statusCounts[st] || 0}</span>
            </button>
          ))}
        </div>
      </div>
      <div className={`file-bar ${locked ? "file-open" : ""}`}>
        <Icon name="file" size={14} />
        <code>{file?.path}</code>
        {file?.modified && <span className="muted">· last saved {file.modified.slice(11, 16)}</span>}
        {locked && (
          <span className="file-open-note">
            <strong>Open in LibreOffice now.</strong> Edit there, then press <kbd>Ctrl</kbd>+<kbd>S</kbd> (choose “Use Excel 2007-365!” if asked) and close it.
            Editing here and sending to your HR list pause until then, so neither side overwrites the other.
          </span>
        )}
      </div>
      <div className="table-wrap">
        <table className="sheet">
          <thead>
            <tr>
              <th className="col-check"><input type="checkbox" checked={allSelected} aria-label="Select all"
                onChange={() => setSelected(allSelected ? new Set() : new Set(ordered.map((r) => r.id)))} /></th>
              <th className="col-num">#</th>
              {COLS.map(([k, label, , w]) => <th key={k} style={{ width: w }}>{label}</th>)}
              <th>Status</th>
              <th>Emailed</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ordered.map((r, i) => {
              const sent = r.Status === "Emailed" || r.Status === "Replied";
              return (
                <tr key={r.id} className={selected.has(r.id) ? "selected" : ""}>
                  <td className="col-check"><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label="Select row" /></td>
                  <td className="col-num">{i + 1}</td>
                  {COLS.map(([k, label, ph]) => (
                    <td key={k} className="cell-td">
                      <Cell value={r[label]} col={k} row={i} placeholder={ph}
                        disabled={locked || (sent && k !== "notes")} onCommit={save(r.id, k)} />
                    </td>
                  ))}
                  <td><StatusBadge status={r.Status} /></td>
                  <td className="nowrap small">{r["Sent On"] ? r["Sent On"].slice(5) : "—"}</td>
                  <td className="nowrap">
                    <button className="icon-btn sm" title="Preview the email" onClick={() => onPreview(r.id)}><Icon name="mail" size={15} /></button>
                  </td>
                </tr>
              );
            })}
            <tr className="new-row">
              <td className="col-check" />
              <td className="col-num">+</td>
              {COLS.map(([k, , ph]) => (
                <td key={k} className="cell-td">
                  <input className="cell" disabled={locked} placeholder={k === "email" ? "New HR email *" : k === "notes" ? "" : `New ${ph.toLowerCase()}`}
                    value={draft[k] || ""} data-col={k} data-row={ordered.length}
                    onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addDraft())} />
                </td>
              ))}
              <td colSpan={3}><button className="btn btn-sm btn-primary" disabled={!draft.email.trim() || adding} onClick={addDraft}>Add row</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function HrOutreach({ notify, summary, onRunSend, sending, refreshSummary }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [mode, setMode] = useState("one");
  const [pasted, setPasted] = useState("");
  const [tpl, setTpl] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [showTemplate, setShowTemplate] = useState(false);
  const [busy, setBusy] = useState(false);   // an add or import is on its way
  const fileRef = useRef();
  const bodyRef = useRef();
  const failingRef = useRef(false);   // polling keeps failing while the server is down: say so once

  const load = useCallback(() => api.hr().then((d) => {
    failingRef.current = false;
    setData(d);
    setTpl((t) => t ?? d.template);
  }).catch((e) => {
    if (!failingRef.current) notify(e.message, "error");
    failingRef.current = true;
  }), [notify]);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  if (!data || !tpl) return <div className="empty">Loading…</div>;

  const rows = data.rows;
  const count = (s) => rows.filter((r) => r.Status === s).length;
  const tplDirty = tpl.subject !== data.template.subject || tpl.body !== data.template.body;
  const openRow = rows.find((r) => r.id === openId);

  const after = (res) => {
    if (res.added) notify(`Added ${res.added} contact${res.added !== 1 ? "s" : ""}` + (res.problems.length ? ` · ${res.problems.length} skipped (${res.problems[0]})` : ""));
    else notify(res.problems[0] || "Nothing added", "error");
    load();
    refreshSummary();
  };

  async function addOne(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      after(await api.hrAdd([form]));
      setForm(EMPTY);
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function addPasted() {
    if (busy) return;
    setBusy(true);
    try {
      after(await api.hrPaste(pasted));
      setPasted("");
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file) {
    if (!file || busy) return;
    setBusy(true);
    try {
      after(await api.hrImport(file));
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveTemplate() {
    try {
      const d = await api.hrTemplate(tpl);
      setData(d);
      setTpl(d.template);
      notify("Template saved");
    } catch (err) {
      notify(err.message, "error");
    }
  }

  function insert(key) {
    const el = bodyRef.current;
    const pos = el ? el.selectionStart : tpl.body.length;
    const body = `${tpl.body.slice(0, pos)}{${key}}${tpl.body.slice(pos)}`;
    setTpl({ ...tpl, body });
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(pos + key.length + 2, pos + key.length + 2); });
  }

  return (
    <div className="page">
      <section className="kpis">
        <div className="kpi"><span className="kpi-label">Ready to email</span><span className="kpi-value">{count("Ready")}</span><span className="kpi-sub">go out on the next send</span></div>
        <div className="kpi"><span className="kpi-label">Emailed</span><span className="kpi-value">{count("Emailed") + count("Replied")}</span><span className="kpi-sub">{count("Replied")} replied</span></div>
        <div className="kpi"><span className="kpi-label">Paused / failed</span><span className="kpi-value">{count("Paused") + count("Failed")}</span><span className="kpi-sub">not being emailed</span></div>
        <div className="kpi kpi-accent">
          <span className="kpi-label">Send now</span>
          <button className="btn btn-sm send-now" disabled={!count("Ready") || !!summary?.action?.name || !data.resume || sending} onClick={onRunSend}>
            <Icon name="send" size={14} /> Email {count("Ready")} contact{count("Ready") !== 1 ? "s" : ""}
          </button>
          <span className="kpi-sub">{data.resume ? `Resume: ${data.resume}` : "Upload your resume in Settings first"} · also runs daily at 9:30</span>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2><Icon name="mail" size={18} /> Add HR contacts</h2>
          <div className="seg-control">
            {[["one", "One at a time"], ["paste", "Paste a list"], ["file", "Import Excel / CSV"]].map(([id, label]) => (
              <button key={id} className={mode === id ? "active" : ""} onClick={() => setMode(id)}>{label}</button>
            ))}
          </div>
        </div>
        <div className="pad">
          {mode === "one" && (
            <form className="add-row" onSubmit={addOne}>
              <input placeholder="HR name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <input placeholder="HR email *" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              <input placeholder="Company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
              <input placeholder="Role (optional)" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} />
              <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? "Adding…" : "Add"}</button>
            </form>
          )}
          {mode === "paste" && (
            <>
              <textarea rows={6} value={pasted} onChange={(e) => setPasted(e.target.value)}
                placeholder={"One contact per line: name, email, company, role\nPriya Sharma, priya@acme.com, Acme Technologies\nRahul Verma, rahul@globex.in, Globex, Backend Developer\nhr@initech.com"} />
              <div className="fix-actions"><button className="btn btn-primary" disabled={!pasted.trim() || busy} onClick={addPasted}>Add contacts</button></div>
            </>
          )}
          {mode === "file" && (
            <div className="dropzone" onClick={() => fileRef.current.click()}
              onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); importFile(e.dataTransfer.files[0]); }}>
              <input ref={fileRef} type="file" accept=".xlsx,.csv,.txt" hidden onChange={(e) => { importFile(e.target.files[0]); e.target.value = ""; }} />
              <span className="file-icon"><Icon name="upload" size={22} /></span>
              <span><strong>Drop an Excel or CSV file</strong><small>Columns: HR Name, HR Email, Company, Role (any order; only the email is required)</small></span>
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Email template</h2>
            <p className="muted small">One message for everyone; the {"{placeholders}"} are filled in for each contact. Your resume, contact details and LinkedIn are added automatically.</p>
          </div>
          <button className="btn btn-sm" onClick={() => setShowTemplate(!showTemplate)}>{showTemplate ? "Hide" : "Edit template"}</button>
        </div>
        {showTemplate && (
          <div className="pad template-grid">
            <div>
              <Field label="Subject"><input value={tpl.subject} onChange={(e) => setTpl({ ...tpl, subject: e.target.value })} /></Field>
              <Field label="Message">
                <textarea ref={bodyRef} rows={12} value={tpl.body} onChange={(e) => setTpl({ ...tpl, body: e.target.value })} />
              </Field>
              <span className="mini-label">Click to insert</span>
              <div className="tag-cloud">
                {Object.entries(data.placeholders).map(([k, label]) => (
                  <button key={k} type="button" className="tag chip-insert" title={label} onClick={() => insert(k)}>{`{${k}}`}</button>
                ))}
              </div>
              <div className="fix-actions">
                {tplDirty && <button className="btn btn-ghost" onClick={() => setTpl(data.template)}>Discard</button>}
                <button className="btn btn-primary" disabled={!tplDirty} onClick={saveTemplate}>Save template</button>
              </div>
            </div>
            <div>
              <span className="mini-label">Preview (example: Priya Sharma at Acme Technologies)</span>
              <div className="email-preview">
                <div className="email-meta"><span>Subject</span> {fill(tpl.subject, data.sample_values)}</div>
                <pre>{fill(tpl.body, data.sample_values)}{"\n\n"}{data.signature}</pre>
                <div className="email-attach"><Icon name="file" size={14} /> {data.resume || "No resume uploaded yet"}</div>
              </div>
            </div>
          </div>
        )}
      </section>

      <HrSheetGrid rows={rows} file={data.file} notify={notify} onChanged={() => { load(); refreshSummary(); }} onPreview={setOpenId} />

      {openRow && <ContactPanel row={openRow} onClose={() => setOpenId(null)} onChanged={load} notify={notify} />}
    </div>
  );
}
