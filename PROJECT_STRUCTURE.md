# Recall — Project Structure & Architecture

Read this before exploring the codebase — it's the map so future sessions
don't need to re-read every file to get oriented.

## Stack
- **Frontend**: React 19 + Vite, Redux Toolkit, `react-pdf` v11 (react-markdown for chat), plain CSS (`index.css`, CSS vars for theming)
- **Gateway**: Node.js/Express (`backend/gateway`) — auth, uploads, document CRUD, proxies query requests
- **Worker**: Python/FastAPI (`backend/worker`) — the actual RAG pipeline (ingestion + query)
- **Queue**: BullMQ (Redis-backed) — async document ingestion jobs
- **DB**: Supabase (Postgres + pgvector) — NOT Firestore. Chunks live in a `documents` table with a `metadata` JSONB column.
- **LLM**: LiteLLM multi-provider — Groq (`groq/openai/gpt-oss-120b` primary, several fallbacks) + Gemini fallback
- **Vision**: Gemini vision API, QUERY-TIME ONLY (`ml/vision.py::answer_about_image`) — asks about one already-identified image when the user's question is about it
- **OCR**: RapidOCR (local, free, `ml/ocr.py`) — used at INGESTION time to extract text from images/figures instead of calling any vision API per image
- **Reranking**: Voyage or local CrossEncoder (`ml/reranker.py`)

## Directory Map

```
backend/
  start.sh                     # dev launcher — kills stale node/python on 3000/8000 before starting, uses `exec` so Ctrl+C actually kills children
  gateway/                     # Node/Express — auth, upload, document CRUD, proxy to worker
    src/server.js
    src/routes/documents.js    # /documents endpoints (list/upload/delete), aggregates chunk_count/created_at for dashboard
    uploads/                   # uploaded PDFs + extracted images live on disk here
  worker/                      # Python/FastAPI — the RAG pipeline itself
    worker.py                  # BullMQ job consumer (ingestion)
    server.py                  # FastAPI app entrypoint (query endpoint host)
    api/
      router.py                 # POST /query — orchestrates the 7-stage pipeline end to end
      models.py                 # QueryRequest etc.
      stages/
        reformulation.py         # Stage 1: contextual query reformulation (uses chat history)
        routing.py                # Stage 2: agentic ToC routing — picks target headings/sections
        retrieval.py               # Stage 3: hybrid retrieval (vector+keyword RPC, structural scan, image-presence boost)
        query_intent.py             # wants_image(), detect_enumeration_intent(), STRUCTURAL_SCAN_PATTERNS
        context.py                   # Stage 5: parent-section expansion + dedup (keeps `excerpt_source` = original matched text before expansion)
        citations.py                  # Stages: select_cited_context() (caps+dedupes BEFORE generation so [n] markers line up), build_citations() (formats final citation dicts incl. excerpt/highlight_text)
    ml/
      generation.py             # Stage 6: LLM answer generation, candidate model fallback chain, system prompt incl. "return the actual image, don't describe it" rule, fresh per-query vision answers for image questions
      vision.py                  # answer_about_image() — query-time Gemini vision call only
      ocr.py                     # extract_text_from_image() — RapidOCR, ingestion-time
      embeddings.py              # generate_embedding()
      reranker.py                # rerank_results() — cross-encoder/Voyage reranking
    parsers/
      deep.py                    # Docling-based deep-mode parser: markdown export, picture extraction + OCR, figure/table label → image_url cross-referencing pass
      medium.py                   # medium-mode parser: per-paragraph page resolution, parent_context metadata
      lite.py                      # lite-mode (page-based) parser, no structural metadata
    pipeline/
      processor.py                # orchestrates parse → embed → insert per document; wraps blocking calls in asyncio.to_thread() to avoid starving BullMQ lock-renewal
      detector.py                  # picks parse mode (deep/medium/lite) based on doc characteristics
    config/
      settings.py                 # env-driven config (BASE_URL, LLM_MODEL, LLM_MAX_TOKENS, etc.)
      supabase.py                  # Supabase client factory
    db/documents.py               # DB helper queries
frontend/
  src/
    pages/
      DocumentChat.jsx           # main chat UI: message list, inline `[n]` citation click handling, right panel (PDF viewer/image/source), citationList/selectedCitation state
      Dashboard.jsx                # metrics dashboard (chunk counts, doc counts, etc.)
    components/
      PDFReferenceViewer.jsx      # react-pdf based viewer: fit-to-width sizing, exact-text highlighting via pdf.js text items, bottom "References" list
      UploadModal.jsx               # upload flow incl. processing_mode selector (deep/medium/lite)
    store/slices/documentsSlice.js  # Redux slice for documents/upload thunks
    index.css                      # all styling incl. .pdf-* classes, --surface etc. CSS vars
```

## RAG Query Pipeline (7 stages, see `api/router.py`)
1. **Reformulation** — rewrite query using chat history context
2. **Agentic routing** — pick target ToC headings to search first
3. **Hybrid retrieval** — vector+keyword Supabase RPC (`hybrid_search`) + structural scan (enumeration queries) + image-presence boost (image queries), merged/deduped by id
4. **Reranking** — cross-encoder/Voyage re-scores everything, including "pinned" rows (structural/image matches), so pinned-but-irrelevant rows can lose their slot on merit
5. **Context cap + pin guarantee** — take top N by rank, then force-append any pinned row that didn't make the cut (prevents blindly-pinned irrelevant items crowding out the best-ranked relevant one)
6. **Expansion + dedup** (`context.py`) — child chunk's `content` gets replaced by full parent-section text for LLM grounding, but `excerpt_source` preserves the ORIGINAL matched chunk text (this is what citations should point at)
7. **select_cited_context()** — caps + dedupes-by-page BEFORE generation, so the model's inline `[n]` markers stay in sync with the final citations list
8. **generate_answer()** — LLM call with numbered context blocks, inline `[n]` citation instructions, "return the actual image if asked for a diagram" rule
9. **build_citations()** — formats final citation dicts: `excerpt` (220 char, display), `highlight_text` (300 char, untruncated-ish, for PDF viewer exact-match highlighting), `source_url`, `page`, `image_url`

