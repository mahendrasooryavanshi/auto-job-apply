"""HTTP API behind the React dashboard. Start with: python -m jobagent ui"""
import base64
import json
import logging
import secrets
import threading
import time
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import quote

import requests
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .__main__ import cmd_find, cmd_recheck, cmd_send
from .config import ROOT, load_config
from .finder import has_job_source
from .lock import Busy, agent_lock
from . import agent_tools, assistant, hr, linkedin_account, linkedin_import, profile, settings, voice
from .activity import external_run, friendly_error, get_progress, record, recent, set_progress
from .sheet import Tracker

log = logging.getLogger("jobagent")
app = FastAPI(title="Job Agent")

LOCAL_HOSTS = {"localhost", "127.0.0.1", "[::1]"}
CSRF_HEADER = "x-job-agent"   # sent by the dashboard on every change; other websites can't add it without a CORS grant


def _hostname(value: str) -> str:
    value = value.strip().lower()
    if value.startswith("["):
        return value.split("]")[0] + "]"
    return value.split(":")[0]


@app.middleware("http")
async def local_dashboard_only(request: Request, call_next):
    """Only this computer's dashboard may use the API.

    - Host check: blocks DNS-rebinding (a website pointing its own name at 127.0.0.1 to read your data).
    - Origin check + custom header on every change: blocks other websites you visit from adding HR contacts,
      changing settings or pressing Send behind your back (cross-site request forgery).
    """
    if _hostname(request.headers.get("host", "")) not in LOCAL_HOSTS:
        return JSONResponse({"detail": "Forbidden"}, status_code=403)
    origin = request.headers.get("origin")
    if origin and origin != "null" and _hostname(origin.split("://")[-1]) not in LOCAL_HOSTS:
        return JSONResponse({"detail": "Forbidden"}, status_code=403)
    if request.method not in ("GET", "HEAD") and request.url.path.startswith("/api/") \
            and request.headers.get(CSRF_HEADER) != "1":
        return JSONResponse({"detail": "Forbidden"}, status_code=403)
    response = await call_next(request)
    if not request.url.path.startswith(("/api/", "/assets/")):
        response.headers["Cache-Control"] = "no-cache"   # always load the newest dashboard after an update
    return response

# Statuses a person may set from the UI; Emailed/Failed/No Contact are set by the agent.
USER_STATUSES = {"Drafted", "Approved", "Skipped", "Applied"}   # Applied: the user applied on the job's own site
EDITABLE = {"subject": "Email Subject", "body": "Email Body", "notes": "Notes", "recruiter_email": "Recruiter Email"}

_action = {"name": None, "started": None, "finished": None, "error": None, "result": None}
_action_lock = threading.Lock()


def _tracker() -> Tracker:
    return Tracker(load_config()["sheet_path"])


def _current_action() -> dict:
    if _action["name"]:
        return {**_action, "progress": get_progress()}
    ext = external_run()
    if ext:   # e.g. the 9:30 daily run, started by the scheduler rather than the dashboard
        return {**_action, "name": ext["name"], "started": ext["started"], "external": True, "progress": get_progress()}
    return {**_action, "progress": ""}


@app.get("/api/summary")
def summary():
    cfg = load_config()
    tracker, hr_sheet = Tracker(cfg["sheet_path"]), hr.HRSheet()
    env = cfg["env"]
    return {
        "counts": Counter(r["Status"] for _, r in tracker.rows()),
        "sent_today": tracker.sent_today() + hr_sheet.sent_today(),
        "hr_ready": sum(1 for _ in hr_sheet.rows("Ready")),
        "daily_limit": cfg["email"]["daily_limit"],
        "auto_send": cfg["email"]["auto_send"],
        "action": _current_action(),
        "setup": {
            "Gmail address": bool(env["GMAIL_ADDRESS"]),
            "Gmail App Password": bool(env["GMAIL_APP_PASSWORD"]),
            "AI key (Claude or Gemini)": bool(env["ANTHROPIC_API_KEY"] or env["GEMINI_API_KEY"]),
            "Job source key": has_job_source(env, cfg["search"]),
            "Resume file": Path(cfg["candidate"]["resume_path"]).exists(),
        },
    }


@app.get("/api/jobs")
def jobs():
    return [{"id": row_num, **{k: ("" if v is None else v) for k, v in row.items()}}
            for row_num, row in _tracker().rows()]


