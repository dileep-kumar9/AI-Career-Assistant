"""
Real job discovery using public, no-authentication job board APIs.

Neither of these requires an API key and neither involves scraping a site
that forbids it -- both publish an open JSON API for this exact purpose:
  - Arbeitnow  (https://www.arbeitnow.com/api/job-board-api)
  - RemoteOK   (https://remoteok.com/api)

If you later get keys for Adzuna, JSearch (RapidAPI), etc., add another
_fetch_* function following the same pattern and merge it into discover_jobs.
"""
import requests
from app.core.config import settings

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; AICareerAssistant/1.0)"}


def _fetch_arbeitnow(query: str) -> list[dict]:
    try:
        resp = requests.get(settings.ARBEITNOW_API, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        data = resp.json().get("data", [])
    except requests.RequestException:
        return []
    q = query.lower()
    jobs = []
    for j in data:
        title = j.get("title", "")
        if q and q not in title.lower() and q not in " ".join(j.get("tags", [])).lower():
            continue
        jobs.append({
            "external_id": j.get("slug"),
            "title": title,
            "company": j.get("company_name"),
            "location": j.get("location") or ("Remote" if j.get("remote") else ""),
            "url": j.get("url"),
            "description": j.get("description", ""),
            "source": "arbeitnow",
        })
    return jobs


def _fetch_remoteok(query: str) -> list[dict]:
    try:
        resp = requests.get(settings.REMOTEOK_API, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        data = resp.json()
    except requests.RequestException:
        return []
    q = query.lower()
    jobs = []
    for j in data:
        if not isinstance(j, dict) or "position" not in j:
            continue  # first element is a legal-notice object, not a job
        title = j.get("position", "")
        tags = " ".join(j.get("tags", []))
        if q and q not in title.lower() and q not in tags.lower():
            continue
        jobs.append({
            "external_id": str(j.get("id")),
            "title": title,
            "company": j.get("company"),
            "location": j.get("location") or "Remote",
            "url": j.get("url"),
            "description": j.get("description", ""),
            "source": "remoteok",
        })
    return jobs


def discover_jobs(query: str = "", limit: int = 25) -> list[dict]:
    jobs = _fetch_arbeitnow(query) + _fetch_remoteok(query)
    # Deduplicate by (title, company)
    seen = set()
    deduped = []
    for j in jobs:
        key = (j["title"].strip().lower(), (j["company"] or "").strip().lower())
        if key in seen:
            continue
        seen.add(key)
        deduped.append(j)
    return deduped[:limit]
