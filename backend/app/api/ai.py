from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.profile import UserProfile
from app.models.resume import Resume
from app.services.analyzer import analyze_resume
from app.services.job_matcher import match_job
from app.services.skill_gap import skill_gap
from app.services.learning import learning_recommendations, generate_study_plan
from app.services.interview_engine import next_questions, evaluate_answer
from app.services.user_context import resolve_candidate_text, get_profile_skills
from app.ai.rag.rag_pipeline import rag_answer
from app.ai.llm import llm_available
from app.agents.orchestrator import prepare_for_job
from app.schemas.ai import (ResumeAnalyzeRequest, JobMatchRequest, SkillGapRequest, LearningRequest,
                             RagRequest, ChatRequest, AgentPrepareRequest)

router = APIRouter(prefix="/ai", tags=["AI"])


@router.get("/status")
def status():
    return {"llm_configured": llm_available()}


@router.post("/resume/analyze")
def resume_analyze(req: ResumeAnalyzeRequest, db: Session = Depends(get_db)):
    """If `resume` is left blank, automatically pulls the user's saved master
    resume (falling back to their profile) instead of requiring a re-paste."""
    resume_text = resolve_candidate_text(db, req.user_id, req.resume)
    return analyze_resume(resume_text, req.job_description)


@router.post("/job/match")
def job_match(req: JobMatchRequest, db: Session = Depends(get_db)):
    """If `profile` is left blank, automatically pulls the user's saved master
    resume/profile instead of requiring a re-paste."""
    profile_text = resolve_candidate_text(db, req.user_id, req.profile)
    return match_job(profile_text, req.job_description)


@router.post("/skills/gap")
def gap(req: SkillGapRequest):
    return skill_gap(req.user_skills, req.required_skills)


@router.post("/learning")
def learning(req: LearningRequest):
    return {
        "curated": learning_recommendations(req.missing_skills),
        "study_plan": generate_study_plan(req.missing_skills, req.target_role),
    }


@router.get("/interview/questions")
def questions(kind: str = "HR", job_description: str = "", n: int = 4):
    return next_questions(kind, job_description, n)


class EvaluatePreviewRequest(BaseModel):
    question: str
    answer: str
    expected_topics: list[str] = []


@router.post("/interview/evaluate-preview")
def evaluate_preview(req: EvaluatePreviewRequest):
    """Stateless evaluation preview (no DB write, no account needed) -- see
    /interview/answer for the persisted, account-scoped version."""
    return evaluate_answer(req.question, req.answer, req.expected_topics)


@router.post("/rag")
def rag(req: RagRequest):
    return rag_answer(req.query, req.documents)


@router.post("/chat")
def chat(req: ChatRequest, db: Session = Depends(get_db)):
    """Career chat grounded in the user's own stored profile + resumes (RAG)."""
    profile = db.query(UserProfile).filter(UserProfile.user_id == req.user_id).first()
    resumes = db.query(Resume).filter(Resume.user_id == req.user_id).all()
    documents = []
    if profile:
        documents.append(" ".join(filter(None, [
            profile.target_role, profile.location, profile.work_preference,
            profile.education, profile.experience, profile.skills,
            profile.projects, profile.certifications, profile.achievements,
        ])))
    documents.extend([r.content for r in resumes if r.content])
    if not documents:
        documents = [""]
    return rag_answer(req.message, documents)


@router.post("/agent/prepare")
def prepare(req: AgentPrepareRequest, db: Session = Depends(get_db)):
    """If `resume`/`profile_skills` are left blank, automatically pulls the
    user's saved data so this can be run with just a job description."""
    resume_text = resolve_candidate_text(db, req.user_id, req.resume)
    skills = req.profile_skills or (get_profile_skills(db, req.user_id) if req.user_id else [])
    return prepare_for_job(req.jd, resume_text, skills or None)
