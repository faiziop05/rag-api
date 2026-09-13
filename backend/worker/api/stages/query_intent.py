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


# Words that appear in almost every "give me the whole chapter" style
# request but carry no topical signal of WHICH chapter/section is meant —
# stripped out before scoring word overlap against heading titles below.
_SECTION_REQUEST_STOPWORDS = {
    "full", "whole", "complete", "entire", "all", "give", "me", "the", "a", "an",
    "of", "please", "show", "document", "this", "chapter", "section", "and", "for",
}
_SECTION_REQUEST_TRIGGER_RE = re.compile(
    r"\b(full|whole|complete|entire)\b.*\b(chapter|section)\b"
    r"|\b(chapter|section)\b.*\b(full|whole|complete|entire)\b",
    re.IGNORECASE,
)
_CHAPTER_NUMBER_RE = re.compile(r"\bchapter\s+(\d+)\b", re.IGNORECASE)
_SECTION_NUMBER_RE = re.compile(r"\bsection\s+(\d+(?:\.\d+)*)\b", re.IGNORECASE)


def detect_section_request(query: str, manifest: dict | None) -> dict | None:
    """
    Returns the manifest heading the user is asking to see IN FULL (e.g.
    "give me the full background chapter", "show me the entire Chapter 2"),
    or None. Deliberately narrow — only triggers on explicit
    full/whole/complete/entire phrasing, NOT on every question that happens
    to be about a topic some heading covers (e.g. "why is data literacy
    important" should NOT match "Chapter 2: Background..." and dump the
    whole chapter; it's a normal question with a normal, topical answer).

    Matching, in order:
      1. An explicit "Chapter N" / "Section N.M" number in the query —
         matched directly against a heading whose title starts with that
         same numbering. Unambiguous when present.
      2. Otherwise, word-overlap between the query (minus generic trigger
         words like "full"/"chapter"/"give me") and each heading's own
         title — e.g. "background" overlaps "Chapter 2: Background and
         existing systems". Requires at least one real overlapping word;
         never guesses off zero signal.
    """
    if not manifest or not manifest.get("headings"):
        return None
    if not _SECTION_REQUEST_TRIGGER_RE.search(query):
        return None

    headings = manifest["headings"]

    chapter_match = _CHAPTER_NUMBER_RE.search(query)
    if chapter_match:
        target = f"chapter {chapter_match.group(1)}"
        for h in headings:
            if h["title"].strip().lower().startswith(target):
                return h

    section_match = _SECTION_NUMBER_RE.search(query)
    if section_match:
        target = section_match.group(1)
        for h in headings:
            if h["title"].strip().lower().startswith(target):
                return h

    query_words = set(re.findall(r"[a-z0-9]+", query.lower())) - _SECTION_REQUEST_STOPWORDS
    if not query_words:
        return None

    # Confirmed on a real document: "give me the full background CHAPTER"
    # tied on word-overlap between "Chapter 2: Background and existing
    # systems" (level 0) and an unrelated "1.1 Background & Motivation"
    # (level 1, under a DIFFERENT chapter) — both share only the word
    # "background". A tie-break using the query's OWN "chapter"/"section"
    # wording (stripped from word-overlap scoring above, but still present
    # in the original query) resolves it correctly: the user said "chapter",
    # so a level-0 heading should win a tie over a deeper one, and vice
    # versa for "section".
    wants_chapter = bool(re.search(r"\bchapter\b", query, re.IGNORECASE))
    wants_section = bool(re.search(r"\bsection\b", query, re.IGNORECASE))

    def _level_bonus(level: int) -> float:
        if wants_chapter and level == 0:
            return 0.5
        if wants_section and level > 0:
            return 0.5
        return 0.0

    best_heading = None
    best_score = 0.0
    for h in headings:
        title_words = set(re.findall(r"[a-z0-9]+", h["title"].lower())) - _SECTION_REQUEST_STOPWORDS
        overlap = len(query_words & title_words)
        if overlap == 0:
            continue
        score = overlap + _level_bonus(h["level"])
        if score > best_score:
            best_score = score
            best_heading = h

    return best_heading
