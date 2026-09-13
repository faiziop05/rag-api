import os
import json
import asyncio
import logging
import tempfile
import urllib.request
from urllib.parse import urlparse

from bullmq import Job

from pipeline.detector import determine_optimal_mode
from parsers.lite import parse_lite_mode
from parsers.medium import parse_medium_mode
from parsers.deep import parse_deep_mode
from ml.embeddings import generate_embedding, generate_embeddings_batch
from db.documents import insert_chunks
from utils.text_clean import strip_markdown_artifacts

logger = logging.getLogger(__name__)

# parse_deep_mode() restricts Docling to PDF/image/DOCX internally, and
# parse_medium_mode()'s bare Docling converter has no InputFormat for these
# either — requesting deep/medium mode for one of these file types would
# fail the whole ingestion job outright with a raw conversion error. The
# web UI already avoids this combination, but a direct API caller (the
# public /ingest endpoint accepts any processing_mode) can still hit it, so
# this is a safety net: fall back to lite mode rather than crash, since a
# plain text file has no images/tables for deep/medium to find anyway.
DEEP_SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".png", ".jpg", ".jpeg", ".tiff", ".bmp", ".gif"}
MEDIUM_UNSUPPORTED_EXTENSIONS = {".txt", ".json"}


async def process_document(job: Job, token: str) -> dict:
    """
    BullMQ job handler for document ingestion.

    Pipeline:
        1. Download remote file (if URL)
        2. Auto-detect or use requested processing mode
        3. Parse document into chunks
        4. Batch-embed chunks
        5. Store chunks in Supabase
    """
    data = job.data
    kb_id = data.get("knowledge_base_id")
    file_path = data.get("filePath")
    mode = data.get("processing_mode", "fast")
    user_metadata = data.get("metadata", {})
    user_id = data.get("user_id")
    original_name = data.get("originalName") or os.path.basename(file_path)

    logger.info(f"Processing job {job.id} | KB: {kb_id} | requested mode: {mode}")

    # ── Step 1: Download remote file ──────────────────────────────────────────
    is_temp_file = False
    if file_path and file_path.startswith("http"):
        logger.info(f"Downloading remote file: {file_path}")
        # Extract actual file extension from URL, don't force .pdf
        parsed_url = urlparse(file_path)
        url_path = parsed_url.path
        ext = os.path.splitext(url_path)[1].lower() or ".pdf"  # Default to .pdf if no extension
        temp_fd, temp_path = tempfile.mkstemp(suffix=ext)
        os.close(temp_fd)
        urllib.request.urlretrieve(file_path, temp_path)
        file_path = temp_path
        is_temp_file = True

    # ── Step 2: Auto-detect processing mode ──────────────────────────────────
    if mode in ("auto", "fast"):
        mode = determine_optimal_mode(file_path, original_name)

    # ── Step 2b: Guard against a mode the file type can't actually support ───
    ext = os.path.splitext(original_name or file_path)[1].lower()
    if mode == "deep" and ext not in DEEP_SUPPORTED_EXTENSIONS:
        logger.warning(
            f"Deep mode doesn't support '{ext}' files — falling back to lite mode "
            f"instead of failing the job."
        )
        mode = "lite"
    elif mode == "medium" and ext in MEDIUM_UNSUPPORTED_EXTENSIONS:
        logger.warning(
            f"Medium mode doesn't support '{ext}' files — falling back to lite mode "
            f"instead of failing the job."
        )
        mode = "lite"

    # ── Step 3: Parse document ────────────────────────────────────────────────
    # Every parse_*_mode() call is synchronous and can run for minutes on a
    # large/image-heavy document (Docling conversion + per-image vision
    # calls). Running it directly here would block THIS event loop the whole
    # time — and this same event loop is what BullMQ's background task uses
    # to renew the job's lock every ~15s. Block it for too long and BullMQ
    # concludes the worker died and marks the job "stalled" (which is exactly
    # what was happening to large documents before this fix). asyncio.to_thread
    # moves the blocking call to a separate thread so the event loop stays
    # free to keep renewing the lock while parsing runs.
    chunks = []
    manifest = {"headings": [], "figures": [], "tables": []}
    try:
        if mode == "deep":
            logger.info("Using Docling (Deep Mode — OCR & Images)")
            chunks, manifest = await asyncio.to_thread(parse_deep_mode, file_path)
        elif mode == "medium":
            logger.info("Using Docling (Medium Mode — Standard Layout)")
            chunks, manifest = await asyncio.to_thread(parse_medium_mode, file_path)
        else:
            logger.info("Using PyMuPDF (Lite Mode — Raw Text)")
            chunks, manifest = await asyncio.to_thread(parse_lite_mode, file_path)
    except Exception as e:
        logger.error(f"Error parsing document: {e}")
        raise
    finally:
        if is_temp_file:
            os.remove(file_path)

    logger.info(f"Extracted {len(chunks)} chunks.")

    # ── Step 4: Embed & store ─────────────────────────────────────────────────
    valid_chunks = [c for c in chunks if c.get("content", "").strip()]
    if valid_chunks:
        # Embed a CLEANED version of each chunk's text (markdown table pipes/
        # separator rows, list markers, etc. stripped — see
        # utils/text_clean.py) rather than the raw Docling markdown. A chunk
        # like "| | | database... |---|---|---|" is noisy, low-signal input
        # for an embedding model and hurts retrieval matching for table
        # content specifically. The STORED `content` below (used for LLM
        # context at generation time) is intentionally left as the original,
        # unmodified markdown — the LLM benefits from seeing real table
        # structure when answering questions about one; only the embedding
        # input needs to be clean.
        contents = [strip_markdown_artifacts(c.get("content", "")) for c in valid_chunks]

        source_file_name = os.path.basename(file_path) if file_path else original_name

        # Batch embed — 64 chunks at a time to respect rate limits
        batch_size = 64
        all_embeddings: list[list[float]] = []
        embedding_model = None  # Track which model is used for consistency
        
        for b_idx in range(0, len(contents), batch_size):
            b_contents = contents[b_idx : b_idx + batch_size]

            logger.info(
                f"Starting embedding generation for batch "
                f"{b_idx // batch_size + 1} "
                f"({len(b_contents)} chunks)..."
            )

            b_embeddings, model_used = await asyncio.to_thread(
                generate_embeddings_batch, b_contents, input_type="document"
            )
            
            # Ensure we don't mix embedding models across batches
            if embedding_model is None:
                embedding_model = model_used
                logger.info(f"Using embedding model: {embedding_model}")
            elif embedding_model != model_used:
                logger.error(f"WARNING: Embedding model changed from {embedding_model} to {model_used}. This will break retrieval!")
                raise RuntimeError(f"Embedding model mismatch: {embedding_model} vs {model_used}")
            
            # Verify batch size matches to prevent silent truncation via zip()
            if len(b_embeddings) != len(b_contents):
                logger.error(f"Batch size mismatch: got {len(b_embeddings)} embeddings for {len(b_contents)} chunks")
                raise RuntimeError(f"Embedding batch incomplete: expected {len(b_contents)}, got {len(b_embeddings)}")
            
            all_embeddings.extend(b_embeddings)

            logger.info(
            f"Embedding generation complete for batch "
            f"{b_idx // batch_size + 1} "
            f"({len(b_embeddings)} embeddings).\n"
            )

        records = []
        for chunk, embedding in zip(valid_chunks, all_embeddings):
            content = chunk.get("content", "")
            from config.settings import BASE_URL
            metadata = chunk.get("metadata", {})
            # Set parser-derived metadata first
            metadata["document_name"] = original_name
            metadata["source_file"] = source_file_name
            metadata["source_url"] = (
                f"{BASE_URL}/uploads/{source_file_name}"
                if source_file_name
                else None
            )
            # User metadata overwrites only if explicitly provided
            metadata.update(user_metadata)

            record = {
                "knowledge_base_id": kb_id,
                "content": content,
                "embedding": embedding,
                "metadata": metadata,
            }
            if user_id:
                record["user_id"] = user_id
            records.append(record)

        # Store the document's structural index (headings tree + figure/
        # table locations, see parsers/manifest.py) as one extra row,
        # alongside the normal chunks — reuses the existing `documents`
        # table/schema rather than needing a new migration. Marked
        # is_manifest=True so retrieval.py can fetch it directly (by
        # knowledge_base_id + that flag) and — just as importantly — so
        # normal hybrid/keyword search never surfaces this row as if it
        # were a real, citable passage; its content is a JSON blob, not
        # prose. Needs SOME embedding to satisfy the table's schema even
        # though it's never meant to be found via similarity — a short,
        # generic phrase is enough since it's excluded from search anyway.
        if manifest.get("headings") or manifest.get("figures") or manifest.get("tables"):
            manifest_embedding = await asyncio.to_thread(generate_embedding, "document structure manifest", "document")
            manifest_record = {
                "knowledge_base_id": kb_id,
                "content": json.dumps(manifest),
                "embedding": manifest_embedding,
                "metadata": {
                    "is_manifest": True,
                    "document_name": original_name,
                },
            }
            if user_id:
                manifest_record["user_id"] = user_id
            records.append(manifest_record)
            logger.info(
                f"Manifest: {len(manifest.get('headings', []))} headings, "
                f"{len(manifest.get('figures', []))} figures, {len(manifest.get('tables', []))} tables."
            )

        # ── Step 5: Persist to Supabase ───────────────────────────────────────
        logger.info(f"Starting Supabase insertion for {len(records)} records...")
        await asyncio.to_thread(insert_chunks, records)
        logger.info("Supabase insertion complete.")

    logger.info(f"Finished job {job.id} — {len(valid_chunks)} chunks stored.")
    return {"status": "success", "chunks_processed": len(valid_chunks)}