def _encode_cursor(key: list) -> str:
    return base64.urlsafe_b64encode(json.dumps({"after": key}).encode()).decode().rstrip("=")


def _decode_cursor(cursor: str) -> list | None:
    if not cursor:
        return None
    try:
        key = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)))["after"]
        if not isinstance(key, list) or len(key) != 2:
            raise ValueError
        return key
    except (ValueError, KeyError, TypeError):
        raise HTTPException(400, "Invalid page cursor; reload the list")


SEARCH_FIELDS = ("Company", "Role", "Location", "Tech Stack", "Source", "Recruiter Email", "Notes")
SORTS = {   # every sort ends with the row id, so the order is total and a cursor can resume exactly
    "newest": lambda n, r: [0, n],
    "match": lambda n, r: [int(r.get("Match %") or 0), n],
    "posted": lambda n, r: [str(r.get("Posted Date") or "")[:10], n],
}


def _source_kind(source: str) -> str:
    s = str(source or "")
    return "company" if s.endswith("careers") else "linkedin" if "linkedin" in s.lower() else "boards"


@app.get("/api/jobs/page")
def jobs_page(status: str = "All", q: str = "", limit: int = 25, cursor: str = "", sort: str = "newest",
              source: str = "all", min_match: int = 0, max_age_days: int = 0, has_email: bool = False):
    """Jobs one page at a time, filtered and sorted on the server. The cursor holds the last row's sort key,
    so "Older" resumes right after it: no repeats or gaps when new jobs arrive (unlike page numbers)."""
    limit = max(5, min(limit, 100))
    key_of = SORTS.get(sort, SORTS["newest"])
    words = q.lower().split()
    oldest = (datetime.now().date() - timedelta(days=max_age_days)).isoformat() if max_age_days > 0 else ""
    matches = []
    for row_num, row in _tracker().rows():
        if status != "All" and row["Status"] != status:
            continue
        if source != "all" and _source_kind(row["Source"]) != source:
            continue
        if min_match and int(row.get("Match %") or 0) < min_match:
            continue
        if oldest and str(row.get("Posted Date") or "")[:10] < oldest:
            continue
        if has_email and not row.get("Recruiter Email"):
            continue
        if words:
            text = " ".join(str(row.get(f) or "") for f in SEARCH_FIELDS).lower()
            if not all(w in text for w in words):
                continue
        matches.append((key_of(row_num, row), row_num, row))
    matches.sort(key=lambda m: m[0], reverse=True)
    after = _decode_cursor(cursor)
    rest = [m for m in matches if after is None or m[0] < after]
    page = rest[:limit]
    return {
        "items": [{"id": n, **{k: ("" if v is None else v) for k, v in r.items()}} for _, n, r in page],
        "next_cursor": _encode_cursor(page[-1][0]) if len(rest) > limit else None,
        "total": len(matches),
        "start": len(matches) - len(rest),   # how many matching jobs come before this page
    }


@app.get("/api/version")
def version():
    """Which dashboard build is being served; open tabs compare it to offer a reload after updates."""
    index = ROOT / "ui" / "dist" / "index.html"
    return {"build": str(int(index.stat().st_mtime)) if index.exists() else "dev"}


class JobUpdate(BaseModel):
    status: str | None = None
    subject: str | None = None
    body: str | None = None
    notes: str | None = None
    recruiter_email: str | None = None


def _apply_update(tracker: Tracker, row_num: int, upd: JobUpdate) -> dict:
    rows = dict(tracker.rows())
    if row_num not in rows:
        raise HTTPException(404, "Job not found")
    if rows[row_num]["Status"] == "Emailed":
        raise HTTPException(400, "This job was already emailed and can't be changed")
    fields = {col: getattr(upd, key) for key, col in EDITABLE.items() if getattr(upd, key) is not None}
    if upd.status is not None:
        if upd.status not in USER_STATUSES:
            raise HTTPException(400, f"Status must be one of {sorted(USER_STATUSES)}")
        if upd.status == "Applied":
            fields["Notes"] = " · ".join(x for x in (rows[row_num].get("Notes") or "", f"Applied on site {datetime.now():%Y-%m-%d}") if x)
        if upd.status == "Approved" and not (fields.get("Recruiter Email") or rows[row_num]["Recruiter Email"]):
            raise HTTPException(400, "Add a recruiter email before approving")
        fields["Status"] = upd.status
    tracker.update(row_num, **fields)
    return rows[row_num]


