import re
import logging
from ml.embeddings import generate_embedding
from api.stages.query_intent import (
    STRUCTURAL_SCAN_PATTERNS,
    detect_enumeration_intent,
    wants_image,
)

logger = logging.getLogger(__name__)

MAX_STRUCTURAL_MATCHES = 40
MAX_IMAGE_MATCHES = 10


def _fetch_all_chunks(kb_id: str, supabase, user_id: str | None = None) -> list[dict]:
    """
    Every caller of this function bypasses the vector-search RPC (which
    scopes by user_id at the database level) and reads chunks directly by
    knowledge_base_id alone — CONFIRMED via a live cross-account test to be
    a real data leak without this filter: a second, unrelated account could
    retrieve another user's private document contents just by knowing (or
    guessing — kb ids are a predictable "filename_timestamp" pattern, not a
    secret) its knowledge_base_id, through the "list all tables/figures" and
    "give me that image" paths (both call this function) and the routed-
    heading path below. Filtering by user_id here as well closes that off —
    matches the scoping the hybrid_search RPC already enforces correctly.
    """
    query = (
        supabase.table("documents")
        .select("id, content, metadata")
        .eq("knowledge_base_id", kb_id)
    )
    if user_id:
        query = query.eq("user_id", user_id)
    res = query.execute()
    return res.data or []


# Extracts a specific "figure_12" / "table_3" style key (kind + number kept
# separate so "Figure 5" and "Table 5" are never treated as the same item)
# — used by _scan_structural_matches to prioritize BREADTH (one
# representative chunk per distinct figure/table) over raw document order.
_LABEL_RE = re.compile(r'\b(fig(?:ure)?s?|tables?)\.?\s*(\d+)\b', re.IGNORECASE)


def _extract_labels(content: str) -> set[str]:
    labels = set()
    for m in _LABEL_RE.finditer(content or ""):
        kind = "table" if m.group(1).lower().startswith("tab") else "figure"
        labels.add(f"{kind}_{m.group(2)}")
    return labels


def _scan_structural_matches(kb_id: str, element_types: set[str], supabase, user_id: str | None = None) -> list[dict]:
    """
    Directly scans every chunk of the knowledge base for structural patterns
    like "Figure 12" / "Table 3", instead of relying on vector similarity —
    a "list all figures" query is semantically similar to almost nothing in
    particular, so vector search alone would only return a handful of
    tangentially-related chunks and miss most of the actual figures/tables.

    Prioritizes BREADTH over raw document order: an early figure is
    typically mentioned several times (its own caption, then again whenever
    later text refers back to it — "as shown in Figure 5"), while a late
    figure is often mentioned only once. Scanning in plain document order
    and stopping at MAX_STRUCTURAL_MATCHES therefore means repeat mentions
    of EARLY figures consume the entire cap before the scan ever reaches
    later ones. Confirmed on a real 97-page, 39-figure document: 121 chunks
    matched the figure pattern at all, but the old document-order scan
    filled its cap of 40 with figures 1-24's repeat mentions and never
    reached figures 25-39 at all — those were silently missing from every
    answer, not because they weren't findable, but because nothing further
    down the pipeline ever saw them. Fixed by scanning for chunks carrying
    a NOT-YET-SEEN figure/table number first, and only using any leftover
    budget for additional (repeat) mentions of numbers already covered.
    """
    patterns = [STRUCTURAL_SCAN_PATTERNS[t] for t in element_types if t in STRUCTURAL_SCAN_PATTERNS]
    if not patterns:
        return []

    candidates: list[tuple[dict, set[str]]] = []
    for row in _fetch_all_chunks(kb_id, supabase, user_id):
        content = row.get("content") or ""
        if any(p.search(content) for p in patterns):
            candidates.append((row, _extract_labels(content)))

    included_ids: set = set()
    matches: list[dict] = []

    def _add(row: dict) -> None:
        row["score"] = 0.95
        # Marks this row so the router keeps it even if reranking (which
        # scores general topical relevance, not "does this literally
        # contain a figure/table") would otherwise push it out of the
        # top-N — completeness matters more than relevance ranking here.
        row["is_pinned"] = True
        matches.append(row)
        included_ids.add(row["id"])

    # Pass 1: one chunk per NOT-YET-SEEN label (or per chunk the pattern
    # matched but couldn't parse a clean number from — rare, but worth
    # keeping rather than silently dropping).
    seen_labels: set[str] = set()
    for row, labels in candidates:
        if len(matches) >= MAX_STRUCTURAL_MATCHES:
            break
        if not labels or (labels - seen_labels):
            _add(row)
            seen_labels |= labels

    # Pass 2: only if there's budget left over, add repeat mentions too —
    # extra context on an already-covered figure is still useful, just
    # never at the expense of a figure that hasn't been covered at all.
    if len(matches) < MAX_STRUCTURAL_MATCHES:
        for row, _labels in candidates:
            if len(matches) >= MAX_STRUCTURAL_MATCHES:
                break
            if row["id"] not in included_ids:
                _add(row)

    return matches


