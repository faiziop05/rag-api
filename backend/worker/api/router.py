import logging
from fastapi import APIRouter, HTTPException

from config.supabase import get_supabase
from api.models import QueryRequest
from api.stages.reformulation import reformulate_query
from api.stages.routing import select_target_headings
from api.stages.retrieval import retrieve_results
from api.stages.context import expand_and_deduplicate
from api.stages.citations import select_cited_context, build_citations, filter_and_renumber_citations
from api.stages.query_intent import detect_enumeration_intent
from ml.reranker import rerank_results
from ml.generation import generate_answer

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/query")
def query_endpoint(req: QueryRequest):
    """
    POST /query — Full RAG pipeline.

    Stages:
        1. Contextual query reformulation  (reformulation.py)
        2. Agentic ToC routing             (routing.py)
        3. Hybrid retrieval                (retrieval.py)
        4. Reranking                       (ml/reranker.py)
        5. Context expansion + dedup       (context.py)
        6. LLM answer generation           (ml/generation.py)
        7. Citation formatting             (citations.py)
    """
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=500, detail="Service unavailable.")
    
    # Verify user owns this knowledge base (authorization check).
    #
    # Previously checked a `knowledge_bases` table — confirmed that table
    # doesn't exist in this deployment at all (PGRST205, "Could not find the
    # table"), and every exception path here just logged and fell through
    # WITHOUT ever raising, meaning this check was a complete no-op: any
    # authenticated user could pass any other user's knowledge_base_id and
    # read their documents. Confirmed exploitable end-to-end with a live
    # cross-account test before this fix (see PROJECT_STRUCTURE.md's
    # pipeline-audit log for the full writeup) — a second account could
    # retrieve another user's private document contents via the "list all
    # tables/figures" and "give me that image" code paths, which read
    # chunks directly by knowledge_base_id with no ownership check at all.
    #
    # The real fix is per-stage: every chunk-reading call in retrieval.py /
    # routing.py / context.py now filters by user_id too, not just
    # knowledge_base_id. This check is a second, defense-in-depth layer on
    # top of that — checked against `documents` itself (the actual source
    # of truth for ownership in this deployment, via its own user_id
    # column) rather than a table that was never populated — so a NEW
    # retrieval helper added later that forgets to filter by user_id still
    # gets denied here before the pipeline even runs.
    try:
        owner_row = (
            supabase.table("documents")
            .select("user_id")
            .eq("knowledge_base_id", req.knowledge_base_id)
            .limit(1)
            .execute()
        )
        if owner_row.data:
            actual_owner = owner_row.data[0].get("user_id")
            # A row with no owner at all (ingested without a user_id) isn't
            # "owned by someone else" — nothing to deny access to.
            if actual_owner and actual_owner != req.user_id:
                logger.warning(f"Unauthorized access attempt: user {req.user_id} querying kb {req.knowledge_base_id} owned by {actual_owner}")
                raise HTTPException(status_code=403, detail="Access denied.")
        # If no rows exist for this kb_id at all, there's nothing to protect
        # — retrieve_results() naturally returns no results for a knowledge
        # base that was never ingested, handled by the existing "I don't
        # have enough context" response further down.
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Authorization check failed: {e}")

    try:
        # Stage 1: Query reformulation
        search_query = reformulate_query(req.query, req.history)

        # Stage 2: Agentic routing
        target_headings = select_target_headings(req.query, req.knowledge_base_id, supabase, req.user_id)

        # Stage 3: Hybrid retrieval
        results = retrieve_results(
            search_query=search_query,
            original_query=req.query,
            kb_id=req.knowledge_base_id,
            user_id=req.user_id,
            target_headings=target_headings,
            supabase=supabase,
        )

        if not results:
            return {"answer": "I don't have enough context to answer this.", "citations": []}

        # Stage 4: Reranking
        reranked = rerank_results(search_query, results)

        # "List all figures/tables" needs many more sources than a typical
        # question — capping at 10 (and 6 citations) would silently drop
        # most of what retrieval.py specifically went and found.
        is_enumeration = bool(detect_enumeration_intent(req.query))
        # Raised alongside the retrieval.py breadth-first fix (MAX_STRUCTURAL_MATCHES=40):
        # citation_cap used to be 24, silently cutting off any document with
        # more than 24 distinct figures/tables even after retrieval found them
        # all — confirmed on a real 39-figure document. Now safe to raise:
        # enumeration chunks are no longer expanded to their full parent
        # section (see context.py), so even 40 of them stays well within any
        # model's context window.
        context_cap = 40 if is_enumeration else 10
        citation_cap = 45 if is_enumeration else None

        # `reranked` is already sorted by relevance — rerank_results()
        # overwrites even a "pinned" row's placeholder score with its real
        # cross-encoder score, so a genuinely relevant pinned match (e.g. the
        # exact image a query asks for) naturally wins a slot on merit here.
        # Only pinned rows that DIDN'T make that cut get force-appended
        # afterward as a hard guarantee. This ordering matters: an earlier
        # version put ALL pinned rows first unconditionally, so e.g. 10
        # blindly-scanned, barely-relevant images (see retrieval.py's
        # image-presence boost) filled the ENTIRE context budget and pushed
        # out the one correctly-ranked, actually-relevant image entirely —
        # confirmed against a real query ("give me use case diagram") where
        # the right image ranked #1 in retrieval but never reached the model
        # because 10 unrelated pinned images had already used up every slot.
        top_context = reranked[:context_cap]
        included_ids = {r["id"] for r in top_context}
        for r in reranked:
            if r.get("is_pinned") and r["id"] not in included_ids:
                top_context.append(r)
                included_ids.add(r["id"])

        # Stage 5: Context expansion + deduplication
        top_context = expand_and_deduplicate(
            top_context,
            req.knowledge_base_id,
            supabase,
            # Several different figures/tables often live in the same
            # section and would otherwise collapse into just the first one.
            dedupe=not is_enumeration,
            user_id=req.user_id,
        )

        # Narrow down to the exact set of sources that will be shown as
        # citations BEFORE generation, so the [n] markers the model emits
        # line up 1:1 with the citations list the frontend renders — doing
        # this filtering only at the end (after generation) would let the
        # model cite an index that citation dedup/capping later removed.
        cited_context = select_cited_context(
            top_context,
            max_citations=citation_cap,
            # Two different figures/tables can legitimately share a page —
            # page-deduping would drop one of the very things being enumerated.
            dedupe_by_page=not is_enumeration,
        )

        # Stage 6: LLM generation
        answer = generate_answer(req.query, cited_context, req.history)

        # Keep only the context blocks the model actually cited inline —
        # otherwise every candidate handed to generation (including ones it
        # never drew on) shows up as a "reference", which is what made
        # citations look unrelated to the answer. See filter_and_renumber_citations().
        answer, cited_context = filter_and_renumber_citations(answer, cited_context)

        # Stage 7: Citation formatting
        citations = build_citations(cited_context)

        return {"answer": answer, "citations": citations}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing query: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Service unavailable.")
