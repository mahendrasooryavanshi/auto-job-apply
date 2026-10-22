"""Openings straight from target companies' own career pages.

Most product companies run their careers page on Greenhouse, Lever, Ashby or SmartRecruiters, and each of these
publishes an official, public job feed meant to be read by other sites. No account is used and the links go
straight to the company's application form. The user lists companies by name; which system a company uses is
detected once and remembered.
"""
import html
import json
import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import requests

from .config import ROOT
from .finder import _row

log = logging.getLogger(__name__)

SOURCES_PATH = ROOT / "data" / "company_sources.json"   # company -> detected system (cached)
WINDOW_DAYS = 30        # company boards keep openings up for weeks, so look further back than job sites
TIMEOUT = 30

# Verified product companies with India / remote engineering openings (Oct 2026). Users can add their own.
DEFAULT_COMPANIES = [
    "Coinbase", "Okta", "Databricks", "GitLab", "Twilio", "MongoDB", "Druva", "Stripe", "Airbnb", "Rubrik",
    "Freshworks", "Plane", "Supabase", "Paytm", "OpenAI", "InMobi", "FamPay", "Sarvam", "ServiceNow",
    "HackerRank", "Meesho", "Atlan", "Notion", "Groww", "CRED", "Zeta", "Postman",
    # Workday companies are added by careers link
    "Adobe=https://adobe.wd5.myworkdayjobs.com/external_experienced",
    "Salesforce=https://salesforce.wd12.myworkdayjobs.com/External_Career_Site",
    "NVIDIA=https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite",
]

INDIA_RE = re.compile(r"india|bengaluru|bangalore|mumbai|pune|hyderabad|gurgaon|gurugram|noida|delhi|chennai|"
                      r"kolkata|ahmedabad|indore|jaipur|kochi|chandigarh|coimbatore|trivandrum", re.I)
GLOBAL_REMOTE_RE = re.compile(r"anywhere|worldwide|global|apac|asia", re.I)
TAGS_RE = re.compile(r"<[^>]+>")


def _text(html_str: str) -> str:
    s = html.unescape(html.unescape(html_str or ""))   # Greenhouse double-escapes its HTML
    s = re.sub(r"(?i)<\s*(br|/p|/li|/h\d)\s*/?>", "\n", s)
    return re.sub(r"\n{3,}", "\n\n", TAGS_RE.sub("", s)).strip()


def _get(url: str, **params):
    for attempt in range(2):   # boards often blip (502/503, dropped connection): one quick retry saves the company
        try:
            resp = requests.get(url, params=params, timeout=TIMEOUT, headers={"User-Agent": "JobAgent/1.0"})
        except requests.Timeout:
            raise   # a slow board is skipped, not waited on twice
        except requests.ConnectionError:
            if attempt:
                raise
            time.sleep(3)
            continue
        if attempt == 0 and (resp.status_code == 429 or resp.status_code >= 500):
            time.sleep(3)
            continue
        resp.raise_for_status()
        return resp.json()


# ---- one fetcher per hiring system; each returns normalised jobs ----

