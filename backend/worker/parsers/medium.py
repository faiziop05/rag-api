from docling.document_converter import DocumentConverter
from parsers.page_resolver import PageResolver
from parsers.manifest import build_manifest

def parse_medium_mode(file_path: str) -> tuple[list[dict], dict]:
    """
    Parses complex documents using IBM Docling for layout-aware extraction.
    Preserves table structures and document hierarchies without heavy image OCR.

    Returns (chunks, manifest) — see parsers/manifest.py. Medium mode never
    extracts images, so manifest["figures"] is always empty here; headings
    and any explicitly-labeled "Table N" references are still captured.
    """
    converter = DocumentConverter()
    result = converter.convert(file_path)

    # Docling exports to perfect Markdown which is great for LLMs
    markdown_text = result.document.export_to_markdown()

    # Extract page numbers from provenance before chunking
    page_resolver = PageResolver()
    try:
        for item, _ in result.document.iterate_items():
            if hasattr(item, 'prov') and item.prov and hasattr(item, 'text'):
                page_no = item.prov[0].page_no if item.prov else 1
                page_resolver.add(item.text, page_no)
    except Exception:
        pass

    # For MVP, we will chunk by markdown headers (simulated here by splitting on double newlines or headers)
    # A robust implementation would use a MarkdownTextSplitter.
    raw_chunks = markdown_text.split("\n\n## ")

    def resolve_page(text, fallback):
        return page_resolver.resolve(text, fallback)

    chunks = []
    for i, chunk in enumerate(raw_chunks):
        if not chunk.strip():
            continue

        parent_content = chunk if i == 0 else f"## {chunk}"
        parent_content = parent_content.strip()

        # Section-level page number — used as a fallback for paragraphs that
        # don't have their own provenance match (a section can span several
        # pages, so each paragraph gets its OWN page where possible instead of
        # all inheriting the heading's page).
        first_line = parent_content.split('\n')[0].strip().lstrip('#').strip()
        section_page = resolve_page(first_line, 1)

        # Split parent into child chunks (paragraphs)
        child_paragraphs = parent_content.split("\n\n")

        for p in child_paragraphs:
            if not p.strip() or len(p.strip()) < 20:
                continue # Skip very tiny chunks

            section_text = first_line if first_line else "General"
            chunks.append({
                "content": p.strip(),
                "metadata": {
                    "page_number": resolve_page(p, section_page),
                    "section": section_text,
                    "parent_context": parent_content
                }
            })

    manifest = build_manifest(chunks)
    return chunks, manifest
