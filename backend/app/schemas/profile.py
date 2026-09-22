from pydantic import BaseModel
class ProfileCreate(BaseModel):
    target_role: str | None = None
    location: str | None = None
    work_preference: str | None = None
    education: str | None = None
    experience: str | None = None
    skills: str | None = None
    projects: str | None = None
    certifications: str | None = None
    achievements: str | None = None
class ProfileResponse(ProfileCreate):
    id: int
    user_id: int
    model_config = {"from_attributes": True}
