// Small, safe Markdown renderer for assistant replies: builds React elements (never raw HTML).
import { Fragment } from "react";
import { safeUrl } from "./utils.js";

const INLINE = /(\*\*(?:[^*]|\*(?!\*))+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s)]+|\*[^*\s][^*]*\*)/g;

function inline(text, key = "") {
  return text.split(INLINE).filter(Boolean).map((part, i) => {
    const k = `${key}-${i}`;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={k}>{inline(part.slice(2, -2), k)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={k}>{part.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(part);
    if (link) return <a key={k} href={safeUrl(link[2])} target="_blank" rel="noreferrer">{link[1]}</a>;
    if (/^https?:\/\//.test(part)) return <a key={k} href={safeUrl(part)} target="_blank" rel="noreferrer">{part.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60)}</a>;
    if (/^\*[^*].*\*$/.test(part)) return <em key={k}>{part.slice(1, -1)}</em>;
    return <Fragment key={k}>{part}</Fragment>;
  });
}

export default function Markdown({ text }) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const out = [];
  let list = null;
  const flush = () => {
    if (list) out.push(list.ordered ? <ol key={out.length}>{list.items}</ol> : <ul key={out.length}>{list.items}</ul>);
    list = null;
  };
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] }; }
      list.items.push(<li key={i}>{inline((bullet || numbered)[1], i)}</li>);
      return;
    }
    flush();
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) out.push(<p key={i} className={`md-h md-h${heading[1].length}`}>{inline(heading[2], i)}</p>);
    else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) out.push(<hr key={i} />);
    else if (line.startsWith(">")) out.push(<blockquote key={i}>{inline(line.replace(/^>\s?/, ""), i)}</blockquote>);
    else if (line.trim()) out.push(<p key={i}>{inline(line, i)}</p>);
  });
  flush();
  return <div className="md">{out}</div>;
}
