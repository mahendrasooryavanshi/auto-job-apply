// Shared job-seeker heuristics for the dashboard.

export function applicantsOf(job) {
  const m = /(over )?(\d+) applicants/i.exec(job.Notes || "");
  return m ? Number(m[2]) + (m[1] ? 100 : 0) : null;
}

export function daysOld(job) {
  const d = new Date(String(job["Posted Date"]).slice(0, 10) + "T00:00:00");
  if (Number.isNaN(d.getTime())) return 7;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((today - d) / 86400000));
}

// What a job seeker weighs: fit, company quality, freshness, competition, a direct recruiter contact
export function rankJob(job) {
  const applicants = applicantsOf(job) ?? 120;
  return (Number(job["Match %"]) || 0)
    + (String(job.Source).endsWith("careers") ? 25 : 0)
    + Math.max(0, 15 - 3 * daysOld(job))
    - Math.min(applicants, 200) / 20
    + (job.Status === "Drafted" ? 15 : 0);
}

export function greeting(date = new Date()) {
  const h = date.getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function nextDailyRun(date = new Date()) {
  const next = new Date(date);
  next.setHours(9, 30, 0, 0);
  if (next <= date) next.setDate(next.getDate() + 1);
  const today = next.toDateString() === date.toDateString();
  return `${today ? "today" : "tomorrow"} at 9:30`;
}

// Only http(s) links may go into an href: a "javascript:" URL from scraped or AI text would run in the dashboard
export function safeUrl(url) {
  try {
    const u = new URL(String(url || "").trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : undefined;
  } catch {
    return undefined;
  }
}
