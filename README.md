# AI Career Assistant

Tailor your resume to every job, apply from a single link or let an agent search and apply for you, then track applications, prepare for interviews and close skill gaps — **using only your real experience**.

It runs on your own computer (the job automation drives a real Chrome window with your logins), stores data in your Firebase project (Firestore collections prefixed `aca_`) or a local SQLite file, and works with free AI keys (Gemini / Groq / Mistral, optional Claude) — or with no AI at all, using clearly labelled rule-based fallbacks.

> Design and decisions: [docs/DESIGN.md](docs/DESIGN.md) · Resume engine details: [docs/RESUME_ENGINE.md](docs/RESUME_ENGINE.md)
> The resume engine is a copy of **resume-creator-ai**; that project is not modified by this app.

---

## Features

| Area | What it does |
|---|---|
| **Resume Builder & ATS analyzer** | Upload (PDF/DOCX) or paste a resume, analyse it with or without a job description (explained 0–100 ATS score, matched/missing keywords with evidence, “raise your score” plan), tailor it, edit by chat, versions, templates, PDF/DOCX export. A fact guard blocks invented skills, employers, dates and metrics. |
| **Career Profile** | Auto-filled from your resume (AI or rules; never overwrites what you typed). Contact details, target roles, experience, notice period, salary, work authorisation, optional diversity answers, saved answers, skills tagged *resume / added by you / learned*. Used for searching and for answering application forms. |
| **Single Job Apply** | Paste one job link → read the page (Greenhouse, Lever, Ashby, Workday, LinkedIn public page, JSON-LD / page text, or your logged-in browser for Naukri/Indeed) → analyse the JD → match score → copy your resume as **“Role – Company”** → tailor → PDF → review → apply → tracker. Review mode (you approve) or auto. |
| **Auto Job Agent** | ON/OFF with a schedule. Searches by your resume, your skills or both: Greenhouse boards, Lever companies, Ashby orgs, Workday sites, Arbeitnow, Remote OK, LinkedIn (public search; Easy Apply), Naukri and Indeed (logged-in browser). Dedupes, filters (companies, title words, job types, experience, date), matches, tailors, and applies in auto mode within daily limits — or leaves jobs “Ready for review”. Run log and queue. |
| **Application automation** | Playwright + your installed Chrome with its own profile. A generic form filler reads every field’s question and fills it from your profile, saved answers, or AI **only when your resume/profile supports the answer**; uploads the exact tailored PDF; generates a cover letter when asked. It stops at CAPTCHAs, login walls and questions it cannot answer truthfully, leaving the tab open for you. Appliers for Greenhouse, Lever, Ashby, LinkedIn Easy Apply, Naukri (incl. chatbot questions), Indeed Apply, Workday (assisted) and any other form. |
| **My resumes** | Two lists: **My resumes** (yours) and **Automation resumes** (“Role – Company”, with the application’s status). |
| **Application Tracker** | Board, table and stats: found → ready → applied → interview → offer / rejected / no response / withdrawn. Notes, interview dates, follow-up reminders (7 days), follow-up / thank-you / withdrawal email drafts (you send them), manual entries, CSV export, response and interview rates by source and by ATS score. |
| **Interview Prep** | Likely questions for a job from its JD and your resume (technical, resume-based, behavioural, HR), mock answers typed or spoken (browser speech-to-text), per-answer score, strengths, gaps and an improved answer built from your real experience. |
| **Skills & Learning** | Skill-gap report from every JD the app has read (demand %, whether your resume shows it, and how many jobs it would **measurably** push over your auto-apply score). Learning plans with steps, search-based resources (no invented links) and a proof project. Confirming a finished plan records a fact that tailoring may then use. |
| **Career Assistant** | Chat over your own records (RAG: profile, resume, applications and JDs, interviews, learning, agent runs) with citations. Proposes actions — apply to a link, start/stop the agent, change a stage, create interview prep or a learning plan, open a resume — that run only after you press **Confirm**. |
| **AI layer** | Central, versioned prompt library with JSON schemas and zod validation (`server/src/ai/prompts`), provider fallback chain, prompt-injection guardrails, RAG (BM25 + optional Gemini embeddings), agentic workflows with human checkpoints. Settings → AI shows the prompt catalogue. |

