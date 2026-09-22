from app.ai.llm import generate_json
from app.ai.prompts import STUDY_PLAN_PROMPT

# Small curated fallback map so recommendations are still useful with no LLM key.
_CURATED = {
    "python": "Python Docs tutorial -> build a small CLI tool -> read 'Fluent Python' ch. 1-4",
    "sql": "SQLBolt interactive lessons -> practice joins/window functions on a public dataset",
    "react": "Official React docs 'Learn React' -> build a small CRUD app with hooks",
    "docker": "Docker Get Started guide -> containerize one of your own projects",
    "aws": "AWS Cloud Practitioner Essentials (free) -> deploy a small project on S3/Lambda",
    "system design": "'Grokking the System Design Interview' notes -> design 2 systems on paper",
}


def learning_recommendations(missing_skills: list[str]) -> list[dict]:
    return [
        {
            "skill": s,
            "recommendation": _CURATED.get(s.strip().lower(),
                                            f"Learn {s} via official docs, a focused tutorial, and a small project."),
        }
        for s in missing_skills
    ]


def generate_study_plan(missing_skills: list[str], target_role: str = "") -> dict:
    """Real LLM-generated study plan (JSON) when a key is configured; otherwise a
    deterministic fallback built from the curated map so the endpoint still works."""
    if not missing_skills:
        return {"provider": "n/a", "plan": []}
    prompt = f"{STUDY_PLAN_PROMPT}\n\nTarget role: {target_role}\nMissing skills: {missing_skills}"
    result = generate_json(prompt)
    if result["provider"] == "openai" and result.get("data"):
        return {"provider": "openai", "plan": result["data"].get("plan", [])}
    plan = [{"skill": s, "why_it_matters": "Commonly required for this role.",
              "steps": [_CURATED.get(s.strip().lower(), f"Study {s} fundamentals and build a small project.")],
              "est_hours": 10} for s in missing_skills]
    return {"provider": "fallback", "plan": plan}
