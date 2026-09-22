import os
from dotenv import load_dotenv
load_dotenv()

class Settings:
    APP_NAME = os.getenv("APP_NAME", "AI Career & Job Application Assistant")
    APP_VERSION = os.getenv("APP_VERSION", "1.0.0")
    ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
    DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./career_assistant.db")
    # Render may provide postgres://; SQLAlchemy expects postgresql://.
    if DATABASE_URL.startswith("postgres://"):
        DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
    elif DATABASE_URL.startswith("postgresql://"):
        pass
    # Render external URLs sometimes use postgres:// or postgres+psycopg2://.
    if DATABASE_URL.startswith("postgresql+psycopg2://"):
        DATABASE_URL = DATABASE_URL.replace("postgresql+psycopg2://", "postgresql://", 1)

    # LLM provider: Groq (https://console.groq.com) -- genuinely free, no credit
    # card required, and very fast (runs open models like Llama 3.3 on their
    # LPU hardware). Free tier is rate-limited (requests/min + tokens/min) but
    # plenty for a personal project. If no key is set, AI endpoints fall back
    # to clearly-labeled rule-based output instead of failing.
    GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
    LLM_MODEL = os.getenv("LLM_MODEL", "llama-3.3-70b-versatile")
    LLM_MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "1024"))

    # Google Sign-In (optional). Get a client ID at console.cloud.google.com
    # (APIs & Services -> Credentials -> OAuth client ID -> Web application).
    # Without it, accounts still work via the plain email/name form.
    GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")

    # CORS - frontend origin(s), comma separated
    CORS_ORIGINS = [o.strip().rstrip("/") for o in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",") if o.strip()]
    # Optional temporary inspection mode: keeps API available without forcing auth UI.
    INSPECTION_MODE = os.getenv("INSPECTION_MODE", "false").lower() in ("1", "true", "yes")

    # Job discovery (public, no-auth job board APIs)
    REMOTEOK_API = "https://remoteok.com/api"
    ARBEITNOW_API = "https://www.arbeitnow.com/api/job-board-api"

settings = Settings()
