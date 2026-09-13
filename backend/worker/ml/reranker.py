import os
import logging
from dotenv import load_dotenv

load_dotenv(override=True)

logger = logging.getLogger(__name__)

_voyage_client = None
_local_reranker = None

def get_voyage_client():
    global _voyage_client
    api_key = os.environ.get("VOYAGE_API_KEY")
    if not api_key:
        return None
    if _voyage_client is None:
        import voyageai
        _voyage_client = voyageai.Client(api_key=api_key)
    return _voyage_client

def get_local_reranker():
    global _local_reranker
    if _local_reranker is None:
        logger.info("Loading local BGE Reranker...")
        from sentence_transformers import CrossEncoder
        _local_reranker = CrossEncoder('BAAI/bge-reranker-v2-m3')
    return _local_reranker

def rerank_results(query: str, results: list[dict], top_k: int = None) -> list[dict]:
    """
    Reranks a list of search results based on their relevance to the query.
    Uses Voyage AI rerank-2 if VOYAGE_API_KEY is configured, otherwise falls back to local cross-encoder.
    """
    if not results:
        return []
    
    docs = [doc.get("content", "") for doc in results]
    client = get_voyage_client()
    
    if client:
        try:
            import copy
            model_name = os.environ.get("VOYAGE_RERANK_MODEL", "rerank-2")
            response = client.rerank(query=query, documents=docs, model=model_name, top_k=top_k)
            reranked = []
            for r in response.results:
                doc = copy.deepcopy(results[r.index])
                doc["score"] = float(r.relevance_score)
                reranked.append(doc)
            return reranked
        except Exception as e:
            logger.warning(f"Voyage rerank failed, falling back to local/original order: {e}")
            
    # Fallback to local CrossEncoder
    try:
        import copy
        reranker = get_local_reranker()
        pairs = [[query, doc.get("content", "")] for doc in results]
        scores = reranker.predict(pairs)
        scored_results = []
        for i, doc in enumerate(results):
            doc_copy = copy.deepcopy(doc)
            doc_copy["score"] = float(scores[i])
            scored_results.append(doc_copy)
        reranked = sorted(scored_results, key=lambda x: x.get("score", 0), reverse=True)
        return reranked[:top_k] if top_k else reranked
    except Exception as e:
        logger.error(f"Local reranker fallback error: {e}")
        return results

