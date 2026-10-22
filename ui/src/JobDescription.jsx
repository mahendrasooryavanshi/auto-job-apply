// Readable job descriptions. Text scraped from job sites often puts every label and value on its own line
// ("Company:" / "NuSwipe Technology"), so lines are regrouped into fields, headings, bullet lists and paragraphs.

const BULLET = /^\s*(?:[-•*·▪●◦]|\d{1,2}[.)])\s+/;
const isLabel = (l) => /:\s*$/.test(l) && l.length <= 45;
const looksHeading = (l, next) =>
  l.length <= 60 && !/[.,;]$/.test(l) && !BULLET.test(l) && /^[A-Z0-9]/.test(l) &&
  (/^(about|responsibilities|requirements|qualifications|what you|who you|why|benefits|perks|skills|role|job|key|must|nice|preferred|our|the role|your|you will|we offer|experience|education|tech)/i.test(l) || (next && next.length > l.length * 1.6 && l.split(" ").length <= 6));

function parse(text) {
  const lines = String(text || "").replace(/\*\*/g, "").replace(/\r/g, "").split("\n").map((l) => l.trim());
  const blocks = [];
  let para = [];
  let list = null;
  const endPara = () => { if (para.length) blocks.push({ type: "p", text: para.join(" ") }); para = []; };
  const endList = () => { if (list) blocks.push(list); list = null; };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) { endPara(); endList(); continue; }
    const next = lines.slice(i + 1).find(Boolean) || "";
    if (BULLET.test(line)) {
      endPara();
      if (!list) list = { type: "ul", items: [] };
      list.items.push(line.replace(BULLET, ""));
      continue;
    }
    if (isLabel(line) && next && !isLabel(next) && !BULLET.test(next) && next.length <= 140) {
      // "Company:" followed by its value on the next line -> one field row
      endPara(); endList();
      blocks.push({ type: "field", label: line.replace(/:\s*$/, ""), value: next });
      i = lines.indexOf(next, i + 1);
      continue;
    }
    const inlineField = /^([A-Z][A-Za-z /&()-]{1,32}):\s+(.{1,140})$/.exec(line);
    if (inlineField) {
      endPara(); endList();
      blocks.push({ type: "field", label: inlineField[1], value: inlineField[2] });
      continue;
    }
    if (isLabel(line) || looksHeading(line, next)) {
      endPara(); endList();
      blocks.push({ type: "h", text: line.replace(/:\s*$/, "") });
      continue;
    }
    if (list && line.length < 160 && !/[.!?]$/.test(para.join(" "))) {
      // continuation of a wrapped bullet point
      list.items[list.items.length - 1] += ` ${line}`;
      continue;
    }
    endList();
    para.push(line);
    // a sentence that ends here closes the paragraph; otherwise the next line continues it
    if (/[.!?)]$/.test(line) && (next.length < 40 || /^[A-Z]/.test(next))) endPara();
  }
  endPara(); endList();
  return blocks;
}

export default function JobDescription({ text }) {
  const blocks = parse(text);
  const fields = [];
  const out = [];
  const flushFields = (key) => {
    if (fields.length) out.push(<dl key={`f${key}`} className="jd-fields">{fields.splice(0)}</dl>);
  };
  blocks.forEach((b, i) => {
    if (b.type === "field") {
      fields.push(<div key={i}><dt>{b.label}</dt><dd>{b.value}</dd></div>);
      return;
    }
    flushFields(i);
    if (b.type === "h") out.push(<h4 key={i} className="jd-h">{b.text}</h4>);
    else if (b.type === "ul") out.push(<ul key={i} className="jd-list">{b.items.map((t, j) => <li key={j}>{t}</li>)}</ul>);
    else out.push(<p key={i} className="jd-p">{b.text}</p>);
  });
  flushFields("end");
  return <div className="jd-body">{out}</div>;
}
