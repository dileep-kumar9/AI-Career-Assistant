import re
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

_STOP_EXTRA = {"and", "or", "the", "a", "an", "to", "of", "in", "for", "with", "on", "at", "is", "are"}


def _tokenize(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-zA-Z][a-zA-Z+.#-]{1,}", text.lower()) if w not in _STOP_EXTRA}


def analyze_resume(resume_text: str, job_description: str = "") -> dict:
    """Real ATS-style keyword-gap analysis, plus a TF-IDF cosine similarity score
    (a genuine, if heuristic, proxy for how closely the resume matches the JD --
    this is the same core technique many real ATS keyword scanners use)."""
    resume_tokens = _tokenize(resume_text)
    jd_tokens = _tokenize(job_description) if job_description else set()

    matched = sorted(resume_tokens & jd_tokens)
    missing = sorted(jd_tokens - resume_tokens)

    similarity = 0.0
    if job_description.strip() and resume_text.strip():
        try:
            vec = TfidfVectorizer(stop_words="english")
            m = vec.fit_transform([resume_text, job_description])
            similarity = round(float(cosine_similarity(m[0], m[1])[0][0]) * 100, 2)
        except ValueError:
            similarity = 0.0

    return {
        "match_score_percent": similarity,
        "matched_terms": matched[:100],
        "missing_terms": missing[:100],
        "matched_count": len(matched),
        "missing_count": len(missing),
        "note": "Keyword/TF-IDF analysis is a heuristic proxy for ATS scoring, not an official ATS result.",
    }
