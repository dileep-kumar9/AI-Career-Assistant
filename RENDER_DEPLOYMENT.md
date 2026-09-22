# Render deployment

## Services
This repository includes `render.yaml` for a Render Blueprint with:
- **Render Web Service**: FastAPI in `backend/`
- **Render Static Site**: Vite/React in `frontend/`
- **Render PostgreSQL**: managed database connected through `DATABASE_URL`

## Before deploying
1. Push the repository to GitHub (repository root must contain `render.yaml`, `backend/`, and `frontend/`).
2. In Render, choose **New → Blueprint** and select the repository.
3. Add the prompted environment values in the Render dashboard:
   - Backend `GROQ_API_KEY`: your existing Groq API key.
   - Backend `GOOGLE_CLIENT_ID`: OAuth web client ID.
   - Frontend `VITE_GOOGLE_CLIENT_ID`: the same OAuth web client ID.
   - Backend `CORS_ORIGINS`: exact frontend origin, e.g. `https://<static-site-name>.onrender.com` (comma-separated if multiple).
4. After the first deploy, copy the actual Static Site URL into Google OAuth **Authorized JavaScript origins**. If using redirect-based OAuth later, configure its redirect URI separately.
5. Confirm the frontend API environment value resolves to the backend host and redeploy the Static Site if necessary.

## Inspection → production
- Blueprint initially sets `INSPECTION_MODE=true` for the inspection stage. This is a configuration flag only; it does not implement a bypass for authentication.
- Complete the app's inspection and integration tests. Then set `INSPECTION_MODE=false` in the backend environment and redeploy when you are ready for the production authentication flow.
- Never put Groq credentials or Google client secrets in frontend variables. Only the public Google OAuth client ID belongs in the frontend.

## Build and runtime settings
- Backend build: `pip install --upgrade pip && pip install -r requirements.txt`
- Backend start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Backend health check: `/health`
- Frontend build: `npm ci && npm run build`
- Frontend publish directory: `dist`

## Persistence and operational notes
- Uploaded files and generated documents are written to the service filesystem by the current application. Render's ordinary service filesystem is ephemeral across deploys/restarts. For durable resume storage, configure a persistent disk or move uploads to object storage before relying on production data retention.
- The current app creates SQLAlchemy tables at startup with `create_all`; use migrations (for example Alembic) for future schema evolution.
- This configuration does not claim that all third-party job sites permit automated interaction. Keep user review and consent before final submission and respect site restrictions.
