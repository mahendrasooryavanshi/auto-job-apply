"""Import LinkedIn's "Download your data" export: saved jobs, job applications and saved-post links.

LinkedIn offers no API for saved jobs or saved posts, but its official data export contains them as CSV files.
The export's file names and columns vary, so this scans every CSV for LinkedIn job / post links and uses the
file name ("Saved Jobs", "Job Applications", ...) to tell what each link is.
"""
import csv
import io
import json
import logging
import re
import time
import zipfile
from datetime import datetime

import requests

from .activity import record, set_progress
from .config import ROOT
from .finder import _row
from .linkedin_jobs import DELAY, job_page
from .lock import agent_lock
from .matcher import score
from .sheet import MAX_CELL, Tracker, same_job_key

log = logging.getLogger(__name__)

EXPORT_PATH = ROOT / "data" / "linkedin_export.upload"
META_PATH = ROOT / "data" / "linkedin_export.name"   # original file name of the upload
PENDING_PATH = ROOT / "data" / "linkedin_pending.json"  # saved jobs/posts sent by the browser bookmark
SAVED_POSTS_PATH = ROOT / "data" / "linkedin_saved_posts.json"
JOB_RE = re.compile(r"linkedin\.com/(?:comm/)?jobs/view/(?:[^/?\s]*-)?(\d{6,})")
POST_RE = re.compile(r"https?://(?:www\.)?linkedin\.com/(?:posts/[^\s,\"]+|feed/update/urn:li:[a-zA-Z]+:\d+)")
MAX_JOBS = 60   # job pages read per import, to stay polite


def _csv_files(filename: str, content: bytes):
    """(name, rows) for every CSV in an uploaded .zip, or the single uploaded .csv."""
    if filename.lower().endswith(".zip") or content[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(content)) as z:
            for name in z.namelist():
                if name.lower().endswith(".csv"):
                    yield name, _rows(z.read(name))
    else:
        yield filename, _rows(content)


def _rows(raw: bytes) -> list[dict]:
    text = raw.decode("utf-8-sig", errors="replace")
    lines = text.splitlines()
    # Some LinkedIn CSVs start with "Notes:" lines before the header row
    start = next((i for i, l in enumerate(lines) if l.count(",") >= 1 and not l.lower().startswith("notes")), 0)
    return list(csv.DictReader(io.StringIO("\n".join(lines[start:]))))


def _pick(row: dict, *names: str) -> str:
    for key, value in row.items():
        if key and any(n in key.lower() for n in names) and value:
            return value.strip()
    return ""


def parse_export(filename: str, content: bytes) -> dict:
    jobs, posts, files = {}, {}, []
    for name, rows in _csv_files(filename, content):
        lname = name.lower()
        kind = "applied" if "application" in lname else "saved" if "saved" in lname else "other"
        found = 0
        for row in rows:
            blob = " ".join(str(v) for v in row.values() if v)
            for job_id in JOB_RE.findall(blob):
                if job_id not in jobs or kind == "applied":
                    jobs[job_id] = {"kind": kind, "title": _pick(row, "title"), "company": _pick(row, "company"),
                                    "date": _pick(row, "date"), "file": name}
                    found += 1
            for url in POST_RE.findall(blob):
                if url not in posts:
                    text = max((str(v) for v in row.values() if v and "http" not in str(v)), key=len, default="")
                    posts[url] = {"url": url, "text": text[:300], "date": _pick(row, "date"), "file": name}
                    found += 1
        if found:
            files.append(f"{name} ({found})")
    return {"jobs": jobs, "posts": list(posts.values()), "files": files}


def queue_from_browser(job_ids: list[str], posts: list[dict]) -> dict:
    """Saved jobs/posts sent by the "Send to Job Agent" bookmark from the user's own LinkedIn page."""
    jobs = {jid: {"kind": "saved", "title": "", "company": "", "date": datetime.now().strftime("%Y-%m-%d"), "file": "LinkedIn page"}
            for jid in dict.fromkeys(job_ids) if jid.isdigit() and 6 <= len(jid) <= 20}
    clean = [{"url": p["url"], "text": str(p.get("text", ""))[:300], "date": datetime.now().strftime("%Y-%m-%d"), "file": "LinkedIn page"}
             for p in posts if POST_RE.fullmatch(str(p.get("url", "")).split("?")[0])]
    data = {"jobs": jobs, "posts": clean, "files": ["your LinkedIn page"]}
    PENDING_PATH.write_text(json.dumps(data))
    return data


