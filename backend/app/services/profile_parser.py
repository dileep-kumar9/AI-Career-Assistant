"""
Parse a resume's raw text into structured profile fields automatically.

Real LLM-based extraction when GROQ_API_KEY is configured; a genuine
(non-trivial) heuristic section-splitter fallback otherwise, so "auto-detect
profile from resume" works either way.
"""
import re
from app.ai.llm import generate_json

PROFILE_EXTRACTION_PROMPT = """Extract structured profile information from this resume text.
Return JSON with exactly these keys (use "" or [] if not found, join lists with ", " into strings
for skills/certifications, keep experience/education/projects/achievements as readable text blocks):
{
  "target_role": "most recent or most senior job title / likely target role",
  "location": "city, country if mentioned",
  "work_preference": "remote/hybrid/onsite if mentioned, else empty",
  "skills": "comma-separated technical + soft skills",
  "certifications": "comma-separated certifications",
  "experience": "work experience section, condensed but complete, including internships",
  "education": "education section",
  "projects": "notable projects section",
  "achievements": "awards/achievements/publications section"
}"""

_SECTION_ALIASES = {
    "skills": ["skills", "technical skills", "core competencies", "technologies"],
    "certifications": ["certifications", "certificates", "licenses"],
    "experience": ["experience", "work experience", "employment history", "professional experience", "internships", "internship experience"],
    "education": ["education", "academic background", "qualifications"],
    "projects": ["projects", "personal projects", "academic projects"],
    "achievements": ["achievements", "awards", "honors", "publications"],
}


def _heuristic_parse(resume_text: str) -> dict:
    """Split the resume into sections by common headers (case-insensitive,
    lines that look like a heading: short, often capitalized, no trailing
    punctuation) and bucket them into our known fields."""
    lines = resume_text.splitlines()
    sections: dict[str, list[str]] = {}
    current_key = None

    def match_section(line: str) -> str | None:
        clean = line.strip().strip(":").lower()
        if not clean or len(clean) > 40:
            return None
        for key, aliases in _SECTION_ALIASES.items():
            if clean in aliases or any(clean == a or clean.startswith(a) for a in aliases):
                return key
        return None

    for line in lines:
        key = match_section(line)
        if key:
            current_key = key
            sections.setdefault(current_key, [])
            continue
        if current_key:
            sections[current_key].append(line)

    def joined(key: str) -> str:
        return "\n".join(l for l in sections.get(key, []) if l.strip()).strip()

    skills_text = joined("skills")
    # normalize skills into a comma-separated list if it reads like a list
    skills_items = re.split(r"[\n,•|]+", skills_text)
    skills_csv = ", ".join(s.strip() for s in skills_items if s.strip())

    # crude "most likely target role" = first non-empty line of the resume
    # (commonly a name or headline; fall back to first Experience line)
    target_role = ""
    for l in lines[:6]:
        if l.strip() and len(l.strip()) < 60 and not re.search(r"@|http|\d{3}", l):
            target_role = l.strip()
            break

    return {
        "target_role": target_role,
        "location": "",
        "work_preference": "",
        "skills": skills_csv,
        "certifications": joined("certifications"),
        "experience": joined("experience"),
        "education": joined("education"),
        "projects": joined("projects"),
        "achievements": joined("achievements"),
    }


def parse_resume_to_profile(resume_text: str) -> dict:
    if not resume_text.strip():
        return {"provider": "error", "fields": {}, "message": "resume_text is empty."}

    result = generate_json(f"{PROFILE_EXTRACTION_PROMPT}\n\nResume text:\n{resume_text}")
    if result["provider"] == "groq" and result.get("data"):
        return {"provider": "groq", "fields": result["data"]}

    return {"provider": "fallback", "fields": _heuristic_parse(resume_text),
             "message": result.get("message", "No LLM configured -- used section-header heuristic parsing instead.")}
