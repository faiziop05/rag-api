# Recall — Reliable Context API

A production-grade RAG (Retrieval-Augmented Generation) document Q&A platform, built to answer questions about PDFs with accurate, page-level citations and structural awareness of the source document.

## Overview

Recall lets a user upload documents (PDFs, with figures/tables/images), then ask natural-language questions and get grounded answers with inline `[n]` citations that link straight back to the exact page and highlighted passage in the original PDF. It's built around a 7-stage retrieval pipeline (reformulation → agentic routing → hybrid search → reranking → context expansion → citation-safe generation) rather than a naive "embed and stuff into a prompt" approach, specifically to handle long structured documents (manuals, papers, reports) with headings, figures, and tables.

## Problem it solves

Most simple RAG demos break down on real documents: they lose section structure, can't answer "list every figure in chapter 3"-style enumeration questions, hallucinate citations that don't match the retrieved text, and can't tell a user *where in the PDF* an answer came from. Recall is built to solve those specific failure modes for professional/technical documents rather than short unstructured text snippets.

## Key features

- **7-stage query pipeline**: query reformulation using chat history → agentic table-of-contents routing → hybrid (vector + keyword) retrieval via a Supabase RPC → cross-encoder/Voyage reranking → context-cap with a "pin guarantee" for structurally/image-matched rows → parent-section expansion for LLM grounding → dedup + numbered citation generation
- **Citation-accurate PDF viewer**: `PDFReferenceViewer.jsx` uses `react-pdf`/pdf.js text items to exact-match-highlight the cited passage on the correct page, not just jump to a page number
- **Structural document index (manifest)**: whole-chapter and figure/table enumeration support, so questions like "what tables are in section 2" work via a structural scan rather than relying purely on vector similarity
- **Three-tier ingestion parsing** (`lite` / `medium` / `deep`): a `deep`-mode Docling parser extracts markdown, pictures, and cross-references figure/table labels to their extracted images; mode is auto-selected per document (or set explicitly from the UI/API) based on document characteristics
- **OCR at ingestion, vision at query time**: RapidOCR runs locally at ingestion to extract text from figures/images cheaply; a Gemini vision call is only made at query time, for a specific already-identified image the user is asking about
- **Async ingestion via BullMQ/Redis**: uploads are queued and processed by a separate Python worker so the gateway stays responsive
- **Developer API keys**: third-party callers can hit `/ingest` and `/query` directly

## What's unique about it

- **Citation excerpt vs. LLM context are deliberately kept separate**: the parent-section text used to ground the LLM's answer is expanded for context, but the original matched chunk (`excerpt_source`) is preserved separately so citations point at what was actually matched, not the expanded context — avoiding citations that "look right" but quote text the model never actually used as the match.
- **Reranking re-scores pinned rows too**: structural/image-matched rows aren't blindly force-included — they still compete on the reranker score, with a fallback "pin guarantee" that only re-adds a pinned row if it got cut, preventing irrelevant pinned hits from crowding out genuinely relevant ones.
- **Runs an ongoing self-audit log** (`PROJECT_STRUCTURE.md`) of each pipeline stage, verifying real behavior against intended behavior stage-by-stage (e.g. caught a `PyMuPDF` API that silently no-op'd behind a bare `except: pass`).

## Tech stack

- **Frontend**: React 19 + Vite, Redux Toolkit, `react-pdf` (pdf.js) for in-browser PDF rendering/highlighting, `react-markdown` for chat rendering, plain CSS with custom properties for theming
- **Gateway**: Node.js / Express 5 — auth (JWT + bcrypt), uploads (multer), document CRUD, proxies query requests to the worker; BullMQ + ioredis for job queueing; nodemailer for verification/reset emails
- **Worker**: Python / FastAPI — the RAG pipeline itself; Docling for deep document parsing; RapidOCR for ingestion-time OCR; LiteLLM for multi-provider LLM calls (Groq primary, Gemini fallback); Voyage AI or a local CrossEncoder for reranking
- **Database**: Supabase (Postgres + pgvector) — chunk storage with a `metadata` JSONB column, hybrid vector+keyword search via a Postgres RPC
- **Queue**: BullMQ (Redis-backed) for async ingestion jobs

## Setup / running instructions

Prerequisites: Node.js, Python 3, Redis, and a Supabase project (Postgres + pgvector).

1. Copy the env templates and fill in credentials:
   ```bash
   cp backend/gateway/.env.example backend/gateway/.env
   cp backend/worker/.env.example backend/worker/.env
   ```
   Required: `SUPABASE_URL`, `SUPABASE_KEY`, `JWT_SECRET`, `REDIS_URL`, `GROQ_API_KEY` (LLM). Optional: `VOYAGE_API_KEY` (reranking/embeddings), `GEMINI_API_KEY` (query-time vision), SMTP settings (email).
2. Run the DB migrations in `backend/migrations/` against your Supabase Postgres instance.
3. Install dependencies:
   ```bash
   cd backend/gateway && npm install
   cd ../worker && pip install -r requirements.txt
   cd ../../frontend && npm install
   ```
4. Start everything with the dev launcher (kills stale processes on ports 3000/8000 and starts gateway + worker):
   ```bash
   ./backend/start.sh
   ```
5. In a separate terminal, start the frontend:
   ```bash
   cd frontend && npm run dev
   ```
   The gateway runs on `:3000`, the FastAPI worker on `:8000`, and the Vite dev server on `:5173` by default.

Frontend scripts: `npm run dev`, `npm run build`, `npm run lint` (oxlint), `npm run preview`.
