# AI Career Assistant — Frontend

React (Vite) + Tailwind v4 SPA covering: Dashboard, Profile, Resume Generator/Analyzer,
Job Discovery, Paste Job Link, Application Tracker, Interview (typing + browser voice
via the Web Speech API), and Career Chat (RAG-grounded).

## Run locally
```bash
cp .env.example .env      # set VITE_API_BASE_URL if the backend isn't on localhost:8000
npm install
npm run dev
```

## Build
```bash
npm run build   # outputs to dist/
```

## Deploy to Vercel
```bash
npm i -g vercel
vercel            # first deploy, follow prompts
vercel --prod
```
Set `VITE_API_BASE_URL` as an environment variable in the Vercel project settings to
point at your deployed backend (e.g. `https://your-backend.onrender.com`). `vercel.json`
already handles SPA client-side routing.

## Notes / honesty about scope
- There's no full auth/login system here — a "user" is created via the onboarding form
  and its id is kept in `localStorage`. Add real auth (e.g. JWT + a login page) before
  using this with real user accounts.
- Voice input in the Interview page uses the browser's built-in Web Speech API
  (Chrome/Edge support it; Firefox/Safari mostly don't) — there's no server-side speech
  processing, by design, so it needs no extra infrastructure.
