import re
import json
import logging
from litellm import completion
from config.settings import LLM_MODEL

logger = logging.getLogger(__name__)


def select_target_headings(query: str, kb_id: str, supabase, user_id: str | None = None) -> list[str]:
    """
    Stage 2 — Agentic Routing (Two-Stage RAG).

    Fetches the Table of Contents (ToC) chunk for the knowledge base and asks the LLM
    to identify which specific section headings are most relevant to the user's query.

    Returns a list of exact heading strings to target for retrieval.
    Returns an empty list if no ToC exists, routing fails, or the LLM selects "ALL".
    """
    # Filters by user_id, not just knowledge_base_id — this table read is
    # otherwise reachable by anyone who knows (or guesses — kb ids are a
    # predictable "filename_timestamp" pattern, not a secret) another
    # user's knowledge_base_id, leaking that document's section/heading
    # structure. See the identical, confirmed issue fixed in retrieval.py's
    # _fetch_all_chunks() for the full writeup.
    toc_query = (
        supabase.table("documents")
        .select("content")
        .eq("knowledge_base_id", kb_id)
        .contains("metadata", {"is_toc": True})
    )
    if user_id:
        toc_query = toc_query.eq("user_id", user_id)
    toc_res = toc_query.execute()

    if not toc_res.data or len(toc_res.data) == 0:
        return []

    toc_content = toc_res.data[0]["content"]
    router_prompt = (
        f"You are an intelligent document router.\n\n"
        f"Here is the Table of Contents for the document:\n{toc_content}\n\n"
        f"The user is asking: '{query}'\n\n"
        f"Based ONLY on this Table of Contents, identify which specific heading(s) BEST answer the question. "
        f'Return a JSON array of the EXACT heading strings from the ToC (e.g., ["## 6.1.3 Information security risk treatment"]). '
        f"Only pick headings that are DIRECTLY relevant. If no heading clearly matches, return [\"ALL\"]. "
        f"Output ONLY the JSON array and absolutely nothing else."
    )

    try:
        response = completion(
            model=LLM_MODEL,
            messages=[{"role": "user", "content": router_prompt}],
            temperature=0.0,
            max_tokens=256,
        )
        reply = response.choices[0].message.content.strip()
        reply = re.sub(r"<think>.*?</think>", "", reply, flags=re.DOTALL).strip()

        if reply.startswith("```json"):
            reply = reply[7:-3].strip()

        parsed = json.loads(reply)
        if isinstance(parsed, list) and len(parsed) > 0 and "ALL" not in parsed:
            logger.info(f"Agentic Router selected headings: {parsed}")
            return parsed
    except Exception as e:
        logger.warning(f"Agentic router failed (falling back to vector search): {e}")

    return []
