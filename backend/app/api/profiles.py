from fastapi import APIRouter,Depends,HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.user import User
from app.models.resume import Resume
from app.schemas.profile import ProfileCreate,ProfileResponse
from app.services.profile_service import *
from app.services.profile_parser import parse_resume_to_profile
router=APIRouter(prefix="/users/{user_id}/profile",tags=["User Profile"])


class ParseFromResumeRequest(BaseModel):
    resume_id: int | None = None
    resume_text: str | None = None
@router.post("/",response_model=ProfileResponse,status_code=201)
def create(user_id:int,data:ProfileCreate,db:Session=Depends(get_db)):
    if not db.query(User).filter(User.id==user_id).first(): raise HTTPException(404,"User not found")
    obj=create_profile(db,user_id,data)
    if not obj: raise HTTPException(409,"Profile already exists")
    return obj
@router.get("/",response_model=ProfileResponse)
def get(user_id:int,db:Session=Depends(get_db)):
    obj=get_profile(db,user_id)
    if not obj: raise HTTPException(404,"Profile not found")
    return obj
@router.put("/",response_model=ProfileResponse)
def update(user_id:int,data:ProfileCreate,db:Session=Depends(get_db)):
    obj=update_profile(db,user_id,data)
    if not obj: raise HTTPException(404,"Profile not found")
    return obj
@router.delete("/")
def remove(user_id:int,db:Session=Depends(get_db)):
    if not delete_profile(db,user_id): raise HTTPException(404,"Profile not found")
    return {"message":"Profile deleted successfully","user_id":user_id}


@router.post("/from-resume", response_model=ProfileResponse)
def from_resume(user_id: int, req: ParseFromResumeRequest, db: Session = Depends(get_db)):
    """Auto-detect profile fields (skills, certifications, experience/internships,
    education, projects, achievements) from a saved resume or pasted resume text,
    then create/update the profile with them. This is what powers 'auto-fill my
    profile from my resume' -- real extraction via LLM, heuristic section-parsing
    fallback otherwise."""
    if not db.query(User).filter(User.id == user_id).first():
        raise HTTPException(404, "User not found")

    resume_text = req.resume_text or ""
    if not resume_text and req.resume_id:
        resume = db.query(Resume).filter(Resume.id == req.resume_id, Resume.user_id == user_id).first()
        if not resume:
            raise HTTPException(404, "Resume not found")
        resume_text = resume.content or ""
    if not resume_text and not req.resume_id:
        latest = (db.query(Resume).filter(Resume.user_id == user_id, Resume.resume_type == "master")
                  .order_by(Resume.id.desc()).first())
        if latest:
            resume_text = latest.content or ""
    if not resume_text.strip():
        raise HTTPException(400, "No resume text available -- pass resume_text, resume_id, or upload a master resume first.")

    result = parse_resume_to_profile(resume_text)
    fields = result["fields"]
    data = ProfileCreate(**{k: fields.get(k, "") for k in ProfileCreate.model_fields})

    existing = get_profile(db, user_id)
    obj = update_profile(db, user_id, data) if existing else create_profile(db, user_id, data)
    return obj
