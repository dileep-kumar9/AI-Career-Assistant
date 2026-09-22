from app.services.analyzer import analyze_resume


def match_job(profile_text: str, job_description: str) -> dict:
    """Match a candidate profile/resume against a JD. Reuses the same real
    TF-IDF + keyword-overlap engine as the resume analyzer for a consistent score."""
    result = analyze_resume(profile_text, job_description)
    return {
        "match_percentage": result["match_score_percent"],
        "matched_terms": result["matched_terms"],
        "missing_terms": result["missing_terms"],
    }


def rank_jobs(profile_text: str, jobs: list[dict]) -> list[dict]:
    """Given a list of job dicts (each with a 'description'), return them sorted
    by match score against the profile, each annotated with match_percentage."""
    ranked = []
    for job in jobs:
        score = match_job(profile_text, job.get("description", "") or "")["match_percentage"]
        ranked.append({**job, "match_percentage": score})
    return sorted(ranked, key=lambda j: j["match_percentage"], reverse=True)
