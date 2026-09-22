from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.schemas.interview import InterviewEvaluateRequest, InterviewResponse
from app.services.interview_engine import evaluate_answer, save_interview_turn, list_interview_history

router = APIRouter(prefix="/interview", tags=["Interview System"])


@router.post("/answer", response_model=InterviewResponse)
def submit_answer(req: InterviewEvaluateRequest, db: Session = Depends(get_db)):
    """Evaluate an answer AND persist the Q/A/feedback turn to interview history."""
    result = evaluate_answer(req.question, req.answer, req.expected_topics)
    feedback_text = result.get("feedback") or str(result)
    obj = save_interview_turn(db, req.user_id, req.job_id, req.interview_type, req.mode,
                               req.question, req.answer, feedback_text)
    return obj


@router.get("/history/{user_id}", response_model=list[InterviewResponse])
def history(user_id: int, db: Session = Depends(get_db)):
    return list_interview_history(db, user_id)
