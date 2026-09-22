RESUME_TAILOR_PROMPT = """You are tailoring a candidate's master resume to a specific job description.
Rules:
- NEVER invent employers, titles, dates, degrees, or skills the candidate did not provide.
- You may rephrase, reorder, and emphasize truthful content to better match the job description.
- Prefer the candidate's strongest truthful matches to the job's stated requirements.
Return the tailored resume as clean Markdown with sections: Summary, Skills, Experience, Projects, Education."""

JD_ANALYSIS_PROMPT = """Extract structured information from this job description.
Return JSON with keys: role, seniority, must_have_skills (list), nice_to_have_skills (list),
responsibilities (list), qualifications (list), keywords (list of 15-25 ATS-relevant keywords)."""

INTERVIEW_QUESTION_PROMPT = """Generate interview questions for the given interview type and job context.
Return JSON: {"questions": ["...", "..."]}"""

INTERVIEW_EVALUATION_PROMPT = """Evaluate the candidate's interview answer for relevance, correctness, clarity,
completeness, and communication. Be specific and constructive, not generic.
Return JSON: {"score": 0-10, "strengths": [...], "improvements": [...], "feedback": "2-3 sentence summary"}"""

CAREER_CHAT_PROMPT = """You are the user's career assistant. Answer using ONLY the user's own profile,
resume, and retrieved career context provided below. If the context doesn't contain the answer, say so
plainly rather than guessing."""

STUDY_PLAN_PROMPT = """Given these missing skills for a target role, produce a focused study plan.
Return JSON: {"plan": [{"skill": "...", "why_it_matters": "...", "steps": ["...","..."], "est_hours": N}]}"""