VERB = {"Approved": "approved", "Skipped": "skipped", "Drafted": "moved back to drafts", "Applied": "applied to"}


def _job_name(row: dict) -> str:
    who = row["Company"] if row.get("Source") != "LinkedIn post" else "a LinkedIn post"
    return f"{row['Role']} at {who}"


@app.patch("/api/jobs/{row_num}")
def update_job(row_num: int, upd: JobUpdate):
    try:
        with agent_lock("jobs", wait=5):
            tracker = _tracker()
            row = _apply_update(tracker, row_num, upd)
            tracker.save()
    except Busy as e:
        raise HTTPException(409, str(e))
    if upd.status in VERB:
        what = "the email for" if upd.status == "Approved" else ""
        record("you", f"You {VERB[upd.status]} {what} {_job_name(row)}".replace("  ", " "),
               "It will be sent on the next send" if upd.status == "Approved" else "", row_num)
    elif upd.subject is not None or upd.body is not None:
        record("you", f"You edited the email for {_job_name(row)}", "", row_num)
    return {"ok": True}


class BulkStatus(BaseModel):
    ids: list[int]
    status: str


@app.post("/api/jobs/bulk-status")
def bulk_status(req: BulkStatus):
    try:
        with agent_lock("jobs", wait=5):
            tracker = _tracker()
            skipped = []
            for row_num in req.ids:
                try:
                    _apply_update(tracker, row_num, JobUpdate(status=req.status))
                except HTTPException as e:
                    skipped.append({"id": row_num, "reason": e.detail})
            tracker.save()
    except Busy as e:
        raise HTTPException(409, str(e))
    updated = len(req.ids) - len(skipped)
    if updated and req.status in VERB:
        record("you", f"You {VERB[req.status]} {updated} job{'s' if updated != 1 else ''}",
               "Approved emails go out on the next send" if req.status == "Approved" else "")
    return {"updated": updated, "skipped": skipped}


def _run(name: str, fn) -> None:
    try:
        _action["result"] = fn(load_config())
    except Exception as e:
        log.exception("%s failed", name)
        _action["error"] = friendly_error(e)
        label = {"find": "Job search", "send": "Sending emails", "recheck": "Re-check", "linkedin_import": "LinkedIn import"}.get(name, name)
        record("problem", f"{label} didn't finish", _action["error"])
    finally:
        set_progress("")
        _action["finished"] = datetime.now().isoformat(timespec="seconds")
        _action["name"] = None


@app.post("/api/actions/{name}")
def start_action(name: str):
    fn = {"find": cmd_find, "send": cmd_send, "recheck": cmd_recheck, "linkedin_import": linkedin_import.run_import}.get(name)
    if not fn:
        raise HTTPException(404, "Unknown action")
    with _action_lock:
        if _action["name"] or external_run():
            raise HTTPException(409, "The agent is already running (maybe the daily run). Try again when it finishes.")
        _action.update(name=name, started=datetime.now().isoformat(timespec="seconds"), finished=None, error=None, result=None)
    threading.Thread(target=_run, args=(name, fn), daemon=True).start()
    return _action


# ---------- HR outreach list ----------

def _hr_row(row_num: int, row: dict, cfg: dict) -> dict:
    subject, body = hr.render(row, cfg)
    return {"id": row_num, **row, "preview_subject": subject, "preview_body": body}


