# AI Career & Job Application Assistant

A full-stack AI career assistant: resume tailoring, ATS-style match scoring,
job discovery, a paste-a-job-link flow, an application tracker, a typing/voice
interview coach, career chat grounded in your own data (RAG), and an agentic
"prepare me for this job" workflow that chains all of the above.

```
Frontend (React + Vite + Tailwind)  →  Backend (FastAPI)  →  SQLite / PostgreSQL
                                              │
                                     Groq LLM (free, optional)
                                     RAG: TF-IDF local retrieval
                                     Job discovery: Arbeitnow + RemoteOK (public APIs)
```

## What's real here, and what still needs your own setup

The LLM provider is **Groq** (https://console.groq.com), not Anthropic — Groq's
free tier needs no credit card and runs Llama 3.3 70B on their LPU hardware,
which is very fast. Free-tier requests are rate-limited (requests/min and
tokens/min; see console.groq.com/docs/rate-limits), but that's plenty for
personal use. Without a key, every AI feature still works via a clearly
labeled heuristic fallback instead of failing.

Everything below is real, working code (not stubs) that has been executed and
tested (`pytest` + `npm run build`) in the process of building it:

| Feature | Status |
|---|---|
| User/profile/resume CRUD, SQLAlchemy models, migrations-free schema creation | ✅ Real |
| Resume upload + text extraction (.pdf/.docx/.txt) | ✅ Real (pdfplumber, python-docx) |
| **Auto-detect profile from resume** (skills, certifications, experience/internships, education, projects) | ✅ Real — `POST /users/{id}/profile/from-resume`, LLM-based when configured, section-header heuristic parser otherwise |
| **Auto-pull saved resume/profile** wherever text would otherwise need re-pasting (analyze, match, agentic prepare) | ✅ Real — pass `user_id` instead of the text and it's resolved server-side |
| ATS-style match scoring (TF-IDF cosine similarity + keyword gaps) | ✅ Real |
| Resume tailoring, JD analysis, interview evaluation, career chat | ✅ Real **when you set `GROQ_API_KEY`**; otherwise a clearly-labeled heuristic fallback runs instead of failing |
| **Resume Maker works without an account** | ✅ Real — `/resume-tools/*` endpoints tailor, parse-preview, and export with no login; results just aren't saved |
| **Single master resume per account** — upload/paste always updates the same master record instead of piling up duplicates; auto-loads on every visit | ✅ Real — `GET /users/{id}/resumes/master`, upsert logic in `resume_service.create_resume` |
| **Promote a tailored resume to become the new master** | ✅ Real — `POST /users/{id}/resumes/set-master`, "Update my master resume with this" button after tailoring |
| RAG retrieval | ✅ Real local TF-IDF retrieval — no external embedding-model download needed |
| Resume export to .docx / .pdf | ✅ Real (python-docx, reportlab) |
| Job discovery | ✅ Real, live results from Arbeitnow + RemoteOK's public, no-auth APIs |
| **Auto Search & Apply** — rank discovered jobs by match % against your saved resume, then tailor or auto-apply straight from a job card | ✅ Real — `GET /jobs/discover/ranked` auto-resolves your saved resume when `user_id` is passed |
| **"Create tailored resume" from a job listing** | ✅ Real — button on Job Discovery / Paste Job Link opens a pre-filled Resume Maker tab |
| Paste-a-job-link JD extraction | ✅ Real (fetches the page you give it, extracts visible text) |
| Application tracker | ✅ Real CRUD + duplicate detection |
| Interview system | ✅ Real — typing + browser-native voice (Web Speech API); works logged-out (stateless evaluation) or logged-in (history persisted) |
| **Auto-Apply page** | ✅ Real UI over the existing safety-first autofill engine (see caveats below) |
| **Resume file auto-attach on Apply Agent** — if you uploaded a resume (not just pasted text), it's auto-attached to a file-upload field during autofill | ✅ Real — `Resume.source_file` persisted on upload, resolved automatically per user |
| **Google Sign-In** (optional) | ✅ Real — verifies the ID token server-side (`google-auth`); falls back to plain email/name sign-in when `GOOGLE_CLIENT_ID` isn't set |
| Agentic "prepare me for this job" workflow | ✅ Real — chains JD analysis → resume match → skill gaps → questions → study plan |
| **UI**: left sidebar navigation, single-page content area, dashboard hub with stats/quick actions, styled resume preview | ✅ Real, builds cleanly (`npm run build`) |
| Docker Compose (backend + Postgres) | ⚠️ Config is complete and reviewed, but **not build-tested here** — this environment has no Docker daemon. Run it yourself with the commands below and let me know if anything needs adjusting. |

What's **intentionally not** claimed as "done":
- **No mass-automated apply bot targeting LinkedIn or similar platforms.**
  LinkedIn's ToS explicitly prohibits automated interaction, and tools that do
  this (e.g. the open-source AIHawk/Auto_Jobs_Applier project) have drawn
  cease-and-desist notices and legal action (see *hiQ Labs v. LinkedIn*). The
  Apply Agent here works the way a person using autofill would instead — one
  page, at your direction, always pausing before submission — which works on
  most real company career sites (Greenhouse, Lever, Workday, iCIMS) without
  that legal exposure.
- **No live scraping of LinkedIn/Indeed/Naukri etc.** for job discovery either
  — same reasoning. Job discovery uses open job-board APIs instead; add more
  sources (Adzuna, JSearch) the same way if you have keys.
- **No full production-grade authentication system.** Google Sign-In is real
  (ID tokens are verified server-side), and the email/name fallback creates a
  local account row — but there's no session/JWT expiry, password reset flow,
  or role-based access. Fine for personal use; add a proper auth layer before
  opening this up to other people.
- **Application automation fills forms but never submits.** It pauses on
  CAPTCHA and before final submission, by design — see `services/automation.py`.
  It needs Playwright's browser installed locally (`playwright install chromium`).
- **Nothing is deployed to a live URL** — no Vercel/hosting credentials were
  available here. Below are the exact commands to deploy it yourself.

## Deploy yourself
- **Backend** → any container host (Render, Fly.io, Railway, AWS/GCP/Azure):
  push the image built from `docker/Dockerfile`, set `DATABASE_URL` to a
  managed Postgres instance and `GROQ_API_KEY` (and `GOOGLE_CLIENT_ID` if
  using Google Sign-In) as env vars.
- **Frontend** → Vercel: `cd frontend && vercel --prod`, then set
  `VITE_API_BASE_URL` (and `VITE_GOOGLE_CLIENT_ID` if using Google Sign-In)
  in the Vercel dashboard.

## UI tour
- **Left sidebar** — navigation, single active page at a time. 🔒 marks pages that need an account (Tracker, Career Chat, Profile); everything else works as a guest.
- **Top bar** — current page title + live AI provider status badge.
- **Dashboard** — the hub: application/resume stats, your skill chips, AI provider status, and one-click cards into every tool.
- **Sign in / create account** — Google Sign-In (if `GOOGLE_CLIENT_ID`/`VITE_GOOGLE_CLIENT_ID` are set) or a lightweight email/name modal; see the honesty note above.

## Run it locally

### Backend
```bash
cd backend
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # add your free GROQ_API_KEY from console.groq.com
uvicorn app.main:app --reload
```
API docs: http://localhost:8000/docs

Run tests: `pytest` (17 tests, all passing against SQLite)

**Optional: Google Sign-In.** Without it, sign-in falls back to the plain
email/name modal automatically. To enable it: create an OAuth client ID at
console.cloud.google.com (APIs & Services → Credentials → OAuth client ID →
Web application, add `http://localhost:5173` as an authorized origin), then
set `GOOGLE_CLIENT_ID` in `backend/.env` and `VITE_GOOGLE_CLIENT_ID` in
`frontend/.env` to the same client ID.

### Frontend
```bash
cd frontend
cp .env.example .env        # VITE_API_BASE_URL=http://localhost:8000
npm install
npm run dev
```
App: http://localhost:5173

### Or run both with Docker Compose (backend + Postgres)
```bash
cp backend/.env.example backend/.env   # add your free GROQ_API_KEY from console.groq.com
docker compose up --build
```
Then run the frontend separately with `npm run dev` (point `VITE_API_BASE_URL`
at `http://localhost:8000`), or build it and serve `frontend/dist` from any
static host / add an nginx service to `docker-compose.yml`.

> Note: `docker compose up --build` has not been executed in this build
> environment (no Docker available here) — the Dockerfile/compose file were
> written and reviewed carefully, but if something doesn't come up cleanly on
> your machine, send me the error and I'll fix it directly.

## Project layout
```
backend/app/
  api/        FastAPI routers: users, profiles (+ from-resume auto-detect), resumes,
              jobs (discovery/link/autofill), applications, interview, ai, auth (Google Sign-In),
              resume_tools (guest, no-login)
  services/   Business logic: resume tailoring, analyzer, job discovery, tracker,
              automation (Apply Agent), profile_parser (resume → profile), user_context (auto-resolve saved data)
  ai/         LLM adapter (Groq), prompts, RAG pipeline
  agents/     Agentic orchestrator chaining services end-to-end
  models/     SQLAlchemy models
  schemas/    Pydantic request/response schemas
frontend/src/
  context/    WorkspaceContext (current page/params), UserContext (account/guest session)
  components/ Sidebar, Topbar, AuthModal, ResumePreview — the app shell
  pages/      Dashboard, Profile, Resume, Jobs, JobLink, AutoApply, Tracker, Interview, Chat
  api/        Single fetch-based client covering every backend endpoint
docker/, docker-compose.yml   Container + Postgres setup
```

## Render deployment notes

- Configure the backend service root directory as `backend` and start it with `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
- Set `DATABASE_URL`, `GROQ_API_KEY`, `GOOGLE_CLIENT_ID`, and `CORS_ORIGINS` in the Render backend environment as applicable. Never commit `.env` files.
- Configure the frontend's Vite API base URL as `VITE_API_BASE_URL` to the deployed API origin, then rebuild the static site.
- The profile resume-source endpoint is `GET /users/{user_id}/profile/resume-source` and constructs canonical resume text from saved profile fields.
- The current Google sign-in implementation verifies a Google ID credential and associates it with a local user record, but does not issue a server-side session/JWT or protect user-scoped routes. Treat this as identity convenience, not authorization, until server-side auth is implemented.
- Resume files and exports are stored on local disk by default. Render instances have ephemeral filesystems unless a persistent disk is configured; use object storage or a persistent disk for durable uploads/exports in production.
