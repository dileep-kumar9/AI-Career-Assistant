from pydantic import BaseModel
class ResumeCreate(BaseModel):
    title: str
    content: str = ""
    resume_type: str = "master"
    job_id: int | None = None
class ResumeResponse(ResumeCreate):
    id: int
    user_id: int
    source_file: str | None = None
    model_config = {"from_attributes": True}
