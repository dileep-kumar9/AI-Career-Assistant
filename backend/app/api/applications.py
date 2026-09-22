from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.schemas.application import ApplicationCreate, ApplicationResponse, ApplicationStatusUpdate
from app.services import tracker

router = APIRouter(prefix="/users/{user_id}/applications", tags=["Application Tracker"])


@router.post("/", response_model=ApplicationResponse, status_code=201)
def create(user_id: int, data: ApplicationCreate, db: Session = Depends(get_db)):
    obj = tracker.create_application(db, user_id, data)
    if not obj:
        raise HTTPException(409, "An application for this company/title already exists (duplicate detected)")
    return obj


@router.get("/", response_model=list[ApplicationResponse])
def list_all(user_id: int, status: str | None = None, db: Session = Depends(get_db)):
    return tracker.list_applications(db, user_id, status)


@router.get("/summary")
def summary(user_id: int, db: Session = Depends(get_db)):
    return tracker.tracker_summary(db, user_id)


@router.patch("/{app_id}/status", response_model=ApplicationResponse)
def update_status(user_id: int, app_id: int, data: ApplicationStatusUpdate, db: Session = Depends(get_db)):
    obj = tracker.update_application_status(db, user_id, app_id, data.status)
    if not obj:
        raise HTTPException(404, "Application not found")
    return obj


@router.delete("/{app_id}")
def remove(user_id: int, app_id: int, db: Session = Depends(get_db)):
    obj = tracker.delete_application(db, user_id, app_id)
    if not obj:
        raise HTTPException(404, "Application not found")
    return {"message": "Application deleted", "id": app_id}
