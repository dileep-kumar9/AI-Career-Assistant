from sqlalchemy.orm import Session
from app.models.user import User

def create_user(db, data):
    if db.query(User).filter(User.email == data.email).first(): return None
    obj = User(**data.model_dump()); db.add(obj); db.commit(); db.refresh(obj); return obj
def get_all_users(db): return db.query(User).all()
def get_user_by_id(db, user_id): return db.query(User).filter(User.id == user_id).first()
def update_user(db, user_id, data):
    obj = get_user_by_id(db, user_id)
    if not obj: return None
    for k,v in data.model_dump().items(): setattr(obj,k,v)
    db.commit(); db.refresh(obj); return obj
def delete_user(db, user_id):
    obj = get_user_by_id(db, user_id)
    if not obj: return None
    db.delete(obj); db.commit(); return obj
