# ATS Resume Builder

Upload your resume **once**, paste a job description, generate an ATS-friendly tailored resume, and keep refining it through chat until you click **Finish**. The uploaded resume stays the source of truth for the whole session — no edit ever asks you to upload it again.

- **Frontend:** React 18 + TypeScript, Vite, Tailwind CSS, shadcn/ui, Lucide, React Query
- **Backend:** Node.js 22.13+ (24 recommended), Express + TypeScript, REST API
- **Database:** SQLite for local development (Node's built-in `node:sqlite`, no native build), PostgreSQL (JSONB) for production
- **AI:** free-tier providers by default — Google Gemini (primary), Groq and Mistral — tried in order with automatic fallback; Claude (Anthropic SDK) is optional. Keys live only on the server.
- **Documents:** PDF text extraction (pdf.js), DOCX extraction (mammoth), PDF generation (pdfkit), DOCX generation (docx)

---

## Quick start (local development)

```bash
npm install
cp .env.example .env          # add GEMINI_API_KEY and/or GROQ_API_KEY (free)

# terminal 1 – API server on http://localhost:8787 (SQLite in ./data)
npm run dev:api

# terminal 2 – web app on http://localhost:8080 (proxies /api to 8787)
npm run dev
```

Open http://localhost:8080 and click **Build an ATS resume** (route `/builder`).

### Choosing an AI provider (free options)

| Provider | Free tier | Notes |
| --- | --- | --- |
| **Google Gemini** (`GEMINI_API_KEY`, `gemini-2.5-flash`) | Yes (AI Studio) | Best free choice: reads PDFs natively, strict JSON schemas, large context. On the free tier Google may use prompts to improve its products — resumes contain personal data, so use a paid tier for real users. |
| **Groq** (`GROQ_API_KEY`, `openai/gpt-oss-120b` or `llama-3.3-70b-versatile`) | Yes | Very fast; free tokens-per-minute limits are low, so long resumes + JDs may hit 429 and fall through to the next provider. |
| **Mistral** (`MISTRAL_API_KEY`, `mistral-small-latest`) | Yes ("Experiment" plan) | Good fallback. |
| **Claude** (`ANTHROPIC_API_KEY`) | No | Highest quality; put `anthropic` first in `AI_PROVIDER_ORDER` to prefer it. |

`AI_PROVIDER_ORDER` (default `gemini,groq,mistral,anthropic`) sets the order; providers without a key are skipped and failures fall through automatically. Whatever the provider, every AI response passes the same deterministic factual guard.

### What you can ask in the chat

The chat works on your stored resume from the moment it is uploaded — no job description required, and never a re-upload. Examples: “Analyse my resume”, “What are my weaknesses?”, “Improve my resume”, “Rewrite my experience with stronger verbs”, “Make this suitable for a SOC Analyst role”, “Remove the line below my name”, “Make it one page”, “Undo”, “Restore version 2”, “Show me what changed”. Paste a job description straight into the chat (optionally after “Tailor my resume to this JD:”) and it is analysed, attached to the session and your current version is tailored to it. “Tailor my resume to the job description” re-tailors to the stored JD, keeping your earlier edits.

**It asks before adding anything you haven't shown.** After tailoring (and when you ask “why is my score low?” or “improve the ATS score”), the assistant lists JD skills that are missing from your resume and asks whether you have them, with quick-reply buttons. Reply “add Tableau”, “add all”, “yes, add SQL but not Terraform” or “no”. Confirmed items are added and remembered as facts you stated, so later edits may use them. Saying “add Tableau and Statistics to my skills” directly also works.

**Project ideas:** “Suggest some projects for a data analyst role” returns numbered ideas with offer buttons; “add 1 and 3” or “add the second one” adds them with a brief description (only add projects you have built or will build).

**Formatting by chat:** “change font to Georgia”, “body font size 11”, “headings size 12”, “name size 22”, “make headings navy”, “headline colour #7a1f2b”, “uppercase headings”, “add lines under headings”, “justify text”, “reset fonts”. The same controls are in **Template → Fonts & colours**. DOCX uses the exact font; PDF uses the closest built-in PDF family (Helvetica, Times or Courier).

**Job links:** paste a link to a job posting (“tailor my resume for https://…”, or just the link) and the posting is read, attached as the job description and your resume is tailored; “check how well I match https://…” only analyses. The Job panel also has *Import from link*. Sites that need a sign-in (e.g. LinkedIn while signed out) cannot be read — paste the text instead.

**Adding projects, internships and certificates:** describe it in the chat (“Add this project: …”) or attach a file with the 📎 button (project report, README, internship/offer letter, code or notebook). It is written in the same format as the entries already in that section (number of points, technologies line, dates only when stated), placed in the right section, and any point that goes beyond what you provided is left out.

**Fitting pages:** “make it one page” / “I need it in two pages” tightens spacing and margins first, then removes only the least important content (e.g. 10th-class results once a degree is listed, the weakest extra bullets — never a line that holds the only mention of a JD keyword), and uses slightly smaller fonts only if still needed. Every removal is listed and can be undone. For multi-page resumes, a section that would be split between pages starts on the next page and the space above is spread evenly (in the preview, PDF and DOCX).

**Contact details:** “change my location to Hyderabad, India”, “update portfolio link to …”, “set headline to …”.

**Honesty:** every reply lists the changes actually applied (computed from the versions); if the AI claims a change it could not apply, you are told so instead.

### Running without AI

With no provider key the whole workflow still works: extraction uses a rule-based parser, JD analysis and ATS scoring are fully deterministic, "generate" re-prioritises existing skills and sections without rewriting, and chat supports undo/redo/restore/compare, template changes, hiding/showing sections, shortening the summary and one-page layout. Anything that needs rewriting returns a clear "AI not configured" message and never changes the resume.

---

## How it works

```
Upload PDF/DOCX or paste text ─► extraction ─► review & correct ─► v1 "Original extracted resume"
                                                                      │ (locked as source of truth
Paste job description ─► JD analysis (editable keywords) ─► ATS score │  once generation runs)
                                                                      ▼
Generate ─► AI tailoring ─► factual guard ─► v2 "ATS-tailored resume" + score (previous → current)
                                                                      ▼
Chat: "Make my summary shorter" ─► section-level AI patch ─► factual guard ─► v3 … vN
      "Undo" / "Restore version 2" / "Show me what changed" / template changes (no AI call)
                                                                      ▼
Finish Resume ─► final review (preview, score, missing keywords, warnings, page count)
               ─► Download PDF / DOCX ─► Finish and Close (finalized; reopen any time)
```

### Persistent sessions

- Every session has a UUID and a random 256-bit **session token**. The server stores only its SHA-256 hash; the browser keeps `{id, token}` in `localStorage`. All `/api/resumes/:id/*` calls require `Authorization: Bearer <token>` (or `X-Session-Token`).
- The server stores: original file (private folder, never a public URL), extracted text, immutable original resume JSON, every version, the job description + analysis, per-version ATS results, chat history, template/layout and status.
- Refreshing the page or coming back later restores the session from the server (`/builder/:id`, or **My resumes**). Sessions expire after `SESSION_TTL_DAYS` of inactivity (sliding); an hourly job deletes expired sessions, their files and orphaned upload folders. Uploads are processed in memory, so no temp files are written.
- No login is implemented; access is tied to the browser that holds the token. To add authentication, associate `resume_sessions` with a user id and check it in `ResumeService.authorize`.

### Chat-based editing (the core feature)

Each instruction runs against the **current stored version** with the original resume, the JD and its analysis, recent chat history and the current ATS status as context. The AI returns **only the sections it changes** (`null` for everything else), keyed by stable item ids. The server then:

1. validates the response against a schema (zod) — malformed or empty output is rejected;
2. applies the **factual guard** (`server/src/services/factGuard.ts`):
   - name/contact, employers, job titles, dates and education facts are always copied from the existing resume;
   - skills must be evidenced by the original or current resume — or asserted by the user in first person (“I have used Terraform at …”). “Add more AWS keywords” is *not* evidence;
   - technologies only mentioned in lab/training/coursework contexts cannot become professional experience;
   - rewritten bullets may not introduce technologies not already mentioned **for that role**, nor any number/metric that appears nowhere in the resume — offending bullets keep their previous wording and the user is told why;
   - brand-new items are accepted only when the instruction supplies their facts; unrequested deletions are refused;
3. saves a new version only if something actually changed, recalculates the ATS score and replies with the changes, warnings, skill gaps and the score delta.

If the AI call fails, times out or is rate-limited, the API returns `503`, an error message is added to the chat, and **the current resume is left unchanged**. Undo/redo, restore, "show me what changed", template changes and score recalculation are handled deterministically (`server/src/services/commands.ts`). As a final safety net, any sentence asking the user to re-upload their resume is stripped from AI replies.

### Version history

Every change (generation, AI edit, manual edit, design change, restore, extraction correction) creates a numbered version. Undo/redo move a pointer through an undo/redo stack; **restore creates a new version** that copies the chosen one, so nothing is ever deleted. The Versions panel supports preview, two-version comparison (section-level + word-level diff), restore, undo and redo. Previewing a version (or “Show changes” on the current one) highlights in yellow what that version added or rewrote compared with its parent — headline, summary sentences, bullets, project lines, skills. The highlight is view-only: it is never saved or exported.

### ATS scoring (0–100)

Implemented in `shared/ats.ts` and fully deterministic except for an optional AI semantic component:

| Category | Default weight | How it is computed |
| --- | ---: | --- |
| JD keyword alignment | 30 | share of JD keywords present (exact/alias = 1, related form = 0.5) |
| Required skills alignment | 25 | 0.8 × required-skill coverage + 0.2 × preferred coverage |
| Relevant experience alignment | 20 | 0.4 × responsibility coverage + 0.3 × years-of-experience fit + 0.3 × required skills evidenced *inside* experience/projects; blended 60/40 with an AI semantic-relevance estimate when `ATS_SEMANTIC_ANALYSIS=true` |
| Structure & ATS readability | 15 | 11 weighted checks: contact info in body, summary length, dated roles, skills and education sections, action verbs, bullet length/weak phrasing, pronouns, length for the page target, standard headings |
| Education & certifications | 10 | degree level vs requirement, requested certifications present |

Weights are configurable with `ATS_WEIGHTS` (rescaled to 100). Keyword matching understands aliases (AWS = Amazon Web Services, K8s = Kubernetes, …) and word boundaries (C#, C++, Node.js). Every keyword shows matched / partial / missing, where it was found, **whether the original resume contains evidence** (with a snippet, and whether it is lab-only), why it matters, and an honest recommendation. Scores are recalculated after generation, after each content edit, when the JD changes and on demand.

**Raising the score.** `shared/improve.ts` builds a ranked plan (shown as “Raise your score” in the ATS panel and returned when you ask “How can I increase my ATS score?”). Each step's gain is *measured* by applying the change to a copy of the resume and re-scoring it: surfacing JD wording for skills the resume already proves, adding missing JD skills **only after you confirm you have them**, showing required skills inside projects/experience, adding role dates, fixing weak bullets, adding a summary, fitting the page target, and adding a project that covers uncovered duties. It reports the current score, the score reachable from existing content alone, and the upper bound.

> The score is an estimated compatibility score produced by this application. It is not an official score from any employer's ATS, ATS products score differently, and no score guarantees an interview.

### Templates

Five single-column, ATS-safe templates (`shared/templates.ts`) drive the browser preview, the PDF and the DOCX identically. All five share the Professional template's typography (fonts, sizes, colours, title-case headings) and differ only in layout: **Professional** (default — Helvetica; centred name and contact line with clickable LinkedIn/portfolio links; bold blue headline under the contact line; title-case headings; inline “Title | Company | Dates” entries), **ATS Classic**, **Modern Professional**, **Technical Resume**, **Minimal**. Per-resume font, size, colour and heading-style overrides are stored in `layout.style`. No tables, columns, images, icons or rating bars; contact details are in the body, not in headers/footers. Users can change template, font size, margins, one/two-page target, paper size (Letter/A4) and section order/visibility; none of these touch content. Default section order: Summary → Technical Skills → Projects → Experience → Education → Certifications → custom sections; tailoring never reorders sections. Each custom section (e.g. Strengths) prints under its own heading.

**Human-sounding output.** Prompts ask the model to keep the candidate's own wording and plain language, and `shared/humanize.ts` then removes typical AI vocabulary deterministically (leverage/utilize → use, spearheaded → led, “in order to” → “to”, filler adjectives such as seamless/robust/cutting-edge, em-dashes, and hollow “Seeking to…” summary sentences). It only swaps or drops words; it never adds claims.

---

## API

All session routes require `Authorization: Bearer <token>` (returned once by upload/paste).

| Method & path | Purpose |
| --- | --- |
| `POST /api/resumes/upload` | multipart `file` (PDF/DOCX ≤ 5 MB, validated by content) → `{session, token, extraction}` |
| `POST /api/resumes/paste` | `{text}` → `{session, token, extraction}` |
| `GET /api/resumes/:id` | full session view (original, current, versions, JD, ATS, chat) |
| `PATCH /api/resumes/:id` · `DELETE /api/resumes/:id` | rename · delete session and files |
| `PUT /api/resumes/:id/original` | correct extraction (`{text}` re-parses or `{resume}`) — only before generation |
| `GET /api/resumes/:id/original/file` | download the original upload |
| `POST /api/resumes/:id/job-description` | `{jobDescription}` → analysis + score |
| `PATCH /api/resumes/:id/job-description/analysis` | edit/remove extracted keywords |
| `POST /api/resumes/:id/generate` | generate the tailored resume |
| `POST /api/resumes/:id/edit` | `{instruction}` → `{session, message, changed}` |
| `PUT /api/resumes/:id/current` | save manual edits as a new version |
| `PATCH /api/resumes/:id/design` | template, font size, margins, page target, paper size, sections |
| `GET /api/resumes/:id/versions` · `GET …/versions/:versionId` | list · fetch a version |
| `GET /api/resumes/:id/compare?from=&to=` | diff two versions |
| `POST /api/resumes/:id/restore/:versionId` · `…/undo` · `…/redo` | history navigation |
| `GET /api/resumes/:id/ats-score` · `POST …/ats-score/recalculate` | read · recompute score |
| `POST /api/resumes/:id/export/pdf` · `…/export/docx` | download (`X-Page-Count` header) |
| `GET /api/resumes/:id/review` | final-review data (page count, warnings, missing keywords) |
| `POST /api/resumes/:id/finish` · `…/reopen` | finalize · reopen for editing |
| `GET /api/health` | health check |

Errors are JSON `{error, code}` with appropriate status codes: `400` validation, `401` bad/missing token, `404` unknown/expired session, `409` finalized or locked, `413` file too large, `422` unreadable document, `429` rate limited, `503` AI unavailable (nothing changed).

---

## Security

- API keys only in server environment variables; never sent to the browser.
- Upload validation by magic bytes (PDF, DOCX, TXT), size limit, page limit, memory-only processing, private storage path per session.
- Session tokens hashed at rest, constant-time comparison, sliding expiry.
- Request validation with zod; control characters stripped from all text; JSON body limit 1 MB.
- Rate limiting (general + stricter AI/parsing limit), Helmet security headers with a strict CSP.
- Logs contain method, route pattern, status, timings and provider outcomes only — never resume text, JDs or tokens.
- **Prompt-injection defence:** resumes, JDs and chat history are wrapped in tagged blocks and the system prompt tells the model to treat them strictly as data; and whatever the model returns still goes through the deterministic factual guard.

---

## Tests

```bash
npm test            # vitest: 52 tests (API workflow + unit tests)
npm run typecheck   # frontend and server TypeScript
```

`server/tests/workflow.test.ts` exercises the real Express app against an in-memory SQLite database with a deterministic fake AI provider that deliberately misbehaves (invents a skill, metrics and a new employer) so the guard is tested. Covered: PDF upload, DOCX upload, pasted text, token protection, JD analysis and keyword editing, generation without invented facts, summary edit that leaves other sections untouched, consecutive edits, restore after a server restart (browser refresh), deterministic score recalculation, undo/redo/restore/compare (API and chat commands), template/layout/section changes without content loss, PDF and DOCX export, finish/reopen, AI failure and malformed AI output leaving the resume unchanged, and a check that no edit reply ever asks to upload the resume again. `server/tests/unit.test.ts` covers keyword matching, JD analysis, scoring, the guard, the command router and diffs. Fixtures live in `public/test-fixtures/` and `server/tests/fixtures/`.

---

## Production deployment

### Vercel + Firebase (recommended, free tiers)

The web app is served by Vercel's CDN, every `/api/*` request runs the same Express app as a serverless function (`api/index.mjs` → `build/server/src/vercel.js`, with every `/api/*` path rewritten to it in `vercel.json`), data is stored in **Cloud Firestore**, and users sign in with **Firebase Authentication** (email/password and Google). Each user's resumes are stored under their account and appear in **My resumes** on any device.

**1. Firebase project** — https://console.firebase.google.com

1. *Add project* (Google Analytics is optional).
2. **Build → Authentication → Get started → Sign-in method**: enable **Email/Password** and **Google**.
3. **Authentication → Settings → Authorized domains**: add `resume-creator-ai.vercel.app` (and your custom domain, if any). `localhost` is there already.
4. **Build → Firestore Database → Create database** (production mode, a region near your users). No rules are needed for the app: only the server (Admin SDK) reads and writes Firestore, and the browser never touches it. Keep the default *deny all* rules:
   ```
   rules_version = '2';
   service cloud.firestore { match /databases/{db}/documents { match /{doc=**} { allow read, write: if false; } } }
   ```
5. **Project settings → General → Your apps → Web (</>)**: register a web app and copy `apiKey`, `authDomain`, `projectId`, `appId` (public values → `VITE_FIREBASE_*`).
6. **Project settings → Service accounts → Generate new private key**: the JSON gives `project_id`, `client_email`, `private_key` (secret → `FIREBASE_*`). Never commit this file.

**2. GitHub → Vercel**

1. Push the repository to GitHub.
2. https://vercel.com/new → import the repository. Framework preset: *Other* (the build command and output come from `vercel.json`: `npm run build`, output `dist`).
3. **Settings → Environment Variables** (Production and Preview):

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | `firestore` |
   | `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` | from the service-account JSON |
   | `FIREBASE_PRIVATE_KEY` | the `private_key` value, pasted as is (with its `\n` sequences) |
   | `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` | from the web-app config |
   | `GEMINI_API_KEY` (and optionally `GROQ_API_KEY`, `MISTRAL_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`) | AI providers |
   | `MAX_UPLOAD_MB` | `4` (Vercel limits request bodies to 4.5 MB) |
   | `CRON_SECRET` | any long random string (daily clean-up of expired guest sessions) |
   | `VITE_SITE_URL` | `https://resume-creator-ai.vercel.app` (or your domain) |
   | `VITE_GOOGLE_SITE_VERIFICATION` | optional, see “Google search” below |

4. Deploy. Every push to `main` redeploys automatically; pull requests get preview URLs.

Notes: the API function has `maxDuration: 60` s (tailoring usually takes 10–40 s). With `FIREBASE_PROJECT_ID` set, sign-in is required (`REQUIRE_AUTH=false` keeps guest mode). Resumes created as a guest in a browser are moved into the account automatically after signing in.

### Google search (“resume-creator-ai”)

- The build writes `robots.txt` and `sitemap.xml` for `VITE_SITE_URL`, and `index.html` carries the title, description, canonical URL, Open Graph tags and `WebSite`/`WebApplication` structured data with the names “Resume Creator AI” and “resume-creator-ai”.
- Open https://search.google.com/search-console → *Add property* → URL prefix `https://resume-creator-ai.vercel.app/` → *HTML tag* → put the `content` value in `VITE_GOOGLE_SITE_VERIFICATION`, redeploy, click *Verify*.
- In Search Console: *Sitemaps* → submit `sitemap.xml`; *URL inspection* → request indexing for the home page.
- New sites usually appear for their exact name within days to a few weeks; ranking for generic terms (“AI resume builder”) depends on links and content and cannot be guaranteed. A custom domain (e.g. `resumecreatorai.com`) and links from your GitHub/LinkedIn/portfolio help.

### Self-hosting (Node server or Docker)

```bash
npm ci
npm run build       # builds the web app (dist/) and the server (build/)
npm start           # serves API + web app on $PORT
```

- Set `DATABASE_URL=postgres://…` for PostgreSQL or `DATABASE_URL=firestore` for Firestore (migrations run automatically on start, or `npm run db:migrate`). Without it, SQLite is used in `DATA_DIR`.
- Persist `DATA_DIR` (original uploads; and the SQLite file if used).
- Behind a proxy/load balancer set `TRUST_PROXY=true` and terminate TLS there.
- **Docker:** `docker compose up --build` starts the app with PostgreSQL (see `docker-compose.yml`); `Dockerfile` builds a single production image.
- Horizontal scaling: per-session edits are serialised in-process; with several instances use sticky sessions or a single instance per database.

---

## Project structure

```
shared/            code shared by server and browser
  resumeTypes.ts   resume model (sections with stable ids, certifications, achievements, layout)
  normalize.ts     validation/normalisation, plain-text rendering
  heuristicParser.ts  rule-based resume parser (AI fallback)
  lexicon.ts, match.ts  skill/certification vocabulary and keyword matching
  jdAnalyzer.ts    deterministic JD analysis + grounded merge of AI analysis
  ats.ts           ATS scoring engine
  diff.ts          version comparison
  templates.ts     template styles used by preview, PDF and DOCX
server/src/
  app.ts, index.ts, config.ts, routes/resumes.ts
  db/              Store interface, SQLite + PostgreSQL implementations, migrations
  ai/              provider chain (Anthropic, Groq, Gemini, Mistral), prompts, schemas
  services/        resumeService (sessions, versions, generate, edit, score, export),
                   factGuard, commands, extract, export
server/tests/      vitest suites and fixtures
src/pages/         BuilderStart, BuilderWorkspace, MyResumes, Index, legacy ResumeMaker
src/components/builder/  chat, ATS, JD, versions, template/sections, source, manual editor, final review
src/components/resume/ResumeDocument.tsx  HTML renderer matching the exports
```

## Legacy editor

The original free-form editor (6 visual templates, browser-side import/export, Resume Agent) is still available at `/resume-maker`, and the Node server continues to serve its `/api/agent`, `/api/parse-resume` and `/api/tailor` endpoints (set `LEGACY_API=false` to disable). Its visual templates are not ATS-safe; use the builder for applications.