## Pipeline stage-by-stage audit (running log, started 2026-09-13)

Going through the ingestion + query pipeline one stage at a time to verify
each one actually does what it claims, fixing what's broken and recording
the reasoning so later sessions don't have to re-derive it. Append a new
`###` entry per stage as we go instead of re-litigating earlier ones.

### New feature (branch `feature/document-manifest`): document structural index — 2026-09-13

Built to replace the ad-hoc, similarity-search-dependent handling of "list
all figures/tables" and "give me the whole chapter/section" requests with a
real, persisted structural map of the document, built once at ingestion —
see the chat transcript investigation earlier the same day for the
user-reported failures this targets ("give me full background chapter" →
"I don't have enough information"; "list all 45 endpoints" → partial/honest
refusal; figure enumeration relying on a live regex scan).

**New file: `parsers/manifest.py`** — `build_manifest(chunks)` walks the
ALREADY-parsed chunk list (not a second, independent extraction pass) and
produces `{headings: [...], figures: [...], tables: [...]}`:
- **Headings** — one entry per distinct `metadata.section` value, with a
  `level` (0=chapter, 1=section, 2=subsection) and a `[page_start, page_end]`
  range. Docling's OWN heading-level attribute turned out to be useless for
  this — confirmed on a real document that EVERY heading, from "Chapter 1"
  down to "1.1.1 The Problem", reports `level=1` flat — so hierarchy is
  classified from the heading TEXT's own numbering pattern instead
  (`classify_heading()`: `Chapter N` → 0, `N.M` → 1, `N.M.K` → 2). Also
  filters out a real Docling quirk: ordinary enumerated list items
  ("1. Common Online Data Analysis Platform (CODAP)") sometimes get
  misclassified as section headers — distinguished from real sub-numbering
  ("1.1") by what follows the dot (a space vs. another digit).
- **page_start** deliberately does NOT use the heading's own resolved page —
  confirmed a real, pre-existing bug where a short heading line like
  "## 1.1 Background & Motivation" resolves to the WRONG page via the
  page-resolver's text matching (too short/generic to match reliably),
  while the substantive paragraph right after it resolves correctly. Fixed
  by taking the minimum page across every chunk in that section EXCLUDING
  the bare heading-line stub itself.
- **page_end** must extend through a heading's OWN subsections, not just to
  the next entry in the flat list — confirmed "Chapter 2" and its first
  subsection "2.1" both start on the same page, so naively using "next
  heading's page_start" gave Chapter 2 a one-page range instead of covering
  2.1-2.4 too. Fixed: a heading's end is the start of the next heading at
  the SAME level or HIGHER (skipping past anything deeper, i.e. its own
  children).
