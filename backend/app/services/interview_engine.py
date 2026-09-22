from app.ai.llm import generate_json, generate
from app.ai.prompts import INTERVIEW_QUESTION_PROMPT, INTERVIEW_EVALUATION_PROMPT
from app.models.interview import Interview

QUESTIONS = {
    "HR": ["Tell me about yourself.", "Why do you want this role?", "Where do you see yourself in 3 years?",
           "Why are you leaving/have you left your current role?"],
    "Technical": ["Explain a technical project you worked on in depth.", "How would you debug a failing API in production?",
                  "Walk me through how you'd design a rate limiter.", "What's a bug you're proud of fixing, and why?"],
    "Behavioral": ["Describe a challenging situation and how you handled it.",
                   "Tell me about a time you disagreed with a teammate.",
                   "Describe a time you missed a deadline. What happened?"],
    "JD-Specific": [],  # filled dynamically from the job description
}


def next_questions(kind: str = "HR", job_description: str = "", n: int = 4) -> dict:
    """Real question generation: JD-specific / any type uses the LLM when configured
    to produce genuinely tailored questions; otherwise returns the static bank."""
    prompt = (f"{INTERVIEW_QUESTION_PROMPT}\n\nInterview type: {kind}\n"
              f"Job description (if provided):\n{job_description or 'Not provided'}\n"
              f"Generate {max(1, min(int(n), 20))} questions. Return JSON with a questions array.")
    result = generate_json(prompt)
    generated = result.get("data", {}).get("questions", []) if result.get("provider") == "groq" else []
    if isinstance(generated, list):
        generated = [str(q).strip() for q in generated if str(q).strip()]
    if generated:
        return {"provider": "groq", "questions": generated[:max(1, min(int(n), 20))]}
    bank = QUESTIONS.get(kind, QUESTIONS["HR"])
    if not bank:
        bank = [
            "Which responsibilities in this job description best match your experience, and why?",
            "Describe a project or task that demonstrates a required skill for this role.",
            "What would you prioritize during your first 30 days in this position?",
            "Which requirement in this role would you need to develop further, and how would you approach it?",
        ]
    return {"provider": "fallback", "questions": bank[:max(1, min(int(n), 20))]}


def evaluate_answer(question: str, answer: str, expected_topics: list[str] | None = None) -> dict:
    """Real LLM-based evaluation when configured; deterministic keyword-based
    scoring as a working fallback otherwise."""
    expected_topics = expected_topics or []
    prompt = f"{INTERVIEW_EVALUATION_PROMPT}\n\nQuestion: {question}\nAnswer: {answer}\nExpected topics (optional): {expected_topics}"
    result = generate_json(prompt)
    if result["provider"] == "groq" and result.get("data"):
        d = result["data"]
        return {"provider": "groq", "score": d.get("score"), "strengths": d.get("strengths", []),
                "improvements": d.get("improvements", []), "feedback": d.get("feedback", "")}

    hits = [t for t in expected_topics if t.lower() in answer.lower()]
    word_count = len(answer.split())
    score = min(10, round((len(hits) / max(len(expected_topics), 1)) * 6 + min(word_count / 40, 4), 1)) if expected_topics else min(10, round(word_count / 20, 1))
    return {
        "provider": "fallback",
        "score": score,
        "strengths": [f"Mentioned: {h}" for h in hits] or ["Answer submitted."],
        "improvements": ["Add concrete examples.", "Quantify impact where possible.",
                          "Configure GROQ_API_KEY for a real evaluation instead of this heuristic."],
        "feedback": f"Heuristic score based on length and topic overlap ({len(hits)}/{len(expected_topics)} expected topics hit).",
    }


def save_interview_turn(db, user_id, job_id, interview_type, mode, question, answer, feedback) -> Interview:
    obj = Interview(user_id=user_id, job_id=job_id, interview_type=interview_type, mode=mode,
                     question=question, answer=answer, feedback=feedback)
    db.add(obj); db.commit(); db.refresh(obj)
    return obj


def list_interview_history(db, user_id):
    return db.query(Interview).filter(Interview.user_id == user_id).order_by(Interview.created_at.desc()).all()
