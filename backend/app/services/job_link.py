import requests
from bs4 import BeautifulSoup

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; AICareerAssistant/1.0)"}


def parse_job_link(url: str) -> dict:
    """Fetch a job posting URL the user pasted and extract its visible text as the
    job description. We only read pages a normal browser could load (GET, respecting
    the site's own HTML) -- no login bypass, no scraping of gated content."""
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
    except requests.RequestException as e:
        return {"url": url, "status": "error", "message": f"Could not fetch URL: {e}"}

    soup = BeautifulSoup(resp.text, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()

    title = soup.title.string.strip() if soup.title and soup.title.string else ""
    # Heuristic: job pages usually have their JD in the largest text block;
    # grab all paragraph-like text as a reasonable approximation.
    text_blocks = [t.get_text(" ", strip=True) for t in soup.find_all(["p", "li", "div"]) if t.get_text(strip=True)]
    description = "\n".join(dict.fromkeys(text_blocks))  # de-dupe, preserve order
    description = description[:20000]  # cap size

    return {
        "url": url,
        "status": "parsed" if description else "empty",
        "title": title,
        "description": description,
        "next_step": "Run /ai/resume/analyze or /ai/job/match with this description.",
    }
