import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { Field, Icon } from "../components.jsx";

const KIND_LABELS = {
  open_to_work: "I'm open to work",
  learning: "Share a learning / tip",
  project: "Project highlight",
  custom: "My own topic",
};
const MAX = 3000;

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

  const load = useCallback(() => api.linkedin().then(setStatus).catch((e) => notify(e.message, "error")), [notify]);

  useEffect(() => {
    load();
    // Back from LinkedIn's sign-in page: show the outcome once, then clean the address bar
    const query = new URLSearchParams(window.location.hash.split("?")[1] || "");
    if (query.get("connected")) notify("LinkedIn connected");
    if (query.get("error")) notify(query.get("error"), "error");
    if (query.toString()) window.history.replaceState(null, "", "#/linkedin");
  }, [load, notify]);

  if (!status) return <div className="empty">Loading…</div>;

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
