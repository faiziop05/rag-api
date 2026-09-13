import re
import logging
from litellm import completion
from config.settings import LLM_MODEL

logger = logging.getLogger(__name__)


def reformulate_query(query: str, history: list[dict]) -> str:
    """
    Stage 1 — Contextual Query Reformulation.

    If the user's latest message references prior context (pronouns, follow-ups),
    this stage rewrites it into a fully standalone search query using the LLM.
    If the query is already standalone or introduces a new topic, it is returned as-is.

    Returns the (possibly rewritten) search query string.
    """
    if not history:
        return query

    try:
        history_text = "\n".join(
            [f"{msg['role']}: {msg['content']}" for msg in history[-4:]]
        )
        prompt = (
            f"Chat history:\n{history_text}\n\nUser: {query}\n\n"
            "Analyze the user's latest query in the context of the chat history. "
            "If the latest query is already a standalone question or introduces a new topic, return it exactly as is without adding irrelevant context from previous messages. "
            "If the latest query refers to previous context (e.g., uses pronouns like 'it', 'they', 'this', or is a continuation), rewrite it into a standalone, comprehensive search query that includes the necessary context. "
            "DO NOT answer the question. ONLY output the rewritten or original query string and nothing else."
        )
        response = completion(
            model=LLM_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0,
            max_tokens=256,
        )
        rewritten = response.choices[0].message.content.strip()
        # Strip <think> tags if the model emits chain-of-thought
        rewritten = re.sub(r"<think>.*?</think>", "", rewritten, flags=re.DOTALL).strip()
        if rewritten:
            logger.info(f"Reformulated query: {rewritten}")
            return rewritten
    except Exception as e:
        logger.warning(f"Query reformulation failed (using raw query): {e}")

    return query
