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
    if not hits:
        return {"query": query, "context": [], "answer": "No relevant context was found in the supplied documents.",
                "provider": "fallback"}
    prompt = f"{CAREER_CHAT_PROMPT}\n\nRetrieved context:\n{context}\n\nQuestion: {query}"
    result = generate(prompt)
    if result["provider"] == "groq":
        answer = result["text"]
    else:
        # Deterministic fallback: surface the retrieved context directly.
        answer = ("LLM not configured -- here is the most relevant retrieved context for your question:\n\n"
                   + context)
    return {"query": query, "context": hits, "answer": answer, "provider": result["provider"]}
