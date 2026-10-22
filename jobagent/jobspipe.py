"""JobsPipe (https://jobspipe.dev): one API over 30+ sources (LinkedIn, Indeed, Greenhouse, Lever, ...).

Costs 1 credit per job returned (jobs already paid for this month are free), so each run makes a single call
capped at MAX_PER_RUN jobs. Jobs carry recruiter emails when the posting has one, which lets the agent draft
outreach emails, and a "ghost score" used to skip listings that are probably stale or fake.
"""
import logging
import re

import requests

from .activity import record
from .finder import _problem, _row

log = logging.getLogger(__name__)

URL = "https://api.jobspipe.dev/v1/jobs/search"
MAX_PER_RUN = 25          # the free plan's per-call cap; 1 credit per new job
GHOST_LIMIT = 60          # ghost_score at or above this: likely an old or fake listing
COUNTRY_CODES = {"india": "IN", "united states": "US", "usa": "US", "uk": "GB", "united kingdom": "GB",
                 "canada": "CA", "germany": "DE", "singapore": "SG", "uae": "AE", "australia": "AU"}
INDIAN_CITIES = re.compile(r"bengaluru|bangalore|mumbai|pune|hyderabad|gurgaon|gurugram|noida|delhi|chennai|kolkata|"
                           r"ahmedabad|indore|jaipur|kochi|chandigarh", re.I)


def _countries(locations: list[str]) -> list[str]:
    codes = {COUNTRY_CODES[l.lower()] for l in locations if l.lower() in COUNTRY_CODES}
    if any(INDIAN_CITIES.search(l) for l in locations):
        codes.add("IN")
    return sorted(codes) or ["IN"]


def search_jobspipe(cfg: dict) -> list[dict]:
    key, s = cfg["env"]["JOBSPIPE_API_KEY"], cfg["search"]
    body = {"job_title_or": s["roles"], "job_country_code_or": _countries(s["locations"]),
            "posted_at_max_age_days": max(1, int(s["posted_within_days"])), "limit": MAX_PER_RUN}
    if [l.lower() for l in s["locations"]] == ["remote"]:
        body["remote"] = True
    try:
        resp = requests.post(URL, json=body, timeout=90, headers={"Authorization": f"Bearer {key}"})
        if resp.status_code == 402:
            record("problem", "JobsPipe credits used up", "Your free JobsPipe credits are finished for now; other sources keep working.")
            return []
        resp.raise_for_status()
    except requests.RequestException as e:
        log.warning("JobsPipe search failed: %s", e)
        _problem("JobsPipe", ", ".join(s["roles"]), ", ".join(s["locations"]), e)
        return []
    data = resp.json()
    meta = data.get("metadata", {})
    jobs, ghosts = [], 0
    for j in data.get("data", []):
        if (j.get("ghost_score") or 0) >= GHOST_LIMIT:
            ghosts += 1
            continue
        providers = ", ".join(dict.fromkeys(src.get("provider", "") for src in j.get("sources") or []))
        salary = j.get("salary_string") or ""
        job = _row(j.get("url") or j.get("source_url") or "", j.get("company") or "", j.get("job_title") or "",
                   j.get("location") or j.get("short_location") or "", j.get("description") or j.get("job_title") or "",
                   str(j.get("date_posted") or "")[:10], salary or "Not disclosed", f"JobsPipe ({providers or 'web'})")
        emails = [e for e in j.get("recruiter_emails") or [] if "@" in e]
        if emails and not job["Recruiter Email"]:
            job["Recruiter Email"] = ", ".join(emails[:2])
        notes = [x for x in (j.get("seniority", "") or "").replace("_", " ").split() if x]
        if j.get("applicant_count"):
            notes.append(f"{j['applicant_count']} applicants")
        if j.get("remote"):
            notes.append("remote")
        job["Notes"] = " · ".join([" ".join(notes[:2])] + notes[2:]) if notes else ""
        jobs.append(job)
    log.info("JobsPipe: %d jobs (%d likely-ghost skipped) · %s credits used, %s left",
             len(jobs), ghosts, meta.get("credits_charged"), meta.get("credits_remaining"))
    remaining = meta.get("credits_remaining")
    if isinstance(remaining, int) and remaining < 100:
        record("problem", "JobsPipe credits running low", f"{remaining} credits left this month.")
    return jobs
