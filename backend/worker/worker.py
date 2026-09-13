"""
worker.py — BullMQ worker entrypoint for document ingestion.

This file only bootstraps the worker process.
All ingestion logic lives in pipeline/processor.py.
"""
import asyncio
import logging
from bullmq import Worker
from config.settings import REDIS_URL
from pipeline.processor import process_document

logging.basicConfig(level=logging.INFO)


async def main():
    logging.info(f"Starting BullMQ worker, connecting to {REDIS_URL}")

    worker = Worker(
        "ingestion",
        process_document,
        {"connection": REDIS_URL},
    )

    # Keep the worker alive indefinitely
    await asyncio.sleep(float("inf"))


if __name__ == "__main__":
    asyncio.run(main())
