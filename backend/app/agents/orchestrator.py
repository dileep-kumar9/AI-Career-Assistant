"""
Real multi-step agentic workflow: chains the actual services together instead
of just describing the steps. Each step's real output feeds the next step's
real input.
"""
from app.services.analyzer import analyze_resume
from app.services.skill_gap import skill_gap
from app.services.learning import generate_study_plan
from app.services.interview_engine import next_questions
from app.ai.llm import generate_json
from app.ai.prompts import JD_ANALYSIS_PROMPT


def analyze_jd(jd: str) -> dict:
    """Real JD parsing: LLM-structured when configured, keyword fallback otherwise."""
    result = generate_json(f"{JD_ANALYSIS_PROMPT}\n\nJob description:\n{jd}")
    if result["provider"] == "openai" and result.get("data"):
        return {"provider": "openai", **result["data"]}
    # Fallback: crude keyword extraction as required_skills (stopwords filtered)
    import re
    _STOP = {"and", "the", "with", "for", "you", "your", "are", "our", "will", "this", "that",
             "have", "has", "from", "who", "role", "team", "work", "job", "using", "into", "able",
             "need", "needs", "looking", "experience", "strong", "years", "plus", "about", "what"}
    words = [w for w in re.findall(r"[a-zA-Z][a-zA-Z+.#-]{2,}", jd.lower()) if w not in _STOP]
    freq = {}
    for w in words:
        freq[w] = freq.get(w, 0) + 1
    common = [w for w, _ in sorted(freq.items(), key=lambda x: -x[1])[:20]]
    return {"provider": "fallback", "role": "", "must_have_skills": common, "nice_to_have_skills": [],
            "responsibilities": [], "qualifications": [], "keywords": common}


def prepare_for_job(jd: str, resume: str, profile_skills: list[str] | None = None) -> dict:
    """
    Real end-to-end 'Prepare me for this job' agent:
      1. Analyze JD -> extract required skills
      2. Analyze resume against JD -> keyword/TF-IDF match
      3. Compute skill gaps -> profile skills vs JD required skills
      4. Generate JD-specific interview questions
      5. Build a study plan for the missing skills
    """
    jd_analysis = analyze_jd(jd)
    resume_analysis = analyze_resume(resume, jd)

    required_skills = jd_analysis.get("must_have_skills") or jd_analysis.get("keywords") or []
    user_skills = profile_skills or sorted(resume_analysis["matched_terms"])
    gaps = skill_gap(user_skills, required_skills)

    questions = next_questions(kind="JD-Specific", job_description=jd, n=5)
    study_plan = generate_study_plan(gaps["missing"][:6], target_role=jd_analysis.get("role", ""))

    return {
        "steps_completed": ["analyze_jd", "analyze_resume", "find_skill_gaps", "prepare_questions", "create_learning_plan"],
        "jd_analysis": jd_analysis,
        "resume_analysis": resume_analysis,
        "skill_gaps": gaps,
        "interview_questions": questions,
        "study_plan": study_plan,
    }
