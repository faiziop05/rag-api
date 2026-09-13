import logging

logger = logging.getLogger(__name__)

_ocr_engine = None


def get_ocr_engine():
    global _ocr_engine
    if _ocr_engine is None:
        logger.info("Loading local RapidOCR engine...")
        from rapidocr import RapidOCR
        _ocr_engine = RapidOCR()
    return _ocr_engine


def extract_text_from_image(pil_image) -> str:
    """
    Runs local OCR (RapidOCR — ONNX-based, no external binary, no API call)
    on an image and returns whatever visible text it finds.

    Used at INGESTION time instead of a vision-LLM call: describing every
    image in a document via Gemini/etc. is what was hitting free-tier rate
    limits and adding real per-image API cost even for images nobody ever
    asks about. Local OCR is free and has no rate limit — combined with the
    image's own caption and the cross-referencing pass in parsers/deep.py,
    it's enough signal for retrieval to find the right image. The
    vision-LLM call is reserved for QUERY time only, when a user actually
    asks something about a specific image (see ml/vision.answer_about_image).
    """
    import numpy as np

    try:
        engine = get_ocr_engine()
        result = engine(np.array(pil_image.convert("RGB")))
        if result and result.txts:
            return " ".join(t.strip() for t in result.txts if t and t.strip())
    except Exception as e:
        logger.warning(f"Local OCR failed: {e}")
    return ""
