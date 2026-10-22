import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { Field, Icon } from "../components.jsx";

const KIND_LABELS = {
  open_to_work: "I'm open to work",
  learning: "Share a learning / tip",
  project: "Project highlight",
  custom: "My own topic",
};
const MAX = 3000;

// Runs on the user's own LinkedIn "Saved jobs" / "Saved posts" page (in their logged-in browser): collects the
// job and post links shown there and opens the dashboard with them. No login data leaves the browser.
const BOOKMARKLET = `javascript:(()=>{const j=new Set(),p=[];document.querySelectorAll('a[href*="/jobs/view/"]').forEach(a=>{const m=a.href.match(/jobs\\/view\\/(?:[^/?]*-)?(\\d{6,})/);if(m)j.add(m[1])});document.querySelectorAll('a[href*="/feed/update/"],a[href*="/posts/"]').forEach(a=>{const u=a.href.split('?')[0].replace(/\\/$/,'');if(!p.some(x=>x.url===u)){const c=a.closest('li')||a.closest('div');p.push({url:u,text:(c?c.innerText:'').replace(/\\s+/g,' ').slice(0,200)})}});if(!j.size&&!p.length){alert('No saved jobs or posts found here. Open LinkedIn > My items > Saved jobs (or Saved posts), scroll to load them, then click again.');return}const d=btoa(unescape(encodeURIComponent(JSON.stringify({j:[...j],p:p.slice(0,100)})))).replace(/\\+/g,'-').replace(/\\//g,'_');window.open('${window.location.origin}/#/linkedin?import='+d,'_blank')})()`;

function decodeImport(value) {
  try {
    const json = decodeURIComponent(escape(atob(value.replace(/-/g, "+").replace(/_/g, "/"))));
    const d = JSON.parse(json);
    return { jobs: (d.j || []).filter((x) => /^\d{6,20}$/.test(x)), posts: (d.p || []).filter((x) => /^https:\/\/(www\.)?linkedin\.com\//.test(x.url)) };
  } catch {
    return null;
  }
}

function FetchFromLinkedIn() {
  const linkRef = useRef();
  // React refuses javascript: links in JSX, so the bookmark's address is set directly on the element
  useEffect(() => { if (linkRef.current) linkRef.current.setAttribute("href", BOOKMARKLET); }, []);
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Fetch saved jobs &amp; posts from your LinkedIn</h2>
          <p className="muted small">LinkedIn doesn't let apps read these, so this button reads them from your own LinkedIn page in your browser (where you're already logged in). Your login never leaves the browser and nothing runs automatically.</p>
        </div>
      </div>
      <div className="pad">
        <ol className="setup-steps">
          <li>One-time: show your bookmarks bar (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd>), then <strong>drag this button onto it</strong>:
            <span className="redirect-url"><a ref={linkRef} className="btn btn-primary bookmarklet" onClick={(e) => e.preventDefault()} title="Drag me to your bookmarks bar">⇪ Send to Job Agent</a></span></li>
          <li>Open <a href="https://www.linkedin.com/my-items/saved-jobs/" target="_blank" rel="noreferrer">LinkedIn → My items → Saved jobs</a> and scroll so all your saved jobs load.</li>
          <li>Click <strong>Send to Job Agent</strong> in your bookmarks bar. The dashboard opens and asks to import them.</li>
          <li>For posts: open <a href="https://www.linkedin.com/my-items/saved-posts/" target="_blank" rel="noreferrer">Saved posts</a>, scroll, and click the bookmark again.</li>
        </ol>
      </div>
    </section>
  );
}

