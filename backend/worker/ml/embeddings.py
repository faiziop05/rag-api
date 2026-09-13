import os
import logging
from dotenv import load_dotenv

load_dotenv(override=True)

logger = logging.getLogger(__name__)

_voyage_client = None
_local_model = None

def get_voyage_client():
    global _voyage_client
    api_key = os.environ.get("VOYAGE_API_KEY")
    if not api_key:
        return None
    if _voyage_client is None:
        import voyageai
        _voyage_client = voyageai.Client(api_key=api_key)
    return _voyage_client

def get_local_model():
    global _local_model
    if _local_model is None:
        logger.info("Loading local BGE-M3 model...")
        from sentence_transformers import SentenceTransformer
        _local_model = SentenceTransformer('BAAI/bge-m3')
    return _local_model

def generate_embedding(text: str, input_type: str = "document") -> list[float]:
    """Generates an embedding for a given text using Voyage AI (voyage-3) or local fallback."""
    client = get_voyage_client()
    if client:
        model_name = os.environ.get("VOYAGE_EMBEDDING_MODEL", "voyage-3")
        res = client.embed([text], model=model_name, input_type=input_type)
        return res.embeddings[0]
    
    # Fallback to local model if VOYAGE_API_KEY is not set
    model = get_local_model()
    embedding = model.encode(text, normalize_embeddings=True)
    return embedding.tolist()

def generate_embeddings_batch(texts: list[str], input_type: str = "document") -> tuple:
    """Batch embedding generation using Voyage AI or local fallback.
    
    Returns:
        Tuple of (embeddings, model_name) to track which embedding model was used.
        This prevents mixing embeddings from different models.
    """
    if not texts:
        return [], "none"
    client = get_voyage_client()
    if client:
        model_name = os.environ.get("VOYAGE_EMBEDDING_MODEL", "voyage-3")
        try:
            res = client.embed(texts, model=model_name, input_type=input_type)
            return res.embeddings, model_name
        except Exception as e:
            logger.warning(f"Voyage embedding failed: {e}. Falling back to local model.")
    
    model = get_local_model()
    embeddings = model.encode(texts, normalize_embeddings=True)
    return [e.tolist() for e in embeddings], "bge-m3-local"

