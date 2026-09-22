# Repair notes (2026-09-22)

## Changes in this package
- Interview question generation now attempts Groq for every interview type, not only when a job description is supplied; falls back to the built-in question bank if generation fails.
- Career Chat accepts guest requests and remains available without a user ID. Authenticated requests can still use profile/resume content as RAG context.
- Career Chat now attempts a general AI answer when no relevant document chunks are retrieved, instead of immediately returning a no-context response.
- Interview form validates that a question and non-empty answer exist before submitting, and correctly distinguishes saved interview feedback from guest evaluation.
- Frontend API URL uses `VITE_API_BASE_URL` when set, localhost API for local development, and the known Render backend URL as a production fallback. Network failures return a clearer API connectivity message.
- Resume upload errors now include HTTP status and parsed API detail where possible.

## Verification performed
- `python -m compileall -q backend/app` succeeded.
- Frontend build was attempted but could not execute: `vite: Permission denied` in this environment. No successful production build is claimed.
- No live authenticated end-to-end tests were performed. Render environment variables, database availability, OAuth origin configuration, and provider quota remain deployment-dependent.
