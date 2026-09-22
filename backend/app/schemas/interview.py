from pydantic import BaseModel
from datetime import datetime

class InterviewQuestionRequest(BaseModel):
    kind: str = "HR"
    job_description: str = ""
    n: int = 4

class InterviewEvaluateRequest(BaseModel):
    user_id: int
    job_id: int | None = None
    interview_type: str = "HR"
    mode: str = "typing"
    question: str
    answer: str
    expected_topics: list[str] = []

class InterviewResponse(BaseModel):
    id: int
    user_id: int
    job_id: int | None = None
    interview_type: str
    mode: str
    question: str
    answer: str
    feedback: str | None = None
    created_at: datetime
    model_config = {"from_attributes": True}
