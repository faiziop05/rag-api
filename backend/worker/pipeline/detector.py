import os
import logging
import pymupdf as fitz

logger = logging.getLogger(__name__)

# A raster image or vector-drawing cluster must cover at least this fraction
# of the page's area to count as "meaningful" — filters out small logos,
# bullet icons, and decorative underlines while still catching a genuinely
# large diagram/photo/chart. Computed from real PDF geometry (page.rect,
# page.get_image_bbox()), not guessed.
MIN_MEANINGFUL_AREA_RATIO = 0.03  # 3% of the page

# If a SINGLE page's combined meaningful visual area (images + diagram
# clusters) covers at least this fraction of that page, the whole document
# is promoted to deep mode. This replaces the old "more than 3 images
# anywhere in the document" rule, which missed documents containing just
# 1-2 large, important diagrams (common for a technical report with one
# architecture diagram and one use-case diagram) because 1-2 never crossed
# a flat count of 3.
PAGE_SIGNIFICANT_AREA_RATIO = 0.15  # 15% of a single page

# Kept as a secondary trigger alongside the per-page check above: several
# small-but-meaningful images spread across many pages (each individually
# under PAGE_SIGNIFICANT_AREA_RATIO) should still promote to deep mode.
MEANINGFUL_IMAGE_COUNT_THRESHOLD = 3


def _cluster_rects(rects: list) -> list:
    """
    Groups overlapping/touching bounding boxes into connected clusters. A
    diagram drawn with PDF vector primitives is normally made of MANY small
    paths (lines, curves, small rects) that only make sense as ONE visual
    object together — without clustering, a single diagram would look like
    dozens of tiny, individually-insignificant rectangles instead of one
    large, obviously-meaningful one.
    """
    clusters: list = []
    for r in rects:
        merged_into = None
        for c in clusters:
            if r.intersects(c):
                c |= r
                merged_into = c
                break
        if merged_into is None:
            clusters.append(fitz.Rect(r))

    # Merging can cause two previously-separate clusters to now overlap
    # each other — keep merging pairwise until nothing changes.
    changed = True
    while changed:
        changed = False
        for i in range(len(clusters)):
            for j in range(i + 1, len(clusters)):
                if clusters[i].intersects(clusters[j]):
                    clusters[i] |= clusters[j]
                    del clusters[j]
                    changed = True
                    break
            if changed:
                break
    return clusters


def _page_meaningful_area(page, table_rects: list) -> tuple[float, int]:
    """
    Returns (meaningful_visual_area, meaningful_image_count) for one page —
    the actual pixel/point area covered by raster images and vector-drawing
    clusters big enough to matter, in real PDF geometry.

    Raster images: page.get_image_bbox() gives the image's true placed
    rectangle, so "is it big enough to matter" is a plain area comparison,
    not a guess (this is also the fix for the old bug — the previous code
    called a page.get_image() method that doesn't exist in PyMuPDF at all,
    so its "meaningful image" count silently stayed at 0 forever).

    Vector drawings: page.get_drawings() enumerates every path/line/curve
    from the actual content stream, which is exact for "does a drawing
    exist here" — but a table's own ruling lines are ALSO vector drawings,
    so any drawing overlapping an already-detected table's bbox is
    excluded before clustering, otherwise a table's grid lines would get
    double-counted as "a diagram" on top of already being a table.
    """
    page_area = page.rect.width * page.rect.height
    if page_area <= 0:
        return 0.0, 0

    meaningful_area = 0.0
    meaningful_image_count = 0

    for img in page.get_images(full=True):
        try:
            bbox = page.get_image_bbox(img)
        except Exception:
            continue
        if not bbox or bbox.is_empty:
            continue
        area = bbox.width * bbox.height
        if (area / page_area) >= MIN_MEANINGFUL_AREA_RATIO:
            meaningful_image_count += 1
            meaningful_area += area

    try:
        drawings = page.get_drawings()
    except Exception:
        drawings = []
    drawing_rects = [
        fitz.Rect(d["rect"])
        for d in drawings
        if d.get("rect") and not d["rect"].is_empty
    ]
    non_table_rects = [
        r for r in drawing_rects
        if not any(r.intersects(t) for t in table_rects)
    ]
    for cluster in _cluster_rects(non_table_rects):
        area = cluster.width * cluster.height
        if (area / page_area) >= MIN_MEANINGFUL_AREA_RATIO:
            meaningful_area += area

    return meaningful_area, meaningful_image_count