def _merge_posts(new: list[dict]) -> None:
    """Newest first, one entry per post link."""
    seen, merged = set(), []
    for p in new + saved_posts():
        if p["url"] not in seen:
            seen.add(p["url"])
            merged.append(p)
    SAVED_POSTS_PATH.write_text(json.dumps(merged, indent=1, ensure_ascii=False))


def run_import(cfg: dict) -> str:
    """Runs as a dashboard action: add saved/applied jobs to the tracker, store saved-post links.
    Input is either the bookmark's pending list or an uploaded LinkedIn data export."""
    if PENDING_PATH.exists():
        data, source = json.loads(PENDING_PATH.read_text()), PENDING_PATH
    elif EXPORT_PATH.exists():
        data, source = parse_export(META_PATH.read_text(), EXPORT_PATH.read_bytes()), EXPORT_PATH
    else:
        raise RuntimeError("Nothing to import. Use the “Send to Job Agent” bookmark or upload your LinkedIn data export.")
    if data["posts"]:
        _merge_posts(data["posts"])
    with agent_lock("jobs"):
        tracker = Tracker(cfg["sheet_path"])
        known = set(tracker._links)
    todo = [(jid, j) for jid, j in data["jobs"].items() if f"https://www.linkedin.com/jobs/view/{jid}/" not in known]
    added = applied = done = 0
    for i, (job_id, j) in enumerate(todo[:MAX_JOBS]):
        set_progress(f"Importing LinkedIn jobs: {i + 1} of {min(len(todo), MAX_JOBS)}")
        try:
            page = job_page(job_id)
        except requests.RequestException as e:
            if isinstance(e, requests.HTTPError) and e.response is not None and e.response.status_code == 429:
                break   # LinkedIn asked us to slow down; the rest can be imported later
            page = {"description": "", "notes": "Job page no longer available", "title": "", "company": "", "location": ""}
        link = f"https://www.linkedin.com/jobs/view/{job_id}/"
        job = _row(link, page["company"] or j["company"], page["title"] or j["title"] or "LinkedIn job",
                   page["location"], page["description"] or page["title"], j["date"][:10], "Not disclosed",
                   "LinkedIn (applied)" if j["kind"] == "applied" else "LinkedIn (saved)")
        pct, skills = score(job, cfg["search"])
        job.update({"Match %": pct, "Tech Stack": ", ".join(skills), "Full JD": job["Description"][:MAX_CELL],
                    "Profile / JD Summary": " ".join(job["Description"].split())[:400]})
        if j["kind"] == "applied":
            # Already applied on LinkedIn: keep it on record but never email this one
            job.update(Status="Skipped", Notes=f"You applied on LinkedIn {j['date']}".strip())
            applied += 1
        else:
            job.update(Status="No Contact", Notes=" · ".join(x for x in ("Saved on LinkedIn", page["notes"]) if x))
            added += 1
        with agent_lock("jobs"):
            tracker = Tracker(cfg["sheet_path"])
            if not tracker.has(link) and same_job_key(job) not in tracker.same_job_keys():
                tracker.add(job)
                tracker.save(force=True)
        done += 1
        time.sleep(DELAY)
    # only now drop what was imported; whatever is left waits in the pending file for the next run
    left = len(todo) - done
    if left:
        PENDING_PATH.write_text(json.dumps({"jobs": dict(todo[done:]), "posts": [], "files": data["files"]}))
    elif source == PENDING_PATH:
        PENDING_PATH.unlink(missing_ok=True)
    if source == EXPORT_PATH:
        EXPORT_PATH.unlink(missing_ok=True)
    msg = (f"Imported {added} saved jobs and {applied} jobs you applied to"
           + (f" · {len(data['posts'])} saved-post links" if data["posts"] else "")
           + (f" · {left} more next time (run the import again)" if left else ""))
    record("search", "LinkedIn saved items imported", msg + (f" · from {', '.join(data['files'][:3])}" if data["files"] else ""))
    log.info(msg)
    return msg


def saved_posts() -> list[dict]:
    try:
        return json.loads(SAVED_POSTS_PATH.read_text())
    except (OSError, ValueError):
        return []
