import os
from dotenv import load_dotenv
load_dotenv()

class Settings:
    APP_NAME = os.getenv("APP_NAME", "AI Career & Job Application Assistant")
    APP_VERSION = os.getenv("APP_VERSION", "1.0.0")
    ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
    DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./career_assistant.db")

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
    CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",") if o.strip()]

    # Job discovery (public, no-auth job board APIs)
    REMOTEOK_API = "https://remoteok.com/api"
    ARBEITNOW_API = "https://www.arbeitnow.com/api/job-board-api"

settings = Settings()
