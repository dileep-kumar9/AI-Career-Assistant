"""Named, reusable multi-step workflows built on top of orchestrator.py."""
from app.agents.orchestrator import prepare_for_job, analyze_jd


def job_preparation_workflow(jd: str, resume: str, profile_skills: list[str] | None = None) -> dict:
    return {"workflow": "agentic_job_preparation", **prepare_for_job(jd, resume, profile_skills)}


def jd_only_workflow(jd: str) -> dict:
    return {"workflow": "jd_analysis_only", "result": analyze_jd(jd)}