---

## Quick start

Requirements: **Node.js 22.13+** (24 recommended) and **Google Chrome** (or Edge: `BROWSER_CHANNEL=msedge`).

```bash
npm install
cp .env.example .env          # then fill in (see below)
npm run dev:all               # API on http://127.0.0.1:8790 + web on http://localhost:8081
```

Open **http://localhost:8081** (use `localhost`, not 127.0.0.1 — Firebase sign-in authorises `localhost`).

Two terminals instead of `dev:all`: `npm run dev:api` and `npm run dev`. Production-style: `npm run build && npm start` → http://localhost:8790.

### Configuration (`.env`)

| Setting | Purpose |
|---|---|
| `DATABASE_URL=firestore` + `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | Store data in Cloud Firestore (same project as resume-creator-ai is fine: this app only uses collections starting with `FIRESTORE_PREFIX`, default `aca_`). With a project set, **sign-in is required**. |
| `VITE_FIREBASE_*` | Public web config for sign-in (email/password and Google). |
| *(no Firebase, `DATABASE_URL` empty)* | **Single-user local mode**: SQLite in `DATA_DIR`, no sign-in. Only allowed while listening on 127.0.0.1. |
| `GEMINI_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, `ANTHROPIC_API_KEY`, `AI_PROVIDER_ORDER` | AI providers, tried in order with automatic fallback. None → rule-based fallbacks. |
| `BROWSER_CHANNEL`, `BROWSER_PROFILE_DIR`, `BROWSER_HEADLESS` | Automation browser (default: your Chrome, visible, profile in `data/browser-profile`). |
| `AUTOMATION_DRY_RUN=true` | Global safety switch: forms are filled but **never submitted**. |
| `PORT` (8790), `HOST` (127.0.0.1) | Server address. Keep loopback unless you use Firebase sign-in. |

### First steps in the app

1. **Resume Builder** → upload your resume.
2. **Career Profile** → *Fill from a resume*, then complete notice period, salary, work authorisation, etc. Only what is here (and in your resume) is ever submitted.
3. **Settings → Automation browser** → *Open to log in* for Naukri / Indeed / LinkedIn (once; sessions stay in the app’s own Chrome profile).
4. **Single Job Apply** → paste a link → review the tailored resume → *Approve & apply* (or *Fill form only* to submit yourself).
5. **Auto Job Agent** → choose resume/skills, roles, locations, sources (e.g. Greenhouse boards `stripe`, Lever `palantir`) → *Run once now* to try it → switch **ON**. Start in **review mode**; turn on **dry run** to watch it fill forms without submitting.

---

## How applying works (and when it stops)

1. The applier opens the job’s application page in the automation browser (never a private/internal address — apply links are untrusted).
2. It lists every field with the question a person would read, then answers in this order: **Career Profile rules → your saved answers → AI** (only with `confident=true` from your resume/profile) → otherwise **unanswered**.
3. Diversity questions → your saved value or “Decline to self-identify”. Required consent boxes are ticked; marketing/newsletter boxes never are.
4. Your tailored PDF is uploaded; a cover letter (resume facts only) is generated if a form asks.
5. It presses Submit only when: you approved it (or auto mode + score ≥ your auto-submit threshold + under the daily limit), dry run is off, and every required question was answered truthfully. “Submitted” is recorded only when the site confirms it.
6. Otherwise the job becomes **Needs attention** with the reason, and the tab stays open for you to finish; then click **Mark as applied**.

---

## Security and honesty controls

