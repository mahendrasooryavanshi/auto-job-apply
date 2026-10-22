import { useState } from "react";

const ICONS = {
  overview: "M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z",
  jobs: "M10 4h4a2 2 0 0 1 2 2v1h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3V6a2 2 0 0 1 2-2zm0 3h4V6h-4v1z",
  settings: "M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.4-2.5 1a7.6 7.6 0 0 0-1.7-1L15 3h-4l-.4 3a7.6 7.6 0 0 0-1.7 1l-2.5-1-2 3.4L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.4 2.5-1c.5.4 1.1.7 1.7 1L11 21h4l.4-3c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.4-2.2-1.6zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  search: "M10.5 3a7.5 7.5 0 0 1 5.9 12.1l4.7 4.7-1.4 1.4-4.7-4.7A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z",
  send: "M3 20.5 21 12 3 3.5v6.6l12 1.9-12 1.9v6.6z",
  check: "M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z",
  link: "M14 3h7v7h-2V6.4l-9.3 9.3-1.4-1.4L17.6 5H14V3zM5 5h5v2H5v12h12v-5h2v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z",
  upload: "M11 16V7.8l-3.6 3.6L6 10l6-6 6 6-1.4 1.4L13 7.8V16h-2zm-7 4v-4h2v2h12v-2h2v4H4z",
  file: "M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm7 1.5V9h5.5L13 3.5z",
  close: "M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3z",
  profile: "M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm0 2c-4.4 0-8 2.2-8 5v2h16v-2c0-2.8-3.6-5-8-5z",
  reply: "M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z",
  alert: "M12 2 1 21h22L12 2zm1 15h-2v-2h2v2zm0-4h-2V9h2v4z",
  filter: "M3 5h18l-7 8v6l-4 2v-8L3 5z",
  clock: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 10.6 3.5 2.1-.8 1.3L11 13V7h2v5.6z",
  mail: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 4.2V18h16V8.2l-8 5-8-5zM4.5 6 12 10.7 19.5 6h-15z",
  linkedin: "M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm2.5 7v8h2.6v-8H6.5zm1.3-4.2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM11 10v8h2.6v-4.2c0-1.1.2-2.2 1.6-2.2s1.4 1.3 1.4 2.3V18H19v-4.6c0-2.3-.5-4-3.1-4-1.3 0-2.1.7-2.4 1.3V10H11z",
  pin: "M12 2a7 7 0 0 1 7 7c0 5.2-7 13-7 13S5 14.2 5 9a7 7 0 0 1 7-7zm0 4.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z",
  sun: "M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0-5 1 3h-2l1-3zm0 20-1-3h2l-1 3zM2 12l3-1v2l-3-1zm20 0-3 1v-2l3 1zM4.9 4.9l2.8 1.4-1.4 1.4-1.4-2.8zm14.2 14.2-2.8-1.4 1.4-1.4 1.4 2.8zM4.9 19.1l1.4-2.8 1.4 1.4-2.8 1.4zM19.1 4.9l-1.4 2.8-1.4-1.4 2.8-1.4z",
  moon: "M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z",
  monitor: "M3 4h18a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-7v2h3v2H7v-2h3v-2H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1 2v9h16V6H4z",
  sliders: "M4 6h9v2H4V6zm13 0h3v2h-3v2h-2V4h2v2zM4 16h3v2H4v-2zm7 0h9v2h-9v2H9v-6h2v2zm-7-5h13v2H4v-2zm16 0v2h-1v-2h1z",
  sparkle: "M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9L12 2zm7 11 .9 2.6 2.6.9-2.6.9L19 20l-.9-2.6-2.6-.9 2.6-.9L19 13zM5 14l.7 2 2 .7-2 .7L5 19.4l-.7-2-2-.7 2-.7L5 14z",
  key: "M7 14a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm5.6-4A6 6 0 1 0 12.6 14H15v3h3v-3h3v-4h-8.4z",
};

export function Icon({ name, size = 18 }) {
  const stroke = name === "activity";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"
      fill={stroke ? "none" : "currentColor"} stroke={stroke ? "currentColor" : "none"}
      strokeWidth={stroke ? 2 : 0} strokeLinecap="round" strokeLinejoin="round">
      <path d={ICONS[name]} />
    </svg>
  );
}

const STATUS_LABELS = { Drafted: "To review", "No Contact": "Apply via link" };

export function StatusBadge({ status }) {
  return <span className={`badge badge-${(status || "").replace(/\s/g, "").toLowerCase()}`}>{STATUS_LABELS[status] || status}</span>;
}

export function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="toggle-row">
      <span>
        <span className="toggle-label">{label}</span>
        {hint && <span className="hint">{hint}</span>}
      </span>
      <button type="button" role="switch" aria-checked={checked} className={`toggle ${checked ? "on" : ""}`}
        onClick={() => onChange(!checked)}><span /></button>
    </label>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

