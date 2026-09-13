import { useCallback, useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Loader2,
  AlertTriangle,
} from 'lucide-react';

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// react-pdf bundles its own pdfjs-dist version; the worker file in /public
// MUST match it exactly (pdf.js hard-errors on a version mismatch between
// the main bundle and its worker).
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

// pdf.js's default loading path streams the PDF via fetch()+ReadableStream
// and issues HTTP range requests. Safari's implementation of that combo has
// long-standing bugs (surfaces as "TypeError: undefined is not a function
// (near '...value of readableStream...')" straight out of pdf.js's network
// layer). Disabling streaming/range/auto-fetch makes pdf.js fall back to a
// single plain request for the whole file — slightly less efficient for
// huge PDFs, but it sidesteps the broken code path entirely and works the
// same across Chrome/Firefox/Safari. Must be a stable object reference (not
// recreated every render) — react-pdf reloads the document if `options`
// changes identity.
const PDF_LOAD_OPTIONS = {
  disableStream: true,
  disableRange: true,
  disableAutoFetch: true,
};

// `scale` here is a multiplier on top of "fit the panel's actual width"
// (computed at render time via a measured container width), not a fixed
// PDF-point zoom level. A hardcoded scale like the old default of 1.15
// renders a standard page at ~1.15 x 612pt ≈ 704px wide regardless of how
// wide the panel actually is — on a ~500px panel that's badly oversized
// ("too zoomed in") and, since the page's height follows its aspect ratio
// at that (wrong) width, throws off the vertical proportions too. 1.0 here
// means "exactly fits the panel," matching how every normal PDF viewer
// defaults its zoom.
const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;
const SCALE_STEP = 0.15;

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

// True when the browser supports the CSS Custom Highlight API
// (CSS.highlights + the `Highlight` constructor). Both Chromium and Safari
// have shipped it for a while now; Firefox is the last holdout — feature-
// detected so it degrades to "no highlight, PDF still works" there instead
// of throwing.
const SUPPORTS_CSS_HIGHLIGHTS =
  typeof window !== 'undefined' && 'highlights' in CSS && typeof Highlight === 'function';

const HIGHLIGHT_NAME = 'pdf-cite';

// Locates the citation's exact text within the page's REAL rendered DOM
// (the text layer pdf.js just built), and returns a Range spanning it —
// rather than trying to reconstruct positions from raw text items and
// inject markup into pdf.js's internally-managed spans (fragile: the
// library only exposes an opaque per-item DOM-index mapping that isn't
// guaranteed to stay aligned, and mutating those spans risks breaking
// native text selection/copy). Walking the actual text nodes and handing a
// Range to the CSS Custom Highlight API means highlighting never touches
// the DOM structure at all — selection and copy-paste keep working exactly
// as they do on any other PDF viewer.
//
// Falls back to shorter prefixes of the target text because the citation's
// source text came from a DIFFERENT text-extraction pass (PyMuPDF/Docling
// at ingest time) than pdf.js's own text layer here, so a long exact match
// can occasionally miss on whitespace/ligature differences even though the
// words are identical.
function findHighlightRange(root, targetText) {
  const target = normalizeWhitespace(targetText || '').toLowerCase();
  if (!target) return null;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let concat = '';
  const spans = []; // { start, end, node }
  let node;
  // eslint-disable-next-line no-cond-assign
  while ((node = walker.nextNode())) {
    const text = node.nodeValue;
    if (!text) continue;
    const start = concat.length;
    concat += text;
    spans.push({ start, end: concat.length, node });
  }
  const nodeOffsetAt = (charIndex) => {
    for (const s of spans) {
      if (charIndex >= s.start && charIndex <= s.end) {
        return { node: s.node, offset: charIndex - s.start };
      }
    }
    return null;
  };

  const tryFind = (candidate) => {
    if (candidate.length < 20) return null;
    // Join words with \s* (zero OR MORE), not \s+ — pdf.js's text layer
    // gives each rendered LINE its own text node with no trailing space, so
    // at every line-wrap boundary the raw DOM text runs two words together
    // with NO whitespace at all (e.g. "...education is" immediately
    // followed by "important for..." with nothing between them, even
    // though they render as "is important" one space apart on the page).
    // Requiring \s+ meant any citation excerpt that happened to straddle a
    // line wrap could never match at all, regardless of markdown vs. PDF
    // text differences.
    const pattern = candidate
      .split(/\s+/)
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\s*');
    if (!pattern) return null;
    const match = new RegExp(pattern, 'i').exec(concat);
    if (!match) return null;
    const start = nodeOffsetAt(match.index);
    const end = nodeOffsetAt(match.index + match[0].length);
    if (!start || !end) return null;
    const range = new Range();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range;
  };

  for (const len of [target.length, 200, 120, 60]) {
    const candidate = target.slice(0, len);
    const range = tryFind(candidate);
    if (range) return range;
  }
  return null;
}

