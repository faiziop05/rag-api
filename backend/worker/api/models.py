from pydantic import BaseModel


class QueryRequest(BaseModel):
    """Incoming payload for the POST /query endpoint."""
    knowledge_base_id: str
    query: str
    history: list[dict] = []
    user_id: str = None
