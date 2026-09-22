"""
LLM provider adapter -- Groq (https://console.groq.com).

Why Groq: a genuinely free tier with no credit card required, running open
models (Llama 3.3 70B by default) on their LPU hardware, which is very fast.
The free tier is rate-limited (requests/min + tokens/min, see
https://console.groq.com/docs/rate-limits) but is plenty for personal use.

Groq exposes an OpenAI-compatible REST endpoint, so this uses plain
`requests` rather than pulling in an extra SDK.

If GROQ_API_KEY is not configured, every function degrades to a clearly
labeled rule-based / heuristic fallback rather than raising, so the rest of
the app keeps working end-to-end without a key -- callers check `provider`
in the returned dict ("groq" vs "fallback") to know which path ran.
"""
import json
import requests
from app.core.config import settings

GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"


def llm_available() -> bool:
    return bool(settings.GROQ_API_KEY)


def generate(prompt: str, system: str = "", max_tokens: int | None = None) -> dict:
    """Low-level call. Returns {"provider": "groq"|"fallback", "text": str}."""
    if not settings.GROQ_API_KEY:
        return {
            "provider": "fallback",
            "text": "",
            "message": "No GROQ_API_KEY configured. Get a free key at https://console.groq.com/keys "
                       "(no credit card needed) and set it in backend/.env to enable live AI output.",
        }
    try:
        resp = requests.post(
            GROQ_CHAT_URL,
            headers={"Authorization": f"Bearer {settings.GROQ_API_KEY}", "Content-Type": "application/json"},
            json={
                "model": settings.LLM_MODEL,
                "max_tokens": max_tokens or settings.LLM_MAX_TOKENS,
                "messages": [
                    {"role": "system", "content": system or "You are a precise, honest career assistant. Never invent facts about the user."},
                    {"role": "user", "content": prompt},
                ],
            },
            timeout=30,
        )
        if resp.status_code == 429:
            return {"provider": "fallback", "text": "", "message": "Groq free-tier rate limit hit -- wait a minute and try again."}
        resp.raise_for_status()
        data = resp.json()
        text = data["choices"][0]["message"]["content"]
        return {"provider": "groq", "text": text}
    except requests.RequestException as e:
        return {"provider": "fallback", "text": "", "message": f"LLM call failed: {e}"}


def generate_json(prompt: str, system: str = "", max_tokens: int | None = None) -> dict:
    """Ask the model for strict JSON and parse it. Falls back to {} on failure."""
    result = generate(prompt + "\n\nRespond with ONLY valid JSON, no prose, no markdown fences.", system, max_tokens)
    if result["provider"] != "groq":
        return {**result, "data": {}}
    raw = result["text"].strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.startswith("json"):
            raw = raw[4:]
    try:
        return {**result, "data": json.loads(raw)}
    except Exception as e:
        return {**result, "data": {}, "message": f"Could not parse JSON from model output: {e}"}
