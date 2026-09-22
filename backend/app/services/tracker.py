from app.models.application import Application


def duplicate_key(company, title, location="", job_id="", url=""):
    return "|".join(str(x).strip().lower() for x in [company, title, location, job_id, url])


def create_application(db, user_id, data) -> Application | None:
    existing = db.query(Application).filter(
        Application.user_id == user_id,
        Application.company == data.company,
        Application.job_title == data.job_title,
    ).first()
    if existing:
        return None  # duplicate detected
    obj = Application(user_id=user_id, **data.model_dump())
    db.add(obj); db.commit(); db.refresh(obj)
    return obj


def list_applications(db, user_id, status: str | None = None):
    q = db.query(Application).filter(Application.user_id == user_id)
    if status:
        q = q.filter(Application.status == status)
    return q.order_by(Application.application_date.desc()).all()


def get_application(db, user_id, app_id):
    return db.query(Application).filter(Application.id == app_id, Application.user_id == user_id).first()


def update_application_status(db, user_id, app_id, status):
    obj = get_application(db, user_id, app_id)
    if not obj:
        return None
    obj.status = status
    db.commit(); db.refresh(obj)
    return obj


def delete_application(db, user_id, app_id):
    obj = get_application(db, user_id, app_id)
    if not obj:
        return None
    db.delete(obj); db.commit()
    return obj


def tracker_summary(db, user_id) -> dict:
    apps = list_applications(db, user_id)
    counts = {}
    for a in apps:
        counts[a.status] = counts.get(a.status, 0) + 1
    return {"total": len(apps), "by_status": counts}
