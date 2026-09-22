from pydantic import BaseModel, EmailStr
class UserCreate(BaseModel):
    name: str
    email: EmailStr
    phone: str | None = None
class UserUpdate(UserCreate): pass
class UserResponse(UserCreate):
    id: int
    model_config = {"from_attributes": True}
