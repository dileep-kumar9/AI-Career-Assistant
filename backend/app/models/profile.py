from sqlalchemy import Column, Integer, String, Text, ForeignKey
from sqlalchemy.orm import relationship
from app.core.database import Base

class UserProfile(Base):
    __tablename__ = "user_profiles"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False, index=True)
    target_role = Column(String)
    location = Column(String)
    work_preference = Column(String)
    education = Column(Text)
    experience = Column(Text)
    skills = Column(Text)
    projects = Column(Text)
    certifications = Column(Text)
    achievements = Column(Text)
    user = relationship("User", backref="profile")
