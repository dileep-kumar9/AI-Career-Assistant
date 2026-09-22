from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from app.core.config import settings
from app.core.database import get_db
from app.models.user import User

router = APIRouter(prefix="/auth", tags=["Authentication"])

class GoogleCredential(BaseModel):
    credential: str

@router.post("/google")
def google_sign_in(payload: GoogleCredential, db: Session = Depends(get_db)):
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(503, "Google sign-in is not configured. Set GOOGLE_CLIENT_ID in the backend environment.")
    try:
        claims = id_token.verify_oauth2_token(payload.credential, google_requests.Request(), settings.GOOGLE_CLIENT_ID)
    except Exception as exc:
        raise HTTPException(401, "Google credential could not be verified. Please try signing in again.") from exc
    email = claims.get("email")
    if not email or not claims.get("email_verified"):
        raise HTTPException(401, "Google account email is missing or unverified.")
    user = db.query(User).filter(User.email == email).first()
    if user is None:
        user = User(name=claims.get("name") or email.split("@")[0], email=email)
        db.add(user); db.commit(); db.refresh(user)
    return {"id": user.id, "name": user.name, "email": user.email, "phone": user.phone}
