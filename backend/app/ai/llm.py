"""OpenAI Chat Completions adapter. The API key is server-side only.
If OPENAI_API_KEY is absent or a request fails, callers receive a labeled fallback.
"""
import json
import requests
from app.core.config import settings

OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"


def llm_available() -> bool:
    return bool(settings.OPENAI_API_KEY)


def generate(prompt: str, system: str = "", max_tokens: int | None = None) -> dict:
    """Return {provider: openai|fallback, text: str}."""
    if not settings.OPENAI_API_KEY:
        return {"provider": "fallback", "text": "", "message": "OPENAI_API_KEY is not configured. Add it to the backend environment to enable live AI."}
    try:
        response = requests.post(
            OPENAI_CHAT_URL,
            headers={"Authorization": f"Bearer {settings.OPENAI_API_KEY}", "Content-Type": "application/json"},
            json={"model": settings.LLM_MODEL,
                  "max_tokens": max_tokens or settings.LLM_MAX_TOKENS,
                  "messages": [
                      {"role": "system", "content": system or "You are a precise, honest career assistant. Never invent facts about the user."},
                      {"role": "user", "content": prompt}],
            }, timeout=45,
        )
        if response.status_code == 429:
            return {"provider": "fallback", "text": "", "message": "OpenAI API rate or quota limit reached. Check your usage and try again later."}
        response.raise_for_status()
        return {"provider": "openai", "text": response.json()["choices"][0]["message"]["content"]}
    except requests.RequestException as exc:
        return {"provider": "fallback", "text": "", "message": f"OpenAI request failed: {exc}"}
    except (KeyError, IndexError, ValueError) as exc:
        return {"provider": "fallback", "text": "", "message": f"Unexpected OpenAI response: {exc}"}


def generate_json(prompt: str, system: str = "", max_tokens: int | None = None) -> dict:
    result = generate(prompt + "\n\nRespond with ONLY valid JSON, no prose, no markdown fences.", system, max_tokens)
    if result["provider"] != "openai":
        return {**result, "data": {}}
    raw = result["text"].strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.startswith("json"):
            raw = raw[4:].strip()
    try:
        return {**result, "data": json.loads(raw)}
    except (json.JSONDecodeError, TypeError) as exc:
        return {**result, "data": {}, "message": f"Could not parse JSON from model output: {exc}"}
