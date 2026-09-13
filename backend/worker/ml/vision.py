import os
import time
import base64
import logging
from dotenv import load_dotenv

load_dotenv(override=True)

logger = logging.getLogger(__name__)

_genai_client = None

def get_genai_client():
    global _genai_client
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return None
    if _genai_client is None:
        try:
            from google import genai
            _genai_client = genai.Client(api_key=api_key)
        except Exception as e:
            logger.error(f"Failed to initialize Google GenAI client: {e}")
            return None
    return _genai_client


def _ask_vision_model(base64_image: str, prompt: str, fallback: str) -> str:
    """
    Call path for answer_about_image() (query-time, question-specific —
    the only vision-LLM caller left; ingestion now indexes images via local
    OCR instead, see ml/ocr.py and parsers/deep.py). Tries each candidate
    Gemini model with exponential backoff on rate limits/transient errors.
    """
    client = get_genai_client()
    if not client:
        logger.warning("No vision model available (GEMINI_API_KEY missing or client init failed).")
        return fallback

    from google.genai import types
    image_bytes = base64.b64decode(base64_image)
    image_part = types.Part.from_bytes(data=image_bytes, mime_type="image/png")

    # Groq's vision-capable Llama models (llama-3.2-*-vision-preview) were
    # decommissioned and, as of writing, Groq's catalog has no vision-capable
    # model to fall back to — so this only tries Gemini variants rather than
    # wasting a request on a fallback that's guaranteed to fail.
    candidate_models = ["gemini-2.5-flash", "gemini-flash-latest"]
    for model_name in candidate_models:
        # Images are frequently described concurrently (see parsers/deep.py's
        # ThreadPoolExecutor), which means a burst of requests can land in
        # the same rate-limit window and all get a 429 back together — a
        # single 1s pause isn't enough for that window to clear. Exponential
        # backoff (1s, 2s, 4s, 8s) gives it real room to recover instead of
        # burning through both candidate models' retries in ~2 seconds.
        for attempt in range(4):
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=[prompt, image_part]
                )
                if response and response.text:
                    return response.text.strip()
            except Exception as e:
                if "503" in str(e) or "429" in str(e):
                    time.sleep(2 ** attempt)
                    continue
                logger.warning(f"Gemini model {model_name} failed: {e}")
                break

    return fallback


def answer_about_image(base64_image: str, question: str) -> str:
    """
    Query-time: once retrieval has already identified an image as relevant
    to the user's CURRENT question (via its ingestion-time description),
    re-examine the actual image with that specific question rather than
    reusing the generic stored description. The upfront description is
    necessarily generic ("describe everything") and can easily miss a
    detail the user specifically asks about later — sending the real
    question back to the vision model gets a targeted answer instead of a
    best-effort guess from a summary that wasn't written with this question
    in mind.
    """
    prompt = (
        f"Look at this image and answer the following question as accurately and specifically "
        f"as possible, based only on what is visible in the image:\n\n{question}\n\n"
        f"If the image does not contain enough information to answer, say so clearly rather than guessing."
    )
    return _ask_vision_model(base64_image, prompt, "Image description unavailable.")