def _greenhouse(slug: str, name: str) -> list[dict]:
    data = _get(f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs", content="true")
    return [{"title": j["title"], "location": (j.get("location") or {}).get("name", ""), "url": j["absolute_url"],
             "posted": j.get("first_published") or j.get("updated_at", ""), "description": _text(j.get("content", "")),
             "budget": ""} for j in data.get("jobs", [])]


def _lever(slug: str, name: str) -> list[dict]:
    out = []
    for j in _get(f"https://api.lever.co/v0/postings/{slug}", mode="json"):
        cat = j.get("categories") or {}
        lists = "\n".join(f"{l.get('text', '')}\n{_text(l.get('content', ''))}" for l in j.get("lists", []))
        pay = j.get("salaryRange") or {}
        out.append({"title": j["text"], "location": " / ".join(filter(None, [cat.get("location", ""), j.get("workplaceType", "")])),
                    "url": j["hostedUrl"],
                    "posted": datetime.fromtimestamp(j.get("createdAt", 0) / 1000, timezone.utc).isoformat(),
                    "description": "\n\n".join(filter(None, [j.get("descriptionPlain", ""), lists, j.get("additionalPlain", "")])),
                    "budget": " ".join(filter(None, [pay.get("currency", ""), " - ".join(
                        f"{v:,}" if isinstance(v, (int, float)) else str(v) for v in (pay.get("min"), pay.get("max")) if v)]))
                    if pay.get("min") else ""})
    return out


def _ashby(slug: str, name: str) -> list[dict]:
    data = _get(f"https://api.ashbyhq.com/posting-api/job-board/{slug}", includeCompensation="true")
    out = []
    for j in data.get("jobs", []):
        if not j.get("isListed", True):
            continue
        locs = [j.get("location", "")] + [s.get("location", "") for s in j.get("secondaryLocations", []) or []]
        out.append({"title": j["title"], "location": " / ".join(filter(None, locs + (["Remote"] if j.get("isRemote") else []))),
                    "url": j.get("jobUrl") or j.get("applyUrl", ""), "posted": j.get("publishedAt", ""),
                    "description": j.get("descriptionPlain") or _text(j.get("descriptionHtml", "")),
                    "budget": ((j.get("compensation") or {}).get("compensationTierSummary") or "")})
    return out


def _smartrecruiters(slug: str, name: str) -> list[dict]:
    out = []
    for j in _get(f"https://api.smartrecruiters.com/v1/companies/{slug}/postings", limit=100).get("content", []):
        loc = j.get("location") or {}
        out.append({"id": j["id"], "title": j["name"],
                    "location": ", ".join(filter(None, [loc.get("city"), loc.get("country"), "Remote" if loc.get("remote") else ""])),
                    "url": f"https://jobs.smartrecruiters.com/{slug}/{j['id']}", "posted": j.get("releasedDate", ""),
                    "description": "", "budget": "", "detail": f"https://api.smartrecruiters.com/v1/companies/{slug}/postings/{j['id']}"})
    return out


def _workable(slug: str, name: str) -> list[dict]:
    data = _get(f"https://apply.workable.com/api/v1/widget/accounts/{slug}", details="true")
    return [{"title": j["title"], "location": ", ".join(filter(None, [j.get("city"), j.get("state"), j.get("country"),
                                                                       "Remote" if j.get("telecommuting") else ""])),
             "url": j.get("url") or j.get("application_url", ""), "posted": j.get("published_on") or j.get("created_at", ""),
             "description": _text(j.get("description", "")), "budget": ""} for j in data.get("jobs", [])]


def _recruitee(slug: str, name: str) -> list[dict]:
    data = _get(f"https://{slug}.recruitee.com/api/offers/")
    return [{"title": j["title"], "location": " / ".join(filter(None, [j.get("location", ""), "Remote" if j.get("remote") else ""])),
             "url": j.get("careers_url", ""), "posted": j.get("published_at") or j.get("created_at", ""),
             "description": _text(j.get("description", "") + "\n" + j.get("requirements", "")),
             "budget": (j.get("salary") or {}).get("min") and f"{j['salary'].get('currency', '')} {j['salary']['min']} - {j['salary'].get('max', '')}" or ""}
            for j in data.get("offers", [])]


def _personio(slug: str, name: str) -> list[dict]:
    import xml.etree.ElementTree as ET
    for host in (f"https://{slug}.jobs.personio.de", f"https://{slug}.jobs.personio.com"):
        try:
            resp = requests.get(f"{host}/xml", params={"language": "en"}, timeout=TIMEOUT)
            resp.raise_for_status()
            root = ET.fromstring(resp.content)
            break
        except (requests.RequestException, ET.ParseError):
            continue
    else:
        return []
    out = []
    for p in root.iter("position"):
        get = lambda tag: (p.findtext(tag) or "").strip()
        desc = "\n\n".join(f"{d.findtext('name') or ''}\n{_text(d.findtext('value') or '')}" for d in p.iter("jobDescription"))
        out.append({"title": get("name"), "location": get("office"), "url": f"{host}/job/{get('id')}",
                    "posted": get("createdAt"), "description": desc, "budget": ""})
    return out


def _breezy(slug: str, name: str) -> list[dict]:
    out = []
    for j in _get(f"https://{slug}.breezy.hr/json"):
        loc = j.get("location") or {}
        out.append({"title": j.get("name", ""), "location": ", ".join(filter(None, [loc.get("city"), (loc.get("country") or {}).get("name") if isinstance(loc.get("country"), dict) else loc.get("country"), "Remote" if loc.get("is_remote") else ""])),
                    "url": j.get("url", ""), "posted": j.get("published_date", ""), "description": "", "budget": ""})
    return out


def _rippling(slug: str, name: str) -> list[dict]:
    out = []
    data = _get(f"https://ats.rippling.com/api/v2/board/{slug}/jobs", page=0)
    for j in (data if isinstance(data, list) else (data.get("items") or data.get("results") or []) if isinstance(data, dict) else []):
        locs = j.get("locations") or []
        out.append({"title": j.get("name", ""), "location": " / ".join(l.get("name", "") if isinstance(l, dict) else str(l) for l in locs),
                    "url": j.get("url", ""), "posted": "", "description": "", "budget": "",
                    "detail": f"https://ats.rippling.com/api/v2/board/{slug}/jobs/{j.get('id')}"})
    return out


WD_URL = re.compile(r"https?://(?P<tenant>[\w-]+)\.(?P<wd>wd\d+)\.myworkdayjobs\.com/(?:[a-z]{2}-[A-Z]{2}/)?(?P<site>[\w-]+)")
WD_POSTED = re.compile(r"(today|yesterday|(\d+)\+? days? ago)", re.I)


def _workday(url: str, name: str, roles: list[str] = ()) -> list[dict]:
    """Big employers (Adobe, Salesforce, NVIDIA...) use Workday; added by pasting their careers-page link."""
    m = WD_URL.match(url)
    base = f"https://{m['tenant']}.{m['wd']}.myworkdayjobs.com/wday/cxs/{m['tenant']}/{m['site']}"
    headers = {"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "JobAgent/1.0"}
    seen, out = set(), []
    for role in roles or [""]:
        resp = requests.post(f"{base}/jobs", json={"appliedFacets": {}, "limit": 20, "offset": 0, "searchText": role},
                             headers=headers, timeout=TIMEOUT)
        resp.raise_for_status()
        for p in resp.json().get("jobPostings", []):
            posted = WD_POSTED.search(p.get("postedOn", "") or "")
            days = 0 if posted and posted.group(1).lower() == "today" else 1 if posted and posted.group(1).lower() == "yesterday" \
                else int(posted.group(2)) if posted and posted.group(2) else 99
            if p["externalPath"] in seen or days > WINDOW_DAYS:
                continue
            seen.add(p["externalPath"])
            out.append({"title": p.get("title", ""), "location": p.get("locationsText", ""),
                        "url": f"https://{m['tenant']}.{m['wd']}.myworkdayjobs.com/{m['site']}{p['externalPath']}",
                        "posted": (datetime.now(timezone.utc) - timedelta(days=days)).isoformat(), "description": "",
                        "budget": "", "detail": f"{base}{p['externalPath']}", "workday": True})
    return out


FETCHERS = {"greenhouse": _greenhouse, "lever": _lever, "ashby": _ashby, "smartrecruiters": _smartrecruiters,
            "workable": _workable, "recruitee": _recruitee, "personio": _personio, "breezy": _breezy, "rippling": _rippling}
PROBES = {
    "greenhouse": lambda s: f"https://boards-api.greenhouse.io/v1/boards/{s}",
    "lever": lambda s: f"https://api.lever.co/v0/postings/{s}?mode=json&limit=1",
    "ashby": lambda s: f"https://api.ashbyhq.com/posting-api/job-board/{s}",
    "smartrecruiters": lambda s: f"https://api.smartrecruiters.com/v1/companies/{s}/postings?limit=1",
    "workable": lambda s: f"https://apply.workable.com/api/v1/widget/accounts/{s}",
    "recruitee": lambda s: f"https://{s}.recruitee.com/api/offers/",
    "personio": lambda s: f"https://{s}.jobs.personio.de/xml?language=en",
    "breezy": lambda s: f"https://{s}.breezy.hr/json",
    "rippling": lambda s: f"https://ats.rippling.com/api/v2/board/{s}/jobs",
}


def _has_postings(ats: str, r: requests.Response) -> bool:
    """Some systems answer 200 even for unknown companies, so check the body looks like a real board."""
    if ats == "personio":
        return b"<workzag-jobs" in r.content
    try:
        data = r.json()
    except ValueError:
        return False
    if ats in ("lever", "breezy"):
        return isinstance(data, list) and bool(data)
    if ats == "smartrecruiters":
        return data.get("totalFound", 0) > 0
    if ats == "workable":
        return bool(data.get("name") or data.get("jobs"))
    if ats == "recruitee":
        return "offers" in data
    if ats == "rippling":
        return bool(data.get("items") or data.get("results")) if isinstance(data, dict) else bool(data)
    return isinstance(data, dict) and ("jobs" in data or "name" in data)


def _detect(company: str) -> dict | None | bool:
    """Which hiring system a company uses, by trying the usual board names on each.
    None = definitely not found; False = some probes failed (network/server error), so try again next time."""
    link = company.split("=")[-1].strip()
    if WD_URL.match(link):
        return {"ats": "workday", "slug": link}
    base = re.sub(r"[^A-Za-z0-9]", "", company)
    unsure = False
    for ats, probe in PROBES.items():
        for slug in dict.fromkeys([base.lower(), base, company.strip().replace(" ", "-").lower()]):
            try:
                r = requests.get(probe(slug), timeout=TIMEOUT)
            except requests.RequestException:
                unsure = True
                continue
            if r.status_code == 429 or r.status_code >= 500:
                unsure = True
            elif r.ok and _has_postings(ats, r):
                return {"ats": ats, "slug": slug}
    return False if unsure else None


def _sources(companies: list[str]) -> dict[str, dict | None]:
    try:
        cache = json.loads(SOURCES_PATH.read_text())
    except (OSError, ValueError):
        cache = {}
    missing = [c for c in companies if c not in cache]
    if missing:
        with ThreadPoolExecutor(8) as ex:
            for company, found in zip(missing, ex.map(_detect, missing)):
                if found is not False:   # don't remember "not found" when it was only a network error
                    cache[company] = found
        SOURCES_PATH.write_text(json.dumps(cache, indent=1))
    return {c: cache.get(c) for c in companies}


def _location_ok(location: str, wanted: list[str]) -> bool:
    loc = location or ""
    cities = [w for w in wanted if w.lower() not in ("india", "remote")]
    if cities:
        if any(c.lower() in loc.lower() for c in cities):
            return True
    elif INDIA_RE.search(loc):
        return True
    remote_ok = any(w.lower() in ("remote", "india") for w in wanted)
    return remote_ok and "remote" in loc.lower() and (INDIA_RE.search(loc) or GLOBAL_REMOTE_RE.search(loc)) is not None


def _recent(posted: str) -> bool:
    try:
        when = datetime.fromisoformat(posted.replace("Z", "+00:00"))
    except ValueError:
        return True
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return when >= datetime.now(timezone.utc) - timedelta(days=WINDOW_DAYS)


def search_companies(cfg: dict) -> list[dict]:
    s = cfg["search"]
    companies = [c.strip() for c in s.get("target_companies", DEFAULT_COMPANIES) if c.strip()]
    sources = _sources(companies)
    unknown = [c for c, src in sources.items() if not src]
    if unknown:
        log.info("No public careers feed found for: %s", ", ".join(unknown))

    skipped = []

    def fetch(item):
        company, src = item
        label = company.split("=")[0].strip() if "=" in company else (
            WD_URL.match(company)["tenant"].title() if WD_URL.match(company) else company)
        try:
            if src["ats"] == "workday":
                return label, src, _workday(src["slug"].split("=")[-1].strip(), label, s["roles"])
            return label, src, FETCHERS[src["ats"]](src["slug"], company)
        except Exception as e:   # any trouble with one company's site: skip it, the rest still count
            log.info("Skipped %s this time: %s", company, e)
            skipped.append(label)
            return company, src, []

    jobs = []
    with ThreadPoolExecutor(8) as ex:
        for company, src, postings in ex.map(fetch, [(c, src) for c, src in sources.items() if src]):
            for p in postings:
                if not (_location_ok(p["location"], s["locations"]) and _recent(p["posted"])):
                    continue
                if not p["description"] and p.get("detail"):
                    try:   # some systems list only titles: read the full ad for jobs that pass the location check
                        d = _get(p["detail"])
                        if p.get("workday"):
                            info = d.get("jobPostingInfo", {})
                            p["description"], p["url"] = _text(info.get("jobDescription", "")), info.get("externalUrl") or p["url"]
                        elif "jobAd" in d:
                            ad = d["jobAd"].get("sections", {})
                            p["description"] = "\n\n".join(_text(v.get("text", "")) for v in ad.values() if isinstance(v, dict))
                        else:
                            p["description"] = _text(d.get("description", "") or d.get("descriptionHtml", ""))
                    except Exception:   # keep the listing without its full text
                        pass
                job = _row(p["url"], company, p["title"], p["location"], p["description"] or p["title"],
                           p["posted"], p["budget"] or "Not disclosed", f"{company} careers")
                job["Notes"] = "⭐ Target company · apply on their careers page"
                jobs.append(job)
    log.info("Target companies: %d openings in your locations from %d companies", len(jobs), sum(1 for v in sources.values() if v))
    if skipped:
        log.info("Skipped %d compan%s with site problems, tried again next run: %s",
                 len(skipped), "y" if len(skipped) == 1 else "ies", ", ".join(sorted(skipped)))
    return jobs


def company_status(companies: list[str]) -> dict:
    """For Settings: which listed companies have a readable careers feed (only uses the cache)."""
    try:
        cache = json.loads(SOURCES_PATH.read_text())
    except (OSError, ValueError):
        cache = {}
    return {c: (cache[c]["ats"] if cache.get(c) else ("not found" if c in cache else "checking on next search"))
            for c in companies}
