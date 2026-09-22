"""
Application-form autofill assistant (Playwright).

Design constraints, matching the project's own safety spec -- this is a
personal-use autofill assistant that runs against the ATS page a real person
gives it, not a mass-apply bot that scrapes and blasts applications across
sites (see the note on that scope decision below):
  - Only fills fields it can confidently map from the user's profile.
  - NEVER attempts to solve/bypass a CAPTCHA -- it detects common CAPTCHA
    markers and immediately pauses for the human.
  - NEVER clicks a final "Submit application" control -- it stops one step
    before submission and hands control back to the user in the opened browser.
  - Runs against whatever ATS page URL the user gives it; form-field mapping
    is heuristic (by input name/label/placeholder), tuned for the common
    Greenhouse/Lever/Workday-style field naming conventions, but isn't
    guaranteed universal -- arbitrary custom ATS UIs may need manual review.

Why this isn't a LinkedIn-style "Easy Apply" bot: LinkedIn's Terms of Service
explicitly prohibit automated interaction with the site, and mass-automated
application tools targeting it have drawn takedown notices and legal action
(see hiQ Labs v. LinkedIn and the cease-and-desist LinkedIn sent the
AIHawk/Auto_Jobs_Applier project). This tool instead works the way a person
using autofill would -- one application, one page, at your direction, always
pausing for your review -- which is both safer and works on the vast
majority of company career sites (Greenhouse, Lever, Workday, iCIMS, etc.)
that don't prohibit this kind of personal-use assistance.

Playwright's browser binaries must be installed once with:
    playwright install chromium
"""

CAPTCHA_MARKERS = ["captcha", "g-recaptcha", "h-captcha", "hcaptcha", "cf-turnstile"]

# Fields matched by input name/id/placeholder/aria-label containing any alias.
# Order matters: more specific keys (first_name) are checked before the
# generic fallback (name) so "First Name" doesn't get swallowed by "name".
FIELD_MAP = {
    "first_name": ["first_name", "firstname", "first-name", "fname"],
    "last_name": ["last_name", "lastname", "last-name", "lname"],
    "name": ["full_name", "fullname", "applicant_name", "your name", "name"],
    "email": ["email", "e-mail"],
    "phone": ["phone", "mobile", "telephone"],
    "location": ["location", "city", "address"],
    "linkedin": ["linkedin"],
    "portfolio": ["portfolio", "website", "github", "personal site"],
    "cover_letter": ["cover_letter", "cover letter", "coverletter", "message to hiring"],
}

RESUME_FILE_MARKERS = ["resume", "cv", "curriculum"]


def application_assistance(fields: dict) -> dict:
    """Non-browser preview: shows what WOULD be filled and why, without touching
    a real page. Useful for the frontend's review step / for environments with
    no Playwright browser installed."""
    return {
        "status": "ready_for_user_review",
        "fields": fields,
        "captcha_action": "pause_for_user",
        "legal_consent": "user_must_review",
        "final_submission": "requires_user_authorization",
    }


def _derive_name_parts(profile: dict) -> dict:
    """If only a full `name` is given, derive first/last so forms that split
    the name into two inputs (very common on Greenhouse/Workday) still fill."""
    derived = dict(profile)
    if profile.get("name") and not (profile.get("first_name") or profile.get("last_name")):
        parts = profile["name"].strip().split(" ", 1)
        derived["first_name"] = parts[0]
        derived["last_name"] = parts[1] if len(parts) > 1 else ""
    return derived


def autofill_application_page(url: str, profile: dict, headless: bool = False, resume_file_path: str | None = None) -> dict:
    """Open the given application page in a real (visible, by default) browser
    and fill fields it can confidently map from `profile` -- including
    attaching a resume file to a detected upload field, if resume_file_path is
    given. Stops and reports back instead of submitting, and immediately
    pauses if a CAPTCHA is detected."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return {"status": "error", "message": "Playwright is not installed. Run: pip install playwright && playwright install chromium"}

    from urllib.parse import urlparse
    parsed = urlparse((url or "").strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return {"status": "error", "message": "Enter a complete http:// or https:// application URL."}

    profile = _derive_name_parts(profile)
    filled, skipped = [], []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=headless)
            page = browser.new_page()
            page.goto(url, wait_until="domcontentloaded", timeout=30000)

            page_html = page.content().lower()
            if any(marker in page_html for marker in CAPTCHA_MARKERS):
                browser.close()
                return {"status": "paused_captcha", "message": "CAPTCHA detected -- stopped without attempting to bypass it. Please complete this application manually.", "url": url}

            # Text/email/tel/textarea fields
            inputs = page.query_selector_all("input:not([type=file]):not([type=submit]):not([type=button]), textarea")
            for el in inputs:
                identifiers = " ".join(filter(None, [
                    el.get_attribute("name") or "", el.get_attribute("id") or "",
                    el.get_attribute("placeholder") or "", el.get_attribute("aria-label") or "",
                ])).lower()
                mapped_key = next((k for k, aliases in FIELD_MAP.items() if any(a in identifiers for a in aliases)), None)
                if mapped_key and profile.get(mapped_key):
                    try:
                        el.fill(str(profile[mapped_key]))
                        filled.append(mapped_key)
                    except Exception:
                        skipped.append(mapped_key)

            # Resume file upload field, if we have a file to attach
            if resume_file_path:
                file_inputs = page.query_selector_all("input[type=file]")
                for el in file_inputs:
                    identifiers = " ".join(filter(None, [
                        el.get_attribute("name") or "", el.get_attribute("id") or "",
                        el.get_attribute("aria-label") or "",
                    ])).lower()
                    if any(marker in identifiers for marker in RESUME_FILE_MARKERS) or len(file_inputs) == 1:
                        try:
                            el.set_input_files(resume_file_path)
                            filled.append("resume_file")
                        except Exception:
                            skipped.append("resume_file")
                        break

            # Deliberately do NOT click submit. Leave the browser open (if not
            # headless) for the user to review and submit themselves.
            if headless:
                browser.close()

            return {
                "status": "paused_for_user_review",
                "url": url,
                "filled_fields": filled,
                "skipped_fields": skipped,
                "final_submission": "requires_user_authorization -- browser left open for manual review/submit" if not headless else "browser closed headless; re-run with headless=False to review before submitting",
            }
    except Exception as e:
        return {"status": "error", "message": str(e)}