function ImportExport({ notify, onDone }) {
  const fileRef = useRef();
  const [busy, setBusy] = useState(false);
  async function upload(file) {
    if (!file) return;
    setBusy(true);
    try {
      const r = await api.linkedinImport(file);
      notify(`Found ${r.saved_jobs} saved jobs, ${r.applied_jobs} applications, ${r.posts} saved posts. Importing… (progress at the top)`);
      onDone();
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Or: import LinkedIn's data download</h2>
          <p className="muted small">LinkedIn doesn't let apps read saved jobs or saved posts, but its official data download includes them. Upload it here once; saved jobs land in your Jobs list with full descriptions, and jobs you already applied to are marked so they're never emailed.</p>
        </div>
      </div>
      <div className="pad grid-2">
        <ol className="setup-steps">
          <li>On LinkedIn: <strong>Me → Settings &amp; Privacy → Data privacy → Get a copy of your data</strong>
            (<a href="https://www.linkedin.com/mypreferences/d/download-my-data" target="_blank" rel="noreferrer">open it</a>).</li>
          <li>Choose <strong>“Want something in particular?”</strong> and tick <strong>Jobs</strong> (add <strong>Saved items</strong> too if it's listed), then <strong>Request archive</strong>.</li>
          <li>LinkedIn emails you a download link, usually within 10 minutes (sometimes up to a day).</li>
          <li>Download the <strong>.zip</strong> and drop it here. No need to unzip.</li>
        </ol>
        <div className="dropzone" onClick={() => fileRef.current.click()}
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files[0]); }}>
          <input ref={fileRef} type="file" accept=".zip,.csv" hidden onChange={(e) => { upload(e.target.files[0]); e.target.value = ""; }} />
          <span className="file-icon"><Icon name="upload" size={22} /></span>
          <span><strong>{busy ? "Reading…" : "Drop your LinkedIn data .zip"}</strong><small>Or a single CSV from it (e.g. Saved Jobs.csv). Import again anytime for new saves.</small></span>
        </div>
      </div>
    </section>
  );
}

function Setup({ status, notify, onSaved }) {
  const [id, setId] = useState(status.client_id || "");
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      await api.saveSettings({ secrets: { LINKEDIN_CLIENT_ID: id.trim(), LINKEDIN_CLIENT_SECRET: secret.trim() } });
      setSecret("");
      notify("LinkedIn app keys saved");
      onSaved();
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setSaving(false);
    }
  }
  const copy = () => navigator.clipboard.writeText(status.redirect_uri).then(() => notify("Redirect URL copied"));
  return (
    <div className="pad">
      <p className="muted small">One-time setup (about 10 minutes). LinkedIn only lets apps post for you through your own free “developer app”. You approve it on LinkedIn's page; this app never sees your password.</p>
      <ol className="setup-steps">
        <li>Open <a href="https://www.linkedin.com/developers/apps/new" target="_blank" rel="noreferrer">linkedin.com/developers → Create app</a>. Name it e.g. “My Job Agent”.
          <span className="hint">LinkedIn asks for a <strong>LinkedIn Page</strong>. If you don't have one, use “Create a new LinkedIn Page” (a simple page with your name is fine) and select it.</span></li>
        <li>In the app, open the <strong>Products</strong> tab and click <strong>Request access</strong> on
          <strong> “Sign In with LinkedIn using OpenID Connect”</strong> and <strong>“Share on LinkedIn”</strong> (both are approved instantly).</li>
        <li>Open the <strong>Auth</strong> tab → <strong>Authorized redirect URLs</strong> → add:
          <span className="redirect-url"><code>{status.redirect_uri}</code><button className="btn btn-sm" onClick={copy}>Copy</button></span></li>
        <li>On the same <strong>Auth</strong> tab, copy the <strong>Client ID</strong> and <strong>Primary Client Secret</strong> into the boxes below.</li>
      </ol>
      <div className="grid-2 top-gap">
        <Field label="Client ID"><input value={id} onChange={(e) => setId(e.target.value)} placeholder="e.g. 86abc123xyz" /></Field>
        <Field label="Client Secret" hint={status.configured ? "Saved. Type a new one to replace it." : "Saved privately on this computer."}>
          <input type="password" autoComplete="new-password" value={secret} onChange={(e) => setSecret(e.target.value)}
            placeholder={status.configured ? "•••••••••••• (saved)" : "Paste here"} />
        </Field>
      </div>
      <div className="fix-actions">
        <button className="btn btn-primary" disabled={saving || !id.trim() || (!secret.trim() && !status.configured)} onClick={save}>Save app keys</button>
      </div>
    </div>
  );
}

