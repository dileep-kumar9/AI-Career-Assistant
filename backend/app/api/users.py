from fastapi import APIRouter,Depends,HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.schemas.user import UserCreate,UserUpdate,UserResponse
from app.services.user_service import *
router=APIRouter(prefix="/users",tags=["Users"])
@router.post("/",response_model=UserResponse,status_code=201)
def create(data:UserCreate,db:Session=Depends(get_db)):
    obj=create_user(db,data)
    if not obj: raise HTTPException(409,"Email already registered")
    return obj
@router.get("/",response_model=list[UserResponse])
def list_all(db:Session=Depends(get_db)): return get_all_users(db)
@router.get("/{user_id}",response_model=UserResponse)
def get_one(user_id:int,db:Session=Depends(get_db)):
    obj=get_user_by_id(db,user_id)
    if not obj: raise HTTPException(404,"User not found")
    return obj
@router.put("/{user_id}",response_model=UserResponse)
def update(user_id:int,data:UserUpdate,db:Session=Depends(get_db)):
    obj=update_user(db,user_id,data)
    if not obj: raise HTTPException(404,"User not found")
    return obj
@router.delete("/{user_id}")
def remove(user_id:int,db:Session=Depends(get_db)):
    if not delete_user(db,user_id): raise HTTPException(404,"User not found")
    return {"message":"User deleted successfully","user_id":user_id}
