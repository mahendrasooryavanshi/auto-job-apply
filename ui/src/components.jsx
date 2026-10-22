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

export function StatusBadge({ status }) {
  return <span className={`badge badge-${(status || "").replace(/\s/g, "").toLowerCase()}`}>{status}</span>;
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
    <svg width={size} height={size} className="ring" role="img" aria-label={`${value} of ${max}`}>
      <circle cx={size / 2} cy={size / 2} r={r} className="ring-track" />
      <circle cx={size / 2} cy={size / 2} r={r} className="ring-fill"
        strokeDasharray={c} strokeDashoffset={c * (1 - pct)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="48%" textAnchor="middle" className="ring-value">{value}</text>
      <text x="50%" y="66%" textAnchor="middle" className="ring-max">of {max}</text>
    </svg>
  );
}
