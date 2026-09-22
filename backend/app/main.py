from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.database import Base, engine
from app.models.user import User
from app.models.profile import UserProfile
from app.models.resume import Resume
from app.models.job import Job
from app.models.application import Application
from app.models.interview import Interview
from app.api.users import router as users_router
from app.api.profiles import router as profiles_router
from app.api.resumes import router as resumes_router
from app.api.ai import router as ai_router
from app.api.jobs import router as jobs_router
from app.api.applications import router as applications_router
from app.api.interview import router as interview_router
from app.api.resume_tools import router as resume_tools_router
from app.api.auth import router as auth_router

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="AI-powered career, resume, job application, and interview assistant.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(users_router)
app.include_router(profiles_router)
app.include_router(resumes_router)
app.include_router(ai_router)
app.include_router(jobs_router)
app.include_router(applications_router)
app.include_router(interview_router)
app.include_router(resume_tools_router)
app.include_router(auth_router)


@app.get("/")
def root():
    return {"message": "AI Career Assistant API is running!", "environment": settings.ENVIRONMENT}


@app.get("/health")
def health():
    return {"status": "ok"}
