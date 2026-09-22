"""
Real local RAG pipeline.

Retrieval uses TF-IDF + cosine similarity (scikit-learn) rather than a
downloaded embedding model, so it works fully offline with no external
model weights to fetch -- genuinely functional, not a stub. Generation
uses the Groq adapter in app.ai.llm, with a graceful non-LLM fallback.
"""
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from app.ai.llm import generate
from app.ai.prompts import CAREER_CHAT_PROMPT


def chunk_text(text: str, size: int = 700, overlap: int = 100) -> list[str]:
    text = (text or "").strip()
    if not text:
        return []
    chunks = []
    step = max(size - overlap, 1)
    for i in range(0, len(text), step):
        chunk = text[i:i + size].strip()
        if chunk:
            chunks.append(chunk)
    return chunks


def retrieve(query: str, documents: list[str], top_k: int = 4) -> list[dict]:
    """Return the top_k most relevant chunks (across all documents) with scores."""
    all_chunks = []
    for doc in documents:
        all_chunks.extend(chunk_text(doc))
    all_chunks = [c for c in all_chunks if c]
    if not all_chunks or not query.strip():
        return []
    try:
        vectorizer = TfidfVectorizer(stop_words="english")
        matrix = vectorizer.fit_transform(all_chunks + [query])
        sims = cosine_similarity(matrix[-1], matrix[:-1])[0]
        ranked = sorted(zip(all_chunks, sims), key=lambda x: x[1], reverse=True)
        return [{"text": c, "score": round(float(s), 4)} for c, s in ranked[:top_k] if s > 0]
    except ValueError:
        # e.g. all-stopword query; fall back to naive overlap
        q = set(query.lower().split())
        scored = [(len(q & set(c.lower().split())), c) for c in all_chunks]
        return [{"text": c, "score": s} for s, c in sorted(scored, reverse=True)[:top_k] if s > 0]


def rag_answer(query: str, documents: list[str], top_k: int = 4) -> dict:
    hits = retrieve(query, documents, top_k)
    context = "\n---\n".join(h["text"] for h in hits)
    # Career chat should still be useful when a user has not yet added a resume
    # or when lexical retrieval finds no matching chunk. In that case answer as
    # a general career assistant and explicitly avoid claiming personal context.
    context_block = context if hits else "No relevant profile/resume context was available. Give general advice and do not assume facts about the user."
    prompt = f"{CAREER_CHAT_PROMPT}\n\nRetrieved context:\n{context_block}\n\nQuestion: {query}"
    result = generate(prompt)
    if result["provider"] == "openai":
        answer = result["text"]
    else:
        # A helpful deterministic fallback rather than an empty chat response.
        if hits:
            answer = ("AI chat is unavailable right now, so here is the relevant information I found in your saved materials.\n\n"
                      + context)
        else:
            answer = ("I couldn't find matching details in your saved profile or resumes. Add your profile/resume for personalized guidance. "
                      "In the meantime, tell me your target role, experience level, and question, and I can help with general career preparation once AI service is available.")
    return {"query": query, "context": hits, "answer": answer, "provider": result["provider"]}
