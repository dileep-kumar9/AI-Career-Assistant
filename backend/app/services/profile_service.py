from app.models.profile import UserProfile
def get_profile(db, user_id): return db.query(UserProfile).filter(UserProfile.user_id == user_id).first()
def create_profile(db, user_id, data):
    if get_profile(db,user_id): return None
    obj=UserProfile(user_id=user_id,**data.model_dump()); db.add(obj); db.commit(); db.refresh(obj); return obj
def update_profile(db,user_id,data):
    obj=get_profile(db,user_id)
    if not obj:return None
    for k,v in data.model_dump().items(): setattr(obj,k,v)
    db.commit(); db.refresh(obj); return obj
def delete_profile(db,user_id):
    obj=get_profile(db,user_id)
    if not obj:return None
    db.delete(obj); db.commit(); return obj
