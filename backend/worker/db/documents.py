import logging
import uuid
from config.supabase import get_supabase

logger = logging.getLogger(__name__)


def insert_chunks(records: list[dict]) -> None:
    """
    Batch-inserts vector chunk records into the Supabase `documents` table.
    Inserts in batches of 50 to stay within Supabase request-size limits.

    Each record must contain:
        - knowledge_base_id (str)
        - content           (str)
        - embedding         (list[float])
        - metadata          (dict)
        - user_id           (str, optional)

    All-or-nothing from the caller's point of view: if any batch fails
    partway through (a bad value, a transient network error), every batch
    already committed for THIS call is rolled back before re-raising —
    confirmed with a real Supabase insert that a batch failure otherwise
    leaves earlier batches permanently committed, silently producing a
    partial, incomplete knowledge base that still shows up in the user's
    document list looking like a normal (just smaller) document, with
    nothing indicating it's actually broken.

    Rollback is scoped to THIS specific call, not just knowledge_base_id —
    each record is stamped with a fresh `_ingestion_run_id` (stored inside
    `metadata`, not a real column, since adding one needs a migration this
    codebase can't run automatically) and rollback deletes by
    (knowledge_base_id, _ingestion_run_id) together. knowledge_base_id
    alone would be enough in the common case, but it's generated from a
    filename + a 4-digit slice of a millisecond timestamp (see
    Dashboard.jsx), so a collision with an OLDER, already-successful
    knowledge base under the same id is not impossible — deleting by id
    alone would wipe out that unrelated document too.
    """
    supabase = get_supabase()
    if not supabase:
        logger.error("Supabase client not available. Skipping chunk insertion.")
        return
    if not records:
        return

    kb_id = records[0].get("knowledge_base_id")
    run_id = str(uuid.uuid4())
    for r in records:
        r.setdefault("metadata", {})["_ingestion_run_id"] = run_id

    batch_size = 50
    inserted_batches = 0
    try:
        for i in range(0, len(records), batch_size):
            batch = records[i : i + batch_size]
            supabase.table("documents").insert(batch).execute()
            inserted_batches += 1
            logger.info(f"Inserted batch {inserted_batches} ({len(batch)} chunks).")
    except Exception as e:
        already_inserted = inserted_batches * batch_size
        logger.error(
            f"Failed to insert batch {inserted_batches + 1}: {e}. Rolling back "
            f"{already_inserted} already-inserted chunk(s) for knowledge_base_id="
            f"{kb_id!r} so this ingestion doesn't leave a partial, broken "
            f"knowledge base behind."
        )
        if kb_id and already_inserted > 0:
            try:
                supabase.table("documents") \
                    .delete() \
                    .eq("knowledge_base_id", kb_id) \
                    .contains("metadata", {"_ingestion_run_id": run_id}) \
                    .execute()
                logger.info(f"Rollback complete for knowledge_base_id={kb_id!r}.")
            except Exception as rollback_err:
                logger.error(
                    f"Rollback ALSO failed for knowledge_base_id={kb_id!r}: "
                    f"{rollback_err}. Partial data may remain — manual cleanup needed "
                    f"(delete from documents where knowledge_base_id = '{kb_id}')."
                )
        raise
