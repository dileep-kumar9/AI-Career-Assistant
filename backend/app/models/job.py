from sqlalchemy import Column, Integer, String, Text
from app.core.database import Base

class Job(Base):
    __tablename__ = "jobs"
    id = Column(Integer, primary_key=True, index=True)
    external_id = Column(String, nullable=True, index=True)
    company = Column(String, nullable=False)
    title = Column(String, nullable=False)
    location = Column(String, nullable=True)
    url = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    source = Column(String, nullable=True)
