import logging

logger = logging.getLogger(__name__)


def expand_and_deduplicate(top_context: list[dict], kb_id: str, supabase, dedupe: bool = True, user_id: str | None = None) -> list[dict]:
    """
    Stage 4 — Parent-Child Context Expansion & Deduplication.

    For structured (medium/deep) chunks, replaces the child chunk's content with the
    full parent section text to give the LLM more complete context.

    For lite-mode (page-based) chunks, fetches the adjacent pages (prev + next) and
    prepends/appends them to widen the context window.

    Deduplicates by the first 100 characters of the context key so two chunks from the
    same section don't both pass through to generation, UNLESS dedupe=False.

    Set dedupe=False for "list all figures/tables" style queries: several
    DIFFERENT figures/tables commonly live in the same section, each as its
    own child chunk with its own distinct excerpt_source/image_url — since
    every child in one section shares the identical parent_context text,
    the default dedup-by-section-text would collapse them down to just the
    FIRST one found and silently drop the rest, which is exactly backwards
    for a request that's explicitly asking to enumerate all of them.

    Returns the deduplicated (or, if dedupe=False, fully expanded but
    unfiltered) context-expanded list of documents.
    """
    unique_headings: set[str] = set()
    deduped: list[dict] = []

    for doc in top_context:
        metadata = doc.get("metadata", {})

        # ── Structured chunk (has parent_context from medium/deep parsers) ────
        if "parent_context" in metadata:
            pc = metadata["parent_context"]
            dedup_key = pc[:100]
            if dedupe and dedup_key in unique_headings:
                continue
            unique_headings.add(dedup_key)
            # Keep the ORIGINAL matched paragraph before we (maybe) blow it
            # up to the full parent section. The LLM gets the full section
            # for grounding, but the citation excerpt/highlight should point
            # at the specific sentence retrieval actually matched — not
            # an arbitrary slice of a (possibly page-long) section.
            doc["excerpt_source"] = doc["content"]
            # Only expand to the FULL parent section for normal queries.
            # dedupe=False means this is an enumeration query ("list all
            # figures/tables") — those just need each item's own short
            # caption/label to list it, not its entire surrounding section.
            # Expanding every one of them (often 20-30 items) blew the
            # assembled prompt up so far that even generous fallback models
            # rejected it outright — confirmed on a real document: a "list
            # all figures" query assembled 17,000+ tokens this way and
            # EVERY fallback model failed (too large / rate-limited),
            # returning a flat error instead of an answer.
            if dedupe:
                doc["content"] = pc
            deduped.append(doc)

        # ── Lite-mode chunk (page-based, no parent_context) ──────────────────
        elif "page_number" in metadata:
            page_num = metadata["page_number"]
            current_kb_id = doc.get("knowledge_base_id", kb_id)
            # Same reasoning as above: keep the original single-page match for
            # the citation excerpt/highlight before we widen "content" with
            # neighboring pages for the LLM.
            doc["excerpt_source"] = doc["content"]

            # Fetch previous page — scoped by user_id too (not just
            # knowledge_base_id), consistent with every other chunk read in
            # this pipeline after the cross-tenant leak found in
            # retrieval.py's _fetch_all_chunks(). This step only ever runs
            # on a chunk that already passed a properly-scoped retrieval
            # step, so it's defense-in-depth here rather than the primary
            # fix, but costs nothing to keep consistent.
            if page_num > 1:
                prev_query = (
                    supabase.table("documents")
                    .select("content")
                    .eq("knowledge_base_id", current_kb_id)
                    .contains("metadata", {"page_number": page_num - 1})
                )
                if user_id:
                    prev_query = prev_query.eq("user_id", user_id)
                prev_res = prev_query.execute()
                if prev_res.data:
                    doc["content"] = prev_res.data[0]["content"] + "\n\n" + doc["content"]

            # Fetch next page
            next_query = (
                supabase.table("documents")
                .select("content")
                .eq("knowledge_base_id", current_kb_id)
                .contains("metadata", {"page_number": page_num + 1})
            )
            if user_id:
                next_query = next_query.eq("user_id", user_id)
            next_res = next_query.execute()
            if next_res.data:
                doc["content"] = doc["content"] + "\n\n" + next_res.data[0]["content"]

            dedup_key = doc["content"][:100]
            if dedupe and dedup_key in unique_headings:
                continue
            unique_headings.add(dedup_key)
            deduped.append(doc)

        # ── Fallback (no structured metadata) ────────────────────────────────
        else:
            dedup_key = doc["content"][:100]
            if dedupe and dedup_key in unique_headings:
                continue
            unique_headings.add(dedup_key)
            deduped.append(doc)

    return deduped