def _scan_image_matches(kb_id: str, original_query: str, supabase, limit: int = MAX_IMAGE_MATCHES, user_id: str | None = None) -> list[dict]:
    """
    Directly fetches chunks carrying an extracted image, regardless of
    vector similarity — a document can have far more images than `limit`,
    so which ones get pinned matters. Rank candidates by how many words they
    share with the query (e.g. "give me use case diagram" vs. a chunk
    captioned "Figure 5: Use Case diagram") rather than taking whichever
    images happen to come first in the table — a document's EARLIER chapters
    would otherwise always win the cap over the actually-relevant later one.
    router.py additionally guarantees pinned rows never crowd out a
    better-ranked unpinned result, so this ranking is a secondary safety net,
    not the only thing standing between "right image" and "wrong image".
    """
    query_words = set(re.findall(r"[a-z0-9]+", original_query.lower()))

    scored: list[tuple[int, dict]] = []
    for row in _fetch_all_chunks(kb_id, supabase, user_id):
        if row.get("metadata", {}).get("image_url"):
            content_words = set(re.findall(r"[a-z0-9]+", (row.get("content") or "").lower()))
            scored.append((len(query_words & content_words), row))

    scored.sort(key=lambda pair: pair[0], reverse=True)
    matches = []
    for _, row in scored[:limit]:
        row["score"] = 0.9
        row["is_pinned"] = True
        matches.append(row)
    return matches


def retrieve_results(
    search_query: str,
    original_query: str,
    kb_id: str,
    user_id: str | None,
    target_headings: list[str],
    supabase,
) -> list[dict]:
    """
    Stage 3 — Hybrid Retrieval.

    Combines several retrieval strategies:
      a) Targeted structural retrieval — if the agentic router identified specific headings,
         fetch all chunks whose parent_context starts with one of those headings.
      b) Exhaustive structural scan — if the query is asking to enumerate ALL
         figures/tables, directly scan every chunk for those patterns instead
         of relying on vector similarity to happen to surface them.
      c) Image-presence boost — if the query is asking to see a visual,
         directly surface any chunk that carries an extracted image.
      d) Standard hybrid search — always runs vector + keyword search via the Supabase RPC.

    Deduplicates results by document ID before returning.
    """
    results: list[dict] = []

    # ── 3a. Targeted structural retrieval ────────────────────────────────────
    if target_headings:
        for row in _fetch_all_chunks(kb_id, supabase, user_id):
            pc = row.get("metadata", {}).get("parent_context", "")
            for heading in target_headings:
                if pc.startswith(heading.strip()):
                    row["score"] = 0.99
                    results.append(row)
                    break

    existing_ids = {r["id"] for r in results}

    def _merge(rows: list[dict]) -> None:
        for row in rows:
            if row["id"] not in existing_ids:
                results.append(row)
                existing_ids.add(row["id"])

    # ── 3b. Exhaustive structural scan ("list all figures/tables") ──────────
    enumeration_types = detect_enumeration_intent(original_query)
    if enumeration_types:
        _merge(_scan_structural_matches(kb_id, enumeration_types, supabase, user_id))

    # ── 3c. Image-presence boost ─────────────────────────────────────────────
    if wants_image(original_query):
        _merge(_scan_image_matches(kb_id, original_query, supabase, user_id=user_id))

    # ── 3d. Hybrid vector + keyword search ───────────────────────────────────
    query_embedding = generate_embedding(search_query, input_type="query")
    vector_res = supabase.rpc(
        "hybrid_search",
        {
            "query_text": original_query,
            "query_embedding": query_embedding,
            "kb_id": kb_id,
            "p_user_id": user_id,
            "match_threshold": -1.0,
            "match_count": 50,
        },
    ).execute()

    if vector_res.data:
        _merge(vector_res.data)

    return results