export default function LinkedIn({ notify }) {
  const [status, setStatus] = useState(null);
  const [kind, setKind] = useState("open_to_work");
  const [topic, setTopic] = useState("");
  const [text, setText] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [posting, setPosting] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [incoming, setIncoming] = useState(null);
  const [importing, setImporting] = useState(false);

  const load = useCallback(() => api.linkedin().then(setStatus).catch((e) => notify(e.message, "error")), [notify]);

  useEffect(() => {
    load();
    // Back from LinkedIn's sign-in page: show the outcome once, then clean the address bar
    const query = new URLSearchParams(window.location.hash.split("?")[1] || "");
    if (query.get("connected")) notify("LinkedIn connected");
    if (query.get("error")) notify(query.get("error"), "error");
    if (query.get("import")) {
      const data = decodeImport(query.get("import"));
      if (data && (data.jobs.length || data.posts.length)) setIncoming(data);
      else notify("Couldn't read the saved items from LinkedIn. Try the bookmark again.", "error");
    }
    if (query.toString()) window.history.replaceState(null, "", "#/linkedin");
  }, [load, notify]);

  if (!status) return <div className="empty">Loading…</div>;

  async function confirmImport() {
    setImporting(true);
    try {
      const r = await api.linkedinSaved(incoming.jobs, incoming.posts);
      notify(`Importing ${r.saved_jobs} saved jobs and ${r.posts} saved posts… (progress at the top)`);
      setIncoming(null);
      setTimeout(load, 4000);
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setImporting(false);
    }
  }

  async function draft() {
    setDrafting(true);
    try {
      setText((await api.linkedinDraft(kind, topic)).text);
      notify("Draft ready. Edit it before posting.");
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setDrafting(false);
    }
  }

  async function post() {
    if (!window.confirm("Post this publicly on your LinkedIn now?")) return;
    setPosting(true);
    try {
      const res = await api.linkedinPost(text);
      setStatus(res);
      setText("");
      notify("Posted on LinkedIn");
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setPosting(false);
    }
  }

  async function disconnect() {
    if (!window.confirm("Disconnect your LinkedIn account from this app?")) return;
    try {
      setStatus(await api.linkedinDisconnect());
      notify("LinkedIn disconnected");
    } catch (e) {
      notify(e.message, "error");
    }
  }

  const placeholders = (text.match(/\[[^\]]+\]/g) || []).length;

  return (
    <div className="page">
      {incoming && (
        <section className="card import-confirm">
          <div className="card-head">
            <div>
              <h2>Import from your LinkedIn page?</h2>
              <p className="muted small">Found <strong>{incoming.jobs.length} saved job{incoming.jobs.length !== 1 ? "s" : ""}</strong> and <strong>{incoming.posts.length} saved post{incoming.posts.length !== 1 ? "s" : ""}</strong>. Jobs are added to your Jobs list with full descriptions; posts appear below.</p>
            </div>
            <div className="actions">
              <button className="btn btn-ghost" onClick={() => setIncoming(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={importing} onClick={confirmImport}>{importing ? "Importing…" : "Import"}</button>
            </div>
          </div>
        </section>
      )}
      <section className="card">
        <div className="card-head">
          <div>
            <h2><Icon name="linkedin" size={18} /> Your LinkedIn account</h2>
            <p className="muted small">Connected through LinkedIn's official sign-in. The app can only post when you press Post, and you can disconnect anytime.</p>
          </div>
          {status.configured && !showSetup && <button className="btn btn-sm btn-ghost" onClick={() => setShowSetup(true)}>App keys</button>}
        </div>

        {status.connected ? (
          <div className="pad li-account">
            {status.picture ? <img src={status.picture} alt="" className="li-avatar" /> : <span className="avatar">{status.name?.[0]}</span>}
            <span className="li-who">
              <strong>{status.name}</strong>
              <small>{status.email} · access until {status.expires} (LinkedIn asks to reconnect every 60 days)</small>
            </span>
            <span className="saved"><Icon name="check" size={13} /> Connected</span>
            <button className="btn btn-sm btn-ghost" onClick={disconnect}>Disconnect</button>
          </div>
        ) : status.configured && !showSetup ? (
          <div className="pad li-connect">
            <p>{status.expired ? "Your LinkedIn access expired (it lasts 60 days)." : "Your LinkedIn app is set up."} Click below, sign in on LinkedIn's page and press <strong>Allow</strong>.</p>
            <a className="btn btn-primary" href="/api/linkedin/connect"><Icon name="linkedin" size={16} /> {status.expired ? "Reconnect LinkedIn" : "Connect LinkedIn"}</a>
          </div>
        ) : null}
        {(!status.configured || showSetup) && (
          <Setup status={status} notify={notify} onSaved={() => { setShowSetup(false); load(); }} />
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Create a post</h2>
            <p className="muted small">AI writes a draft from your resume and settings; you edit it and decide whether to post.</p>
          </div>
        </div>
        <div className="pad">
          <div className="chips">
            {status.kinds.map((k) => (
              <button key={k} className={`chip ${kind === k ? "active" : ""}`} onClick={() => setKind(k)}>{KIND_LABELS[k] || k}</button>
            ))}
          </div>
          <div className="input-row top-gap">
            <input value={topic} onChange={(e) => setTopic(e.target.value)}
              placeholder={kind === "custom" ? "What should the post be about?" : "Optional: anything to mention (e.g. a project name, what you learned)"} />
            <button className="btn" onClick={draft} disabled={drafting || (kind === "custom" && !topic.trim())}>
              {drafting ? "Writing…" : text ? "Rewrite with AI" : "Write with AI"}
            </button>
          </div>
          <Field label={<>Post <span className={`count ${text.length > MAX ? "over" : ""}`}>{text.length} / {MAX}</span></>}>
            <textarea rows={12} value={text} onChange={(e) => setText(e.target.value)}
              placeholder="Write your post here, or click “Write with AI”." />
          </Field>
          {placeholders > 0 && <p className="alert">Fill in the {placeholders} [placeholder]{placeholders > 1 ? "s" : ""} with your real details before posting.</p>}
          <div className="fix-actions">
            {!status.connected && <span className="muted small">Connect LinkedIn above to post.</span>}
            <button className="btn btn-sm" disabled={!text.trim()} onClick={() => navigator.clipboard.writeText(text).then(() => notify("Copied"))}>Copy</button>
            <button className="btn btn-primary" disabled={!status.connected || posting || !text.trim() || text.length > MAX || placeholders > 0} onClick={post}>
              {posting ? "Posting…" : "Post to LinkedIn"}
            </button>
          </div>
        </div>
      </section>

      {status.posts.length > 0 && (
        <section className="card">
          <div className="card-head"><h2>Your posts from this app</h2></div>
          <ul className="list">
            {status.posts.map((p) => (
              <li key={p.time + p.urn}>
                <span className="list-main"><strong>{p.text.split("\n")[0]}</strong><small>{p.time}</small></span>
                {p.url && <a className="btn btn-sm" href={p.url} target="_blank" rel="noreferrer">View ↗</a>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <FetchFromLinkedIn />
      <ImportExport notify={notify} onDone={() => setTimeout(load, 3000)} />

      {status.saved_posts?.length > 0 && (
        <section className="card">
          <div className="card-head"><h2>Your saved posts ({status.saved_posts.length})</h2><span className="muted small">From your LinkedIn data download</span></div>
          <ul className="list">
            {status.saved_posts.map((p) => (
              <li key={p.url}>
                <span className="list-main"><strong>{p.text || p.url.replace(/^https?:\/\/(www\.)?/, "")}</strong><small>{p.date}</small></span>
                <a className="btn btn-sm" href={p.url} target="_blank" rel="noreferrer">Open ↗</a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <div className="card-head"><h2>LinkedIn jobs</h2></div>
        <p className="pad muted small" style={{ margin: 0 }}>
          LinkedIn doesn't let personal apps search jobs through your account, so jobs come from LinkedIn's public job
          listings (no login, so your account is never at risk). They're included in <strong>Find jobs now</strong> and the daily run,
          with full descriptions. Turn this on or off in <a href="#/settings">Settings → What to search for</a>.
        </p>
      </section>
    </div>
  );
}
