"""Tools that let the voice assistant work the app for the user.

Read tools run immediately. Action tools (anything that changes data or sends something) are only *requested* by the
model: the server describes the request to the user and runs it solely after an explicit confirmation (see api.py).
"""
from .config import load_config
from .hr import HRSheet
from .lock import agent_lock
from .sheet import Tracker, first_email

STATUS_ALIASES = {"to review": "Drafted", "review": "Drafted", "drafted": "Drafted", "approved": "Approved",
                  "emailed": "Emailed", "sent": "Emailed", "applied": "Applied", "replied": "Replied",
                  "apply via link": "No Contact", "no contact": "No Contact", "open": "No Contact",
                  "skipped": "Skipped", "hidden": "Skipped", "failed": "Failed"}

_S, _I, _O = "STRING", "INTEGER", "OBJECT"
READ_DECLS = [
    {"name": "list_jobs", "description": "Find jobs in the user's tracker. Use for 'show/find/which jobs…'. Returns the best matches first.",
     "parameters": {"type": _O, "properties": {
         "query": {"type": _S, "description": "Words to match in company, role, location or skills, e.g. 'node bengaluru'"},
         "status": {"type": _S, "description": "to review | approved | emailed | applied | replied | apply via link | skipped | failed"},
         "min_match": {"type": _I, "description": "Minimum match percent"},
         "limit": {"type": _I, "description": "How many to return (default 6)"}}}},
    {"name": "job_details", "description": "Full details of one job by its id (from list_jobs).",
     "parameters": {"type": _O, "properties": {"job_id": {"type": _I}}, "required": ["job_id"]}},
    {"name": "pipeline_summary", "description": "Counts of jobs by status, emails sent today, daily limit, HR contacts ready.",
     "parameters": {"type": _O, "properties": {}}},
    {"name": "list_hr_contacts", "description": "The user's HR outreach list (optionally by status: ready, emailed, replied, paused, failed).",
     "parameters": {"type": _O, "properties": {"status": {"type": _S}}}},
    {"name": "show_job", "description": "Open a job's detail panel on the user's screen.",
     "parameters": {"type": _O, "properties": {"job_id": {"type": _I}}, "required": ["job_id"]}},
]
ACTION_DECLS = [
    {"name": "approve_job_email", "description": "Request approval of the drafted recruiter email for a job (it is sent on the next send). Needs user confirmation.",
     "parameters": {"type": _O, "properties": {"job_id": {"type": _I}}, "required": ["job_id"]}},
    {"name": "send_emails_now", "description": "Request sending all approved job emails, ready HR contacts and due follow-ups now. Needs user confirmation.",
     "parameters": {"type": _O, "properties": {}}},
    {"name": "mark_applied", "description": "Request marking a job as applied (user applied on the company site). Needs user confirmation.",
     "parameters": {"type": _O, "properties": {"job_id": {"type": _I}}, "required": ["job_id"]}},
    {"name": "skip_job", "description": "Request hiding a job the user is not interested in. Needs user confirmation.",
     "parameters": {"type": _O, "properties": {"job_id": {"type": _I}}, "required": ["job_id"]}},
    {"name": "add_hr_contact", "description": "Request adding an HR contact to the outreach list (they get emailed on the next send). Needs user confirmation.",
     "parameters": {"type": _O, "properties": {"name": {"type": _S}, "email": {"type": _S}, "company": {"type": _S},
                                                "role": {"type": _S}}, "required": ["email"]}},
    {"name": "find_jobs_now", "description": "Request a new job search across all sources now (takes a few minutes). Needs user confirmation.",
     "parameters": {"type": _O, "properties": {}}},
]
READ_NAMES = {d["name"] for d in READ_DECLS}
ACTION_NAMES = {d["name"] for d in ACTION_DECLS}


def _jobs() -> dict[int, dict]:
    with agent_lock("jobs"):
        return dict(Tracker(load_config()["sheet_path"]).rows())


def _brief(n: int, r: dict) -> dict:
    return {"job_id": n, "role": r["Role"], "company": r["Company"], "location": r["Location"], "match": r["Match %"],
            "status": r["Status"], "posted": str(r["Posted Date"] or "")[:10], "recruiter_email": r["Recruiter Email"] or None,
            "email_drafted": bool(r["Email Subject"])}


