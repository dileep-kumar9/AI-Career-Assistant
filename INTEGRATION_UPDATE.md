# Integration update

## Changes in this iteration
- Switched the server-side LLM adapter from Groq's compatible endpoint to the OpenAI Chat Completions endpoint.
- Added `OPENAI_API_KEY` configuration and set `gpt-4o-mini` as the configurable default model. Keep the key only in the backend environment; never expose it with a `VITE_` variable.
- Updated services that identify a live provider to recognize `openai`.
- Added workspace entrance motion, focus-visible styling, button interaction feedback, smooth scrolling, and reduced-motion support.

## Important limitations
- OpenAI API usage may be billed; this is not represented as a free API. Without a key, existing fallback behavior remains available and is not equivalent to genuine model-generated tailoring.
- This update does not claim full integration of third-party GitHub repositories. Their source trees and exact licenses were not available for a code-level review, so copying code would be premature. Supply repository archives (or make their source accessible) for license review and targeted integration.
- Automated browser tests, authenticated end-to-end workflows, deployment verification, and real API calls have not been run in this environment.
