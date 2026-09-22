from uuid import uuid4

from fastapi.testclient import TestClient
from app.main import app


def unique_email(prefix):
    return f"{prefix}.{uuid4().hex}@example.com"


client = TestClient(app)


def test_root():
    r = client.get("/")
    assert r.status_code == 200


def test_health():
    assert client.get("/health").json()["status"] == "ok"


def test_user_and_profile_flow():
    r = client.post("/users/", json={"name": "Test User", "email": unique_email("test.smoke")})
    assert r.status_code == 201
    uid = r.json()["id"]
    r = client.post(f"/users/{uid}/profile/", json={"target_role": "Engineer", "skills": "python,sql"})
    assert r.status_code == 201
    r = client.get(f"/users/{uid}/profile/")
    assert r.status_code == 200
    assert r.json()["target_role"] == "Engineer"


def test_resume_analyze_heuristic():
    r = client.post("/ai/resume/analyze", json={"resume": "python sql docker", "job_description": "python sql kubernetes"})
    assert r.status_code == 200
    body = r.json()
    assert "match_score_percent" in body
    assert "kubernetes" in body["missing_terms"]


def test_skill_gap():
    r = client.post("/ai/skills/gap", json={"user_skills": ["python"], "required_skills": ["python", "go"]})
    assert r.status_code == 200
    assert r.json()["missing"] == ["go"]


def test_agent_prepare_end_to_end():
    r = client.post("/ai/agent/prepare", json={"jd": "We need a python backend engineer with sql and docker experience.", "resume": "I am a python developer with sql and docker experience."})
    assert r.status_code == 200
    body = r.json()
    assert "skill_gaps" in body and "interview_questions" in body and "study_plan" in body


def test_application_tracker_crud():
    r = client.post("/users/", json={"name": "Tracker User", "email": unique_email("tracker.smoke")})
    uid = r.json()["id"]
    r = client.post(f"/users/{uid}/applications/", json={"company": "Acme", "job_title": "SWE"})
    assert r.status_code == 201
    app_id = r.json()["id"]
    r = client.patch(f"/users/{uid}/applications/{app_id}/status", json={"status": "Interviewing"})
    assert r.status_code == 200
    assert r.json()["status"] == "Interviewing"
    r = client.get(f"/users/{uid}/applications/summary")
    assert r.json()["total"] == 1


def test_interview_answer_persists():
    r = client.post("/users/", json={"name": "Interview User", "email": unique_email("interview.smoke")})
    uid = r.json()["id"]
    r = client.post("/interview/answer", json={"user_id": uid, "interview_type": "HR", "mode": "typing", "question": "Tell me about yourself.", "answer": "I am a backend engineer with 3 years of experience.", "expected_topics": []})
    assert r.status_code == 200
    r = client.get(f"/interview/history/{uid}")
    assert r.status_code == 200
    assert len(r.json()) == 1


def test_guest_resume_tailor_no_account_needed():
    r = client.post("/resume-tools/tailor", json={"master_resume_text": "Python developer with django and sql experience.", "job_description": "Need a python developer with django, sql, and docker."})
    assert r.status_code == 200
    assert "resume_markdown" in r.json()


def test_guest_parse_preview():
    r = client.post("/resume-tools/parse-preview", json={"resume_text": "Jane Smith\nSkills\nPython, SQL\nEducation\nBSc CS"})
    assert r.status_code == 200
    assert "python" in r.json()["fields"]["skills"].lower()


def test_profile_auto_detect_from_resume():
    r = client.post("/users/", json={"name": "Auto User", "email": unique_email("auto.smoke")})
    uid = r.json()["id"]
    client.post(f"/users/{uid}/resumes/", json={"title": "Master", "resume_type": "master", "content": "Skills\nPython, SQL\nEducation\nBSc CS\nCertifications\nAWS Developer"})
    r = client.post(f"/users/{uid}/profile/from-resume", json={})
    assert r.status_code == 200
    body = r.json()
    assert "python" in body["skills"].lower()
    assert "aws" in body["certifications"].lower()


