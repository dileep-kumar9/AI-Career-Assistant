def skill_gap(user_skills: list[str], required_skills: list[str]) -> dict:
    have = {x.strip().lower() for x in user_skills if x.strip()}
    req = {x.strip().lower() for x in required_skills if x.strip()}
    matched = sorted(have & req)
    missing = sorted(req - have)
    coverage = round(len(matched) / max(len(req), 1) * 100, 2)
    return {"matched": matched, "missing": missing, "coverage_percent": coverage}
