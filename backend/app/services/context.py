def build_career_context(profile: str = "", resume: str = "", job: str = "", interview: str = "") -> str:
    parts = [p for p in [profile, resume, job, interview] if p and p.strip()]
    return "\n\n".join(parts).strip()
