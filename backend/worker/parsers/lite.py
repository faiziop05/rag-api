import os

import pymupdf as fitz  # PyMuPDF


def parse_lite_mode(file_path: str) -> tuple[list[dict], dict]:
    """
    Parses a PDF or plain-text document using the lightweight path.
    Returns (chunks, manifest) for interface consistency with parse_deep_mode
    /parse_medium_mode — lite mode has no heading/figure detection at all
    (that's the whole point of "lite": fast, raw text, no structure), so its
    manifest is always empty (headings=[], figures=[], tables=[]).
    """
    empty_manifest = {"headings": [], "figures": [], "tables": []}
    ext = os.path.splitext(file_path)[1].lower()

    if ext in {".txt", ".md", ".csv", ".json"}:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            text = f.read()

        if not text.strip():
            return [], empty_manifest

        # Split on double newlines (paragraphs) rather than single newlines
        paragraphs = [p.strip() for p in text.split('\n\n') if p.strip()]
        chunks = [
            {
                "content": paragraph,
                "metadata": {"page_number": 1, "section": "General"},
            }
            for paragraph in paragraphs
            if paragraph and len(paragraph) > 10  # Filter very short fragments
        ]
        return chunks, empty_manifest

    doc = fitz.open(file_path)
    chunks = []

    for page_num in range(len(doc)):
        page = doc.load_page(page_num)
        text = page.get_text("text")

        if text.strip():
            chunks.append(
                {
                    "content": text.strip(),
                    "metadata": {
                        "page_number": page_num + 1,
                        "section": "General",
                    },
                }
            )

    return chunks, empty_manifest