def determine_optimal_mode(file_path: str, original_name: str = "") -> str:
    """
    Analyses the file to determine the most cost/compute-effective extraction mode.

    Modes:
        lite   — PyMuPDF raw text (fast, plain text PDFs)
        medium — Docling layout extraction (tables, structured docs)
        deep   — Docling with OCR + image extraction (images, diagrams)

    Decision logic for PDFs (per page, using real PDF geometry — see
    _page_meaningful_area() — not a flat document-wide image count):
        - Any page whose meaningful visual area (raster images + non-table
          vector-drawing clusters) covers >= PAGE_SIGNIFICANT_AREA_RATIO
          of that page                                    →  deep
        - OR more than MEANINGFUL_IMAGE_COUNT_THRESHOLD meaningful raster
          images anywhere in the document                 →  deep
        - Tables present (and neither of the above)        →  medium
        - Otherwise                                        →  lite

    Known accepted limitation: table presence still comes from PyMuPDF's
    own find_tables() heuristic (ruled-line/whitespace detection), which
    can occasionally disagree with what Docling's own layout model decides
    at actual extraction time — this detector's job is a cheap prediction
    of what Docling will find, not a second authoritative source. Making
    that 100% consistent would mean running a Docling layout pass here
    too, which would roughly double parsing cost for every document. See
    PROJECT_STRUCTURE.md's "Document mode auto-detection" section for the
    full accuracy write-up and why this tradeoff was accepted.
    """
    ext = (
        os.path.splitext(original_name)[1].lower()
        if original_name
        else os.path.splitext(file_path)[1].lower()
    )

    # Plain-text formats → always lite
    if ext in [".txt", ".md", ".csv", ".json"]:
        return "lite"

    if ext == ".pdf":
        try:
            doc = fitz.open(file_path)
            has_tables = False
            any_page_significant = False
            total_meaningful_images = 0

            for page in doc:
                table_rects: list = []
                try:
                    tables = page.find_tables()
                    if tables and len(tables.tables) > 0:
                        has_tables = True
                        table_rects = [fitz.Rect(t.bbox) for t in tables.tables]
                except Exception:
                    pass

                meaningful_area, meaningful_image_count = _page_meaningful_area(page, table_rects)
                total_meaningful_images += meaningful_image_count

                page_area = page.rect.width * page.rect.height
                if page_area > 0 and (meaningful_area / page_area) >= PAGE_SIGNIFICANT_AREA_RATIO:
                    any_page_significant = True

            doc.close()

            if any_page_significant or total_meaningful_images > MEANINGFUL_IMAGE_COUNT_THRESHOLD:
                logger.info(
                    f"Auto-detect: significant visual content found "
                    f"({total_meaningful_images} meaningful image(s), "
                    f"page-significant={any_page_significant}). Upgrading to Deep mode."
                )
                return "deep"

            if has_tables:
                logger.info("Auto-detect: Tables found. Upgrading to Medium mode.")
                return "medium"

            logger.info("Auto-detect: Text-heavy PDF. Using Lite mode.")
            return "lite"

        except Exception as e:
            logger.error(f"Auto-detect failed: {e}. Falling back to lite.")
            return "lite"

    # Default fallback for .docx and other supported formats
    if ext == ".docx":
        # Check if .docx contains embedded images (simple heuristic)
        try:
            from zipfile import ZipFile
            with ZipFile(file_path) as docx_zip:
                # Check if media folder exists (contains images)
                media_files = [f for f in docx_zip.namelist() if f.startswith('word/media/')]
                if media_files:
                    logger.info(f"Auto-detect: .docx with {len(media_files)} embedded image(s) found. Using Deep mode.")
                    return "deep"
        except Exception as e:
            logger.debug(f"Could not check .docx for images: {e}")

    logger.info(f"Auto-detect: Extension {ext} defaults to Medium.")
    return "medium"
