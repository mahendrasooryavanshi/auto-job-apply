"""LinkedIn job listings from LinkedIn's public (logged-out) job search pages.

No LinkedIn account is used, so the user's account can't be restricted by this. Requests are kept
slow and few; if LinkedIn starts refusing (HTTP 429), the run stops asking for details.
"""
import logging
import time
from datetime import date

import requests
from bs4 import BeautifulSoup

from .finder import _problem, _row

log = logging.getLogger(__name__)

SOURCE = "LinkedIn"
SEARCH_URL = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search"
DETAIL_URL = "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{}"
PAGES = 2                 # 10 jobs per page
MAX_DETAILS = 30          # job descriptions read per run
DELAY = 1.5
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"


def _get(url: str, **params) -> requests.Response:
    return requests.get(url, params=params, timeout=30, headers={"User-Agent": UA, "Accept-Language": "en"})


def _cards(html: str) -> list[dict]:
    out = []
    for card in BeautifulSoup(html, "html.parser").select("div.base-search-card"):
        urn = card.get("data-entity-urn", "")
        job_id = urn.rsplit(":", 1)[-1]
        title = card.select_one(".base-search-card__title")
        if not job_id.isdigit() or not title:
            continue
        company = card.select_one(".base-search-card__subtitle")
        location = card.select_one(".job-search-card__location")
        posted = card.select_one("time")
        out.append({
            "id": job_id,
            "link": f"https://www.linkedin.com/jobs/view/{job_id}/",
            "title": title.get_text(strip=True),
            "company": company.get_text(strip=True) if company else "",
            "location": location.get_text(strip=True) if location else "",
            "posted": posted.get("datetime", "") if posted else "",
        })
    return out


def job_page(job_id: str) -> dict:
    """Title, company, location, description and notes from one public job page. Raises requests.HTTPError on refusal."""
    resp = _get(DETAIL_URL.format(job_id))
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    desc = soup.select_one(".show-more-less-html__markup") or soup.select_one(".description__text")
    criteria = {li.select_one("h3").get_text(strip=True): li.select_one("span").get_text(strip=True)
                for li in soup.select(".description__job-criteria-item") if li.select_one("h3") and li.select_one("span")}
    applicants = soup.select_one(".num-applicants__caption")
    notes = " · ".join(x for x in (
        criteria.get("Seniority level"), criteria.get("Employment type"),
        applicants.get_text(strip=True) if applicants else "") if x)
    text = lambda sel: (soup.select_one(sel).get_text(strip=True) if soup.select_one(sel) else "")
    return {"description": desc.get_text("\n", strip=True) if desc else "", "notes": notes,
            "title": text(".topcard__title"), "company": text("a.topcard__org-name-link") or text(".topcard__org-name"),
            "location": text(".topcard__flavor--bullet")}


def search_linkedin_jobs(cfg: dict, known_links: set[str]) -> list[dict]:
    s = cfg["search"]
    seconds = max(1, int(s["posted_within_days"])) * 86400
    cards, seen = [], set()
    for role in s["roles"]:
        for location in s["locations"]:
            params = {"keywords": role, "location": "India" if location.lower() == "remote" else location,
                      "f_TPR": f"r{seconds}"}
            if location.lower() == "remote":
                params["f_WT"] = "2"   # LinkedIn's "remote" filter
            for page in range(PAGES):
                try:
                    resp = _get(SEARCH_URL, start=page * 10, **params)
                    if resp.status_code == 429:
                        _problem("LinkedIn", role, location, requests.HTTPError(response=resp))
                        return _build(cards, known_links)
                    resp.raise_for_status()
                except requests.RequestException as e:
                    log.warning("LinkedIn search failed for %s/%s: %s", role, location, e)
                    _problem("LinkedIn", role, location, e)
                    break
                found = [c for c in _cards(resp.text) if c["id"] not in seen]
                seen.update(c["id"] for c in found)
                cards += found
                if len(found) < 10:
                    break
                time.sleep(DELAY)
    return _build(cards, known_links)


def _build(cards: list[dict], known_links: set[str]) -> list[dict]:
    jobs, fetched, blocked = [], 0, False
    for c in cards:
        desc, notes = "", ""
        # Only read descriptions for jobs not already in the sheet, and only a limited number per run
        if c["link"] not in known_links and fetched < MAX_DETAILS and not blocked:
            try:
                time.sleep(DELAY)
                page = job_page(c["id"])
                desc, notes = page["description"], page["notes"]
                fetched += 1
            except requests.RequestException as e:
                blocked = isinstance(e, requests.HTTPError) and e.response is not None and e.response.status_code == 429
                log.warning("LinkedIn job %s details failed: %s", c["id"], e)
        job = _row(c["link"], c["company"], c["title"], c["location"], desc or c["title"],
                   c["posted"] or date.today().isoformat(), "Not disclosed", SOURCE)
        if notes:
            job["Notes"] = notes
        jobs.append(job)
    log.info("LinkedIn jobs: %d found, %d descriptions read%s", len(jobs), fetched, " (rate-limited)" if blocked else "")
    return jobs
