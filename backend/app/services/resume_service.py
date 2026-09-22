import os, uuid
from app.models.resume import Resume
from app.ai.llm import generate
from app.ai.prompts import RESUME_TAILOR_PROMPT
from app.utils.document_extractor import render_resume_docx, render_resume_pdf, extract_text_from_bytes

GENERATED_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "generated")
os.makedirs(GENERATED_DIR, exist_ok=True)

UPLOADS_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "uploaded_resumes")
os.makedirs(UPLOADS_DIR, exist_ok=True)


def get_master_resume(db, user_id):
    """The single master resume for this user, if any (most recently updated)."""
    return (db.query(Resume)
            .filter(Resume.user_id == user_id, Resume.resume_type == "master")
            .order_by(Resume.id.desc()).first())


def create_resume(db, user_id, data, source_file: str | None = None):
    """Creates a resume row. For 'master' resumes specifically, this upserts
    into a single master row per user instead of piling up duplicates every
    time someone re-pastes or re-uploads -- so there's always exactly one
    'current' master resume, and it's always the latest content."""
    payload = data.model_dump()
    if source_file:
        payload["source_file"] = source_file
    if payload.get("resume_type") == "master":
        existing = get_master_resume(db, user_id)
        if existing:
            existing.title = payload.get("title", existing.title)
            existing.content = payload.get("content", existing.content)
            if source_file:
                existing.source_file = source_file
            db.commit(); db.refresh(existing)
            return existing
    obj = Resume(user_id=user_id, **payload)
    db.add(obj); db.commit(); db.refresh(obj)
    return obj


def set_master_resume(db, user_id, content: str, title: str = "Master Resume"):
    """Promote arbitrary content (e.g. a tailored resume you just generated)
    to become the user's new master resume -- overwrites the existing master
    row if one exists, creates one otherwise."""
    existing = get_master_resume(db, user_id)
    if existing:
        existing.title = title
        existing.content = content
        db.commit(); db.refresh(existing)
        return existing
    obj = Resume(user_id=user_id, title=title, content=content, resume_type="master")
    db.add(obj); db.commit(); db.refresh(obj)
    return obj


def list_resumes(db, user_id):
    return db.query(Resume).filter(Resume.user_id == user_id).order_by(Resume.resume_type.asc(), Resume.id.desc()).all()


def get_resume(db, user_id, resume_id):
    return db.query(Resume).filter(Resume.id == resume_id, Resume.user_id == user_id).first()


def delete_resume(db, user_id, resume_id):
    obj = get_resume(db, user_id, resume_id)
    if not obj:
        return None
    db.delete(obj); db.commit()
    return obj


def ingest_uploaded_file(file_bytes: bytes, filename: str) -> str:
    """Extract plain text from an uploaded master resume file (.txt/.pdf/.docx)."""
    return extract_text_from_bytes(file_bytes, filename)


def save_uploaded_file(user_id: int, file_bytes: bytes, filename: str) -> str:
    """Persist the ORIGINAL uploaded file (not just its extracted text) to disk,
    so it can later be auto-attached to a resume-upload field by the Apply
    Agent. Returns the saved path. One file per user (overwrites on re-upload,
    matching the single-master-resume design)."""
    ext = os.path.splitext(filename)[1] or ".pdf"
    path = os.path.join(UPLOADS_DIR, f"user_{user_id}_master{ext}")
    with open(path, "wb") as f:
        f.write(file_bytes)
    return path


def get_master_resume_file_path(db, user_id: int) -> str | None:
    """The on-disk path of the user's originally uploaded master resume file,
    if they uploaded one (as opposed to pasting text) -- used by the Apply
    Agent to auto-attach a resume to file-upload fields."""
    obj = get_master_resume(db, user_id)
    if obj and obj.source_file and os.path.isfile(obj.source_file):
        return obj.source_file
    return None


def tailor_resume(master_resume_text: str, job_description: str) -> dict:
    """Real LLM call that rewrites the resume for a JD, truthfully (no invented facts).
    Falls back to a clearly-labeled heuristic reorder when no LLM key is configured."""
    if not master_resume_text.strip():
        return {"provider": "error", "resume_markdown": "", "message": "master_resume_text is empty."}

    prompt = f"{RESUME_TAILOR_PROMPT}\n\nMaster resume:\n{master_resume_text}\n\nJob description:\n{job_description}"
    result = generate(prompt, max_tokens=1800)
    if result["provider"] == "openai":
        return {"provider": "openai", "resume_markdown": result["text"]}

    # Fallback: keep every fact, just resurface it under standard headings so the
    # feature is still usable end-to-end without an API key.
    fallback = (
        "# Resume (heuristic fallback — no LLM key configured)\n\n"
        "## Summary\nSee experience and skills below (tailored rewriting requires OPENAI_API_KEY).\n\n"
        f"## Original Content\n{master_resume_text}\n"
    )
    return {"provider": "fallback", "resume_markdown": fallback, "message": result.get("message", "")}


def export_resume(resume_markdown: str, fmt: str = "docx") -> str:
    """Render a resume (Markdown produced by tailor_resume) to a real .docx or .pdf file
    on disk and return the path."""
    filename = f"resume_{uuid.uuid4().hex[:10]}.{fmt}"
    out_path = os.path.join(GENERATED_DIR, filename)
    if fmt == "docx":
        return render_resume_docx(resume_markdown, out_path)
    if fmt == "pdf":
        return render_resume_pdf(resume_markdown, out_path)
    raise ValueError("fmt must be 'docx' or 'pdf'")
