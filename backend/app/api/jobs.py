from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from app.core.database import get_db
from app.models.job import Job
from app.models.user import User
from app.models.profile import UserProfile
from app.schemas.job import JobResponse, JobLinkRequest
from app.services.job_link import parse_job_link
from app.services.job_discovery import discover_jobs
from app.services.job_matcher import rank_jobs
from app.services.automation import application_assistance, autofill_application_page
from app.services.resume_service import get_master_resume_file_path
from app.services.user_context import resolve_candidate_text

router = APIRouter(prefix="/jobs", tags=["Job Discovery & Application"])


class AutofillRequest(BaseModel):
    url: str
    user_id: int | None = None      # if set, auto-builds the profile dict from saved data
    profile_overrides: dict = {}    # explicit values win over auto-built ones
    headless: bool = False


def _build_profile_dict(db: Session, user_id: int) -> dict:
    user = db.query(User).filter(User.id == user_id).first()
    profile = db.query(UserProfile).filter(UserProfile.user_id == user_id).first()
    data = {}
    if user:
        data.update({"name": user.name, "email": user.email, "phone": user.phone})
    if profile:
        data.update({"location": profile.location})
    return {k: v for k, v in data.items() if v}


@router.get("/discover", response_model=list[JobResponse])
def discover(query: str = "", limit: int = 25, persist: bool = True, db: Session = Depends(get_db)):
    """Real job discovery via public no-auth job board APIs (Arbeitnow + RemoteOK)."""
    jobs = discover_jobs(query, limit)
    if not persist:
        return [JobResponse(id=0, **j) for j in jobs]
    saved = []
    for j in jobs:
        existing = db.query(Job).filter(Job.external_id == j["external_id"], Job.source == j["source"]).first()
        if existing:
            saved.append(existing)
            continue
        obj = Job(**j)
        db.add(obj); db.commit(); db.refresh(obj)
        saved.append(obj)
    return saved


@router.get("/discover/ranked")
def discover_ranked(profile_text: str = "", query: str = "", limit: int = 25, user_id: int | None = None, db: Session = Depends(get_db)):
    """Discover jobs and rank them by real TF-IDF match against a profile/resume
    text. If profile_text is left blank and user_id is given, auto-pulls the
    user's saved master resume/profile -- this is the 'auto search' half of
    auto search & apply."""
    text = resolve_candidate_text(db, user_id, profile_text)
    jobs = discover_jobs(query, limit)
    return rank_jobs(text, jobs)


@router.post("/link")
def job_link(req: JobLinkRequest):
    return parse_job_link(req.url)


@router.post("/application/assist")
def assist(fields: dict):
    return application_assistance(fields)


@router.post("/application/autofill")
def autofill(req: AutofillRequest, db: Session = Depends(get_db)):
    """Opens the job application page and fills matched fields, pausing before
    submission (and immediately on CAPTCHA detection). If user_id is given,
    profile fields (name/email/phone/location) are auto-pulled from the saved
    account instead of needing to be re-typed; profile_overrides always wins.
    Requires Playwright's browser installed locally: `playwright install chromium`."""
    profile = _build_profile_dict(db, req.user_id) if req.user_id else {}
    profile.update(req.profile_overrides)
    resume_path = get_master_resume_file_path(db, req.user_id) if req.user_id else None
    return autofill_application_page(req.url, profile, req.headless, resume_file_path=resume_path)
