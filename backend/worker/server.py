"""
api.py — FastAPI entrypoint for the RAG inference server.

This file only bootstraps the application.
All query logic lives in api/router.py and api/stages/*.py.
"""
import uvicorn
from fastapi import FastAPI
from api.router import router

app = FastAPI(title="RAG Inference API")

# Mount the query router
app.include_router(router)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.1", port=8000)
