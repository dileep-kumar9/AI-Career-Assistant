from pydantic import BaseModel
from datetime import datetime

class ApplicationCreate(BaseModel):
    job_id: int | None = None
    company: str
    job_title: str
    job_url: str | None = None
    status: str = "New"
    resume_used: str | None = None

class ApplicationResponse(ApplicationCreate):
    id: int
    user_id: int
    application_date: datetime
    model_config = {"from_attributes": True}

class ApplicationStatusUpdate(BaseModel):
    status: str
