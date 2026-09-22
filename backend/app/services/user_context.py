"""
Resolves "what do we already know about this user" so other endpoints can
auto-pull saved resume/profile data instead of requiring the frontend to
re-paste it every time. This is what powers "auto-parse when needed".
"""
from app.models.profile import UserProfile
from app.models.resume import Resume


def get_profile_text(db, user_id: int) -> str:
    p = db.query(UserProfile).filter(UserProfile.user_id == user_id).first()
    if not p:
        return ""
    return " ".join(filter(None, [
        p.target_role, p.location, p.work_preference, p.skills,
        p.experience, p.education, p.projects, p.certifications, p.achievements,
    ]))


def get_latest_master_resume_text(db, user_id: int) -> str:
    r = (db.query(Resume)
         .filter(Resume.user_id == user_id, Resume.resume_type == "master")
         .order_by(Resume.id.desc()).first())
    return r.content if r and r.content else ""


def get_profile_skills(db, user_id: int) -> list[str]:
    p = db.query(UserProfile).filter(UserProfile.user_id == user_id).first()
    if not p or not p.skills:
        return []
    return [s.strip() for s in p.skills.split(",") if s.strip()]


def resolve_candidate_text(db, user_id: int | None, explicit_text: str = "") -> str:
    """Priority: explicit text the caller passed > saved master resume > saved profile."""
    if explicit_text.strip():
        return explicit_text
    if user_id is None:
        return ""
    resume_text = get_latest_master_resume_text(db, user_id)
    if resume_text.strip():
        return resume_text
    return get_profile_text(db, user_id)
