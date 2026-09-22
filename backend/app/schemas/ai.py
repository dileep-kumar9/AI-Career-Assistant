from pydantic import BaseModel

class ResumeAnalyzeRequest(BaseModel):
    resume: str = ""
    job_description: str = ""
    user_id: int | None = None  # if resume is blank, auto-pulls the user's saved master resume/profile

class JobMatchRequest(BaseModel):
    profile: str = ""
    job_description: str
    user_id: int | None = None  # if profile is blank, auto-pulls the user's saved master resume/profile

class SkillGapRequest(BaseModel):
    user_skills: list[str]
    required_skills: list[str]

class LearningRequest(BaseModel):
    missing_skills: list[str]
    target_role: str = ""

class RagRequest(BaseModel):
    query: str
    documents: list[str]

class ChatRequest(BaseModel):
    user_id: int
    message: str

class AgentPrepareRequest(BaseModel):
    jd: str
    resume: str = ""
    profile_skills: list[str] = []
    user_id: int | None = None  # if resume/profile_skills are blank, auto-pulls saved data

class TailorResumeRequest(BaseModel):
    master_resume_text: str
    job_description: str
    export_format: str | None = None  # "docx" | "pdf" | None


class ResumeExportRequest(BaseModel):
    resume_markdown: str
    export_format: str
