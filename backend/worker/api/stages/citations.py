import re

from utils.text_clean import strip_markdown_artifacts as _strip_markdown_artifacts

MAX_CITATIONS = 6


def select_cited_context(
    context_docs: list[dict],
    max_citations: int | None = None,
    dedupe_by_page: bool = True,
) -> list[dict]:
    """
    Filters reranked context_docs down to the exact set that will be shown
    as citations, highest-scoring first, capped at max_citations (falls back
    to MAX_CITATIONS when not given).

    Several entries commonly land on the SAME page of the same document —
    expanding a child chunk to its full parent section (see context.py)
    means two sibling chunks can both resolve to one page. Showing each of
    those as a separate citation just spams the UI with repeat page
    references without adding new information, so by default we keep only
    one per (document, page).

    Set dedupe_by_page=False for "list all figures/tables" style queries:
    two DIFFERENT figures can legitimately sit on the same page, and
    page-deduping there would silently drop one of the very things the user
    explicitly asked to enumerate.

    This MUST run before generation (not just before building citation
    dicts): the generation stage numbers its context blocks [1], [2], ... for
    inline citation markers, and those numbers need to match this exact,
    final, deduped list — not the longer pre-dedup list — or the model could
    emit an inline [7] that no longer exists once citations are capped.
    """
    cap = max_citations if max_citations is not None else MAX_CITATIONS
    seen_pages: set[tuple[str, object]] = set()
    selected: list[dict] = []
    for ctx in context_docs:
        if dedupe_by_page:
            metadata = ctx.get("metadata", {})
            document = metadata.get("document_name", "Unknown")
            page = metadata.get("page_number")

            dedup_key = (document, page)
            if page is not None and dedup_key in seen_pages:
                continue
            seen_pages.add(dedup_key)

        selected.append(ctx)
        if len(selected) >= cap:
            break

    return selected


_CITE_MARKER_RE = re.compile(r"\[(\d+)\]|【(\d+)】")


def filter_and_renumber_citations(answer: str, context_docs: list[dict]) -> tuple[str, list[dict]]:
    """
    generate_answer() shows the model ALL of `context_docs` as numbered
    candidates, but a grounded answer typically only actually draws on a
    handful of them — the rest were retrieval/rerank candidates that never
    supported anything the model actually said. Previously every candidate
    was still shown as a "citation" regardless, which is why a question
    like "what are the deadlines" could show six references — an OCR
    fragment, an unrelated table row, a chapter heading — none of which the
    answer actually cited, while the one paragraph the model DID cite [1]
    for the real answer got buried among them.

    Scans the model's own inline [n] / 【n】 markers (in order of first
    appearance), keeps ONLY the context blocks actually referenced, and
    renumbers them 1..m — rewriting the markers in the answer text to match
    — so `citations[i]` still lines up with the inline `[i+1]` the frontend
    turns into a clickable chip.

    Returns (rewritten_answer, filtered_context_docs). If the model didn't
    cite anything concrete, returns an empty citation list rather than
    falling back to showing every candidate.
    """
    used_in_order: list[int] = []
    seen: set[int] = set()
    for m in _CITE_MARKER_RE.finditer(answer):
        num = int(m.group(1) or m.group(2))
        if num not in seen and 1 <= num <= len(context_docs):
            seen.add(num)
            used_in_order.append(num)

    if not used_in_order:
        return answer, []

    remap = {old: new for new, old in enumerate(used_in_order, start=1)}

    def _rewrite(m: re.Match) -> str:
        num = int(m.group(1) or m.group(2))
        new_num = remap.get(num)
        return f"[{new_num}]" if new_num else ""

    rewritten = _CITE_MARKER_RE.sub(_rewrite, answer)
    filtered_docs = [context_docs[old - 1] for old in used_in_order]
    return rewritten, filtered_docs


def build_citations(context_docs: list[dict]) -> list[dict]:
    """
    Stage 7 — Citation Formatting.

    Converts the final (already filtered by select_cited_context) context
    documents into a structured citations list the frontend renders. Order
    matters here: citations[i] must correspond to the inline [i+1] marker
    the model was told to use for the i-th context block.
    """
    citations = []
    for ctx in context_docs:
        metadata = ctx.get("metadata", {})
        # Prefer the ORIGINAL matched paragraph/page (saved in context.py
        # before parent-section expansion) over the (possibly much larger)
        # expanded "content" — the excerpt and the PDF highlight should point
        # at the specific text retrieval actually matched, not an arbitrary
        # slice of a whole section or page.
        source_text = (ctx.get("excerpt_source") or ctx.get("content") or "").strip()
        source_text = _strip_markdown_artifacts(source_text)
        cleaned = re.sub(r"\s+", " ", source_text).strip()
        excerpt = cleaned[:220]
        if len(cleaned) > len(excerpt):
            excerpt += "..."

        source_url = metadata.get("source_url")
        if not source_url and metadata.get("source_file"):
            source_url = f"http://localhost:3000/uploads/{metadata['source_file']}"

        citations.append({
            "document": metadata.get("document_name", "Unknown"),
            "page": metadata.get("page_number"),
            "section": metadata.get("section", ""),
            "image_url": metadata.get("image_url"),
            "confidence_score": ctx.get("score"),
            "excerpt": excerpt,
            # Untruncated (but capped) exact text for the PDF viewer to
            # search for and highlight — kept separate from the display
            # excerpt above so trimming one doesn't affect the other.
            "highlight_text": cleaned[:300],
            "source_url": source_url,
            "source_file": metadata.get("source_file"),
        })

    return citations
