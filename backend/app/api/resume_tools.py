"""
Account-free endpoints. These deliberately do NOT require a user_id, so the
Resume Maker and Auto-Apply features work for a guest who hasn't created a
profile/account -- nothing here is persisted unless the caller separately
saves it via the user-scoped resume/profile endpoints.
"""
import os
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from app.services.resume_service import tailor_resume, export_resume, GENERATED_DIR
from app.schemas.ai import ResumeExportRequest
from app.services.profile_parser import parse_resume_to_profile
from app.services.automation import application_assistance, autofill_application_page

router = APIRouter(prefix="/resume-tools", tags=["Resume Tools (no login required)"])


class GuestTailorRequest(BaseModel):
    master_resume_text: str
    job_description: str
    export_format: str | None = None  # "docx" | "pdf" | None


class GuestParseRequest(BaseModel):
    resume_text: str


class GuestAutofillRequest(BaseModel):
    url: str
    profile: dict
    headless: bool = False


@router.post("/tailor")
def guest_tailor(req: GuestTailorRequest):
    """Tailor a resume to a job description -- no account needed. Nothing is saved."""
    result = tailor_resume(req.master_resume_text, req.job_description)
    response = dict(result)
    if req.export_format and result.get("resume_markdown"):
        response["file_path"] = os.path.basename(export_resume(result["resume_markdown"], req.export_format))
    return response


@router.post("/export")
def guest_export(req: ResumeExportRequest):
    """Export the exact resume currently shown in the guest editor; never re-run AI tailoring."""
    if not req.resume_markdown.strip():
        raise HTTPException(400, "Resume content is empty.")
    if req.export_format not in {"docx", "pdf"}:
        raise HTTPException(400, "Export format must be docx or pdf.")
    return {"file_path": os.path.basename(export_resume(req.resume_markdown, req.export_format))}


@router.post("/parse-preview")
def guest_parse_preview(req: GuestParseRequest):
    """Preview what would be auto-detected from a resume, without saving it
    anywhere -- useful for the guest Resume Maker flow."""
    return parse_resume_to_profile(req.resume_text)


@router.get("/download/{filename}")
def download(filename: str):
    path = os.path.join(GENERATED_DIR, filename)
    if not os.path.isfile(path):
        raise HTTPException(404, "File not found")
    return FileResponse(path, filename=filename)


@router.post("/application/assist")
def assist(fields: dict):
    return application_assistance(fields)


@router.post("/application/autofill")
def autofill(req: GuestAutofillRequest):
    """Same safety-first autofill as /jobs/application/autofill (pauses on
    CAPTCHA, never submits) but takes the profile dict directly -- no account
    needed. Requires Playwright's browser installed locally."""
    return autofill_application_page(req.url, req.profile, req.headless)
