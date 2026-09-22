from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.user import User
from app.schemas.resume import ResumeCreate, ResumeResponse
from app.schemas.ai import TailorResumeRequest, ResumeExportRequest
from app.services.resume_service import (create_resume, list_resumes, get_resume, delete_resume,
                                          ingest_uploaded_file, save_uploaded_file, tailor_resume, export_resume,
                                          get_master_resume, set_master_resume)
from pydantic import BaseModel

router = APIRouter(prefix="/users/{user_id}/resumes", tags=["Resume Generator"])


class SetMasterRequest(BaseModel):
    content: str
    title: str = "Master Resume"


@router.post("/", response_model=ResumeResponse, status_code=201)
def create(user_id: int, data: ResumeCreate, db: Session = Depends(get_db)):
    return create_resume(db, user_id, data)


@router.post("/upload", response_model=ResumeResponse, status_code=201)
async def upload(user_id: int, title: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Upload a master resume as .txt/.pdf/.docx -- text is extracted for real
    and stored so it can be tailored/analyzed later."""
    if not db.query(User).filter(User.id == user_id).first():
        raise HTTPException(404, "User not found. Sign in again and retry.")
    filename = (file.filename or "").lower()
    if not filename.endswith((".pdf", ".docx", ".txt")):
        raise HTTPException(415, "Unsupported resume type. Upload a PDF, DOCX, or TXT file.")
    content_bytes = await file.read()
    if not content_bytes:
        raise HTTPException(400, "The selected file is empty.")
    if len(content_bytes) > 10 * 1024 * 1024:
        raise HTTPException(413, "Resume is larger than 10 MB. Please upload a smaller file.")
    try:
        text = ingest_uploaded_file(content_bytes, file.filename)
    except Exception as exc:
        raise HTTPException(400, f"Could not read this resume. Check that the file is a valid PDF/DOCX/TXT: {exc}") from exc
    if not text.strip():
        raise HTTPException(400, "No readable text found. Scanned PDFs may need OCR; try a text-based PDF, DOCX, or TXT.")
    saved_path = save_uploaded_file(user_id, content_bytes, file.filename)
    data = ResumeCreate(title=title, content=text, resume_type="master")
    return create_resume(db, user_id, data, source_file=saved_path)


@router.get("/", response_model=list[ResumeResponse])
def list_all(user_id: int, db: Session = Depends(get_db)):
    return list_resumes(db, user_id)


@router.get("/master", response_model=ResumeResponse)
def get_master(user_id: int, db: Session = Depends(get_db)):
    """The user's single current master resume, if any -- lets the frontend
    auto-load it (from a PDF/DOCX upload or paste) without re-fetching and
    filtering the whole resume list every time."""
    obj = get_master_resume(db, user_id)
    if not obj:
        raise HTTPException(404, "No master resume saved yet -- upload or paste one first.")
    return obj


@router.post("/set-master", response_model=ResumeResponse)
def promote_to_master(user_id: int, req: SetMasterRequest, db: Session = Depends(get_db)):
    """Promote content (typically a resume you just tailored) to become the
    new master resume -- overwrites the existing one instead of creating a
    separate, disconnected copy."""
    return set_master_resume(db, user_id, req.content, req.title)


@router.get("/{resume_id}", response_model=ResumeResponse)
def get_one(user_id: int, resume_id: int, db: Session = Depends(get_db)):
    obj = get_resume(db, user_id, resume_id)
    if not obj:
        raise HTTPException(404, "Resume not found")
    return obj


@router.delete("/{resume_id}")
def remove(user_id: int, resume_id: int, db: Session = Depends(get_db)):
    obj = delete_resume(db, user_id, resume_id)
    if not obj:
        raise HTTPException(404, "Resume not found")
    return {"message": "Resume deleted", "id": resume_id}


@router.post("/tailor")
def tailor(user_id: int, req: TailorResumeRequest, db: Session = Depends(get_db)):
    """Tailor a master resume's text to a job description via the LLM (or fallback),
    optionally saving a new 'tailored' Resume row and/or exporting to .docx/.pdf."""
    result = tailor_resume(req.master_resume_text, req.job_description)
    response = dict(result)
    if req.export_format and result.get("resume_markdown"):
        path = export_resume(result["resume_markdown"], req.export_format)
        response["file_path"] = __import__("os").path.basename(path)
    return response


@router.post("/export")
def export_current(user_id: int, req: ResumeExportRequest, db: Session = Depends(get_db)):
    """Export the exact resume currently shown in the editor; never re-run AI tailoring."""
    if not db.query(User).filter(User.id == user_id).first():
        raise HTTPException(404, "User not found. Sign in again and retry.")
    if not req.resume_markdown.strip():
        raise HTTPException(400, "Resume content is empty.")
    if req.export_format not in {"docx", "pdf"}:
        raise HTTPException(400, "Export format must be docx or pdf.")
    path = export_resume(req.resume_markdown, req.export_format)
    return {"file_path": __import__("os").path.basename(path)}


@router.get("/download/{filename}")
def download(filename: str):
    import os
    from app.services.resume_service import GENERATED_DIR
    path = os.path.join(GENERATED_DIR, filename)
    if not os.path.isfile(path):
        raise HTTPException(404, "File not found")
    return FileResponse(path, filename=filename)
