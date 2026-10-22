"""Fetch jobs from job APIs and normalise them into tracker rows."""
import logging
import re

import requests

log = logging.getLogger(__name__)
JSEARCH_MAX_CALLS = 4


def _problem(source: str, role: str, location: str, e: Exception) -> None:
    from .activity import friendly_error, record
    record("problem", f"Couldn't search {source} for “{role}” in {location}", friendly_error(e))

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
# Indian mobile numbers as published in the post, e.g. +91 98765 43210 / 9876543210
PHONE_RE = re.compile(r"(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b")
# Addresses that appear in job ads' legal text but don't reach a recruiter (accommodation requests, fraud
# reports, privacy/legal desks): emailing them looks careless, so they're never used as a recruiter contact
IGNORED_EMAIL_PARTS = ("noreply", "no-reply", "donotreply", "example.com", "privacy", "unsubscribe", "accommodation",
                       "fraud", "legal", "compliance", "accessibility", "disability", "gdpr", "dataprotection",
                       "security@", "abuse@", "support@", "billing@", "press@", "media@", "investor")


def extract_contacts(text: str) -> tuple[str, str]:
    emails = [e for e in dict.fromkeys(EMAIL_RE.findall(text or ""))
              if not any(p in e.lower() for p in IGNORED_EMAIL_PARTS)]
    phones = list(dict.fromkeys(PHONE_RE.findall(text or "")))
    return ", ".join(emails[:2]), ", ".join(phones[:2])


def _budget(lo, hi, currency="", period="") -> str:
    if not lo and not hi:
        return "Not disclosed"
    rng = f"{int(lo):,}" if lo else ""
    if hi and hi != lo:
        rng = f"{rng} - {int(hi):,}" if rng else f"up to {int(hi):,}"
    return " ".join(x for x in (currency, rng, f"/{period.lower()}" if period else "") if x)


def _row(link, company, role, location, description, posted, budget, source) -> dict:
    email, phone = extract_contacts(description)
    return {
        "Job Link": link, "Company": company, "Role": role, "Location": location,
        "Description": description or "", "Recruiter Email": email, "Mobile": phone,
        "Posted Date": (posted or "")[:10], "Budget": budget, "Source": source,
    }


def search_jsearch(api_key: str, role: str, location: str, days: int) -> list[dict]:
    date_posted = "today" if days <= 1 else "3days" if days <= 3 else "week" if days <= 7 else "month"
    resp = requests.get(
        "https://jsearch.p.rapidapi.com/search-v2",
        headers={"X-RapidAPI-Key": api_key, "X-RapidAPI-Host": "jsearch.p.rapidapi.com"},
        params={"query": f"{role} in {location}", "num_pages": 2,
                "date_posted": date_posted, "country": "in"},
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json().get("data") or {}
    jobs = []
    for j in data.get("jobs", []) if isinstance(data, dict) else data:
        loc = j.get("job_location") or ", ".join(
            x for x in (j.get("job_city"), j.get("job_state"), j.get("job_country")) if x)
        if j.get("job_is_remote"):
            loc = f"Remote ({loc})" if loc else "Remote"
        budget = j.get("job_salary_string") or _budget(
            j.get("job_min_salary"), j.get("job_max_salary"),
            j.get("job_salary_currency") or "", j.get("job_salary_period") or "")
        jobs.append(_row(
            j.get("job_apply_link") or j.get("job_google_link", ""), j.get("employer_name", ""),
            j.get("job_title", ""), loc, j.get("job_description", ""),
            j.get("job_posted_at_datetime_utc", ""), budget, j.get("job_publisher") or "JSearch",
        ))
    return jobs


def search_adzuna(app_id: str, app_key: str, role: str, location: str, days: int) -> list[dict]:
    params = {"app_id": app_id, "app_key": app_key, "what": role, "results_per_page": 50,
              "max_days_old": days, "content-type": "application/json"}
    if location.lower() not in ("india", "remote"):
        params["where"] = location
    resp = requests.get("https://api.adzuna.com/v1/api/jobs/in/search/1", params=params, timeout=30)
    resp.raise_for_status()
    return [
        _row(j.get("redirect_url", ""), j.get("company", {}).get("display_name", ""),
             j.get("title", ""), j.get("location", {}).get("display_name", ""),
             j.get("description", ""), j.get("created", ""),
             _budget(j.get("salary_min"), j.get("salary_max"), "INR", "year"), "Adzuna")
        for j in resp.json().get("results", [])
    ]


def has_job_source(env: dict, search: dict | None = None) -> bool:
    search = search or {}
    return bool(env["RAPIDAPI_KEY"] or (env["ADZUNA_APP_ID"] and env["ADZUNA_APP_KEY"])
                or env["SERPER_API_KEY"] or env["SERPAPI_KEY"] or env["JOBSPIPE_API_KEY"] or search.get("linkedin_jobs", True)
                or (search.get("company_jobs", True) and search.get("target_companies", True)))


def find_jobs(cfg: dict, known_links: set[str] = frozenset()) -> list[dict]:
    # imported here: these modules use _row from this module
    from .company_jobs import search_companies
    from .jobspipe import search_jobspipe
    from .linkedin_jobs import search_linkedin_jobs
    from .linkedin_posts import search_posts

    env, s = cfg["env"], cfg["search"]
    if not has_job_source(env, s):
        raise RuntimeError("No job source is on. Turn on LinkedIn jobs or add a JSearch / Adzuna / Serper key in Settings.")
    jobs = []
    if env["JOBSPIPE_API_KEY"]:
        jobs += search_jobspipe(cfg)
    if s.get("company_jobs", True):
        try:
            jobs += search_companies(cfg)
        except Exception as e:   # one source failing must not stop the others
            log.warning("Target companies search failed: %s", e)
    if s.get("linkedin_jobs", True):
        jobs += search_linkedin_jobs(cfg, set(known_links))
    if env["SERPER_API_KEY"] or env["SERPAPI_KEY"]:
        jobs += search_posts(cfg)
    jsearch_calls = 0
    for role in s["roles"]:
        for location in s["locations"]:
            # JSearch's free plan allows only a few hundred calls a month: spend at most JSEARCH_MAX_CALLS per run
            if env["RAPIDAPI_KEY"] and jsearch_calls < JSEARCH_MAX_CALLS:
                jsearch_calls += 1
                try:
                    jobs += search_jsearch(env["RAPIDAPI_KEY"], role, location, s["posted_within_days"])
                except requests.RequestException as e:
                    log.warning("JSearch failed for %s/%s: %s", role, location, e)
                    _problem("JSearch", role, location, e)
            if env["ADZUNA_APP_ID"] and env["ADZUNA_APP_KEY"]:
                try:
                    jobs += search_adzuna(env["ADZUNA_APP_ID"], env["ADZUNA_APP_KEY"], role, location, s["posted_within_days"])
                except requests.RequestException as e:
                    log.warning("Adzuna failed for %s/%s: %s", role, location, e)
                    _problem("Adzuna", role, location, e)
    return [j for j in jobs if j["Job Link"]]