- **No invented facts**: resume tailoring passes the fact guard; application answers must be supported by your profile/resume; skills you merely *added* are used for search only; learned skills count only after you confirm them.
- **Prompt injection**: job pages, resumes, retrieved records and form labels are wrapped as untrusted data (control/invisible characters stripped, tags neutralised); injection phrasing on job pages is flagged in the UI; every AI output is schema-validated; assistant actions need the user’s own intent, server-side validation (your application ids, links you typed) and a Confirm click.
- **Human confirmation** for submitting, auto mode, enabling LinkedIn, and every chat action. Daily limits (overall and LinkedIn), minimum match and auto-submit thresholds, dry run.
- **Server**: listens on 127.0.0.1 by default; DNS-rebinding (Host) check; CSRF guard (`X-ACA-Client`) in single-user mode; Firebase ID-token verification; every document owner-scoped; zod validation of all request bodies; rate limits (general and AI); helmet CSP; SSRF-safe fetching (public IPs only, size/time caps, redirect checks) for job pages and APIs; CSV export neutralises spreadsheet formulas; secrets only in `.env` (git-ignored); `data/` (DB, PDFs, browser profile) git-ignored.
- `npm run lint` also fails on hidden/invisible characters in source files.

---

## Limitations (honest status)

- **Portal automation is best-effort.** LinkedIn, Naukri and Indeed change their pages often and use bot checks; selectors were written against their current structure but could not be exercised end-to-end here without your logged-in accounts. When a step fails, the job goes to *Needs attention* with the tab open — it never silently guesses. Greenhouse/Lever/Ashby-style forms and the generic filler are covered by real-browser tests on local fixture pages.
- **LinkedIn**: automation is against LinkedIn’s User Agreement and can get accounts restricted. It is off by default, capped (10/day by default), and job *search* uses LinkedIn’s public (logged-out) pages so your account is only used for Easy Apply.
- **Naukri** applies with your Naukri **profile** resume, not the tailored PDF (the app does not change your Naukri profile).
- **Workday** needs an account per company: the app opens the pre-filled application and you finish it (assisted).
- **CAPTCHAs** are never solved automatically.
- The **agent runs only while the app is running** on your computer (schedules resume after a restart if it was ON). Job automation needs a desktop Chrome, so it is not available from the Docker image (which serves the resume features, tracker and assistant with Firebase sign-in).
- Without AI keys: tailoring only re-orders/re-prioritises existing content, interview feedback and learning plans are rule-based (labelled), and chat answers common questions and commands by rules.
- Stored Firestore data is per owner; queries use single-field filters and in-memory sorting (fine for personal volumes, not for thousands of users).

---

## Testing

```bash
npm test            # 97 tests: resume engine, career API, guardrails, sources, RAG, security, real-browser form filling
npm run typecheck   # web + server
npm run lint        # eslint + hidden-character check
npm run build       # production web bundle + compiled server
npm run smoke:sources  # optional: hits the live public job-board APIs (Greenhouse, Lever, Ashby, Workday, Arbeitnow, Remote OK, LinkedIn public)
```

The browser tests (`server/tests/automation.browser.test.ts`) drive headless Chrome against local fixture forms shaped like Greenhouse/Lever and are skipped when Chrome is not installed. No test submits anything to a real site.

---

## Project structure

```
server/src/
  ai/            provider chain, guard.ts (injection guardrails), prompts/ (central prompt library)
  career/        profile, applications (pipeline + tracker), agent, tracker, interview, skills, rag, assistant, routes
    jobs/        public job-board sources, portal (browser) sources, link reader
    automation/  browser manager, answer engine, generic form filler, site appliers
  services/      resume engine (copied): tailoring, fact guard, ATS, export, extraction, job page fetch
  db/            SQLite / PostgreSQL / Firestore stores (+ owner-scoped aca_ documents)
  middleware/    Firebase auth, local-mode CSRF / Host guard
shared/          types shared by server and web (resume, ATS, JD analyser, careerTypes)
src/             React app: pages (Dashboard, SingleApply, Agent, Tracker, Interview, Skills, Assistant, Profile, Settings, builder, MyResumes)
scripts/         dev.mjs (run API + web), smoke-sources.ts, check-hidden-chars.mjs
docs/            DESIGN.md (approved design v5), RESUME_ENGINE.md
```

## Repository history

This repository previously held the FastAPI + React version of this idea. It is preserved on the **`legacy-fastapi`** branch and the **`v1-fastapi`** tag.