def test_resume_analyze_auto_resolves_from_saved_data():
    r = client.post("/users/", json={"name": "Resolve User", "email": unique_email("resolve.smoke")})
    uid = r.json()["id"]
    client.post(f"/users/{uid}/resumes/", json={"title": "Master", "resume_type": "master", "content": "python django sql experience"})
    r = client.post("/ai/resume/analyze", json={"job_description": "python django aws", "user_id": uid})
    assert r.status_code == 200
    assert "python" in r.json()["matched_terms"]


def test_master_resume_upserts_instead_of_duplicating():
    r = client.post("/users/", json={"name": "MasterUser", "email": unique_email("master.smoke")})
    uid = r.json()["id"]
    r = client.get(f"/users/{uid}/resumes/master")
    assert r.status_code == 404
    r1 = client.post(f"/users/{uid}/resumes/", json={"title": "M1", "resume_type": "master", "content": "v1"})
    r2 = client.post(f"/users/{uid}/resumes/", json={"title": "M2", "resume_type": "master", "content": "v2"})
    assert r1.json()["id"] == r2.json()["id"]
    r = client.get(f"/users/{uid}/resumes/")
    assert len(r.json()) == 1
    assert r.json()[0]["content"] == "v2"


def test_promote_tailored_resume_to_master():
    r = client.post("/users/", json={"name": "PromoteUser", "email": unique_email("promote.smoke")})
    uid = r.json()["id"]
    client.post(f"/users/{uid}/resumes/", json={"title": "Master", "resume_type": "master", "content": "original"})
    r = client.post(f"/users/{uid}/resumes/set-master", json={"content": "tailored version", "title": "New Master"})
    assert r.status_code == 200
    assert r.json()["content"] == "tailored version"
    r = client.get(f"/users/{uid}/resumes/")
    assert len(r.json()) == 1


def test_google_signin_returns_503_when_not_configured():
    r = client.post("/auth/google", json={"credential": "fake-token"})
    assert r.status_code == 503


def test_uploaded_resume_file_is_saved_and_retrievable():
    import io
    r = client.post("/users/", json={"name": "FileUser", "email": unique_email("file.smoke")})
    uid = r.json()["id"]
    files = {"file": ("resume.txt", io.BytesIO(b"Skills\nPython, SQL"), "text/plain")}
    r = client.post(f"/users/{uid}/resumes/upload?title=Master", files=files)
    assert r.status_code == 201
    assert r.json()["source_file"]
    r = client.get(f"/users/{uid}/resumes/master")
    assert r.status_code == 200
    assert r.json()["source_file"]


def test_autofill_resolves_saved_resume_without_crashing():
    r = client.post("/users/", json={"name": "AutofillUser", "email": unique_email("autofill.smoke")})
    uid = r.json()["id"]
    r = client.post("/jobs/application/autofill", json={"url": "https://example.com/apply", "user_id": uid})
    assert r.status_code == 200
    assert r.json()["status"] == "error"


def test_pasted_job_link_parses_page_content(monkeypatch):
    from types import SimpleNamespace
    import app.services.job_link as job_link

    def fake_get(url, headers, timeout):
        assert url == "https://jobs.example.test/role"
        return SimpleNamespace(text="<html><head><title>Python Engineer</title></head><body><nav>Menu</nav><p>Build Python APIs</p><script>ignore()</script></body></html>", raise_for_status=lambda: None)

    monkeypatch.setattr(job_link.requests, "get", fake_get)
    response = client.post("/jobs/link", json={"url": "https://jobs.example.test/role"})
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "parsed"
    assert body["title"] == "Python Engineer"
    assert "Build Python APIs" in body["description"]
    assert "ignore()" not in body["description"]
