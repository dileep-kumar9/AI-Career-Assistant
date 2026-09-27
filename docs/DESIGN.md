# AI Career Assistant

> **Design document (v5, approved).** It has been implemented; the main [README](../README.md) describes what was built, how to run it and the known limitations. Ports changed during the build to API 8790 / web 8081 so the app can run next to resume-creator-ai.
> A new, separate app. **resume-creator-ai is not changed.** This app has its own copy of resume-creator-ai's resume features, adds job automation, and adds the most useful features from the earlier *AI Career & Job Application Assistant* plan.
> GitHub: this app goes into https://github.com/dileep-kumar9/AI-Career-Assistant (see section 14)

```
                     🤖 AI CAREER ASSISTANT
                              │
 ┌────────────────────────────┼─────────────────────────────┐
 ▼                            ▼                             ▼
👤 CAREER PROFILE       📄 RESUME SYSTEM               💼 JOB SYSTEM
                      Builder · Analyzer          Single Job Apply (link)
                      Tailoring · Export           Auto Job Agent (search)
                              │
                              ▼
               ⚙️ APPLICATION AUTOMATION (browser)
                              │
                              ▼
               📊 APPLICATION TRACKER (applied → interview → offer)
                              │
              ┌───────────────┼────────────────┐
              ▼               ▼                ▼
       🎤 INTERVIEW     🧠 SKILL GAP  ──►  📚 LEARNING PLAN
          PREP              (market-wide, from real JDs)
              └───────────────┼────────────────┘
                              ▼
               💬 CAREER ASSISTANT CHAT (RAG + actions)
                              │
       ┌──────────────────────┴───────────────────────┐
       │ AI LAYER: Prompt Engineering · RAG · LLM      │
       │           Generative AI · Agentic AI          │
       │           Guardrails (fact guard, confidence) │
       └───────────────────────────────────────────────┘
```

---

## 1. Features from the earlier plan: analysis

Each feature was checked against this app's goal (**get hired faster, honestly**) and against what it can reuse.

