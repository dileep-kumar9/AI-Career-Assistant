import os
from dotenv import load_dotenv
load_dotenv()

class Settings:
    APP_NAME = os.getenv("APP_NAME", "AI Career & Job Application Assistant")
    APP_VERSION = os.getenv("APP_VERSION", "1.0.0")
    ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
    DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./career_assistant.db")

    # OpenAI API (usage may be billable; no key is required for fallback mode).
    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
    LLM_MODEL = os.getenv("LLM_MODEL", "gpt-4o-mini")
    LLM_MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "1024"))

    # Google Sign-In (optional). Get a client ID at console.cloud.google.com
    # (APIs & Services -> Credentials -> OAuth client ID -> Web application).
    # Without it, accounts still work via the plain email/name form.
    GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")

    # CORS - frontend origin(s), comma separated
    CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",") if o.strip()]

    # Job discovery (public, no-auth job board APIs)
    REMOTEOK_API = "https://remoteok.com/api"
    ARBEITNOW_API = "https://www.arbeitnow.com/api/job-board-api"

settings = Settings()
