import os

import pymupdf as fitz  # PyMuPDF


def parse_lite_mode(file_path: str) -> list[dict]:
    """
    Parses a PDF or plain-text document using the lightweight path.
    Returns a list of chunks (dictionaries with content and metadata).
    """
    ext = os.path.splitext(file_path)[1].lower()

    if ext in {".txt", ".md", ".csv", ".json"}:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            text = f.read()

        if not text.strip():
            return []

        # Split on double newlines (paragraphs) rather than single newlines
        paragraphs = [p.strip() for p in text.split('\n\n') if p.strip()]
        return [
            {
                "content": paragraph,
                "metadata": {"page_number": 1, "section": "General"},
            }
            for paragraph in paragraphs
            if paragraph and len(paragraph) > 10  # Filter very short fragments
        ]

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

    return chunks
