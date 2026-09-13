from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
import os
import re
import uuid
from ml.ocr import extract_text_from_image
from config.settings import BASE_URL
from parsers.page_resolver import PageResolver

# Matches "Figure 25", "Fig. 3", "Table 7", etc. — used to cross-reference an
# image to every section that talks ABOUT it by name, not just the section
# it's physically sitting next to (see the cross-referencing pass below).
FIGURE_LABEL_RE = re.compile(r'\b(Figures?|Figs?\.?|Tables?)\s+(\d+)\b', re.IGNORECASE)

# do_ocr=False below only reads text that's ALREADY a real text layer, plus
# whatever RapidOCR reads off individual detected picture/figure regions —
# it does NOT read a page that IS one big scanned image, because Docling's
# layout model doesn't carve a full, text-free page into a "Picture"
# region the same way it does a diagram sitting inside a normal page. A
# genuinely scanned document (or a PDF with no real text layer at all)
# would silently come back nearly empty. If the fast pass yields
# suspiciously little text for how many pages there are, it's a strong
# signal the document has no real text layer, and the whole thing is
# re-converted once with Docling's OWN OCR engine turned on instead.
MIN_CHARS_PER_PAGE_BEFORE_OCR_RETRY = 100

def parse_deep_mode(file_path: str) -> list[dict]:
    """
    Parses documents using IBM Docling with deep OCR and layout extraction.
    Capable of reading text inside images, diagrams, and complex tables.
    """
    # Configure Pipeline for deepest extraction (OCR + Picture/Table generation)
    pipeline_options = PdfPipelineOptions()
    pipeline_options.do_ocr = False # Hybrid Mode: Skip slow text OCR
    pipeline_options.do_table_structure = True
    pipeline_options.generate_picture_images = True
    
    converter = DocumentConverter(
        allowed_formats=[InputFormat.PDF, InputFormat.IMAGE, InputFormat.DOCX],
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)
        }
    )
    
    result = converter.convert(file_path)

    # Export to markdown which now includes OCR'd text from diagrams/shapes
    markdown_text = result.document.export_to_markdown()

    # Detect a scanned/no-text-layer document and retry with real OCR (see
    # MIN_CHARS_PER_PAGE_BEFORE_OCR_RETRY above for why the fast pass misses
    # this case). Only PDFs have a meaningful "page count" for this check.
    try:
        num_pages = result.document.num_pages()
    except Exception:
        num_pages = 1
    avg_chars_per_page = len(markdown_text.strip()) / max(num_pages, 1)
    if avg_chars_per_page < MIN_CHARS_PER_PAGE_BEFORE_OCR_RETRY:
        print(
            f"Deep mode extracted only {avg_chars_per_page:.0f} chars/page across "
            f"{num_pages} page(s) — looks like a scanned/no-text-layer document. "
            f"Retrying with OCR enabled."
        )
        ocr_pipeline_options = PdfPipelineOptions()
        ocr_pipeline_options.do_ocr = True
        ocr_pipeline_options.do_table_structure = True
        ocr_pipeline_options.generate_picture_images = True
        ocr_converter = DocumentConverter(
            allowed_formats=[InputFormat.PDF, InputFormat.IMAGE, InputFormat.DOCX],
            format_options={
                InputFormat.PDF: PdfFormatOption(pipeline_options=ocr_pipeline_options)
            },
        )
        try:
            result = ocr_converter.convert(file_path)
            markdown_text = result.document.export_to_markdown()
        except Exception as e:
            # Keep the original (fast-pass) result rather than failing the
            # whole ingestion job just because the OCR retry itself failed.
            print(f"OCR retry failed, keeping original (likely near-empty) result: {e}")

    raw_chunks = markdown_text.split("\n\n## ")

    # [Multi-Modal] Extract Images and index them via LOCAL OCR
    #
    # Docling emits one "<!-- image -->" placeholder per picture, in document
    # order. We must replace them in lockstep with result.document.pictures —
    # if a picture fails and we simply skip to searching from index 0 again,
    # the NEXT picture's image gets attached to the FAILED picture's (earlier)
    # placeholder, and every image after that is off-by-one. To keep them
    # aligned we track a cursor into raw_chunks and always consume exactly one
    # placeholder per picture, success or failure.
    #
    # This used to call a vision LLM (Gemini) here to describe every single
    # image at ingestion time. That meant a 50-image document made 50 API
    # calls before anyone had asked about any of them — on a free-tier key
    # that's a wall of 429s (and paid, it's real cost for images nobody ever
    # queries). Local OCR (RapidOCR, ONNX-based) extracts the image's visible
    # text instead — free, no rate limit, no network call at all. Combined
    # with the image's own caption and the cross-referencing pass below, this
    # is enough for retrieval to find the right image. The vision-LLM call is
    # reserved for QUERY time only, when a user actually asks about a
    # specific image (see ml/vision.answer_about_image, wired into
    # ml/generation.py).
    if hasattr(result.document, "pictures"):
        cursor = 0
        for pic in result.document.pictures:
            target_idx = None
            for i in range(cursor, len(raw_chunks)):
                if "<!-- image -->" in raw_chunks[i]:
                    target_idx = i
                    break
            if target_idx is None:
                break  # no more placeholders left to fill
            cursor = target_idx

            try:
                img = pic.get_image(result.document) if hasattr(pic, "get_image") else getattr(pic, "image", None)
                if img:
                    img_id = str(uuid.uuid4())
                    img_filename = f"{img_id}.png"
                    img_path = os.path.join(os.path.dirname(__file__), "../../gateway/uploads/images", img_filename)
                    os.makedirs(os.path.dirname(img_path), exist_ok=True)
                    img.save(img_path, format="PNG")

                    image_url = f"{BASE_URL}/uploads/images/{img_filename}"

                    ocr_text = extract_text_from_image(img)
                    description = ocr_text if ocr_text else "No readable text detected in this image by OCR."

                    raw_chunks[target_idx] = raw_chunks[target_idx].replace(
                        "<!-- image -->",
                        f"![Image]({image_url})\n\n> **Image Analysis**: {description}\n\n",
                        1,
                    )
                else:
                    # Consume the placeholder anyway so the next picture doesn't inherit it
                    raw_chunks[target_idx] = raw_chunks[target_idx].replace("<!-- image -->", "", 1)
            except Exception as e:
                print(f"Error processing picture: {e}")
                raw_chunks[target_idx] = raw_chunks[target_idx].replace("<!-- image -->", "", 1)
                
    # Build a page resolver from docling provenance before markdown export
    page_resolver = PageResolver()
    try:
        for item, _ in result.document.iterate_items():
            if hasattr(item, 'prov') and item.prov and hasattr(item, 'text'):
                page_no = item.prov[0].page_no if item.prov else 1
                page_resolver.add(item.text, page_no)
    except Exception:
        pass  # If provenance extraction fails, fall back to page 1

    def resolve_page(text: str, fallback: int) -> int:
        return page_resolver.resolve(text, fallback)

    # Now build the final chunks with the injected image URLs
    chunks_final = []
    for i, chunk in enumerate(raw_chunks):
        if not chunk.strip():
            continue

        parent_content = chunk if i == 0 else f"## {chunk}"
        parent_content = parent_content.strip()

        # Section-level page number — used as a fallback for paragraphs that
        # don't have their own provenance match (e.g. a section spans pages
        # 3-5; each paragraph below gets its OWN page where possible instead
        # of all inheriting page 3 from the heading).
        first_line = parent_content.split('\n')[0].strip().lstrip('#').strip()
        section_page = resolve_page(first_line, 1)
        # A section occasionally starts with an image (e.g. a logo at the
        # very top of a cover page) rather than real heading text — using
        # that verbatim as the section name would show raw markdown syntax
        # ("![Image](http://...)") to users instead of a real label.
        section_name = first_line if first_line and not first_line.startswith("![Image](") else "General"

        # Split parent into child chunks (paragraphs)
        child_paragraphs = parent_content.split("\n\n")

        # Tracks the URL of an image whose "![Image](url)" markdown was just
        # processed, so the VERY NEXT paragraph (the OCR/analysis text that
        # describes that same image — see the replacement string built
        # above) can also be tagged with it. Without this, only the
        # paragraph+image chunk below carries image_url — the analysis
        # chunk (often the one a query about the image's actual CONTENT
        # would match, since its text literally IS the image's own OCR'd
        # text) would have no link back to the picture at all, so "give me
        # that image" could match this chunk and return nothing visual.
        # Cleared after every non-image paragraph so it never leaks onto a
        # later, unrelated one.
        pending_image_url = None

        for p in child_paragraphs:
            if not p.strip() or len(p.strip()) < 20:
                continue # Skip very tiny chunks

            stripped = p.strip()
            is_image_markdown = stripped.startswith("![Image](")

            if is_image_markdown:
                match = re.search(r'!\[Image\]\(([^)]+)\)', stripped)
                image_url = match.group(1) if match else None
                pending_image_url = image_url

                # Attach the image to the paragraph right before it (its
                # likely caption/context) — UNLESS that previous chunk
                # already carries a DIFFERENT image's URL (two images with
                # no text between them), where overwriting it would
                # silently reassign that chunk to the wrong picture. Also
                # falls here if this image is the very first thing in the
                # document (no previous chunk to attach to). Either way,
                # give it its own standalone chunk instead.
                prev_chunk = chunks_final[-1] if chunks_final else None
                if prev_chunk is not None and "image_url" not in prev_chunk["metadata"]:
                    prev_chunk["content"] += f"\n\n{stripped}"
                    prev_chunk["metadata"]["parent_context"] += f"\n\n{stripped}"
                    if image_url:
                        prev_chunk["metadata"]["image_url"] = image_url
                        # Marks this as the ORIGINAL chunk the image is
                        # anchored to (as opposed to a chunk that merely
                        # inherits the same url below, e.g. this image's own
                        # OCR text) — see the cross-referencing pass further
                        # down for why that distinction matters.
                        prev_chunk["metadata"]["is_primary_image_chunk"] = True
                else:
                    chunk_metadata = {
                        "page_number": resolve_page(stripped, section_page),
                        "section": section_name,
                        "parent_context": parent_content,
                    }
                    if image_url:
                        chunk_metadata["image_url"] = image_url
                        chunk_metadata["is_primary_image_chunk"] = True
                    chunks_final.append({"content": stripped, "metadata": chunk_metadata})
                continue

            chunk_metadata = {
                "page_number": resolve_page(p, section_page),
                "section": section_name,
                "parent_context": parent_content
            }
            if pending_image_url:
                # This chunk INHERITS the image's url (see comment on
                # pending_image_url above) rather than being the image's own
                # anchor point — deliberately NOT marked is_primary_image_chunk,
                # so the cross-referencing pass below doesn't treat this
                # chunk's neighbors as caption material for this image too.
                chunk_metadata["image_url"] = pending_image_url

            chunks_final.append({
                "content": stripped,
                "metadata": chunk_metadata
            })
            pending_image_url = None

    # ── Cross-reference images to the sections that actually DISCUSS them ────
    #
    # An image currently lives with whichever paragraph physically precedes
    # it in the PDF — but reports commonly group all their figures together
    # in an appendix while discussing what each one MEANS earlier in the main
    # body, referencing it only by name ("...as shown in Figure 5"). Without
    # this, a question like "give me the use case diagram" only ever finds
    # the image if retrieval happens to land on the appendix chunk, even
    # though the main-body chunk describing use cases is the far more likely
    # semantic match. This is pure text matching — no AI calls, no added
    # server/API load — so every document gets it for free at ingestion.
    figure_id_to_url: dict[str, str] = {}
    for idx, c in enumerate(chunks_final):
        img_url = c["metadata"].get("image_url")
        # Only gather caption text from a PRIMARY image chunk (the one the
        # image is actually anchored to), not from a chunk that merely
        # inherited the same url (e.g. the image's own OCR/analysis text —
        # see is_primary_image_chunk above). Otherwise, when that inherited
        # chunk happens to sit right next to an UNRELATED orphaned caption
        # (a "Figure N:" label whose own picture is missing/undetected —
        # this really happens: e.g. a document captioning "Figure 14/15/16"
        # in a row while only 2 pictures actually exist for them), the
        # "next chunk" guess below would wrongly borrow this image's url
        # for that unrelated figure number. Confirmed on a real document:
        # an orphaned "Figure 16" caption was silently mislabeled with
        # Figure 15's picture until this check was added.
        if not img_url or not c["metadata"].get("is_primary_image_chunk"):
            continue
        # The caption ("Figure 25: Classrooms Model Code") is usually the
        # NEXT chunk, since the image markdown itself just got merged onto
        # the chunk that PRECEDED the image above.
        caption_sources = [c["content"]]
        if idx + 1 < len(chunks_final):
            caption_sources.append(chunks_final[idx + 1]["content"])
        for source in caption_sources:
            for m in FIGURE_LABEL_RE.finditer(source):
                kind = "Table" if m.group(1).lower().startswith("tab") else "Figure"
                figure_id_to_url.setdefault(f"{kind} {m.group(2)}", img_url)

    if figure_id_to_url:
        for c in chunks_final:
            if c["metadata"].get("image_url"):
                continue  # already anchored to its own image
            # Re-run the SAME regex on this chunk rather than a plain
            # substring check — PDF text extraction from justified body
            # paragraphs often produces irregular spacing ("Figure  5" with
            # a double space), which a literal "figure 5" substring check
            # silently fails to match even though the regex (with \s+)
            # handles it fine. Normalizing both sides through the regex
            # keeps them comparable regardless of spacing quirks.
            for m in FIGURE_LABEL_RE.finditer(c["content"]):
                kind = "Table" if m.group(1).lower().startswith("tab") else "Figure"
                label = f"{kind} {m.group(2)}"
                if label in figure_id_to_url:
                    c["metadata"]["image_url"] = figure_id_to_url[label]
                    # Distinguishes "the image physically sits here" from
                    # "this chunk just references a figure that lives
                    # elsewhere" — kept in case the two ever need different
                    # treatment later (e.g. displaying vs. citing).
                    c["metadata"]["image_url_referenced"] = True
                    break

    # Generate Table of Contents (ToC) Map
    toc_lines = ["# Document Table of Contents"]
    for chunk in raw_chunks:
        # Reconstruct the split logic to find headings
        if chunk.strip():
            first_line = chunk.split("\n")[0].strip()
            # If it's a heading (or if we just want the first sentence of each main section)
            # We know chunks after i=0 were split on "\n\n## ", so we'll just prepend "## " to those
            # But wait, raw_chunks was split by "\n\n## ". 
            pass

    # A more reliable way: iterate over chunks_final to get unique headings from parent_context
    unique_headings = []
    for c in chunks_final:
        pc = c["metadata"].get("parent_context", "")
        if pc:
            heading = pc.split("\n")[0].strip()
            if heading and heading not in unique_headings:
                # Keep it reasonably short
                if len(heading) < 150:
                    unique_headings.append(heading)

    toc_content = "# Document Table of Contents\n\n" + "\n".join([f"- {h}" for h in unique_headings])
    
    # Append the ToC as a special chunk
    chunks_final.append({
        "content": toc_content,
        "metadata": {
            "page_number": 1,
            "section": "Table of Contents",
            "parent_context": "Table of Contents",
            "is_toc": True
        }
    })

    return chunks_final
