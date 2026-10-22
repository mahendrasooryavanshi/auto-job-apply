"""Score a job against the candidate's skills."""
import re

SEP = r"[\s.\-_/]?"
FULL_MATCH_WEIGHT = 6   # primary skills weigh 2, secondary 1


def _pattern(skill: str) -> re.Pattern:
    """Match a skill however a post spells it: nodejs ~ Node.js ~ Node JS, reactjs ~ React, postgressql ~ PostgreSQL."""
    compact = re.sub(r"[^a-z0-9+#]", "", skill.lower())
    compact = re.sub(r"(.)\1+", r"\1", compact)          # tolerate doubled letters (postgresSql)
    if compact.endswith("js") and len(compact) > 4:       # "reactjs" also matches plain "React"
        body, suffix = compact[:-2], f"(?:{SEP}js)?"
    else:
        body, suffix = compact, ""
    letters = SEP.join(re.escape(c) + "+" for c in body)
    return re.compile(rf"(?<![a-z0-9]){letters}{suffix}(?![a-z0-9])")


def _has(text: str, skill: str) -> bool:
    return bool(skill.strip()) and _pattern(skill).search(text) is not None


def score(job: dict, search: dict) -> tuple[int, list[str]]:
    """Return (match percent, matched skills). Primary skills count double."""
    text = f"{job['Role']} {job['Description']}".lower()
    primary = [s for s in search["primary_skills"] if _has(text, s)]
    secondary = [s for s in search.get("secondary_skills", []) if _has(text, s) and s not in primary]
    total = 2 * len(search["primary_skills"]) + len(search.get("secondary_skills", []))
    # A post rarely lists the whole stack, so ~3 matching primary skills already counts as a full match;
    # otherwise a long skill list would push every job below the threshold.
    target = min(total, FULL_MATCH_WEIGHT)
    pct = min(100, round(100 * (2 * len(primary) + len(secondary)) / target)) if target else 0
    return pct, primary + secondary


YEARS_RE = re.compile(r"(\d{1,2})\s*(?:\+|(?:-|–|to)\s*\d{1,2})?\s*\+?\s*(?:years?|yrs?)", re.I)
SENIOR_TITLE_RE = re.compile(r"\b(principal|architect|head|director|vp|manager|staff)\b", re.I)
# Titles that mention a stack but aren't developer jobs (recruiters hiring Node devs, test/support/security roles)
NON_DEV_TITLE_RE = re.compile(r"\b(recruit\w*|talent|sourcer|sales|marketing|account (executive|manager)|customer|support|"
                              r"tse|qa|quality|in test|tester|sdet|security|data scientist|analyst|designer|"
                              r"product manager|program manager|project manager|scrum|devops|sre|site reliability|"
                              r"hr|human resources|finance|legal|consultant|writer|documentation|"
                              r"administrator|dba|evangelist|advocate)\b", re.I)
# A frontend skill in the title doesn't make "Senior .NET Full Stack Developer (React)" a Node job
FRONTEND_ONLY = {"reactjs", "react", "nextjs", "redux", "angular", "vue", "javascript", "typescript", "html", "css"}
JUNIOR_TITLE_RE = re.compile(r"\b(intern|internship|trainee|fresher|apprentice)\b", re.I)


def required_years(text: str) -> int | None:
    """Smallest 'N years' requirement in the text, e.g. '3-5 years' -> 3, '8+ yrs' -> 8."""
    found = [int(m.group(1)) for m in YEARS_RE.finditer(text) if 0 < int(m.group(1)) <= 25]
    return min(found) if found else None


def reject_reason(job: dict, search: dict, experience: int = 0) -> str | None:
    """Why a job doesn't suit the candidate, or None if it does."""
    title = job["Role"].lower()
    text = f"{title} {job['Description']}".lower()
    hit = next((k for k in search.get("exclude_keywords") or [] if _has(text, k)), None)
    if hit:
        return f"mentions “{hit}” (your skip list)"
    if (job.get("Company") or "").lower() in (c.lower() for c in search.get("exclude_companies") or []):
        return "company is on your skip list"
    non_dev = NON_DEV_TITLE_RE.search(title)
    if non_dev:
        return f"not a developer role ({non_dev.group(1)})"
    required = search.get("required_skills") or []
    if required and not any(_has(text, s) for s in required):
        return f"doesn't mention {' / '.join(required)}"
    other = [k for k in search.get("exclude_title_keywords") or [] if _has(title, k)]
    backend = [s for s in required + search["primary_skills"] if s.lower() not in FRONTEND_ONLY]
    if other and not any(_has(title, s) for s in backend):
        return f"title is a {other[0]} role"
    if experience:
        if experience >= 2 and JUNIOR_TITLE_RE.search(title):
            return "internship / fresher role"
        if experience < 6 and SENIOR_TITLE_RE.search(title):
            return f"too senior ({SENIOR_TITLE_RE.search(title).group(1)})"
        years = required_years(text)
        if years and years > experience + 2:
            return f"needs {years}+ years"
    cities = [l.lower() for l in search.get("locations", []) if l.lower() not in ("india", "remote")]
    loc = (job.get("Location") or "").lower()
    if cities and loc and loc != "india" and "remote" not in loc and not any(c in loc for c in cities):
        return f"location {job['Location']}"
    return None
