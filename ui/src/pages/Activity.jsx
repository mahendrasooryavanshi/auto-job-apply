import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { Icon } from "../components.jsx";

const KINDS = {
  search: { icon: "search", tone: "accent" },
  email: { icon: "send", tone: "info" },
  followup: { icon: "reply", tone: "info" },
  reply: { icon: "reply", tone: "ok" },
  bounce: { icon: "alert", tone: "err" },
  problem: { icon: "alert", tone: "err" },
  you: { icon: "profile", tone: "neutral" },
  filter: { icon: "filter", tone: "neutral" },
  schedule: { icon: "clock", tone: "accent" },
};

const FILTERS = [
  ["all", "All", () => true],
  ["emails", "Emails & replies", (k) => ["email", "followup", "reply", "bounce"].includes(k)],
  ["search", "Job searches", (k) => ["search", "filter", "schedule"].includes(k)],
  ["you", "Your actions", (k) => k === "you"],
  ["problems", "Problems", (k) => ["problem", "bounce"].includes(k)],
];

function dayLabel(day) {
  const d = new Date(`${day}T00:00:00`);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - d) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
}

function timeLabel(ts) {
  return new Date(ts.replace(" ", "T")).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export default function Activity({ onOpen }) {
  const [items, setItems] = useState(null);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    const load = () => api.activity().then((d) => setItems(d.items)).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const groups = useMemo(() => {
    const test = FILTERS.find(([id]) => id === filter)[2];
    const out = [];
    for (const item of (items || []).filter((i) => test(i.kind))) {
      const day = item.time.slice(0, 10);
      if (!out.length || out[out.length - 1].day !== day) out.push({ day, items: [] });
      out[out.length - 1].items.push(item);
    }
    return out;
  }, [items, filter]);

  const problemCount = (items || []).filter((i) => ["problem", "bounce"].includes(i.kind)).length;

  return (
    <div className="page">
      <div className="chips">
        {FILTERS.map(([id, label]) => (
          <button key={id} className={`chip ${filter === id ? "active" : ""}`} onClick={() => setFilter(id)}>
            {label}
            {id === "problems" && problemCount > 0 && <span>{problemCount}</span>}
          </button>
        ))}
      </div>

      <section className="card">
        {items === null ? <p className="empty">Loading…</p> : groups.length === 0 ? (
          <p className="empty">
            {items.length === 0 ? "Nothing yet. Every search, email, reply and change you make will show up here." : "Nothing in this category yet."}
          </p>
        ) : (
          groups.map((g) => (
            <div key={g.day} className="feed-day">
              <h3 className="feed-day-label">{dayLabel(g.day)}</h3>
              <ul className="feed">
                {g.items.map((item, i) => {
                  const kind = KINDS[item.kind] || KINDS.you;
                  const clickable = Boolean(item.job_id);
                  return (
                    <li key={`${item.time}-${i}`} className={clickable ? "clickable" : ""}
                      onClick={clickable ? () => onOpen(item.job_id) : undefined}>
                      <span className={`feed-icon tone-${kind.tone}`}><Icon name={kind.icon} size={16} /></span>
                      <span className="feed-body">
                        <strong>{item.title}</strong>
                        {item.detail && <small>{item.detail}</small>}
                      </span>
                      <span className="feed-time">{timeLabel(item.time)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
