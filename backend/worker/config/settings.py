import os
from dotenv import load_dotenv

load_dotenv(override=True)

# ── Redis ─────────────────────────────────────────────────────────────────────
REDIS_URL: str = os.environ.get("REDIS_URL", "redis://localhost:6379")

# ── Supabase ──────────────────────────────────────────────────────────────────
SUPABASE_URL: str = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY: str = os.environ.get("SUPABASE_KEY", "")

# ── LLM ───────────────────────────────────────────────────────────────────────
LLM_MODEL: str = os.environ.get("LLM_MODEL", "groq/openai/gpt-oss-20b")

# ── Embedding / Reranker ──────────────────────────────────────────────────────
VOYAGE_API_KEY: str = os.environ.get("VOYAGE_API_KEY", "")
VOYAGE_EMBEDDING_MODEL: str = os.environ.get("VOYAGE_EMBEDDING_MODEL", "voyage-3")
VOYAGE_RERANK_MODEL: str = os.environ.get("VOYAGE_RERANK_MODEL", "rerank-2")

# ── Vision ────────────────────────────────────────────────────────────────────
GEMINI_API_KEY: str = os.environ.get("GEMINI_API_KEY", "")
GROQ_API_KEY: str = os.environ.get("GROQ_API_KEY", "")

# ── Base URL for file references ───────────────────────────────────────────────
BASE_URL: str = os.environ.get("BASE_URL", "http://localhost:3000")
