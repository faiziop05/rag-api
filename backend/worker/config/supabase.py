import logging
from supabase import create_client, Client
from config.settings import SUPABASE_URL, SUPABASE_KEY

logger = logging.getLogger(__name__)

_supabase_client: Client | None = None


def get_supabase() -> Client | None:
    """
    Returns the shared Supabase client singleton.
    Returns None if SUPABASE_URL / SUPABASE_KEY are not configured,
    so callers can degrade gracefully.
    """
    global _supabase_client
    if _supabase_client is None:
        if not SUPABASE_URL or not SUPABASE_KEY:
            logger.warning("SUPABASE_URL and SUPABASE_KEY not set. Supabase client unavailable.")
            return None
        _supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
    return _supabase_client
