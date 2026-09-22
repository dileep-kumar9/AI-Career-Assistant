from sqlalchemy import Column, Integer, String, Text, ForeignKey, DateTime
from datetime import datetime, timezone
from app.core.database import Base

class Interview(Base):
    __tablename__ = "interviews"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    job_id = Column(Integer, nullable=True)
    interview_type = Column(String, default="HR")
    mode = Column(String, default="typing")
    question = Column(Text)
    answer = Column(Text)
    feedback = Column(Text)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