export default function PDFReferenceViewer({
  url,
  pageNumber = 1,
  excerpt = '',
  citations = null,
  activeCitation = null,
  onSelectCitation = null,
  formatDocName = null,
}) {
  const [numPages, setNumPages] = useState(null);
  const [currentPage, setCurrentPage] = useState(Math.max(1, Number(pageNumber) || 1));
  const [scale, setScale] = useState(1);
  const [loadError, setLoadError] = useState(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const scrollAreaRef = useRef(null);

  // Measure the actual available width so the page can be sized to fit it
  // (see the MIN_SCALE/MAX_SCALE comment above) instead of rendering at a
  // fixed pixel scale that ignores how wide the panel actually is.
  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setContainerWidth(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Jump to the requested page whenever a new citation is selected — this is
  // just component state now, no imperative plugin API needed.
  useEffect(() => {
    setCurrentPage(Math.max(1, Number(pageNumber) || 1));
    if (SUPPORTS_CSS_HIGHLIGHTS) CSS.highlights.delete(HIGHLIGHT_NAME);
  }, [pageNumber, url, excerpt]);

  useEffect(() => {
    setLoadError(null);
    setNumPages(null);
  }, [url]);

  // Clear the highlight on unmount so it doesn't linger globally — the CSS
  // Custom Highlight API registry is page-wide, not scoped to this component.
  useEffect(() => {
    return () => {
      if (SUPPORTS_CSS_HIGHLIGHTS) CSS.highlights.delete(HIGHLIGHT_NAME);
    };
  }, []);

  // Runs after pdf.js finishes building the REAL text layer DOM for the
  // currently rendered page. Only highlight when the rendered page is the
  // one the citation actually points at — otherwise a stale highlight from
  // a previous citation could momentarily apply to whatever page the user
  // has since navigated to.
  const handleTextLayerRendered = useCallback(() => {
    if (!SUPPORTS_CSS_HIGHLIGHTS) return;
    CSS.highlights.delete(HIGHLIGHT_NAME);
    const targetPage = Math.max(1, Number(pageNumber) || 1);
    if (currentPage !== targetPage || !excerpt) return;
    const root = scrollAreaRef.current?.querySelector('.react-pdf__Page__textContent');
    if (!root) return;
    const range = findHighlightRange(root, excerpt);
    if (range) {
      CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(range));
    }
  }, [pageNumber, currentPage, excerpt]);

  if (!url) {
    return (
      <div
        style={{
          display: 'grid',
          placeItems: 'center',
          height: '100%',
          minHeight: 300,
          color: 'var(--text-muted)',
        }}
      >
        No PDF available.
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'var(--surface)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div className="pdf-toolbar">
        <button
          type="button"
          className="pdf-toolbar-btn"
          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
          disabled={currentPage <= 1}
          title="Previous page"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="pdf-toolbar-page">
          <input
            type="number"
            min={1}
            max={numPages || 1}
            value={currentPage}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v >= 1 && v <= (numPages || 1)) setCurrentPage(v);
            }}
          />
          <span>/ {numPages ?? '—'}</span>
        </span>
        <button
          type="button"
          className="pdf-toolbar-btn"
          onClick={() => setCurrentPage((p) => Math.min(numPages || p, p + 1))}
          disabled={!numPages || currentPage >= numPages}
          title="Next page"
        >
          <ChevronRight size={16} />
        </button>

        <div style={{ flex: 1 }} />

        <button
          type="button"
          className="pdf-toolbar-btn"
          onClick={() => setScale((s) => Math.max(MIN_SCALE, +(s - SCALE_STEP).toFixed(2)))}
          title="Zoom out"
        >
          <ZoomOut size={15} />
        </button>
        <span className="pdf-toolbar-zoom">{Math.round(scale * 100)}%</span>
        <button
          type="button"
          className="pdf-toolbar-btn"
          onClick={() => setScale((s) => Math.min(MAX_SCALE, +(s + SCALE_STEP).toFixed(2)))}
          title="Zoom in"
        >
          <ZoomIn size={15} />
        </button>
      </div>

      <div className="pdf-scroll-area" ref={scrollAreaRef}>
        {loadError ? (
          <div className="pdf-status pdf-status-error">
            <AlertTriangle size={18} />
            Couldn't load this PDF.
          </div>
        ) : (
          <div className="pdf-scroll-inner">
            <Document
              file={url}
              options={PDF_LOAD_OPTIONS}
              suspense={false}
              onLoadSuccess={(doc) => setNumPages(doc.numPages)}
              onLoadError={(err) => setLoadError(err?.message || 'Failed to load PDF')}
              loading={
                <div className="pdf-status">
                  <Loader2 className="lucide-spin" size={22} /> Loading PDF…
                </div>
              }
              error={
                <div className="pdf-status pdf-status-error">
                  <AlertTriangle size={18} /> Couldn't load this PDF.
                </div>
              }
            >
              <Page
                key={currentPage}
                pageNumber={currentPage}
                width={containerWidth ? containerWidth * scale : undefined}
                onRenderTextLayerSuccess={handleTextLayerRendered}
                renderAnnotationLayer
                renderTextLayer
                loading={
                  <div className="pdf-status">
                    <Loader2 className="lucide-spin" size={20} />
                  </div>
                }
              />
            </Document>

            {/* Fills the space below a page that doesn't reach the panel's
                full height with the message's other sources, instead of
                leaving it blank — also lets you jump between citations from
                the same answer without going back to the chat. */}
            {citations && citations.length > 0 && (
              <div className="pdf-references">
                <div className="pdf-references-title">References</div>
                {citations.map((c, idx) => {
                  const label = formatDocName ? formatDocName(c.document) : c.document || 'Document';
                  const isActive = activeCitation === c;
                  return (
                    <button
                      key={idx}
                      type="button"
                      className={`pdf-reference-item ${isActive ? 'active' : ''}`}
                      onClick={() => onSelectCitation?.(c)}
                    >
                      <span className="pdf-reference-num">{idx + 1}</span>
                      <span className="pdf-reference-body">
                        <span className="pdf-reference-doc">
                          {label}
                          {c.page ? ` · p.${c.page}` : ''}
                        </span>
                        {c.excerpt && (
                          <span className="pdf-reference-excerpt">{c.excerpt}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
