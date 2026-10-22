"""Find public LinkedIn hiring posts through Google search (Serper.dev or SerpAPI).

Recruiters often post "We're hiring ... send your CV to hr@company.com" on LinkedIn instead of a
job board, so these posts are where recruiter emails and phone numbers actually appear.
LinkedIn is never logged into: we only read Google results and, when the snippet has no email,
the post's public page.
"""
import html
import logging
import re
import time
from datetime import date, datetime, timedelta

import requests

from .finder import _problem, _row

log = logging.getLogger(__name__)

SOURCE = "LinkedIn post"
MAX_PAGE_FETCHES = 15          # public post pages read per run when the snippet lacks an email
PAGE_FETCH_DELAY = 2.0
BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

BUDGET_RE = re.compile(
    r"(?:ctc|salary|package|budget)?\s*[:\-]?\s*(?:₹|rs\.?|inr)?\s*"
    r"(\d{1,2}(?:\.\d)?\s*(?:-|–|to)\s*\d{1,2}(?:\.\d)?\s*(?:lpa|l\.p\.a|lakhs?|lacs?)"
    r"|\d{1,2}(?:\.\d)?\s*(?:lpa|l\.p\.a))", re.I)
RELATIVE_RE = re.compile(r"(\d+)\s*(minute|hour|day|week|month)s?\s*ago", re.I)


def _query(role: str, location: str) -> str:
    q = (f'site:linkedin.com/posts "{role}" (hiring OR "looking for") '
         f'("@gmail.com" OR "email" OR "send your resume" OR "share your cv")')
    if location.lower() not in ("india", "remote", ""):
        q += f' "{location}"'
    return q


def _tbs(days: int) -> str:
    return "qdr:d" if days <= 1 else "qdr:w" if days <= 7 else "qdr:m"


def _search_serper(key: str, query: str, days: int) -> list[dict]:
    resp = requests.post("https://google.serper.dev/search", timeout=30,
                         headers={"X-API-KEY": key, "Content-Type": "application/json"},
                         json={"q": query, "num": 20, "gl": "in", "tbs": _tbs(days)})
    resp.raise_for_status()
    return resp.json().get("organic", [])


def _search_serpapi(key: str, query: str, days: int) -> list[dict]:
    resp = requests.get("https://serpapi.com/search.json", timeout=30,
                        params={"engine": "google", "q": query, "num": 20, "gl": "in",
                                "tbs": _tbs(days), "api_key": key})
    resp.raise_for_status()
    return resp.json().get("organic_results", [])


def _posted_date(raw: str) -> str:
    raw = (raw or "").strip()
    m = RELATIVE_RE.search(raw)
    if m:
        n, unit = int(m.group(1)), m.group(2).lower()
        delta = {"minute": timedelta(minutes=n), "hour": timedelta(hours=n), "day": timedelta(days=n),
                 "week": timedelta(weeks=n), "month": timedelta(days=30 * n)}[unit]
        return (datetime.now() - delta).date().isoformat()
    for fmt in ("%b %d, %Y", "%d %b %Y"):
        try:
            return datetime.strptime(raw, fmt).date().isoformat()
        except ValueError:
            pass
    return ""


def _post_text(url: str) -> str:
    """Read the public post page's description (LinkedIn serves it without login)."""
    try:
        resp = requests.get(url, timeout=20, headers={"User-Agent": BROWSER_UA, "Accept-Language": "en"})
    except requests.RequestException:
        return ""
    if resp.status_code != 200:
        return ""
    for pattern in (r'"articleBody"\s*:\s*"(.*?)"\s*[,}]',
                    r'<meta[^>]+property="og:description"[^>]+content="([^"]*)"',
                    r'<meta[^>]+name="description"[^>]+content="([^"]*)"'):
        m = re.search(pattern, resp.text, re.S)
        if m:
            text = m.group(1).encode().decode("unicode_escape", errors="ignore") if "articleBody" in pattern else m.group(1)
            return html.unescape(text)
    return ""


def _author(title: str) -> str:
    # Google titles look like "Priya Sharma on LinkedIn: #hiring ..." or "#hiring ... | Priya Sharma"
    m = re.match(r"(.+?)\s+on LinkedIn", title) or re.search(r"\|\s*([^|]+?)\s*$", title)
    return m.group(1).strip() if m else ""


def search_posts(cfg: dict) -> list[dict]:
    env, s = cfg["env"], cfg["search"]
    if env["SERPER_API_KEY"]:
        search, key = _search_serper, env["SERPER_API_KEY"]
    else:
        search, key = _search_serpapi, env["SERPAPI_KEY"]
    cutoff = (date.today() - timedelta(days=s["posted_within_days"])).isoformat()
    jobs, seen, fetched = [], set(), 0
    for role in s["roles"]:
        for location in s["locations"]:
            try:
                results = search(key, _query(role, location), s["posted_within_days"])
            except requests.RequestException as e:
                log.warning("LinkedIn post search failed for %s/%s: %s", role, location, e)
                _problem("LinkedIn posts", role, location, e)
                continue
            for r in results:
                link = (r.get("link") or "").split("?")[0]
                if "linkedin.com/posts" not in link or link in seen:
                    continue
                seen.add(link)
                title, text = r.get("title", ""), f"{r.get('title', '')}\n{r.get('snippet', '')}"
                if "@" not in text and fetched < MAX_PAGE_FETCHES:
                    fetched += 1
                    time.sleep(PAGE_FETCH_DELAY)
                    text = f"{text}\n{_post_text(link)}"
                posted = _posted_date(r.get("date", ""))
                if posted and posted < cutoff:
                    continue
                loc = next((l for l in s["locations"] if l.lower() in text.lower()), location)
                if "remote" in text.lower() and "Remote" not in loc:
                    loc = f"{loc} / Remote"
                budget = BUDGET_RE.search(text)
                job = _row(link, "", role, loc, text, posted,
                           budget.group(1).strip() if budget else "Not disclosed", SOURCE)
                author = _author(title)
                job["Notes"] = f"LinkedIn post by {author}" if author else "LinkedIn post"
                jobs.append(job)
    log.info("LinkedIn posts: %d found (%d post pages read)", len(jobs), fetched)
    return jobs
