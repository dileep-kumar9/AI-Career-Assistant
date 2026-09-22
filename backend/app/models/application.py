from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from datetime import datetime, timezone
from app.core.database import Base

class Application(Base):
    __tablename__ = "applications"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    job_id = Column(Integer, ForeignKey("jobs.id"), nullable=True)
    company = Column(String)
    job_title = Column(String)
    job_url = Column(String)
    application_date = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    status = Column(String, default="New")
    resume_used = Column(String, nullable=True)