@app.get("/api/hr")
def hr_list():
    cfg = load_config()
    e = cfg["email"]
    resume = Path(cfg["candidate"]["resume_path"])
    return {
        "rows": [_hr_row(n, r, cfg) for n, r in hr.HRSheet().rows()],
        "template": {"subject": e.get("hr_subject") or hr.DEFAULT_SUBJECT, "body": e.get("hr_body") or hr.DEFAULT_BODY},
        "placeholders": hr.PLACEHOLDERS,
        "sample_values": hr.values_for({"HR Name": "Priya Sharma", "Company": "Acme Technologies"}, cfg),
        "signature": hr.signature(cfg),
        "resume": resume.name if resume.exists() else None,
        "file": {"path": str(hr.HR_PATH), "open": hr.open_in_spreadsheet(),
                 "modified": datetime.fromtimestamp(hr.HR_PATH.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S")
                 if hr.HR_PATH.exists() else None},
    }


class HRContact(BaseModel):
    name: str = ""
    email: str
    company: str = ""
    role: str = ""
    notes: str = ""


@app.post("/api/hr")
def hr_add(contacts: list[HRContact]):
    added, problems = 0, []
    try:
        with agent_lock("hr", wait=5):
            sheet = hr.HRSheet()
            for c in contacts:
                try:
                    sheet.add(c.name, c.email, c.company, c.role, c.notes)
                    added += 1
                except ValueError as e:
                    problems.append(str(e))
            sheet.save()
    except (Busy, hr.SheetOpen) as e:
        raise HTTPException(409, str(e))
    if added:
        record("you", f"You added {added} HR contact{'s' if added != 1 else ''}", "They'll be emailed on the next send")
    return {"added": added, "problems": problems}


@app.post("/api/hr/import")
async def hr_import(request: Request, filename: str):
    try:
        contacts = hr.parse_contacts(filename, await request.body())
    except Exception as e:
        raise HTTPException(400, f"Couldn't read that file: {e}")
    if not contacts:
        raise HTTPException(400, "No email addresses found. Use columns: HR Name, HR Email, Company, Role")
    return hr_add([HRContact(**c) for c in contacts])


class HRUpdate(BaseModel):
    expect_email: str | None = None   # the row's email as the UI saw it; guards against rows moved in Excel
    name: str | None = None
    email: str | None = None
    company: str | None = None
    role: str | None = None
    notes: str | None = None
    status: str | None = None


@app.patch("/api/hr/{row_num}")
def hr_update(row_num: int, upd: HRUpdate):
    fields = {col: getattr(upd, key) for key, col in
              (("name", "HR Name"), ("email", "HR Email"), ("company", "Company"), ("role", "Role"), ("notes", "Notes"))
              if getattr(upd, key) is not None}
    if upd.email is not None and not hr.EMAIL_RE.match(upd.email.strip()):
        raise HTTPException(400, f"“{upd.email}” isn't a valid email address")
    if upd.status is not None:
        if upd.status not in ("Ready", "Paused"):
            raise HTTPException(400, "Status can be Ready or Paused")
        fields["Status"] = upd.status
    try:
        with agent_lock("hr", wait=5):
            sheet = hr.HRSheet()
            row = sheet.check(row_num, upd.expect_email)
            if row["Status"] in ("Emailed", "Replied") and set(fields) - {"Notes"}:
                raise HTTPException(400, "This person was already emailed; only notes can be changed")
            if upd.email is not None and upd.email.strip().lower() != row["HR Email"].lower() \
                    and upd.email.strip().lower() in sheet.emails():
                raise HTTPException(400, f"{upd.email.strip()} is already in your HR list")
            sheet.update(row_num, **fields)
            sheet.save()
    except (Busy, hr.SheetOpen, LookupError) as e:
        raise HTTPException(409, str(e))
    return {"ok": True}


class HRBulk(BaseModel):
    ids: list[int]
    emails: list[str] | None = None   # same order as ids; guards against rows moved in Excel
    action: str   # pause | resume | delete


@app.post("/api/hr/bulk")
def hr_bulk(req: HRBulk):
    if req.action not in ("pause", "resume", "delete"):
        raise HTTPException(400, "Unknown action")
    changed = 0
    try:
        with agent_lock("hr", wait=5):
            sheet = hr.HRSheet()
            for i, row_num in enumerate(req.ids):
                sheet.check(row_num, req.emails[i] if req.emails else None)
            rows = dict(sheet.rows())
            # Highest rows first, so deleting one doesn't shift the row numbers of the others
            for row_num in sorted(set(req.ids) & set(rows), reverse=True):
                status = rows[row_num]["Status"]
                if req.action == "delete":
                    sheet.delete(row_num)
                elif status in ("Ready", "Paused", "Failed", "Check email"):
                    sheet.update(row_num, Status="Paused" if req.action == "pause" else "Ready")
                else:
                    continue
                changed += 1
            sheet.save()
    except (Busy, hr.SheetOpen, LookupError) as e:
        raise HTTPException(409, str(e))
    verb = {"pause": "paused", "resume": "resumed", "delete": "removed"}[req.action]
    if changed:
        record("you", f"You {verb} {changed} HR contact{'s' if changed != 1 else ''}", "")
    return {"changed": changed}


@app.delete("/api/hr/{row_num}")
def hr_delete(row_num: int):
    try:
        with agent_lock("hr", wait=5):
            sheet = hr.HRSheet()
            if row_num not in dict(sheet.rows()):
                raise HTTPException(404, "Contact not found")
            sheet.delete(row_num)
            sheet.save()
    except (Busy, hr.SheetOpen) as e:
        raise HTTPException(409, str(e))
    return {"ok": True}


class HRTemplate(BaseModel):
    subject: str
    body: str


@app.put("/api/hr/template")
def hr_template(t: HRTemplate):
    try:
        hr.validate_template(t.subject, t.body)
    except hr.TemplateError as e:
        raise HTTPException(400, str(e))
    if not t.subject.strip() or not t.body.strip():
        raise HTTPException(400, "Subject and message can't be empty")
    settings.update_email_template(t.subject.strip(), t.body.strip())
    record("you", "You updated your HR email template", "")
    return hr_list()


@app.post("/api/hr/open")
def hr_open():
    import subprocess
    if not hr.HR_PATH.exists():
        hr.HRSheet().save()
    try:
        subprocess.Popen(["xdg-open", str(hr.HR_PATH)], start_new_session=True,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError as e:
        raise HTTPException(500, f"Couldn't open the file: {e}")
    return {"ok": True, "path": str(hr.HR_PATH)}


@app.get("/api/hr/download")
def hr_download():
    from fastapi.responses import FileResponse
    if not hr.HR_PATH.exists():
        hr.HRSheet().save()
    return FileResponse(hr.HR_PATH, filename="hr_contacts.xlsx")


# ---------- LinkedIn account (official OAuth: sign in + posting) ----------

@app.get("/api/linkedin")
def linkedin_status():
    return {**linkedin_account.status(load_config()["env"]), "posts": linkedin_account.history()[:20],
            "kinds": list(linkedin_account.POST_KINDS), "saved_posts": linkedin_import.saved_posts()}


class SavedItems(BaseModel):
    jobs: list[str] = []
    posts: list[dict] = []


@app.post("/api/linkedin/saved")
def linkedin_saved(req: SavedItems):
    """Saved jobs/posts read by the "Send to Job Agent" bookmark on the user's own LinkedIn page."""
    data = linkedin_import.queue_from_browser(req.jobs[:500], req.posts[:300])
    if not (data["jobs"] or data["posts"]):
        raise HTTPException(400, "No saved jobs or posts were found on that LinkedIn page")
    start_action("linkedin_import")
    return {"saved_jobs": len(data["jobs"]), "posts": len(data["posts"])}


@app.post("/api/linkedin/import")
async def linkedin_import_upload(request: Request, filename: str):
    content = await request.body()
    if not content:
        raise HTTPException(400, "The file is empty")
    if len(content) > 200 * 1024 * 1024:
        raise HTTPException(400, "That file is too large (max 200 MB)")
    try:
        found = linkedin_import.parse_export(filename, content)
    except Exception as e:
        raise HTTPException(400, f"Couldn't read that file. Upload the .zip LinkedIn emailed you, or a CSV from it. ({e})")
    if not (found["jobs"] or found["posts"]):
        raise HTTPException(400, "No LinkedIn job or post links found in that file. Use the export that includes "
                                 "“Jobs” (Saved jobs / Job applications).")
    linkedin_import.EXPORT_PATH.write_bytes(content)
    linkedin_import.META_PATH.write_text(filename)
    start_action("linkedin_import")
    saved = sum(1 for j in found["jobs"].values() if j["kind"] != "applied")
    return {"saved_jobs": saved, "applied_jobs": len(found["jobs"]) - saved, "posts": len(found["posts"]), "files": found["files"]}


@app.get("/api/linkedin/connect")
def linkedin_connect():
    from fastapi.responses import RedirectResponse
    try:
        return RedirectResponse(linkedin_account.auth_url(load_config()["env"]))
    except linkedin_account.LinkedInError as e:
        return RedirectResponse(f"/#/linkedin?error={quote(str(e))}")


@app.get("/api/linkedin/callback")
def linkedin_callback(code: str = "", state: str = "", error: str = "", error_description: str = ""):
    from fastapi.responses import RedirectResponse
    if error:
        msg = linkedin_account.explain_error(error, error_description)
        record("problem", "LinkedIn connection didn't finish", msg)
        return RedirectResponse(f"/#/linkedin?error={quote(msg)}")
    try:
        info = linkedin_account.finish_connect(load_config()["env"], code, state)
    except (linkedin_account.LinkedInError, requests.RequestException) as e:
        return RedirectResponse(f"/#/linkedin?error={quote(str(e))}")
    record("you", f"You connected LinkedIn as {info['name']}", "The app can post for you when you press Post")
    return RedirectResponse("/#/linkedin?connected=1")


@app.post("/api/linkedin/disconnect")
def linkedin_disconnect():
    linkedin_account.disconnect()
    record("you", "You disconnected LinkedIn", "")
    return linkedin_status()


class PostDraft(BaseModel):
    kind: str = "custom"
    topic: str = ""


@app.post("/api/linkedin/draft")
def linkedin_draft(req: PostDraft):
    try:
        return {"text": linkedin_account.draft(load_config(), req.kind, req.topic)}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(502, friendly_error(e))


class PostText(BaseModel):
    text: str


@app.post("/api/linkedin/post")
def linkedin_post(req: PostText):
    try:
        entry = linkedin_account.publish(req.text)
    except linkedin_account.LinkedInError as e:
        raise HTTPException(400, str(e))
    except requests.RequestException as e:
        raise HTTPException(502, friendly_error(e))
    record("you", "You posted on LinkedIn", req.text.strip().splitlines()[0][:90])
    return {"post": entry, **linkedin_status()}


# ---------- AI career assistant ----------

class ChatRequest(BaseModel):
    messages: list[dict]
    job_id: int | None = None
    mode: str = "chat"   # chat | mock | voice | agent
    language: str = "en"  # voice assistant replies: en | hinglish | hi


@app.post("/api/assistant/chat")
def assistant_chat(req: ChatRequest):
    cfg = load_config()
    job = None
    if req.job_id:
        rows = dict(Tracker(cfg["sheet_path"]).rows())
        if req.job_id in rows:
            job = {k: ("" if v is None else v) for k, v in rows[req.job_id].items()}
    msgs = [{"role": m.get("role"), "content": str(m.get("content", ""))[:8000],
             "attachments": [str(a) for a in (m.get("attachments") or [])][:6]}
            for m in req.messages if m.get("role") in ("user", "assistant")]
    if not msgs or msgs[-1]["role"] != "user":
        raise HTTPException(400, "Send a message to the assistant")
    try:
        result = assistant.chat(cfg, msgs, job, req.mode if req.mode in ("mock", "voice", "agent") else "chat", req.language)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        log.exception("Assistant failed")
        raise HTTPException(502, friendly_error(e))
    pending = result.pop("pending_action", None)
    if pending:
        # The model only *asked* for an action: describe it and wait for the user's explicit confirmation
        try:
            summary, details = agent_tools.describe(pending["tool"], pending["args"])
        except (ValueError, TypeError) as e:
            result["reply"] = f"{result.get('reply') or ''} {str(e).rstrip('.')}.".strip()
            return result
        action_id = secrets.token_urlsafe(12)
        _pending_actions[action_id] = {**pending, "summary": summary, "expires": time.time() + 600}
        result["pending_action"] = {"id": action_id, "summary": summary, "details": details}
        result["reply"] = ASK_CONFIRM.get(req.language, ASK_CONFIRM["en"]).format(summary)
    return result


_pending_actions: dict[str, dict] = {}

ASK_CONFIRM = {"en": "I'm about to: {}. Shall I go ahead?",
               "hinglish": "Ye karna hai: {}. Kar doon? Haan ya na boliye.",
               "hi": "यह करना है: {}. कर दूँ? हाँ या ना बोलिए।"}
DONE_MESSAGES = {   # spoken after a confirmed action, per reply language
    "Approved": {"en": "Approved. It goes out on the next send.", "hinglish": "Approve ho gaya. Agle send mein chala jayega.",
                 "hi": "Approve हो गया। अगले send में चला जाएगा।"},
    "Applied": {"en": "Marked as applied.", "hinglish": "Applied mark kar diya.", "hi": "Applied mark कर दिया।"},
    "Skipped": {"en": "Done, it's hidden.", "hinglish": "Ho gaya, job hide kar di.", "hi": "हो गया, job hide कर दी।"},
    "hr": {"en": "Added to your HR list. They'll be emailed on the next send.",
           "hinglish": "HR list mein add kar diya. Agle send mein email chala jayega.",
           "hi": "HR list में add कर दिया। अगले send में email चला जाएगा।"},
    "send": {"en": "Sending now. I'll space the emails out; you can watch progress at the top.",
             "hinglish": "Emails bhejna shuru kar diya. Progress upar dikh raha hai.",
             "hi": "Emails भेजना शुरू कर दिया। Progress ऊपर दिख रहा है।"},
    "find": {"en": "Searching for new jobs now. This takes a few minutes.",
             "hinglish": "Nayi jobs dhoondh raha hoon, kuch minute lagenge.", "hi": "नई jobs ढूँढना शुरू, कुछ मिनट लगेंगे।"},
    "cancel": {"en": "Cancelled. Nothing was changed.", "hinglish": "Cancel kar diya, kuch change nahi hua.",
               "hi": "Cancel कर दिया, कुछ नहीं बदला।"},
}


class ConfirmRequest(BaseModel):
    id: str
    approve: bool
    language: str = "en"


@app.post("/api/assistant/confirm")
def assistant_confirm(req: ConfirmRequest):
    """Run (or drop) an action the assistant requested, exactly as it was shown to the user."""
    action = _pending_actions.pop(req.id, None)
    if not action or action["expires"] < time.time():
        raise HTTPException(410, "That request expired. Ask again.")
    def say(what: str) -> str:
        return DONE_MESSAGES[what].get(req.language, DONE_MESSAGES[what]["en"])

    if not req.approve:
        record("you", "You cancelled an assistant action", action["summary"])
        return {"done": False, "message": say("cancel")}
    tool, args = action["tool"], action["args"]
    if tool in ("approve_job_email", "mark_applied", "skip_job"):
        status = {"approve_job_email": "Approved", "mark_applied": "Applied", "skip_job": "Skipped"}[tool]
        update_job(int(args["job_id"]), JobUpdate(status=status))
        message = say(status)
    elif tool == "add_hr_contact":
        res = hr_add([HRContact(name=str(args.get("name") or ""), email=str(args["email"]),
                                company=str(args.get("company") or ""), role=str(args.get("role") or ""))])
        if not res["added"]:
            raise HTTPException(400, res["problems"][0] if res["problems"] else "Couldn't add that contact")
        message = say("hr")
    elif tool in ("send_emails_now", "find_jobs_now"):
        start_action("send" if tool == "send_emails_now" else "find")
        message = say("send" if tool == "send_emails_now" else "find")
    else:
        raise HTTPException(400, "Unknown action")
    record("you", f"You confirmed: {action['summary']}", "via the voice assistant")
    return {"done": True, "message": message}


@app.post("/api/assistant/upload")
async def assistant_upload(request: Request, filename: str):
    data = await request.body()
    try:
        return assistant.save_upload(filename, data)
    except assistant.UploadError as e:
        raise HTTPException(400, str(e))


@app.get("/api/assistant/upload/{file_id}")
def assistant_file(file_id: str):
    from fastapi.responses import Response
    try:
        meta, data = assistant.load_upload(file_id)
    except assistant.UploadError as e:
        raise HTTPException(404, str(e))
    return Response(data, media_type=meta["type"] if meta["ext"] in assistant.MEDIA_TYPES else "application/octet-stream",
                    headers={"Content-Disposition": f'inline; filename="{meta["name"]}"', "X-Content-Type-Options": "nosniff"})


class SpeakRequest(BaseModel):
    text: str
    voice: str = "Sulafat"
    indian_accent: bool = True
    persona: str = "interviewer"   # interviewer | assistant


@app.get("/api/assistant/voices")
def assistant_voices():
    return {"voices": voice.VOICES}


@app.post("/api/assistant/speak")
def assistant_speak(req: SpeakRequest):
    from fastapi.responses import Response
    key = load_config()["env"]["GEMINI_API_KEY"]
    if not key:
        raise HTTPException(400, "Natural voice needs a Gemini key")
    try:
        return Response(voice.speak(key, req.text, req.voice, req.indian_accent, req.persona), media_type="audio/wav")
    except voice.VoiceError as e:
        raise HTTPException(429, str(e))
    except requests.RequestException as e:
        raise HTTPException(502, friendly_error(e))


@app.post("/api/assistant/speak-stream")
def assistant_speak_stream(req: SpeakRequest):
    """Raw 16-bit mono PCM as it is generated, so the browser can start playing within about a second and a half."""
    from fastapi.responses import StreamingResponse
    key = load_config()["env"]["GEMINI_API_KEY"]
    if not key:
        raise HTTPException(400, "Natural voice needs a Gemini key")
    try:
        rate, chunks = voice.stream(key, req.text, req.voice, req.indian_accent, req.persona)
    except voice.VoiceError as e:
        raise HTTPException(429, str(e))
    except requests.RequestException as e:
        raise HTTPException(502, friendly_error(e))
    return StreamingResponse(chunks, media_type="application/octet-stream",
                             headers={"X-Sample-Rate": str(rate), "Cache-Control": "no-store"})


@app.get("/api/activity")
def activity(limit: int = 300):
    return {"items": recent(limit)}


@app.get("/api/logs")
def logs(lines: int = 200):
    path = ROOT / "logs" / "agent.log"
    if not path.exists():
        return {"lines": []}
    return {"lines": path.read_text(errors="replace").splitlines()[-lines:]}


class SettingsUpdate(BaseModel):
    candidate: dict | None = None
    search: dict | None = None
    email: dict | None = None
    secrets: dict[str, str] | None = None   # only non-empty values are saved


@app.get("/api/settings")
def get_settings():
    return settings.get_settings()


@app.put("/api/settings")
def put_settings(req: SettingsUpdate):
    try:
        if req.candidate or req.search or req.email:
            settings.update_config(req.model_dump(include={"candidate", "search", "email"}))
            record("you", "You updated your settings",
                   ", ".join(n for n, v in (("profile", req.candidate), ("search", req.search), ("email", req.email)) if v))
        if req.secrets and any((v or "").strip() for v in req.secrets.values()):
            settings.update_env(req.secrets)
            record("you", "You updated your account keys", "Saved securely on this computer")
    except settings.SettingsError as e:
        raise HTTPException(400, str(e))
    return settings.get_settings()


@app.delete("/api/settings/secrets/{key}")
def clear_secret(key: str):
    settings.clear_env(key)
    return settings.get_settings()


@app.post("/api/settings/resume")
async def upload_resume(request: Request, filename: str):
    try:
        name = settings.save_resume(filename, await request.body())
    except settings.SettingsError as e:
        raise HTTPException(400, str(e))
    record("you", "You uploaded a new resume", f"{name} will be attached to every email")
    return {"name": name}


@app.post("/api/settings/test-gmail")
def test_gmail():
    try:
        return {"message": settings.test_gmail()}
    except settings.SettingsError as e:
        raise HTTPException(400, str(e))


class ProfileRequest(BaseModel):
    linkedin_headline: str = ""
    linkedin_about: str = ""
    naukri_headline: str = ""
    naukri_summary: str = ""
    naukri_skills: str = ""


@app.get("/api/profile")
def get_profile():
    return {"result": profile.last_result(), "linkedin_pdf": profile.linkedin_pdf_info()}


@app.post("/api/profile/linkedin-pdf")
async def upload_linkedin_pdf(request: Request):
    try:
        profile.save_linkedin_pdf(await request.body())
    except ValueError as e:
        raise HTTPException(400, str(e))
    record("you", "You uploaded your LinkedIn profile PDF", "Used to compare your current profile with the suggestions")
    return {"linkedin_pdf": profile.linkedin_pdf_info()}


@app.post("/api/profile")
def make_profile(req: ProfileRequest):
    try:
        result = profile.suggest(load_config(), req.model_dump())
        record("you", "New LinkedIn & Naukri profile suggestions are ready", "See Profile boost")
        return {"result": result}
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        log.exception("Profile suggestions failed")
        raise HTTPException(502, f"Couldn't generate suggestions: {e}")


_dist = ROOT / "ui" / "dist"
if _dist.exists():
    app.mount("/", StaticFiles(directory=_dist, html=True), name="ui")