| Earlier feature | Decision | Why / how it fits |
|---|---|---|
| 👤 User Profile | ✅ **Add** as **Career Profile** | One place for skills, target roles, locations and form answers. It feeds the agent's search, the form filler and the chat. Auto-filled from your resume. |
| 📄 Resume Generator | ✅ Already included | The copied resume-creator-ai builder (tailoring, fact guard, templates, export) |
| 🔍 Resume Analyzer | ✅ Already included (from resume-creator-ai) | The copied engine already has it: the ATS panel (score, keyword matched/partial/missing with evidence, structure checks), "Raise your score" plan, and chat analysis without a JD ("Analyse my resume", "What are my weaknesses?"). No new page; it's also reachable from job cards and the career chat. |
| 🔎 Job Discovery | ✅ Already included | Auto Job Agent. **Add Arbeitnow + RemoteOK** (free public APIs the old app used) as extra sources. |
| 🔗 Job Link Application | ✅ Already included | Single Job Apply |
| ⚙️ Application Automation | ✅ Already included | Browser appliers + honest question answering |
| 📊 Application Tracker | ✅ **Upgrade** "Applied jobs" into a real tracker | After you apply the job isn't finished: add stages **Interview → Offer / Rejected / No response**, notes, follow-up reminders, manual entries for jobs applied elsewhere, and a **follow-up / thank-you email draft**. |
| 🎤 Interview System | ✅ **Add**, linked to each job | When a job reaches *Interview*: likely questions from **that JD + your resume**, a mock interview (typing or voice), AI feedback with score and improved answers. More useful than generic practice. |
| 🧠 Skill Gap Analysis | ✅ **Add**, market-wide | The agent reads hundreds of real JDs, so the app can say *"Splunk is required in 42% of SOC Analyst jobs you matched, and you don't have it"* and *"learning it would raise 18 jobs above your auto-apply score"*. Unique to this app, and nearly free since the data is already collected. |
| 📚 Learning Recommendations | ✅ **Add**, tied to gaps | A short study plan per missing skill plus a **proof project**. When you finish and confirm, the skill becomes a **confirmed fact** the resume may use. It closes the loop honestly (gap → learn → proof → resume). |
| 💬 AI Career Assistant | ✅ **Add** as chat with actions | Ask about **your** data ("Which jobs did I apply to this week?", "Why was the Deloitte job skipped?", "What should I learn next?") and give commands ("apply to this link", "pause the agent"). |
| 🧠 Prompt Engineering | ✅ **Add** as a central prompt library | All prompts in one folder, versioned, each with a JSON schema and tests. Behaviour can be improved in one place. |
| 📚 RAG | ✅ **Add** | Grounds the chat, interview prep, question answers and cover letters in *your* resume, profile, JDs and history, so the AI answers from facts, not guesses. |
| 🤖 LLM | ✅ Already included | Provider chain Gemini → Groq → Mistral → Claude with automatic fallback |
| ✨ Generative AI | ✅ Already included, extended | Tailoring + cover letters, interview questions and feedback, study plans, email drafts |
| 🧩 Agentic AI | ✅ Already included, extended | The Auto Job Agent (plan → act → check → retry) + **"Prepare me for this job"** workflow + chat tool-calling, all with human-in-the-loop checkpoints |
| Own email/password login (old app) | ❌ Not needed | Firebase Auth (Google + email) is already used |
| LinkedIn/portal scraping ban (old app's rule) | ⚠️ Changed | You chose to include portals. Kept **off by default** for LinkedIn, with warnings and limits (section 6). |

**Not added:** salary prediction and job-market "forecasts". They would be guesswork without reliable data, and would make the app less trustworthy.

---

## 2. The parts of the app

| Part | What you do | What happens |
|---|---|---|
| **A. Resume Builder + Analyzer** | Upload, edit, analyse | resume-creator-ai features (builder, ATS analyzer, improvement plan, chat) |
| **B. Single Job Apply** | Paste **one job link** | Read page → find JD → analyse → tailor → show → apply → track |
| **C. Auto Job Agent** | Choose **a resume and/or skills**, preferences, switch **ON** | Searches jobs → match → JD → tailor → apply → track, until OFF |
| **D. Application Tracker** | Update stages, add notes | Every job from B, C or manual entry, from *Applied* to *Offer* |
| **E. Interview Prep** | Click *Prepare* on a job | Questions from that JD + resume, mock interview, feedback |
| **F. Skills & Learning** | Open the Skills page | Market-wide skill gaps from real JDs, study plans, proof projects |
| **G. Career Assistant chat** | Ask or command | Answers from your own data (RAG) and runs actions |

B and C share the same pipeline. They differ only in **where the jobs come from**.

---

## 3. Career Profile

Filled **automatically from your resume**; you then correct it.

| Group | Fields |
|---|---|
| Basics | Name, email, phone, city, LinkedIn, GitHub, portfolio |
| Career | Target roles, experience (years), current role/company, notice period, current and expected CTC, job types, locations, remote/hybrid/on-site |
| Skills | Skills from the resume + skills you add yourself. Each is marked *in resume* or *added by me* (added ones are used for **searching only**, never put on a resume without your confirmation). |
| Work authorisation | Countries, sponsorship needed, relocation |
| Saved answers | Answers you gave to application questions, reused next time |
| Diversity (optional) | Default "Decline to self-identify" |

---

## 4. Part B: Single Job Apply (paste a link)

```
Paste link ─► [1] Read page ─► [2] Find JD & analyse ─► [3] Match score
          ─► [4] Tailor resume ("<Role> – <Company>", saved in Automation resumes)
          ─► [5] Show preview + score before → after + keywords + skill gaps
          ─► [6] Apply  (review: you approve · auto: submits)
          ─► [7] Added to the Application Tracker
```

- Uses your **default resume** (or pick one). Always prepared, even with a low match; you decide.
- Live steps: "Reading page… Found: SOC Analyst at Deloitte… Tailoring… 64 → 82… Filling form… Submitted ✓".
- Also offers **"Prepare me for this job"** (section 9.3): JD → match → gaps → likely interview questions → mini study plan.

---

## 5. Part C: Auto Job Agent

### 5.1 Setup

| Setting | Example | Used for |
|---|---|---|
| **Search by** | ◉ Resume ○ Skills ○ Both | Where the keywords come from (Career Profile) |
| **Resume** | "Dileep – Resume" | Search keywords (resume mode) and **the resume tailored for every job** |
| **Skills** | SIEM, Splunk, SOC, Python | Search keywords and the match filter |
| **Target roles** | SOC Analyst, Security Analyst | Search queries (suggested from the resume) |
| **Locations / Remote** | Hyderabad, Bangalore, Remote | Filter |
| **Experience / Job type / Posted within** | 0–2 yrs · Full-time, Internship · 7 days | Filters |
| **Sources** | Greenhouse ✓ Lever ✓ Ashby ✓ Arbeitnow ✓ RemoteOK ✓ Naukri ✓ Indeed ✓ LinkedIn ☐ | Section 6 |
| **Exclude** | Companies, title words ("Senior", "Lead") | Filter |
| **Mode** | Review / Auto | Approve each one, or submit automatically |
| **Minimum match** | 60 prepare · 75 auto-submit | Quality gate |
| **Daily limit / Run every** | 25 (LinkedIn 10) · 60 min | Safety / schedule |

> **Applying always needs a resume.** Skills decide which jobs are found; the chosen resume is what gets tailored and submitted. The fact guard never invents experience.

### 5.2 When the agent is ON

```
 ┌──────────── every "Run every" minutes, while ON ─────────────┐
 │ [1] SEARCH   queries from roles + skills + location → sources │
 │ [2] DEDUPE   drop seen / applied / excluded jobs              │
 │ [3] FIND JD  open each job, extract the full JD               │
 │ [4] MATCH    ATS match 0–100 (below minimum → Skipped)        │
 │              every JD also feeds the Skill Gap report         │
 │ [5] TAILOR   "<Role> – <Company>" → Automation resumes        │
 │ [6] APPLY    review → "Ready for review" · auto → submit      │
 │ [7] TRACK    Application Tracker + run log                    │
 └──── stops for the day at the daily limit; OFF stops at once ──┘
```

**Agent screen:** ON/OFF switch · status ("Searching Naukri… 14 new · 5 matched · 3 applied today") · live log · queue (Found → Matched → Tailored → Ready → Applied / Needs attention / Skipped).

---

## 6. Job sources

| Source | Searching | Applying | Notes |
|---|---|---|---|
| **Greenhouse / Lever / Ashby** | Public APIs (company boards you add, or found from pasted links) | Fills the form, uploads the tailored PDF | Pauses if a CAPTCHA appears |
| **Arbeitnow, RemoteOK** | Free public APIs | Through the job's own apply link (routed to the matching applier) | Mostly remote/EU jobs |
| **Workday** | Public search | **Assisted**: pre-filled, you finish | Separate account per company |
| **Naukri** | Search in your logged-in Chrome | Apply + chatbot questions | Sends your **profile resume**, not the tailored PDF (left untouched) |
| **Indeed** | Search in your logged-in Chrome | Indeed Apply | Cloudflare checks often block automation, so it pauses for you |
| **LinkedIn** | Search in your logged-in Chrome | Easy Apply | ⚠️ Breaks LinkedIn's terms; accounts can be restricted. **Off by default**, max 10 per day |
| **Pasted link** | — | Matching applier or the generic form filler | Part B |

You log in to Naukri, Indeed and LinkedIn **once**, in the app's own Chrome profile. The app never stores those passwords.

---

## 7. Application Tracker (upgraded "Applied jobs")

| Stage | Set by |
|---|---|
| Found → Matched → Tailored → Ready | Agent |
| **Applied** | Agent (or you, for manual/assisted applies) |
| **Interview** (with date and round) · **Offer** · **Rejected** · **No response** · **Withdrawn** | You, in one click; the chat can also set it ("I got an interview at Deloitte on Friday") |

- **Views:** Kanban board by stage and a table (role, company, source, applied date, stage, match, resume, link); search, filters, CSV export.
- **Per job:** the tailored resume used (preview), the JD, answers submitted, notes, timeline, and **follow-up reminders** (default: 7 days after applying with no response).
- **Email drafts:** follow-up and thank-you emails, generated from the job and your resume, for you to copy and send. Nothing is sent automatically.
- **Manual entry:** add jobs you applied to outside the app, so everything is in one place.
- **Stats:** applications per week, response rate, interview rate by source and by match score (shows which sources and score ranges actually work).

---

## 8. Interview Prep

Opens from any job ("Prepare" button, automatic when the stage becomes *Interview*) or from the menu.

1. **Question set for this job:** technical (from the JD's required skills), resume-based ("Walk me through your SIEM project"), behavioural (STAR) and HR. About 15 questions, ranked by likelihood.
2. **Mock interview:** one question at a time, answer by **typing or voice** (browser speech-to-text), with an optional timer.
3. **AI feedback per answer:** score out of 10, what was good, what was missing, and an improved sample answer **built only from your resume facts**.
4. **Summary:** overall score, weakest topics (linked to Skills & Learning), and history across sessions to track progress.

---

## 9. Skills & Learning

### 9.1 Skill gap
- **Per job:** required/preferred skills matched, missing, or *in resume but weak*.
- **Market-wide:** from every JD the agent read in the last 30 days for your target roles:

| Skill | In % of matched jobs | You have it? | Jobs that would pass the auto-apply score |
|---|---:|---|---:|
| Splunk | 42% | ❌ | +18 |
| Incident Response | 38% | ✅ (in resume) | — |
| Azure Sentinel | 21% | ❌ | +7 |

"Jobs that would pass" is **measured**: the app re-scores those JDs with the skill added, using the existing improvement planner.

### 9.2 Learning plan
For each chosen gap skill: what to learn (ordered topics), estimated hours, free resource *types* (official docs, free courses, a YouTube search link; **no made-up URLs**), and a **proof project** idea.
When you finish and confirm ("I learned Splunk and built the log-analysis project"), the skill and project become **confirmed facts**. The resume engine may then add them honestly, and the agent re-scores the affected jobs.

### 9.3 "Prepare me for this job" (agentic workflow)
One click on any job runs: JD analysis → match → gaps → interview questions → mini study plan, and shows one combined report.

---

## 10. Career Assistant chat

- **Answers from your own data (RAG):** resume and versions, Career Profile, JDs of matched/applied jobs, tracker notes, interview history, skill-gap report.
  *"Which jobs did I apply to this week?" · "Why was the Deloitte job skipped?" · "Compare my resume with this JD" · "What should I learn next?"*
- **Actions (agentic tool-calling):** apply to a pasted link · pause/resume the agent · change a tracker stage · start interview prep · create a learning plan · open a resume.
  Actions that **submit or change** something always ask *"Confirm?"* first.
- It cites which document an answer came from ("from your application to Deloitte, 12 Sep"), and says *"I don't have that information"* instead of guessing.

---

## 11. AI layer

| Concept | Where it is used |
|---|---|
| **Prompt Engineering** | Central `server/src/ai/prompts/` library: resume, JD analysis, matching, question answering, cover letter, interview questions, answer evaluation, skill gap, learning plan, career chat, email drafts. Each prompt has a version, a system role, a JSON output schema, few-shot examples and golden tests (`vitest`). Outputs record which prompt version produced them. |
| **RAG** | Per-user knowledge base (`aca_kb_chunks`): resume, profile, JDs, notes, interview history, chunked with source links. Retrieval is hybrid: keyword BM25 (always, no cost) plus Gemini embeddings (when a key is set) → top chunks passed to the prompt with citations. Used by chat, interview prep, cover letters and application answers. |
| **LLM** | Gemini → Groq → Mistral → Claude (`claude-opus-5`), with automatic fallback on errors and rate limits. Cheap models for simple tasks, stronger ones for tailoring and evaluation. |
| **Generative AI** | Tailored resumes, cover letters, answers to form questions, interview questions and feedback, study plans, email drafts |
| **Agentic AI** | Auto Job Agent (search → decide → act → verify → retry/pause), "Prepare me for this job" workflow, chat tool-calling. Human-in-the-loop checkpoints: review mode, confirmations, *Needs attention*. |
| **Guardrails** | Fact guard (no invented skills/metrics/employers), confidence gating for form answers, schema validation of every AI output, prompt-injection filter on job pages (JD text is treated as data, never as instructions), daily limits and dry run |

---

## 12. Data: same Firebase project, separate collections

One login works in both apps. This app's collections use the `aca_` prefix so resume-creator-ai's My resumes never shows this app's resumes.

| Collection | Holds |
|---|---|
| `aca_resume_sessions` / `_versions` / `aca_chat_messages` / `aca_resume_files` | Resumes (resume-creator-ai format) + `origin` (manual/automation) + `job` (title, company, url, applicationId) |
| `aca_profiles` | Career Profile + saved answers |
| `aca_job_applications` | Role, company, location, links, source, **stage + timeline**, match, ATS before/after, resume id/version, answers, notes, reminders |
| `aca_agent_settings` / `aca_agent_runs` | Agent setup · each run's counts, errors, log |
| `aca_jobs_seen` | Every JD the agent read (for dedupe + skill-gap statistics) |
| `aca_interviews` | Question sets, answers, scores, feedback |
| `aca_learning` | Gap skills, study plans, progress, confirmed facts |
| `aca_kb_chunks` | RAG chunks (+ embeddings when available) |

Secrets stay in `.env` and are never pushed to GitHub.

---

## 13. Architecture

```
┌──────────────────── AI Career Assistant (runs on your PC) ────────────────────┐
│ Web UI  React + Vite + Tailwind + shadcn                 http://localhost:8080 │
│ API     Node + Express + TypeScript                      http://localhost:8787 │
│  ├─ resume/       copied resume engine (parse, tailor, fact guard, ATS, export)│
│  ├─ profile/      Career Profile + auto-fill from resume                       │
│  ├─ automation/   pipeline · agent · scheduler · sources/* · appliers/* ·      │
│  │                answers · browser (Playwright + your Chrome)                 │
│  ├─ tracker/      stages, reminders, stats, email drafts                       │
│  ├─ interview/    question sets, mock sessions, evaluation                     │
│  ├─ skills/       gap statistics, learning plans, confirmed facts              │
│  ├─ assistant/    career chat, tools (actions), workflows                      │
│  └─ ai/           prompts/ · rag/ · provider chain · guardrails                │
└──────────────────────────────────┬─────────────────────────────────────────────┘
                                   ▼
             Firebase (same project): Auth + Firestore (aca_* collections)
```

Automation runs on your PC (real browser, your logins, CAPTCHAs). Everything else could also be deployed online later.

---

## 14. GitHub: AI-Career-Assistant repo

**Confirmed:** the new app is placed in this same repo. The repo currently holds the **older FastAPI + React version** of this idea. The new app is TypeScript/Node and carries its best features forward (section 1), so it **replaces** that code on `main`.

Plan (each push is confirmed with you first):
1. Keep the old code on a branch `legacy-fastapi` + tag `v1-fastapi` (never deleted).
2. Put the new app on `main`.
3. `.env`, `data/`, the browser profile and uploads are git-ignored.
4. The local folder is renamed `Desktop\dileep\ai-career-assistant`.

---

## 15. Setup (after it is built)

```bash
npm install
cp .env.example .env     # same Firebase + AI keys as resume-creator-ai; FIRESTORE_PREFIX=aca_
npm run dev:api          # API + automation (:8787)
npm run dev              # web app (:8080)
```

1. Sign in (same account as resume-creator-ai), upload your resume, and check the auto-filled **Career Profile**.
2. **Settings:** *Open browser to log in* for Naukri, Indeed and LinkedIn.
3. **Single job:** paste a link → Apply. **Agent:** choose the resume/skills → switch **ON**.

---

## 16. Build plan

| # | Milestone | You can test |
|---|---|---|
| M1 | Copy the resume engine, rename to AI Career Assistant, `aca_` collections, My resumes / Automation resumes tabs, central prompt library | Builder works; separate lists |
| M2 | **Career Profile** (auto-fill from resume) | Profile ready for forms and agent |
| M3 | **Single Job Apply** up to tailoring + **Application Tracker** (stages, notes, table/Kanban) | Paste link → tailored resume → tracked |
| M4 | Browser + generic form filler + Greenhouse / Lever / Ashby appliers (dry run first) | Part B applies for real |
| M5 | **Auto Job Agent:** setup, query builder, ON/OFF scheduler, API sources (+ Arbeitnow, RemoteOK), queue, limits | Agent runs end to end on ATS boards |
| M6 | Naukri, Indeed, LinkedIn; Workday assisted | Portal jobs |
| M7 | **Skills & Learning** (per-job + market gaps, measured impact, plans, confirmed facts) + "Prepare me for this job" | Gap report from real JDs |
| M8 | **Interview Prep** (questions, mock typing/voice, feedback, history) | Practice for a real interview |
| M9 | **RAG + Career Assistant chat** with actions; follow-up reminders and email drafts | Ask/command from chat |
| M10 | Dashboard stats, CSV export, tests, GitHub push | Finished v1 |

---

## 17. Decisions

**Confirmed**
- ✅ All features in section 1 (the Resume Analyzer is the one already in the copied resume-creator-ai engine)
- ✅ App name: **AI Career Assistant**
- ✅ Same Firebase project as resume-creator-ai, with this app's data in `aca_` collections
- ✅ GitHub: same repo **dileep-kumar9/AI-Career-Assistant**; old code kept on the `legacy-fastapi` branch, new app on `main`
- ✅ resume-creator-ai itself is never changed
- ✅ Defaults: Naukri profile resume untouched · LinkedIn off by default (max 10 per day) · pasted links always prepared · cover letters only when asked · applying uses your chosen resume even when searching by skills

**Still open (a default is used unless you say otherwise)**
- Build order: automation first (M1–M6), then Skills, Interview and Chat (M7–M9), as in section 16.