- **Figures/tables** are derived from each chunk's own `image_url` +
  cross-referenced label (the SAME data `deep.py`'s existing cross-
  referencing pass already computes — not a new, separately-risky detection
  mechanism), with a `caption` extracted as the actual text LINE containing
  the "Figure N"/"Table N" match — real descriptive text ("Figure 25:
  Classrooms Model Code"), not a bare label, which is what makes a "list all
  figures" answer actually useful rather than just a number.
- Docling's own per-item `.captions`/`.caption_text` attributes were tried
  first and found EMPTY for this document's tables/pictures — confirmed
  directly, not assumed — hence deriving captions from the chunk text
  instead.

**Parser return signature changed**: `parse_deep_mode`/`parse_medium_mode`/
`parse_lite_mode` now return `(chunks, manifest)` instead of just `chunks`
(lite mode's manifest is always empty — no structure to index there).
`pipeline/processor.py` updated to unpack this and store the manifest as
ONE extra row per document (`metadata.is_manifest = True`, `content` = the
JSON-serialized manifest) — reuses the existing `documents` table/schema
rather than needing a new migration; needs a placeholder embedding to
satisfy the schema even though it's never meant to be found via similarity
(explicitly excluded from search — see below).

**Query-side wiring**:
- `query_intent.py::detect_section_request(query, manifest)` — recognizes
  "give me the full/whole/complete/entire chapter/section X" phrasing
  specifically (NOT every question that happens to be about a topic some
  heading covers — a normal question still gets a normal, topical answer).
  Matches an explicit "Chapter N"/"Section N.M" number directly when
  present; otherwise scores word-overlap between the query and each
  heading's title. A real tie found and fixed: "give me the full background
  chapter" tied between "Chapter 2: Background and existing systems" and an
  unrelated "1.1 Background & Motivation" (both share only the word
  "background") — resolved by using the query's own "chapter"/"section"
  wording as a tie-breaker preferring the matching heading level.
- `retrieval.py::fetch_manifest()` / `fetch_chunks_by_page_range()` — the
  latter fetches EVERY chunk in a matched section's exact page range
  directly, guaranteed complete (not a top-K similarity guess).
- `retrieval.py::manifest_enumeration_matches()` — for "list all
  figures/tables", reads the manifest's list directly when available
  (reliable — replaces the live regex scan for documents that have a
  manifest); falls back to the old scan for documents ingested before this
  feature existed or where the manifest has nothing for the requested type.
- `retrieve_results()` now returns `(results, needs_full_context)` —
  `needs_full_context` covers BOTH enumeration AND whole-section requests,
  since both need `context.py`'s dedup-by-section collapsing turned off
  (fetching many paragraphs of the SAME section would otherwise collapse
  down to one) and a much higher `context_cap`/`citation_cap` in
  `router.py` (40 / 80, up from 10 / None) — a plain "is this an
  enumeration query" check would have missed the whole-section case
  entirely.

**Two real bugs found and fixed WHILE testing this end-to-end** (not
theoretical — both directly broke the very first live test):
1. The synthetic `is_toc` housekeeping chunk (and the new `is_manifest`
   chunk) were never excluded from normal retrieval — confirmed live: for
   "give me the full background chapter", the ToC chunk (containing every
   chapter name) reranked HIGHER than most real chapter content, since it's
   literally full of the query's own keywords. Fixed by excluding both
   flags in `retrieval.py`'s merge step.
2. A document's own literal "Contents" page (the real, rendered table of
   contents FROM THE PDF ITSELF, not a synthetic chunk) got parsed as one
   dense, unsplit ~16,000-character block — confirmed this single chunk
   nearly ate the ENTIRE 22,000-char generation budget by itself, before
   the "is_toc" fix even landed. Fixed with a general per-block size cap in
   `generation.py` (`MAX_CHARS_PER_BLOCK = 3000`) — defense-in-depth against
   ANY oversized chunk from any source, not just this one.

**Verified end-to-end, live, against the real 97-page/39-figure document**:
- "give me the full background chapter" — went from "I don't have enough
  information" (before this feature) to a genuinely comprehensive answer
  correctly covering all four of Chapter 2's real subsections (2.1-2.4),
  with 11 accurate citations quoting the real document text verbatim.
- "list all figures" — manifest path confirmed active (real captions like
  "Figure 25: Classrooms Model Code" appearing in the answer, not bare
  labels), returning 28-35 of 39 figures across separate test runs — the
  remaining gap under real testing-day rate-limit pressure is the SAME
  already-documented, deliberately-accepted char-budget tradeoff from
  earlier that day, not a new issue.

**Known, accepted limitations (documented, not silently missed)**:
- Unnumbered front/back-matter headings ("References", "Appendix") can
  still resolve to a wrong page via the same short-generic-text page-
  resolution weakness — the fix above only targeted the SPECIFIC case
  found (a heading's own bare stub line), not this related but distinct
  case. Only affects a handful of front/back-matter entries; the numbered
  chapter hierarchy (what "give me chapter X" queries actually target) is
  solid.
- A handful of clearly non-heading strings (e.g. "Datasets (Base:
  /api/teacher/datasets)") still appear as level-0 manifest entries —
  Docling misclassifying API-route-looking text as a section header, a
  different failure mode than the enumerated-list-item case the classifier
  already filters. Cosmetic (extra manifest noise), not a correctness bug —
  doesn't affect chapter/figure lookups.
- Generalizing enumeration beyond figures/tables to arbitrary "list all X"
  requests (e.g. "list all 45 API endpoints") was explicitly scoped OUT of
  this pass — that needs structured extraction of arbitrary data tables'
  row contents, a bigger, more document-specific feature, not attempted
  here to avoid shipping something unverified.

### Stage: `pipeline/detector.py` (`determine_optimal_mode`) — audited & fixed 2026-09-13

**What it's for:** when a document is ingested without an explicit
`processing_mode` (the web UI always sends one explicitly — `deep` or
`lite`, default `'deep'` in `Dashboard.jsx` — so this only actually runs
for third-party API callers hitting `/ingest` with no `processing_mode`,
per the Developer Keys API docs), this decides `lite` vs `medium` vs
`deep` before Docling ever runs.

**Confirmed bug (fixed):** the old code tried to filter "meaningful"
images via `page.get_image(img_idx)` — that method doesn't exist on
PyMuPDF's `Page` object at all (verified: `hasattr(page, 'get_image')` is
`False` on the installed 1.28.2). Every call threw `AttributeError`,
silently swallowed by a bare `except: pass`, so the meaningful-image count
was ALWAYS 0 regardless of how many images the document had — verified
against `fh190_final_report.pdf` (97 pages, 99 real embedded images):
the old logic counted 0, meaning `image_count > 3` could never fire and
every image-heavy document auto-detected as `medium` or `lite`, silently
losing all image extraction.

**Fixed by** (`pipeline/detector.py`, current version):
- Real per-image geometry via `page.get_image_bbox()` (confirmed to exist
  and return accurate placed rectangles) instead of the broken call —
  "is this image meaningful" is now an exact area-ratio comparison
  (`MIN_MEANINGFUL_AREA_RATIO = 0.03`, i.e. ≥3% of the page), not a
  guess.
- Added vector-graphics detection via `page.get_drawings()` (confirmed
  real, reads literal draw operators — 100% exact for *presence*).
  Diagrams exported as vector paths (PowerPoint/Visio/draw.io) were
  previously invisible to this detector entirely, since `get_images()`
  only sees embedded raster images. Nearby drawing primitives are
  clustered into connected regions (`_cluster_rects`) and scored by area,
  since one diagram is normally dozens of tiny individual paths.
  Any drawing overlapping an already-detected table's bbox is EXCLUDED
  before clustering — a table's own ruling lines are vector drawings too,
  and would otherwise get miscounted as "a diagram" on top of already
  being a table. Verified on the real document's actual table page: 81
  vector-drawing primitives (the table's grid lines) → 0 survive the
  table-overlap exclusion, confirming no false positives from tables.
- Replaced the flat document-wide "`image_count > 3`" threshold with a
  PER-PAGE significance check (`PAGE_SIGNIFICANT_AREA_RATIO = 0.15`, i.e.
  any single page whose meaningful visual area ≥15% of that page
  promotes the whole doc to `deep`), OR the old count-based trigger kept
  as a secondary path for many small-but-meaningful images spread across
  a document. This fixes the case of a document with just 1-2 large,
  important diagrams, which the old flat `>3` count would never promote.
- Verified end-to-end on the real document after the fix: now correctly
  reports 98 meaningful images (1 of the 99 filtered out as sub-3%-area,
  e.g. a small icon) and page-significant=True → returns `deep`, exactly
  as it should have all along.

**Accepted, NOT fixed (deliberate tradeoff — documented, not an oversight):**
Table detection still relies on PyMuPDF's own `find_tables()` heuristic
(ruled-line/whitespace detection), which is independent from — and can
occasionally disagree with — the trained layout model Docling itself uses
when it actually extracts the document. The only way to guarantee the
detector's table prediction always matches reality is to have the
detector ask the SAME authority (i.e. run a Docling layout pass here
too), but that would roughly double parsing cost for every document
just to decide which mode to use — defeating the point of a cheap
pre-check. Left as-is; flagging so a future session doesn't assume this
was overlooked.

**What "100% accuracy" means for each piece of this, precisely:**
| Question | Accuracy achieved |
|---|---|
| Does a raster image exist here, how big? | 100% — exact PDF geometry (`get_image_bbox`) |
| Does a vector drawing exist here, how big? | 100% for presence; clustered+scored for "is it one diagram" |
| Is this region a Table? | Heuristic (`find_tables()`), not guaranteed to match Docling's own later judgment — accepted tradeoff above |

### Stage: `parsers/deep.py`, `parsers/medium.py`, `parsers/lite.py` — audited & fixed 2026-09-13

Went scenario-by-scenario ("does this handle scanned docs, wrong file types, tables, etc.") rather than just reading the happy path, testing each claim against real and constructed files. Findings and fixes:

**1. An image's OCR/analysis text had no link back to its own picture — FIXED.**
`parse_deep_mode()` stored an image as TWO separate chunks: one holding `![Image](url)` (merged onto the preceding paragraph), and a second, separate chunk holding its OCR'd "Image Analysis" text — but only the first one carried `image_url`. Since the analysis chunk's content literally IS the image's own text, it's often the chunk a question about that image's CONTENT would actually match — and it had no way to return the picture. Verified on the real document: chunk 0 (`![Image](...)`) had `image_url` set, chunk 1 (its OCR text) had `image_url: None`. Fixed with a `pending_image_url` tracker so the paragraph immediately following an image also inherits its url.

**2. That fix then surfaced a second, PRE-EXISTING bug in the "match a caption to its image" cross-reference pass — FIXED.**
The existing logic assumed "the caption is usually the next chunk after the image." Once fix #1 made the OCR/analysis chunk also carry `image_url`, it started qualifying for that same cross-reference logic — and on a real page where 3 figures ("14, 15, 16") were captioned but Docling only found 2 actual pictures, "Figure 16" (an orphaned caption with no picture of its own) ended up borrowing Figure 15's image, because it happened to sit right after Figure 15's analysis chunk in the list. Verified before/after on the real document: `chunk 142 "Figure 16..."` went from incorrectly `image_url: 857c8384...` (Figure 15's picture) to correctly `image_url: None`. Fixed by only letting the ORIGINAL anchor chunk for an image (marked `is_primary_image_chunk`) contribute to caption-matching — not a chunk that merely inherited the same url via fix #1.

**3. Deep mode's `section` metadata was a hardcoded, useless string — FIXED.**
Every single chunk from `deep.py` had `"section": "Deep Extracted Structured Layout"` literally, regardless of what section it was actually in — unlike `medium.py`, which correctly used the real heading text. Since most image-bearing documents now correctly route to `deep` mode (after yesterday's detector fix), this meant most citations in the app showed this meaningless placeholder instead of a real section name. Fixed to use the real heading (same approach as `medium.py`), with a guard for the edge case where a section's very first line IS an image (e.g. a logo on a cover page) rather than real heading text — falls back to `"General"` instead of showing raw markdown syntax as the section name.

**4. Deep mode produces almost nothing for a scanned/no-text-layer document — FIXED.**
`do_ocr = False` is hardcoded in `deep.py` for speed — it only reads real text plus whatever RapidOCR reads off individual detected picture regions, not a full page that IS one big scanned image (Docling's layout model doesn't carve a distinct "Picture" region out of a page with no other content to contrast it against). Built and tested a synthetic scanned PDF (a real page rendered flat to an image): `deep` mode returned **1 chunk** (an empty Table-of-Contents placeholder) — effectively nothing. Fixed by measuring extracted text after the fast pass; if it's under ~100 chars/page, the document is re-converted ONCE with Docling's real OCR turned on. Verified: same scanned test file now produces 12 real, readable chunks. Verified separately that a normal, text-rich document (the real 97-page report) does NOT trigger the slower retry path — no false positives.
Also checked `medium.py` for the same problem and found it does NOT have this bug: it uses Docling's bare default pipeline, whose default `do_ocr` is actually `True` (only `deep.py` explicitly turns it off) — confirmed by running the same scanned test file through `parse_medium_mode()`, which correctly returned 11 real chunks with no changes needed.

**5. Selecting "Deep Vision" for a `.txt` upload crashed the whole ingestion job — FIXED (two layers).**
`deep.py` restricts Docling to `[PDF, IMAGE, DOCX]` internally; the upload UI never filtered mode options by file type, so a real user could pick Deep Vision for a `.txt` file and the job would fail outright (`ConversionError: File format not allowed`) — reproduced directly before fixing. Also found `medium.py`'s unrestricted Docling converter has no `InputFormat` for `.txt`/`.json` either — same failure mode if `processing_mode=medium` is forced via the public API. Fixed at both layers: `Dashboard.jsx::processFile()` silently substitutes `lite` for `deep` when the file is a text-only format (lossless — those formats have no images/tables for Deep Vision to find anyway); `pipeline/processor.py` has the same guard server-side as a safety net for direct API callers who bypass the frontend entirely, falling back to `lite` instead of failing the job.

**6. Markdown table syntax (`| cell | cell |`, `|---|---|`) was being embedded as-is — FIXED.**
The raw, un-cleaned markdown table text was what actually got embedded for retrieval — noisy, low-signal input for an embedding model, hurting search quality specifically for table content. Extracted the existing cleanup logic (previously private to `citations.py`, used only for the PDF-highlight/excerpt display path) into a shared `utils/text_clean.py::strip_markdown_artifacts()`, now also used in `pipeline/processor.py` to clean the text that gets EMBEDDED. Deliberately left the STORED `content` (used for LLM context at generation time) untouched — the LLM benefits from seeing real table structure when answering questions about one; only the embedding input needed cleaning.

**Investigated but not conclusively fixed: DOCX image extraction in deep mode.** `deep.py`'s Docling pipeline options (`generate_picture_images`, etc.) are PDF-specific — Docling's DOCX pipeline (`WordFormatOption`/`ConvertPipelineOptions`) has no equivalent field at all, so there's no simple "turn this on" fix. Tested against a real `.docx` file, but it happened to contain no embedded images, so the test was inconclusive either way (0 images extracted, but also 0 images present to extract). Needs a real docx-with-embedded-images test file before this can be confidently fixed or ruled out as already-working.

### Stage: `ml/embeddings.py` (`generate_embeddings_batch`) + `db/documents.py` (`insert_chunks`) — audited & fixed 2026-09-13

Verified against the REAL configured services (this project's actual `VOYAGE_API_KEY` and live Supabase `documents` table), not just by reading the code.

**Embedding (`ml/embeddings.py`) — confirmed correct, no fix needed.**
- Real call with the project's actual Voyage key: returns real `voyage-3` embeddings, 1024 dimensions, consistent between document-time (`input_type="document"`) and query-time (`input_type="query"`) calls.
- Simulated a Voyage outage (forced the client's `.embed()` to throw): correctly falls back to local `BAAI/bge-m3`, logs a warning, still returns valid 1024-dim embeddings.
- Simulated the dangerous case — Voyage succeeds for batch 1, then fails for batch 2+ of the SAME document (an outage mid-ingestion): confirmed `processor.py`'s cross-batch model-mismatch check correctly fires and stops the job, rather than silently storing a document half-embedded by two incompatible models (which would quietly and permanently break retrieval for it — the two models' outputs aren't comparable even though they happen to both be 1024-dim).

**Storage (`db/documents.py::insert_chunks`) — confirmed a real gap, FIXED.**
Description ("builds one record per chunk, batch-inserts 50 at a time") was accurate but incomplete: proved with a real Supabase insert (50 good rows, 1 deliberately malformed row, 20 more good rows) that a batch failure partway through left the first 50 rows PERMANENTLY committed while the rest were never attempted — a silent, partial, broken knowledge base that still shows up in the user's document list looking like a normal (just smaller) document, with the job correctly emailing "failed" but nothing cleaning up the leftover rows.

Fixed to be all-or-nothing: each `insert_chunks()` call now stamps every record with a fresh `_ingestion_run_id` (inside `metadata`, since adding a real column needs a migration this codebase can't run automatically) and, on any batch failure, deletes every row already committed for THIS specific run before re-raising. Deliberately scoped by `(knowledge_base_id, _ingestion_run_id)` together, not `knowledge_base_id` alone — `knowledge_base_id` is generated from a filename + a 4-digit slice of a millisecond timestamp (`Dashboard.jsx`), so a collision with an OLDER, already-successful, unrelated knowledge base under the same id isn't impossible; a naive "delete by kb_id" rollback would have wiped that out too.

Verified both scenarios directly against the live database:
- Same 50-good/1-bad/20-good failure as before → now correctly rolls back to **0** rows remaining (previously 50 remained).
- Same failure, but with a genuine pre-existing unrelated row already sitting under the same `knowledge_base_id` (simulating a real id collision) → that pre-existing row survives untouched; only the new failed run's rows get removed.

### Stage: Query pipeline (`api/router.py`, `api/stages/retrieval.py`/`routing.py`/`context.py`, `ml/generation.py`) — audited & fixed 2026-09-13

**CRITICAL — confirmed, exploitable cross-tenant data leak, FIXED.** Verified end-to-end with two real, unrelated test accounts (not just read from the code): account B could read account A's private document contents just by knowing/guessing account A's `knowledge_base_id` (predictable `filename_timestamp` pattern, not a secret). Reproduced live: inserted a fake "confidential salary" document owned by account A, then had account B successfully extract it via a `POST /query` asking "list all tables in this document."

Root cause: `retrieval.py::_fetch_all_chunks()` (used by the "list all figures/tables" scan, the "give me that image" scan, and the routed-heading fetch), `routing.py`'s table-of-contents fetch, and `context.py`'s adjacent-page fetch all read chunks by `knowledge_base_id` alone, with **no ownership filter at all** — unlike the main hybrid-search RPC path, which does correctly filter by `user_id` (confirmed: the SAME attack via a normal question, not an enumeration one, was already correctly denied by that path).

Fixed by threading `user_id` through all four call sites and filtering by it everywhere chunks are read (matching what the RPC path already did correctly). Also replaced the router-level authorization check, which queried a `knowledge_bases` table **confirmed not to exist in this deployment at all** (every error path silently fell through without ever denying access — a complete no-op), with a real check against `documents.user_id` itself — a second, defense-in-depth layer so a future new retrieval helper that forgets to filter by user still gets denied before the pipeline runs.

Re-verified the exact same attack after the fix: correctly denied (empty/no-context response, then a clean 403 from the new router-level gate), while the real owner's own access is unaffected — checked both with direct function calls and live HTTP requests. Also fixed a side effect surfaced by the router-level gate actually firing for the first time: `backend/gateway/src/routes/query.js` was collapsing EVERY non-200 response from the Python worker (403 included) into a generic 500 "Internal server error" — fixed to pass the real status/message through.

**Answer accuracy — spot-checked directly against the real source PDF (not just plausible-looking).** Multiple direct-question tests all came back correct: right facts, right page, right section, and — checked character-by-character — citation excerpt text matching the actual PDF wording verbatim (e.g. a "why is data literacy important" question correctly cited page 6, section "1.1 Background & Motivation", with the excerpt exactly matching that paragraph).

**Citations sometimes missing entirely — FIXED.** A fully correct answer (the project's deadline table) came back with **zero citations**, twice, reproducibly — not wrong citations, none at all. Confirmed by inspecting the raw model output directly: the model itself simply didn't emit any `[n]` marker anywhere, despite the system prompt requiring one per row, specifically when formatting its answer as a markdown table. Fixed with a cheap, targeted retry in `generate_answer()`: if a response has real context available, isn't a truncated/cut-off response, isn't a legitimate "I don't have enough information" answer, and contains no `[n]`/`【n】` marker at all, it's sent back to the SAME model once with an explicit "you forgot citations, revise and resubmit the full answer" nudge; if the retry still comes back uncited, the original (correct, just unverifiable) answer is kept rather than failing the request. Verified: the same deadlines question now comes back correctly citing `[1]` → page 60, "8.3 Implementation Timeline Evaluation".

**"List all X" queries could fail completely — FIXED.** A real "list all figures in this document" query (a 97-page report with dozens of figures) assembled 17,000+ tokens of context and every single one of the 7 fallback models rejected it (too large / rate-limited / daily-quota-exhausted) — the user got a flat "Sorry, there was an error generating the answer" for a completely reasonable question. Root cause: `context.py::expand_and_deduplicate()` unconditionally expanded EVERY matched chunk to its full parent section, even for enumeration queries — which only need each item's own short caption/label to list it, not several paragraphs of surrounding section text. Fixed by only doing that expansion when `dedupe=True` (i.e. NOT an enumeration query) — enumeration chunks now keep their original, much shorter matched text. Verified: the same "list all figures" query that previously failed outright now returns a real answer (17 figures listed, each properly cited, ~228s — still slow, but no longer crashing).

**Follow-up investigation (same day): why only 17 of 39 figures — root cause found and FIXED.**

Root cause, confirmed directly: `retrieval.py::_scan_structural_matches()` capped at `MAX_STRUCTURAL_MATCHES = 40` **chunks**, scanned in plain document order — but an early figure (1-24) is typically mentioned many times (its own caption, then again every time later text refers back to it), while a late figure is often mentioned once. Confirmed on the real document: 121 chunks mention a figure/table pattern at all, but the old document-order scan filled its 40-chunk cap with figures 1-24's repeat mentions and never reached figures 25-39 — they never reached the model at all, not because they weren't findable, but because nothing downstream ever saw them.

Fixed with a two-pass scan: pass 1 takes one representative chunk per NOT-YET-SEEN figure/table number (breadth first); pass 2 only fills any leftover budget with repeat mentions of numbers already covered. Verified directly: distinct figure numbers found went from 25 (missing 25-39 except a stray 33) to **all 39, zero missing**. Also raised `citation_cap` (24→45) and `context_cap` (30→40) in `router.py`, since the old 24-citation cap would have silently cut off any document with more figures than that even after retrieval found them all.

**That fix then re-triggered the "enumeration blows the token budget" crash from earlier the same day** — raising the caps let the prompt grow large again even with short (non-expanded) chunks. Root-caused precisely this time: Groq's free tier caps the PRIMARY model (`openai/gpt-oss-120b`) at a hard **8000 tokens/minute**, confirmed from the actual error message, not an estimate — a genuinely tight ceiling. Fixed with a real char-budget cap in `generate_answer()` (`MAX_TOTAL_CONTEXT_CHARS = 22000`, sized against the system prompt's own measured ~1450-token length, leaving real margin for the chars→tokens estimate being approximate): stops adding further (lowest-ranked) context blocks once the assembled prompt would exceed a safe size, always keeping at least the first block so the model never gets nothing to work with. Blocks left out simply never get a citation number, so nothing desyncs with `filter_and_renumber_citations()`'s numbering.

Final verified result on the real 39-figure document: **35 of 39 figures**, each with a real citation — up from a flat crash, then 17/39, to 35/39. The remaining 4 (confirmed from the logs) were cut off by this same budget cap under real rate-limit pressure from repeated testing that day ("Used 7245, Requested 3406" against the 8000 ceiling — the window was nearly consumed by cumulative test traffic, not this one request alone). Deliberately left as-is rather than raising the budget further: doing so trades "reliably gets 35/39" for "occasionally gets rate-limited back to 0/39" under real concurrent usage, which is a worse trade.

## Known trouble spots (as of 2026-09-12)
- **Citations unrelated to the answer — FIXED 2026-09-12.** `router.py` built the "References" list from EVERY context block handed to the LLM, regardless of whether the model's answer actually cited it inline. A question like "what are the deadlines" could come back with the correct answer citing only `[1]`, while the References panel still listed 5 more unrelated candidates (an OCR fragment, an unrelated table row, a chapter heading) that were never actually used. Fixed via `citations.py::filter_and_renumber_citations()`: scans the model's own inline `[n]`/`【n】` markers, keeps only the referenced blocks, renumbers them 1..m, and rewrites the markers in the answer text to match — wired into `router.py` right after `generate_answer()`, before `build_citations()`.
- **PDF highlighting never actually worked — FIXED 2026-09-12 (two bugs).**
  1. The old approach used react-pdf's `customTextRenderer`, which depends on an internal, undocumented per-item→DOM-index alignment inside react-pdf's `TextLayer` (`node_modules/react-pdf/dist/Page/TextLayer.js`) that isn't guaranteed to stay correct across pdf.js versions, and mutating those spans risked breaking native text selection/copy. Replaced with the CSS Custom Highlight API (`CSS.highlights.set('pdf-cite', new Highlight(range))` + `::highlight(pdf-cite){...}` in `index.css`): after pdf.js renders the real text layer (`onRenderTextLayerSuccess`), `PDFReferenceViewer.jsx::findHighlightRange()` walks the actual DOM text nodes to build a `Range` spanning the citation's matched text, registered without touching DOM structure at all.
  2. Even after that, matching still failed for any excerpt that happened to straddle a line wrap: pdf.js's text layer gives each rendered LINE its own text node with NO trailing space character — e.g. `"...education is"` then immediately `"important for..."` with nothing between them in the raw DOM text, even though it renders as "is important" with a visible gap. The match regex joined excerpt words with `\s+` (requires ≥1 whitespace), so it silently failed at exactly these boundaries. Fixed by joining with `\s*` (zero-or-more) instead — see the comment in `findHighlightRange`.
  3. Separately, markdown TABLE citations (Docling exports tables as pipe-delimited rows + a `|---|---|` separator row) could never match at all regardless of the above — that punctuation is synthetic and never existed in the PDF's real text. `citations.py::_strip_markdown_artifacts` now strips separator rows and pipe characters before an excerpt is built.
  Verified live end-to-end: a citation excerpt deliberately chosen to straddle a real line-wrap now highlights correctly across both lines, and double-click-select/copy on the PDF still works normally.
- **Citation page-number accuracy — FIXED 2026-09-12.** `deep.py`/`medium.py` resolved each paragraph's page number via a fragile 80-char substring match against a `dict` keyed by truncated Docling provenance text. Two bugs: (1) duplicate truncated keys (repeated headers/footers/boilerplate) silently overwrote each other in the dict, discarding earlier pages; (2) the match returned whichever dict entry came first, not the right one, so short/common text resolved to an arbitrary wrong page. Wrong page number meant the PDF viewer's exact-text highlight search ran against the wrong page's text and never found anything — hence "just showing the page number," no highlight. Fixed by extracting a shared `PageResolver` (`parsers/page_resolver.py`) used by both parsers: stores provenance as an ORDERED LIST (not a dict, no overwrite) and resolves with a monotonic forward-only cursor that walks in the same reading order chunks are produced in, so repeated text is disambiguated by proximity instead of picking an arbitrary occurrence. **Only affects newly-ingested documents** — existing rows in Supabase already have the old (possibly wrong) page numbers baked into their metadata; re-upload a document to get corrected citations for it.
- `processor.py`: `source_file_name` for remote-URL-downloaded temp files can produce a broken `source_url` (edge case, direct uploads unaffected).
- `deep.py` DOCX handling doesn't enable `generate_picture_images` for DOCX specifically (PDF only) — image extraction for .docx in deep mode may not work.

## API Keys section (frontend/src/pages/DeveloperKeys.jsx) — rebuilt 2026-09-12
Was a minimal CRUD list that permanently returned the full plaintext secret on every GET (a real credential-exposure issue) with no confirmation, validation, or error handling. Rebuilt to match standard SaaS API-key UX:
- **Backend (`backend/gateway/src/routes/apiKeys.js`)**: GET now always returns a MASKED key (`sk_xxxx••••••••••••xxxx`) — the full value is only ever in the POST response, once, at creation. Added name validation (required, trimmed, ≤60 chars), ordering by `created_at` (with a graceful fallback if that column doesn't exist on a given deployment), and a proper 404 on revoking a key that isn't there.
- **Frontend**: one-time "reveal" modal shown right after creation with a copy button and an explicit "you won't see this again" warning; the persisted list only ever shows the masked value; revoking goes through the existing `ConfirmModal` (names the key, warns it's irreversible) instead of an instant delete; explicit loading state on first fetch; inline validation errors on the name field (empty / too long / duplicate-name-in-this-list); dismissible error banners on fetch/create/revoke failure instead of silent `console.error`.
- Verified live end-to-end (real gateway + a throwaway test account): create → one-time reveal → masked in list → revoke confirmation → removed from list. Also verified via curl: masking, empty-name 400, revoke-of-missing-id 404.
- **Note**: client-side duplicate-name check only warns in the UI; the server does not enforce name uniqueness (two keys with the same name are still allowed via direct API use — intentional, not a security property, just a UX nudge).

## Account/settings features implemented 2026-09-12
Previously: Settings was almost entirely cosmetic (fake "Member Since" date, inert theme/notification toggles, "Delete Account" that only logged out without deleting anything), no password reset/change, no email verification, chat history lived only in localStorage, landing page showed to logged-in users. All rebuilt:

- **`backend/migrations/002_account_features.sql`** — one-time additive migration (run manually in the Supabase SQL editor; this codebase has no DDL-capable connection, only the REST/`supabase-js` client, so it can't be applied automatically). Adds `users.name`, `users.email_verified`, `users.notifications_enabled`, `users.theme`, and `chat_threads`/`chat_messages` tables. Every feature that depends on these degrades gracefully (clear 501 + explicit message, not a crash) until it's run — verified both ways.
- **Real account deletion** (`DELETE /account`, `backend/gateway/src/routes/account.js`) — requires current password, cascades across `api_keys`, `documents` (+ best-effort disk cleanup of uploaded files/images), `knowledge_bases`, `chat_threads`, then the `users` row itself.
- **Real password change** (`PATCH /account/password`) — requires current password.
- **Password reset** (`POST /auth/forgot-password` + `/auth/reset-password`, frontend `ResetPasswordPage.jsx`) — stateless signed-JWT reset tokens (no new table needed), generic response regardless of whether the email exists (no user enumeration).
- **Email verification** (`POST /auth/verify-email`, `/auth/send-verification`, frontend `VerifyEmailPage.jsx`) — same stateless-token approach; gated on the `email_verified` migration column.
- **Profile editing** (`PATCH /account/profile`) — display name, theme, notification preference.
- **Real theme toggle** — the whole app is CSS-variable-driven (`index.css` `:root`), so a `[data-theme="light"]` override block re-themes everything; applied pre-mount in `main.jsx` (no flash), persisted to `localStorage` immediately and best-effort synced to the account.
- **Real (if minimal) notification system** — `backend/gateway/src/services/ingestionNotifier.js` listens to the BullMQ `ingestion` queue's `completed`/`failed` events and emails the document owner, honoring `notifications_enabled`. This is the ONE event the app currently has worth notifying about; the toggle was previously wired to nothing at all.
- **Mailer** (`backend/gateway/src/utils/mailer.js`) — nodemailer with `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` env vars; with no SMTP configured (the default), it logs the email (including the actual reset/verification link) to the gateway console instead of silently failing — every flow above works in dev with zero mail setup.
- **Server-side chat history** (`backend/gateway/src/routes/chat.js`, `frontend/src/lib/chatApi.js`) — threads/messages now persist to `chat_threads`/`chat_messages`. localStorage remains the fast local cache and offline fallback; on first opening a chat for a kb in a browser with no local session yet, it hydrates from the server. New threads are created server-side first (real id) then locally; messages sync in the background (best-effort, never blocks the UI).
- **Landing/login/register redirect** (`App.jsx`'s new `GuestRoute`) — an authenticated user hitting `/`, `/login`, or `/register` is redirected straight to `/dashboard`.
- **Billing/upgrade — intentionally NOT implemented.** Settings shows a plans/pricing UI, but there's no payment processing wired up: that needs a real payment provider's credentials (e.g. Stripe secret/publishable keys, price IDs, webhook secret), which this session doesn't have and financial-transaction integration isn't something to build blind. Ask if you want it scaffolded once you have Stripe (or another provider) set up.
- **Cleanup**: deleted unused dead file `frontend/src/store/slices/documentSlice.js` (near-duplicate of `documentsSlice.js`, never imported) and a stray `frontend/package-lock copy.json`.

All of the above was verified end-to-end live (browser + curl): register → forgot-password → reset-password → login with new password; change-password wrong/right; delete-account wrong-password-rejected then real cascade-delete confirmed via failed subsequent login; theme toggle actually re-paints the app and persists across reload; notifications toggle reverts + shows a clear message pre-migration; landing-page redirect for authenticated users.

## Conventions / gotchas worth remembering
- Groq model IDs go through LiteLLM with a `groq/` prefix; Gemini via `gemini/` prefix.
- `metadata.parent_context` presence marks a "structured" chunk (medium/deep parse); its absence + `page_number` presence marks a lite-mode chunk.
- Any chunk carrying `metadata.image_url` is an image/figure chunk.
- `is_pinned` on a retrieval row means "keep this even if reranking would drop it" — set by the structural scan and image-presence boost, NOT a permanent guarantee of inclusion (reranking can still legitimately promote it via score, and router.py only force-appends pinned rows that didn't already make the natural cut).
- Never call Gemini vision at ingestion time — that was the old, expensive, rate-limited approach; OCR replaced it. Gemini vision is for one-off query-time questions about a specific already-identified image only.
