import re

# Docling's own heading "level" (from iterate_items()) is NOT a reliable
# hierarchy signal — confirmed on a real document: EVERY heading, from
# "Chapter 1: ..." down to "1.1.1 The Problem", reports level=1 flat, with
# no distinction between chapter/section/subsection. The heading TEXT's own
# numbering is the actual reliable signal for a numbered academic/technical
# report (the common case this targets), so hierarchy is classified from
# that instead.
_CHAPTER_RE = re.compile(r"^chapter\s+\d+\b", re.IGNORECASE)
_SUBSECTION_RE = re.compile(r"^\d+\.\d+\.\d+\b")  # "1.1.1 The Problem"
_SECTION_RE = re.compile(r"^\d+\.\d+\b")  # "1.1 Background & Motivation"
# Docling sometimes misclassifies an ordinary enumerated list item (e.g.
# "1. Common Online Data Analysis Platform (CODAP)") as a section header.
# Distinguished from real sub-numbering ("1.1") by what follows the dot: a
# SPACE (list item) vs. another DIGIT (sub-numbering) — confirmed on a real
# document where both patterns appear side by side.
_LIST_ITEM_RE = re.compile(r"^\d+\.\s")

_FIGURE_TABLE_RE = re.compile(r"\b(Figures?|Figs?\.?|Tables?)\s+(\d+)\b", re.IGNORECASE)


def classify_heading(text: str) -> int | None:
    """
    Returns a hierarchy level (0=chapter, 1=section, 2=subsection) for a
    heading's own text, or None if it doesn't match a recognized numbered
    pattern and looks like Docling-misclassified list content rather than a
    real heading (see _LIST_ITEM_RE above) — callers should still keep an
    unrecognized-but-not-list-like heading (e.g. "DECLARATION", "References")
    as a level-0 entry; only explicit list-item false positives are dropped.
    """
    stripped = text.strip()
    if _SUBSECTION_RE.match(stripped):
        return 2
    if _SECTION_RE.match(stripped):
        return 1
    if _LIST_ITEM_RE.match(stripped):
        return None  # Docling false positive — an enumerated list item, not a heading
    if _CHAPTER_RE.match(stripped):
        return 0
    return 0  # Unnumbered top-level section (e.g. "DECLARATION", "References")


