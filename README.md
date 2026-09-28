# AI Career Assistant

Tailor your resume to every job, apply from a single link or let an agent search and apply for you, then track applications, prepare for interviews and close skill gaps — **using only your real experience**.

It runs on your own computer (the job automation drives a real Chrome window with your logins) — or hosted on **Render** or **Vercel** with a small **runner** on your computer doing the browser work — stores data in your Firebase project (Firestore collections prefixed `aca_`) or a local SQLite file, and works with free AI keys (Gemini / Groq / Mistral, optional Claude) — or with no AI at all, using clearly labelled rule-based fallbacks.

> Design and decisions: [docs/DESIGN.md](docs/DESIGN.md) · Resume engine details: [docs/RESUME_ENGINE.md](docs/RESUME_ENGINE.md)
> The resume engine is a copy of **resume-creator-ai**; that project is not modified by this app.

---

## Features

| Area | What it does |
|---|---|
| **Resume Builder & ATS analyzer** | Upload (PDF/DOCX) or paste a resume, analyse it with or without a job description (explained 0–100 ATS score, matched/missing keywords with evidence, “raise your score” plan), tailor it, edit by chat, versions, templates, PDF/DOCX export. A fact guard blocks invented skills, employers, dates and metrics. |
| **Career Profile** | Auto-filled from your resume (AI or rules; never overwrites what you typed). Contact details, target roles, experience, notice period, salary, work authorisation, optional diversity answers, saved answers, skills tagged *resume / added by you / learned*. Used for searching and for answering application forms. |
| **Single Job Apply** | Paste one job link → read the page (Greenhouse, Lever, Ashby, Workday, LinkedIn public page, **Google Forms**, **Microsoft Forms**, JSON-LD / page text, or your logged-in browser for Naukri/Indeed). On a **third-party page** (a blog, a news post, an aggregator) it finds the real apply link, form or JD on that page and follows it. → analyse the JD → match score (jobs below **50** are left automatically; *Apply anyway* overrides) → copy your resume as **“Role – Company”** → tailor → PDF → review → apply → tracker. Forms get the tailored PDF in their file-upload question. |
| **Auto Job Agent** | ON/OFF with a schedule. Searches by your resume, your skills or both: Greenhouse boards, Lever companies, Ashby orgs, Workday sites, Arbeitnow, Remote OK, LinkedIn (public search; Easy Apply), Naukri and Indeed (logged-in browser). Dedupes, filters (companies, title words, job types, date and **your experience range**: *Fresher (0)* keeps only fresher / 0-year jobs, *2–3* keeps jobs asking up to 3 years, *2* up to 2; the range is also sent to LinkedIn and Naukri searches), matches, tailors and decides: **skip** when match or tailored ATS is below 50, **auto-approve & apply** when both are ≥ 70, otherwise **ask you**. The review queue opens the next waiting job as soon as you approve or skip one. Run log and queue. |
| **Application automation** | Playwright + your installed Chrome with its own profile. A generic form filler reads every field’s question and fills it from your profile, saved answers, or AI **only when your resume/profile supports the answer**; uploads the exact tailored PDF; generates a cover letter when asked. When a form asks something only you can answer (e.g. “How many years of Python?”, “Can you join within 15 days?”) the application pauses and **asks you in the app**; your answer is remembered and filled next time, and remembered answers are shown for **review** before submitting (switchable). It stops at CAPTCHAs and login walls, leaving the tab open for you. LinkedIn Easy Apply: contact info → **uploads the tailored resume** in the resume step → questions → review (never ticks “Follow company”). Appliers for Greenhouse, Lever, Ashby, LinkedIn Easy Apply, Naukri (incl. chatbot questions), Indeed Apply, Workday (assisted) and any other form. |
| **My resumes** | Two lists: **My resumes** (yours) and **Automation resumes** (“Role – Company”, with the application’s status). |
| **Application Tracker** | Board, table and stats: found → ready → applied → interview → offer / rejected / no response / withdrawn. Notes, interview dates, follow-up reminders (7 days), follow-up / thank-you / withdrawal email drafts (you send them), manual entries, CSV export, response and interview rates by source and by ATS score. |
| **Interview Prep** | A **live AI interview** that speaks and listens: it notices silence and hesitation, offers a hint or a model answer, and asks connecting follow-ups when an answer is partial or wrong. **Coach mode** suggests better answers built from your real experience. Every session is saved in its own folder (role, company, date and time) with the transcript and the job description. |
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