export function TagInput({ value = [], onChange, placeholder }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const parts = draft.split(",").map((s) => s.trim()).filter(Boolean);
    const next = [...value];
    parts.forEach((p) => { if (!next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p); });
    onChange(next);
    setDraft("");
  };
  return (
    <div className="tags">
      {value.map((t) => (
        <span key={t} className="tag">
          {t}
          <button type="button" aria-label={`Remove ${t}`} onClick={() => onChange(value.filter((v) => v !== t))}>×</button>
        </span>
      ))}
      <input value={draft} placeholder={value.length ? "Add more…" : placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
          if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => draft.trim() && add()} />
    </div>
  );
}

export function Ring({ value, max, size = 92 }) {
  const r = (size - 12) / 2;
  const c = 2 * Math.PI * r;
  const pct = max ? Math.min(1, value / max) : 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="ring" role="img" aria-label={`${value} of ${max}`}>
      <circle cx={size / 2} cy={size / 2} r={r} className="ring-track" />
      <circle cx={size / 2} cy={size / 2} r={r} className="ring-fill"
        strokeDasharray={c} strokeDashoffset={c * (1 - pct)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="48%" textAnchor="middle" className="ring-value">{value}</text>
      <text x="50%" y="66%" textAnchor="middle" className="ring-max">of {max}</text>
    </svg>
  );
}

// ---------- Job list pieces ----------

const AVATAR_HUES = [252, 200, 160, 28, 330, 280, 190, 12, 140, 220];

export function CompanyAvatar({ name, size = 40 }) {
  const label = (name || "?").replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
  let h = 0;
  for (const ch of name || "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = AVATAR_HUES[h % AVATAR_HUES.length];
  return (
    <span className="company-avatar" style={{ "--hue": hue, width: size, height: size, fontSize: size * 0.36 }} aria-hidden="true">
      {label}
    </span>
  );
}

export function MatchPill({ value }) {
  const v = Number(value) || 0;
  const tier = v >= 85 ? "high" : v >= 60 ? "mid" : "low";
  return <span className={`match match-${tier}`} title={`${v}% match with your skills`}>{v}%</span>;
}

export function timeAgo(value) {
  const d = new Date(String(value).slice(0, 10) + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((today - d) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} wk${days >= 14 ? "s" : ""} ago`;
  return `${Math.floor(days / 30)} mo ago`;
}

export function SourceTag({ source }) {
  const s = String(source || "");
  const kind = /careers$/.test(s) ? "company" : /linkedin/i.test(s) ? "linkedin" : /jobspipe/i.test(s) ? "pipe" : "board";
  const label = kind === "company" ? "Company site" : kind === "linkedin" ? "LinkedIn" : s.replace(/^JobsPipe \((.*)\)$/, "$1") || "Web";
  return <span className={`source-tag source-${kind}`}>{label}</span>;
}


// ---------- Theme picker (top bar) ----------
export function ThemePicker({ theme, onChange, accents }) {
  const [open, setOpen] = useState(false);
  const modes = [["light", "sun", "Light"], ["dark", "moon", "Dark"], ["system", "monitor", "System"]];
  const current = modes.find((m) => m[0] === theme.mode) || modes[2];
  return (
    <div className="theme-picker">
      <button className="btn icon-only" aria-label="Appearance" title="Appearance" onClick={() => setOpen(!open)}>
        <Icon name={current[1]} size={17} />
      </button>
      {open && (
        <>
          <div className="popover-backdrop" onClick={() => setOpen(false)} />
          <div className="popover" role="dialog" aria-label="Appearance">
            <span className="mini-label">Appearance</span>
            <div className="seg-control full">
              {modes.map(([m, icon, label]) => (
                <button key={m} className={theme.mode === m ? "active" : ""} onClick={() => onChange({ ...theme, mode: m })}>
                  <Icon name={icon} size={14} /> {label}
                </button>
              ))}
            </div>
            <span className="mini-label top-gap">Layout</span>
            <div className="seg-control full">
              {[["compact", "Compact"], ["comfortable", "Comfortable"]].map(([d, label]) => (
                <button key={d} className={(theme.density || "compact") === d ? "active" : ""} onClick={() => onChange({ ...theme, density: d })}>{label}</button>
              ))}
            </div>
            <span className="mini-label top-gap">Colour theme</span>
            <div className="swatches">
              {Object.entries(accents).map(([key, a]) => (
                <button key={key} className={`swatch-btn ${theme.accent === key ? "active" : ""}`} onClick={() => onChange({ ...theme, accent: key })}
                  title={a.label} aria-label={`${a.label} theme`}>
                  <span style={{ background: `linear-gradient(135deg, ${a.colors[0]}, ${a.colors[1]})` }} />
                  <small>{a.label}</small>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
