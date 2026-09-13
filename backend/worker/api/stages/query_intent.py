"""
Shared query-intent heuristics used by both retrieval (to decide whether to
widen/boost the search beyond plain vector similarity) and generation (to
decide whether to keep image markdown in the LLM's context). Kept in one
place so the two keyword sets can't silently drift apart.
"""
import re

IMAGE_KEYWORDS = {
    "diagram", "image", "figure", "fig", "chart", "picture", "photo", "photograph",
    "illustration", "screenshot", "graph", "flowchart", "uml", "use case",
    "show me", "display", "visual", "look like", "appearance", "drawing",
}


def wants_image(query: str) -> bool:
    """True if the user's query is plausibly asking to see a visual."""
    q = query.lower()
    return any(kw in q for kw in IMAGE_KEYWORDS)


STRUCTURAL_SCAN_PATTERNS = {
    # Matches "Figure 12" / "Fig. 3" AND appendix-style labels like
    # "A.1" / "B.15" (common for screenshots numbered per-appendix-section
    # rather than sequentially as "Figure N" throughout the whole document).
    # "figure"/"fig" is case-insensitive, but the appendix-letter form is
    # deliberately NOT — a lowercase form ("v.2", "p.5") is far more likely
    # to be a version/page reference than a figure label.
    "figure": re.compile(r"(?i:fig(?:ure)?s?\.?\s*\d+)|\b[A-Z]\.\d+\b"),
    "table": re.compile(r"\btables?\s*\d+", re.IGNORECASE),
}


def detect_enumeration_intent(query: str) -> set[str]:
    """
    Returns which structural element types (currently: figures, tables) the
    user is asking to enumerate EXHAUSTIVELY, e.g. "list all figures", "what
    tables are in this document". Empty set if this isn't that kind of query.

    Standard top-k vector retrieval only surfaces the handful of chunks most
    semantically similar to the query AS A WHOLE — it systematically misses
    most instances of something scattered across many pages/sections, which
    is exactly the case "list all X" needs to handle well.
    """
    q = query.lower()
    if not re.search(r"\ball\b|\bevery\b|\beach\b|\blist\b", q):
        return set()
    wanted = set()
    if "figure" in q or "diagram" in q:
        wanted.add("figure")
    if "table" in q:
        wanted.add("table")
    return wanted