`dev:all` runs the API without file watching (a restart would close the automation browser and interrupt the agent). When editing server code, use two terminals instead: `npm run dev:api` (watch mode) and `npm run dev`. Production-style: `npm run build && npm start` → http://localhost:8790.

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
5. It presses Submit only when: you approved it (or match and tailored ATS are both ≥ your auto-approve score, or auto mode — within the daily limit), dry run is off, and every required question was answered truthfully. “Submitted” is recorded only when the site confirms it.
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
- The **agent and applying run only while the app (or the runner) is running** on your computer (schedules resume after a restart if it was ON). Job automation needs a desktop Chrome, so neither Vercel nor the Docker image can apply by themselves: they queue that work for the runner.
- Without AI keys: tailoring only re-orders/re-prioritises existing content, interview feedback and learning plans are rule-based (labelled), and chat answers common questions and commands by rules.
- Stored Firestore data is per owner; queries use single-field filters and in-memory sorting (fine for personal volumes, not for thousands of users).

---

## Deploy to Render (hosted app + runner on your computer)

One Render **web service** serves the web app and the API (`render.yaml`). Data stays in **Firestore** (Render’s free PostgreSQL expires after 30 days). Render has no desktop browser with your logins, so — exactly as with Vercel below — applying, login-only pages and the job agent are queued for `npm run runner` on your computer.

1. Render → **New → Blueprint** → this repo (or, for an existing service: Build command `npm ci --include=dev && npm run build && npm run sitemap`, Start command `npm start`, Health check `/api/health`, env `NODE_VERSION=24`, `HOST=0.0.0.0`).
2. Fill in the secret env vars listed in `render.yaml` (Firebase, `VITE_FIREBASE_*`, AI keys). `SITE_URL` defaults to the service’s onrender.com URL.
3. Firebase → Authentication → Authorized domains → add the onrender.com domain.
4. Runner on your computer: see step 4 of the Vercel section.

Free Render services sleep after ~15 minutes without visits (the first request then takes about a minute); the runner keeps working on your computer meanwhile.

## Deploy to Vercel (hosted app + runner on your computer)

Vercel serves the web app and the API as a serverless function (`api/index.js` → `server/src/vercel.ts`). Serverless functions have no browser and no lasting disk, so:

| Runs on Vercel | Runs on your computer (`npm run runner`) |
|---|---|
| Sign-in, Resume Builder & ATS, Career Profile, reading public job pages and forms, matching, tailoring, the tracker, interview practice, skills, the assistant | Applying (your logged-in Chrome), reading login-only pages (Naukri, Indeed, Microsoft Forms), the Auto Job Agent schedule, writing interview folders to disk |

Work that needs the browser is **queued**; the Agent page shows whether your runner is online and how many jobs wait for it. Tailored PDFs are rebuilt on demand from the saved resume version.

1. **Vercel project** → import the GitHub repo. `vercel.json` sets the build (`npm run build && npm run sitemap`), the output (`dist`), the function (300 s), rewrites and a daily cleanup cron.
2. **Environment variables** (Vercel → Settings → Environment Variables): `DATABASE_URL=firestore`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `VITE_FIREBASE_*`, your AI keys, `CRON_SECRET` (a long random string), and for search engines `SITE_URL` and `GOOGLE_SITE_VERIFICATION` (below).
3. **Firebase** → Authentication → Settings → Authorized domains → add your Vercel domain.
4. **Runner** on your computer: in `.env` use the same `DATABASE_URL` / `FIREBASE_*` values plus `RUNNER_OWNERS=<your user id>` (shown on the Agent page of the hosted app), then `npm run runner`. Log in to job sites once at http://localhost:8790 → Settings → Automation browser. The runner only works for the ids in `RUNNER_OWNERS`.

## Search engines (Google)

`npm run sitemap` (run by the Vercel build) writes into `dist/`: an indexable **landing page** (title, description, canonical URL, Open Graph, JSON-LD `WebApplication`, a static copy of the landing text for crawlers), `app.html` for every app page (**noindex**: your data is never indexed), `robots.txt` and `sitemap.xml`.

- Site URL: `SITE_URL` (e.g. `https://your-domain.com`); on Render / Vercel the service’s own domain is used automatically. Without one, `robots.txt` disallows everything.
- **Google Search Console**: this site’s verification is already included (the HTML tag in the landing page and `public/googlec62117fecf58bc04.html`); for another property set `GOOGLE_SITE_VERIFICATION`. Deploy → *Verify* → *Sitemaps* → submit `sitemap.xml`. Searching for the app name finds it once Google has crawled it (usually a few days).

---

## Testing

```bash
npm test            # 115 tests: resume engine, career API, guardrails, sources, RAG, security, real-browser form filling
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
scripts/         dev.mjs (run API + web), seo.mjs (landing page, robots.txt, sitemap.xml), smoke-sources.ts, check-hidden-chars.mjs
api/             Vercel function entry (→ server/src/vercel.ts)
docs/            DESIGN.md (approved design v5), RESUME_ENGINE.md
```

## Repository history

This repository previously held the FastAPI + React version of this idea. It is preserved on the **`legacy-fastapi`** branch and the **`v1-fastapi`** tag.