def build_manifest(chunks: list[dict]) -> dict:
    """
    Builds a structural index of the document from its already-parsed
    chunks — NOT a second, independent extraction pass. Headings, page
    numbers, figure/table-to-image links, and section assignment are all
    read from metadata the parser (deep.py/medium.py) already computed and
    verified during normal chunking, rather than re-deriving them from
    Docling's own (for this purpose, unreliable — see classify_heading
    above) heading-level and caption attributes.

    Returns:
        {
          "headings": [{"title", "level", "page_start", "page_end"}, ...],
          "figures":  [{"label", "page", "image_url", "section"}, ...],
          "tables":   [{"label", "page", "section"}, ...],
        }
    Ordered by first appearance (== document reading order, since chunks are
    already in that order).
    """
    # ── Headings: one entry per distinct "section" value, in first-seen order ──
    #
    # page_start is deliberately NOT just "whichever chunk we saw this
    # section on first" — confirmed on a real document that the heading's
    # OWN text (e.g. "## 1.1 Background & Motivation", as its own short
    # chunk) resolves to the WRONG page via the page-resolver's text
    # matching (too short/generic a string to match reliably), while the
    # actual paragraph immediately following it resolves correctly. Using
    # the minimum page number across every SUBSTANTIVE chunk in the section
    # (i.e. excluding the bare heading-line stub itself) sidesteps that
    # unreliable resolution rather than inheriting it.
    section_pages: dict[str, list[int]] = {}
    for c in chunks:
        section = c.get("metadata", {}).get("section")
        if not section:
            continue
        stripped_content = c.get("content", "").strip().lstrip("#").strip()
        if stripped_content == section.strip():
            continue  # the bare heading line itself — see comment above
        section_pages.setdefault(section, []).append(c.get("metadata", {}).get("page_number", 1))

    headings: list[dict] = []
    seen_sections: set[str] = set()
    for c in chunks:
        section = c.get("metadata", {}).get("section")
        if not section or section in ("General",) or section in seen_sections:
            continue
        level = classify_heading(section)
        if level is None:
            continue  # Docling-misclassified list item — not a real heading
        seen_sections.add(section)
        pages = section_pages.get(section) or [c.get("metadata", {}).get("page_number", 1)]
        headings.append({
            "title": section,
            "level": level,
            "page_start": min(pages),
            "page_end": None,  # filled in below, once every heading's page_start is known
        })

    last_page = max((c.get("metadata", {}).get("page_number", 1) for c in chunks), default=1)
    for i, h in enumerate(headings):
        # A heading's range must extend through its OWN subsections, not
        # just up to the very next entry in the flat list — confirmed this
        # matters on a real document: "Chapter 2" is immediately followed
        # in the list by its own first subsection "2.1 Background
        # research", both starting on the SAME page, so naively using
        # "next heading's page_start" gave Chapter 2 a range of just that
        # one page instead of covering 2.1 through 2.4 too. The correct
        # boundary is the next heading at the SAME level or HIGHER (i.e.
        # skip past anything deeper — a subsection of this one).
        end_page = last_page
        for later in headings[i + 1:]:
            if later["level"] <= h["level"]:
                end_page = later["page_start"]
                break
        h["page_end"] = max(h["page_start"], end_page)

    # ── Figures & tables: derived from each chunk's OWN image_url + section,
    # which deep.py has already cross-referenced correctly (see deep.py's
    # figure_id_to_url pass) — this just reads that result back out into a
    # flat, directly-queryable list instead of re-scanning text with regex
    # again at query time.
    figures: dict[str, dict] = {}
    tables: dict[str, dict] = {}
    for c in chunks:
        metadata = c.get("metadata", {})
        image_url = metadata.get("image_url")
        page = metadata.get("page_number", 1)
        section = metadata.get("section", "")
        content = c.get("content", "")
        for m in _FIGURE_TABLE_RE.finditer(content):
            kind = "table" if m.group(1).lower().startswith("tab") else "figure"
            label = f"{'Table' if kind == 'table' else 'Figure'} {m.group(2)}"
            target = figures if kind == "figure" else tables
            # The line containing the match, e.g. "Figure 26: Datasets
            # Model Code" — this IS the caption for a chunk that's just
            # "label + image markdown" (the common case), or a longer
            # sentence for an inline body mention ("...as shown in Figure
            # 26 which..."); either way, real descriptive text rather than
            # a bare label, which is what a "list all figures" answer
            # actually needs to be useful (not just "Figure 26" with
            # nothing else).
            line_start = content.rfind("\n", 0, m.start()) + 1
            line_end = content.find("\n", m.end())
            if line_end == -1:
                line_end = len(content)
            caption = content[line_start:line_end].strip()
            # Prefer an entry that actually HAS an image (the chunk anchored
            # to the real picture) over one that merely mentions the label
            # in passing body text — first-anchored-wins, but an image-
            # carrying chunk always overrides a text-only mention.
            existing = target.get(label)
            if existing is None or (image_url and not existing.get("image_url")):
                entry = {"label": label, "page": page, "section": section, "caption": caption}
                if kind == "figure":
                    entry["image_url"] = image_url
                target[label] = entry

    def _label_sort_key(label: str):
        m = re.search(r"\d+", label)
        return int(m.group()) if m else 0

    return {
        "headings": headings,
        "figures": sorted(figures.values(), key=lambda f: _label_sort_key(f["label"])),
        "tables": sorted(tables.values(), key=lambda t: _label_sort_key(t["label"])),
    }
