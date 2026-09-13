class PageResolver:
    """
    Maps arbitrary text snippets (paragraphs split out of Docling's markdown
    export) back to the PDF page they actually came from, using Docling's
    per-item provenance collected during iterate_items().

    Built as an ORDERED LIST, not a dict: repeated text (running headers,
    footers, boilerplate disclaimers) produces the same truncated snippet on
    MULTIPLE pages, and a dict keyed by that snippet silently keeps only the
    last page written, discarding every earlier occurrence.

    Resolution walks forward from a monotonic cursor instead of rescanning
    from the top on every call: paragraphs are chunked out in the same
    reading order Docling walked the document in, so a forward-only search
    naturally disambiguates repeated text by proximity — a paragraph can't
    be citing content that appears earlier than where we've already
    resolved up to. This is what was missing before: a plain "first
    substring match in the whole document" would grab whichever earlier
    occurrence happened to be inserted last (or first), regardless of which
    actual occurrence the paragraph came from — producing a citation page
    number that looks plausible but is simply wrong, which is also why the
    PDF viewer's exact-text highlight then fails to find that text on the
    page it navigated to.
    """

    _MIN_MATCH_LEN = 15
    _SNIPPET_LEN = 200

    def __init__(self):
        self._items: list[tuple[str, int]] = []
        self._cursor = 0

    def add(self, text: str, page_no: int) -> None:
        snippet = (text or "").strip()[: self._SNIPPET_LEN]
        if len(snippet) >= self._MIN_MATCH_LEN:
            self._items.append((snippet, page_no))

    @staticmethod
    def _matches(a: str, b: str) -> bool:
        return a in b or b in a

    def resolve(self, text: str, fallback: int) -> int:
        snippet = (text or "").strip().lstrip("#").strip()[: self._SNIPPET_LEN]
        if len(snippet) < 10:
            return fallback

        for i in range(self._cursor, len(self._items)):
            key, page_no = self._items[i]
            if self._matches(snippet, key):
                self._cursor = i
                return page_no

        # Fallback: full scan from the start, for the rare case a chunk is
        # out of the original reading order (e.g. an image re-attached to
        # a preceding chunk during post-processing).
        for i, (key, page_no) in enumerate(self._items):
            if self._matches(snippet, key):
                self._cursor = i
                return page_no

        return fallback
