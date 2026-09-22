from sqlalchemy import Column, Integer, String, Text, ForeignKey
from app.core.database import Base

class Resume(Base):
    __tablename__ = "resumes"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title = Column(String, nullable=False)
    source_file = Column(String, nullable=True)
    content = Column(Text, nullable=True)
    resume_type = Column(String, default="master")
    job_id = Column(Integer, nullable=True)