def run_read(name: str, args: dict, ui: list) -> dict:
    if name == "list_jobs":
        status = STATUS_ALIASES.get(str(args.get("status") or "").lower().strip())
        words = str(args.get("query") or "").lower().split()
        min_match = int(args.get("min_match") or 0)
        found = []
        for n, r in _jobs().items():
            if status and r["Status"] != status:
                continue
            if not status and r["Status"] in ("Skipped", "Failed"):
                continue
            text = " ".join(str(r.get(f) or "") for f in ("Company", "Role", "Location", "Tech Stack", "Notes")).lower()
            if any(w not in text for w in words) or int(r["Match %"] or 0) < min_match:
                continue
            found.append((n, r))
        found.sort(key=lambda x: (int(x[1]["Match %"] or 0), str(x[1]["Posted Date"] or "")), reverse=True)
        limit = max(1, min(int(args.get("limit") or 6), 15))
        return {"total": len(found), "jobs": [_brief(n, r) for n, r in found[:limit]]}
    if name in ("job_details", "show_job"):
        row = _jobs().get(int(args.get("job_id") or 0))
        if not row:
            return {"error": "No job with that id"}
        if name == "show_job":
            ui.append({"open_job": int(args["job_id"])})
            return {"ok": True, "shown": f"{row['Role']} at {row['Company']}"}
        jd = str(row.get("Full JD") or row.get("Profile / JD Summary") or "")
        return {**_brief(int(args["job_id"]), row), "salary": row["Budget"], "source": row["Source"], "link": row["Job Link"],
                "notes": row["Notes"], "description": jd[:3500]}
    if name == "pipeline_summary":
        rows = _jobs().values()
        counts = {}
        for r in rows:
            counts[r["Status"]] = counts.get(r["Status"], 0) + 1
        cfg = load_config()
        with agent_lock("hr"):
            hr_rows = list(HRSheet().rows())
        return {"jobs_by_status": counts, "hr_ready": sum(1 for _, r in hr_rows if r["Status"] == "Ready"),
                "daily_email_limit": cfg["email"]["daily_limit"]}
    if name == "list_hr_contacts":
        want = str(args.get("status") or "").strip().capitalize()
        with agent_lock("hr"):
            rows = [r for _, r in HRSheet().rows() if not want or r["Status"] == want]
        return {"total": len(rows), "contacts": [{"name": r["HR Name"], "email": r["HR Email"], "company": r["Company"],
                                                  "status": r["Status"]} for r in rows[:15]]}
    return {"error": f"Unknown tool {name}"}


def describe(name: str, args: dict) -> tuple[str, list[str]]:
    """(one-line summary, detail lines) of a requested action, checked against current data. Raises ValueError if invalid."""
    if name in ("approve_job_email", "mark_applied", "skip_job"):
        job_id = int(args.get("job_id") or 0)
        row = _jobs().get(job_id)
        if not row:
            raise ValueError("I couldn't find that job")
        label = f"{row['Role']} at {row['Company']}"
        if name == "approve_job_email":
            if not row["Recruiter Email"] or not row["Email Subject"]:
                raise ValueError(f"There's no drafted email for {label} to approve")
            if row["Status"] in ("Emailed", "Replied"):
                raise ValueError(f"{label} was already emailed")
            return (f"Approve the email to {first_email(row['Recruiter Email'])} for {label}",
                    [f"Subject: {row['Email Subject']}", "It goes out on the next send (your resume is attached)."])
        if name == "mark_applied":
            return f"Mark {label} as applied", []
        return f"Hide {label} (not interested)", ["You can restore it later from the Skipped tab."]
    if name == "add_hr_contact":
        email = str(args.get("email") or "").strip()
        if "@" not in email:
            raise ValueError("I need a valid email address for the HR contact")
        who = " ".join(x for x in (str(args.get("name") or "").strip(), f"<{email}>") if x)
        company = str(args.get("company") or "").strip()
        return (f"Add HR contact {who}" + (f" at {company}" if company else ""),
                ["They'll be emailed with your template and resume on the next send."])
    if name == "send_emails_now":
        rows = _jobs().values()
        approved = [r for r in rows if r["Status"] == "Approved"]
        cfg = load_config()
        if cfg["email"]["auto_send"]:
            approved += [r for r in rows if r["Status"] == "Drafted"]
        with agent_lock("hr"):
            ready = [r for _, r in HRSheet().rows() if r["Status"] == "Ready"]
        if not approved and not ready:
            raise ValueError("There's nothing approved or ready to send. Approve some emails first.")
        details = [f"• {r['Company']}: {first_email(r['Recruiter Email'])}" for r in approved[:6]]
        details += [f"• HR {r['HR Name'] or ''} {r['HR Email']}".replace("  ", " ") for r in ready[:6]]
        more = len(approved) + len(ready) - len(details)
        if more > 0:
            details.append(f"…and {more} more")
        details.append("Due follow-ups are sent too, within your daily limit. Your resume is attached to each email.")
        return f"Send {len(approved)} job email{'s' if len(approved) != 1 else ''} and {len(ready)} HR email{'s' if len(ready) != 1 else ''} now", details
    if name == "find_jobs_now":
        return "Search all job sources for new jobs now", ["Takes a few minutes and uses some of your free API searches."]
    raise ValueError(f"Unknown action {name}")
