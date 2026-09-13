import React, { useState, useRef, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useSelector, useDispatch } from "react-redux";
import {
  Send,
  FileText,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Trash2,
  ArrowLeft,
  Plus,
  LayoutDashboard,
  LogOut,
  Copy,
  Check,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  addMessage,
  setTyping,
  createChatThread,
  switchChatThread,
  deleteChatThread,
  hydrateKbThreads,
} from "../store/slices/chatSlice";
import { fetchDocuments, deleteDocument } from "../store/slices/documentsSlice";
import { logout } from "../store/slices/authSlice";
import ConfirmModal from "../components/ConfirmModal";
import PDFReferenceViewer from "../components/PDFReferenceViewer";
import * as chatApi from "../lib/chatApi";

const STARTERS = [
  "Summarize this document",
  "What are the key requirements?",
  "List all tables and figures",
  "Find any dates or deadlines",
];

// Turns bare "[1]", "[2]" ... citation markers into real markdown links
// (`[1](#cite-1)`) so react-markdown parses them as its own `a` nodes — that
// lets a custom `a` renderer turn them into clickable inline chips. A `#...`
// fragment href (rather than a custom "cite:" scheme) matters here:
// react-markdown sanitizes link URLs and silently drops unrecognized
// schemes, which would strip our href before the custom renderer ever sees
// it — same-page fragments are always allowed through. Skips fenced code
// blocks and inline code spans entirely so a literal "arr[1]" in a code
// sample is never touched.
//
// Also matches "【1】" (fullwidth brackets): the system prompt tells the
// model to use plain ASCII "[1]", but some models default to CJK-style
// citation brackets regardless of instructions — matching both here means a
// citation still renders as a clickable chip even when a model doesn't
// comply with the requested format.
//
// Adjacent citations like "[1][3]" are matched and rewritten as ONE run
// with a real space between them ("[1](#cite-1) [3](#cite-3)"). Without
// this, back-to-back inline-cite <button>s have only a CSS margin between
// them — no actual space CHARACTER — so selecting/copying the text (or an
// accessibility reader) concatenates them into "13", indistinguishable from
// a single citation number 13.
function injectCitationLinks(markdown) {
  const segments = markdown.split(/(```[\s\S]*?```)/g);
  return segments
    .map((segment, i) => {
      if (i % 2 === 1) return segment; // fenced code block, left untouched
      return segment.replace(
        /(`[^`]*`)|((?:\[\d+\]|【\d+】)+)/g,
        (whole, codeSpan, citeRun) => {
          if (codeSpan) return codeSpan;
          const nums = [...citeRun.matchAll(/\[(\d+)\]|【(\d+)】/g)].map(
            (m) => m[1] ?? m[2]
          );
          return nums.map((n) => `[${n}](#cite-${n})`).join(" ");
        }
      );
    })
    .join("");
}

function TypingIndicator() {
  return (
    <div className="msg-row">
      <div className="msg-avatar ai">AI</div>
      <div className="msg-bubble ai" style={{ padding: "0.75rem 1rem" }}>
        <div className="typing-indicator">
          <span className="typing-dot" />
          <span className="typing-dot" />
          <span className="typing-dot" />
        </div>
      </div>
    </div>
  );
}

export default function DocumentChat() {
  const { kbId } = useParams();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const token = useSelector((s) => s.auth.token);
  const user = useSelector((s) => s.auth.user);
  const rawSession = useSelector((s) => s.chat.sessions[kbId]);
  const docSession = rawSession || { threads: [], activeThreadId: null };
  const activeThread =
    docSession.threads.find((thread) => thread.id === docSession.activeThreadId) ||
    docSession.threads[0] ||
    null;
  const history = activeThread?.messages || [];
  const isTyping = useSelector((s) => s.chat.isTyping);
  const { items: documents } = useSelector((s) => s.documents);
  const currentDoc = documents.find((d) => d.id === kbId);

  const [input, setInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [docToDelete, setDocToDelete] = useState(null);
  const [selectedCitation, setSelectedCitation] = useState(null);
  const [citationList, setCitationList] = useState(null);
  const [copiedIndex, setCopiedIndex] = useState(null);

  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const displayName = user?.email?.split("@")[0] || "User";
  const initials = displayName.slice(0, 2).toUpperCase();

  useEffect(() => {
    if (documents.length === 0) dispatch(fetchDocuments());
  }, [dispatch]);

  // Chat history used to live ONLY in localStorage — cleared browser data
  // or a different device meant it was just gone. Now it's also persisted
  // server-side (see backend/gateway/src/routes/chat.js); the first time
  // this kb is opened in a browser with no local session for it yet, pull
  // whatever the server has. Never runs once a local session exists, so it
  // can't clobber anything already here.
  useEffect(() => {
    if (!token || !kbId || rawSession) return;
    let cancelled = false;
    (async () => {
      const threads = await chatApi.fetchThreads(kbId, token);
      if (!cancelled && threads && threads.length > 0) {
        dispatch(hydrateKbThreads({ kbId, threads }));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kbId, token]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, isTyping]);

  // Default the right panel to the document itself so a PDF is always
  // visible as soon as a chat is opened, not only after clicking a citation.
  // Re-runs when switching documents (kbId change) so the panel follows.
  useEffect(() => {
    if (!currentDoc) return;
    setSelectedCitation({
      document: currentDoc.filename,
      page: 1,
      section: "",
      image_url: null,
      confidence_score: null,
      excerpt: "",
      source_url: currentDoc.source_url,
      source_file: currentDoc.source_file,
      isDefaultView: true,
    });
    setCitationList(null);
    setRightPanelOpen(true);
  }, [currentDoc?.id]);

  const handleCopyMessage = (content, idx) => {
    navigator.clipboard?.writeText(content || "");
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex((prev) => (prev === idx ? null : prev)), 1500);
  };

  const confirmDelete = async () => {
    if (docToDelete) {
      await dispatch(deleteDocument(docToDelete));
      setDocToDelete(null);
      if (docToDelete === kbId) navigate("/dashboard");
    }
  };

  const handleNewChat = async () => {
    // Create it server-side FIRST so the thread's id is real from the
    // start — messages sent into it can then sync immediately instead of
    // this thread being permanently local-only. Falls back to a plain
    // local id (chatSlice generates one) if the server call fails/isn't
    // available, same as everywhere else this app talks to the sync API.
    const serverThread = token ? await chatApi.createThread(kbId, token, "New chat") : null;
    dispatch(createChatThread({ kbId, title: "New chat", id: serverThread?.id || null }));
  };

  const handleSwitchThread = (threadId) => {
    dispatch(switchChatThread({ kbId, threadId }));
  };

  const handleDeleteThread = (threadId) => {
    dispatch(deleteChatThread({ kbId, threadId }));
    if (token) chatApi.deleteThread(kbId, token, threadId);
  };

  const formatDocName = (name) => {
    if (!name || name === "Unknown") return currentDoc?.filename || "Document";
    const isHex = /^[a-f0-9]{25,}$/i.test(name.replace(/-/g, ""));
    return isHex ? currentDoc?.filename || "Document" : name;
  };

  const handleSelectCitation = (c, allCitations = null) => {
    setSelectedCitation(c);
    if (allCitations) setCitationList(allCitations);
    setRightPanelOpen(true);
  };

  const send = async (text) => {
    const msg = text || input;
    if (!msg.trim()) return;
    const threadId = activeThread?.id;

    dispatch(
      addMessage({
        kbId,
        threadId,
        message: { role: "user", content: msg },
      })
    );
    if (token && threadId) chatApi.addMessage(kbId, token, threadId, { role: "user", content: msg });
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    dispatch(setTyping(true));

    try {
      const apiHistory = (activeThread?.messages || []).slice(-10).map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const res = await fetch("http://localhost:3000/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          knowledge_base_id: kbId,
          query: msg,
          history: apiHistory,
        }),
      });
      const data = await res.json();
      const assistantMessage = res.ok
        ? { role: "assistant", content: data.answer, citations: data.citations }
        : { role: "assistant", content: `Error: ${data.error}` };
      dispatch(addMessage({ kbId, threadId, message: assistantMessage }));
      if (token && threadId) chatApi.addMessage(kbId, token, threadId, assistantMessage);
    } catch (err) {
      const assistantMessage = { role: "assistant", content: `Error: ${err.message}` };
      dispatch(addMessage({ kbId, threadId, message: assistantMessage }));
      if (token && threadId) chatApi.addMessage(kbId, token, threadId, assistantMessage);
    } finally {
      dispatch(setTyping(false));
    }
  };

  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const docTitle = currentDoc?.filename || kbId;
  const selectedSourceIsPdf = selectedCitation?.source_url
    ?.toLowerCase()
    .endsWith(".pdf");
  const selectedSourceIsImage = selectedCitation?.source_url
    ? /\.(png|jpe?g|gif|webp|svg)$/i.test(selectedCitation.source_url)
    : false;

  function getURL(citation) {
    if (citation?.source_url) {
      return citation.source_url;
    }
  }

  return (
    <div
      className="chat-layout page-enter"
      style={{ display: "flex", height: "100vh", overflow: "hidden" }}
    >
      {/* Sidebar */}
      <div className={`chat-sidebar ${!sidebarOpen ? "hidden" : ""}`}>
        <div className="chat-sidebar-header">
          <div
            style={{
              fontFamily: "'Plus Jakarta Sans', sans-serif",
              fontSize: "1.1rem",
              fontWeight: 800,
              letterSpacing: "-0.04em",
            }}
          >
            Recall<span style={{ color: "var(--primary-light)" }}>.</span>
          </div>
          <button
            className="btn-ghost"
            onClick={() => setSidebarOpen(false)}
            title="Collapse sidebar"
          >
            <PanelLeftClose size={16} />
          </button>
        </div>

        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            marginBottom: "1.25rem",
            padding: "0 0.25rem",
          }}
        >
          <Link
            to="/dashboard"
            className="btn-ghost"
            title="Dashboard"
            style={{
              background: "var(--surface-2)",
              borderRadius: "var(--radius-sm)",
              padding: "0.5rem 0.65rem",
            }}
          >
            <LayoutDashboard size={15} />
          </Link>
          <button
            className="btn btn-primary btn-sm"
            style={{ flex: 1, gap: "0.4rem" }}
            onClick={handleNewChat}
            id="btn-new-chat"
          >
            <Plus size={14} /> New chat
          </button>
        </div>

        <div className="sidebar-section-label">Chats</div>
        <div className="chat-thread-list">
          {(docSession.threads || []).map((thread) => (
            <div
              key={thread.id}
              className={`chat-thread-item ${
                thread.id === activeThread?.id ? "active" : ""
              }`}
            >
              <button
                type="button"
                className="chat-thread-link"
                onClick={() => handleSwitchThread(thread.id)}
              >
                <MessageSquare size={12} />
                <span className="truncate">{thread.title || "New chat"}</span>
              </button>
              {docSession.threads.length > 1 && (
                <button
                  type="button"
                  className="chat-thread-delete"
                  onClick={() => handleDeleteThread(thread.id)}
                  aria-label="Delete chat"
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="sidebar-section-label">Knowledge Bases</div>

        <div className="chat-doc-list">
          {documents.map((doc) => (
            <div key={doc.id} className="chat-doc-item">
              <Link
                to={`/chat/${doc.id}`}
                className={`chat-doc-link ${doc.id === kbId ? "active" : ""}`}
                title={doc.filename}
              >
                <MessageSquare size={13} style={{ flexShrink: 0 }} />
                <span className="truncate">{doc.filename}</span>
              </Link>
              <button
                className="btn-ghost"
                style={{
                  padding: "0.35rem",
                  color: "var(--danger)",
                  opacity: 0.6,
                  flexShrink: 0,
                }}
                onMouseOver={(e) => (e.currentTarget.style.opacity = "1")}
                onMouseOut={(e) => (e.currentTarget.style.opacity = "0.6")}
                onClick={() => setDocToDelete(doc.id)}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: "auto",
            borderTop: "1px solid var(--border)",
            paddingTop: "1rem",
          }}
        >
          <div className="sidebar-user">
            <div className="sidebar-avatar">{initials}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="sidebar-user-name truncate">{displayName}</div>
              <div className="sidebar-user-plan">Pro Plan</div>
            </div>
            <button
              className="btn-ghost"
              onClick={() => dispatch(logout())}
              title="Sign out"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div
        className="chat-main"
        style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}
      >
        {/* Top bar */}
        <div className="chat-topbar">
          {!sidebarOpen && (
            <button
              className="btn-ghost"
              onClick={() => setSidebarOpen(true)}
              title="Open sidebar"
            >
              <PanelLeftOpen size={16} />
            </button>
          )}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.65rem",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: "var(--radius-sm)",
                background: "rgba(79,70,229,0.12)",
                border: "1px solid rgba(79,70,229,0.2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <FileText size={14} color="var(--primary-light)" />
            </div>
            <div className="truncate">
              <div
                className="chat-topbar-title truncate"
                style={{ maxWidth: 320 }}
              >
                {docTitle}
              </div>
              <div className="chat-topbar-sub">{history.length} messages</div>
            </div>
          </div>
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              gap: "0.5rem",
              alignItems: "center",
            }}
          >
            <Link
              to="/dashboard"
              className="btn-ghost btn-sm"
              style={{ gap: "0.4rem", fontSize: "0.82rem" }}
            >
              <ArrowLeft size={14} /> Dashboard
            </Link>

            {selectedCitation && (
              <button
                className="btn-ghost btn-sm"
                onClick={() => setRightPanelOpen(!rightPanelOpen)}
                title={
                  rightPanelOpen ? "Hide citation panel" : "Show citation panel"
                }
                style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}
              >
                {rightPanelOpen ? (
                  <PanelRightClose size={16} />
                ) : (
                  <PanelRightOpen size={16} />
                )}
                <span>Source</span>
              </button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className="chat-messages">
          <div className="chat-messages-inner">
            {history.length === 0 ? (
              <div className="chat-empty">
                <div className="chat-empty-icon">
                  <FileText size={28} />
                </div>
                <h2>Ask anything about this document</h2>
                <p>
                  I'll search through <strong>{docTitle}</strong> and give you
                  precise, cited answers including tables, images, and exact
                  page references.
                </p>
                <div className="chat-starters">
                  {STARTERS.map((s) => (
                    <button
                      key={s}
                      className="chat-starter-pill"
                      onClick={() => send(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              history.map((msg, i) => (
                <div key={i} className={`msg-row ${msg.role}`}>
                  <div className={`msg-avatar ${msg.role}`}>
                    {msg.role === "assistant" ? "AI" : initials}
                  </div>
                  <div className="msg-content">
                    <div className={`msg-bubble ${msg.role}`}>
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          code({ node, inline, className, children, ...props }) {
                            const match = /language-(\w+)/.exec(className || "");
                            return !inline && match ? (
                              <SyntaxHighlighter
                                children={String(children).replace(/\n$/, "")}
                                style={vscDarkPlus}
                                language={match[1]}
                                PreTag="div"
                                customStyle={{
                                  borderRadius: "var(--radius)",
                                  margin: "0.75rem 0",
                                  fontSize: "0.82rem",
                                }}
                                {...props}
                              />
                            ) : (
                              <code className={className} {...props}>
                                {children}
                              </code>
                            );
                          },
                          a({ href, children: linkChildren }) {
                            if (href?.startsWith("#cite-")) {
                              const citation = msg.citations?.[Number(href.slice(6)) - 1];
                              if (!citation) return <>{linkChildren}</>;
                              return (
                                <button
                                  type="button"
                                  className="inline-cite"
                                  onClick={() => handleSelectCitation(citation, msg.citations)}
                                  title={`${formatDocName(citation.document)}${
                                    citation.page ? ` · Page ${citation.page}` : ""
                                  }`}
                                >
                                  {linkChildren}
                                </button>
                              );
                            }
                            return (
                              <a href={href} target="_blank" rel="noreferrer">
                                {linkChildren}
                              </a>
                            );
                          },
                        }}
                      >
                        {msg.citations?.length
                          ? injectCitationLinks(msg.content)
                          : msg.content}
                      </ReactMarkdown>
                    </div>

                    {msg.role === "assistant" && msg.content && (
                      <button
                        type="button"
                        className={`msg-copy-btn ${copiedIndex === i ? "copied" : ""}`}
                        onClick={() => handleCopyMessage(msg.content, i)}
                        title="Copy answer"
                      >
                        {copiedIndex === i ? (
                          <>
                            <Check size={12} /> Copied
                          </>
                        ) : (
                          <>
                            <Copy size={12} /> Copy
                          </>
                        )}
                      </button>
                    )}

                  </div>
                </div>
              ))
            )}

            {isTyping && <TypingIndicator />}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Input */}
        <div className="chat-input-wrap">
          <div className="chat-input-inner">
            <div className="chat-input-box">
              <textarea
                ref={textareaRef}
                className="chat-textarea"
                value={input}
                rows={1}
                placeholder="Ask a question about your document…"
                disabled={isTyping}
                id="chat-input"
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${Math.min(
                    e.target.scrollHeight,
                    180
                  )}px`;
                }}
                onKeyDown={onKey}
              />
              <button
                className="chat-send-btn"
                onClick={() => send()}
                disabled={!input.trim() || isTyping}
                id="btn-send"
              >
                <Send size={16} />
              </button>
            </div>
            <p className="chat-hint">
              AI can make mistakes. Verify critical information with the cited
              sources.
            </p>
          </div>
        </div>
      </div>

      {/* Right Citation Panel */}
      {selectedCitation && rightPanelOpen && (
        <div
          style={{
            width: "550px",
            maxWidth: "100%",
            height: "100vh",
            background: "rgba(19, 19, 19, 0.98)",
            borderLeft: "1px solid rgba(148, 163, 184, 0.2)",
            display: "flex",
            flexDirection: "column",
            zIndex: 40,
            flexShrink: 0,
          }}
        >
          {/* Panel header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "1rem 1.25rem",
              borderBottom: "1px solid rgba(148, 163, 184, 0.15)",
              flexShrink: 0,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: "0.95rem",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {formatDocName(selectedCitation.document)}
              </div>
              <div style={{ color: "var(--text-muted)", fontSize: "0.76rem" }}>
                {selectedCitation.isDefaultView
                  ? "Full document"
                  : selectedCitation.section || "Source excerpt"}
                {selectedCitation.page ? ` · Page ${selectedCitation.page}` : ""}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              {selectedCitation.excerpt && (
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() =>
                    navigator.clipboard?.writeText(selectedCitation.excerpt || "")
                  }
                  title="Copy reference"
                >
                  Copy
                </button>
              )}
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => setRightPanelOpen(false)}
                title="Close panel"
              >
                <PanelRightClose size={16} />
              </button>
            </div>
          </div>

          {/* Panel body — layout changes based on content type */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              padding: selectedSourceIsPdf ? "0.75rem" : "1.25rem",
              overflowY: selectedSourceIsPdf ? "hidden" : "auto",
            }}
          >
            {/* Excerpt card — hidden when a PDF is shown (PDF has its own
                highlight overlay, and we want the viewer to get all the
                vertical space) */}
            {selectedCitation.excerpt && !selectedSourceIsPdf && (
              <div
                style={{
                  padding: "0.8rem 0.9rem",
                  borderRadius: 10,
                  background: "rgba(148, 163, 184, 0.06)",
                  marginBottom: "1rem",
                  fontSize: "0.82rem",
                  lineHeight: 1.6,
                  color: "var(--text-muted)",
                  whiteSpace: "pre-wrap",
                  flexShrink: 0,
                }}
              >
                {selectedCitation.excerpt}
              </div>
            )}

            {selectedSourceIsPdf ? (
              <div
                style={{
                  position: "relative",
                  flex: 1,
                  minHeight: 0,
                  borderRadius: 10,
                  overflow: "hidden",
                  border: "1px solid rgba(148, 163, 184, 0.18)",
                }}
              >
                <PDFReferenceViewer
                  key={selectedCitation.source_url}
                  url={getURL(selectedCitation)}
                  pageNumber={selectedCitation.page || 1}
                  excerpt={selectedCitation.highlight_text || selectedCitation.excerpt || ""}
                  citations={citationList}
                  activeCitation={selectedCitation}
                  onSelectCitation={handleSelectCitation}
                  formatDocName={formatDocName}
                />
              </div>
            ) : selectedSourceIsImage ? (
              <img
                src={selectedCitation.source_url}
                alt="Source preview"
                style={{
                  width: "100%",
                  borderRadius: 10,
                  display: "block",
                  objectFit: "contain",
                  background: "white",
                }}
              />
            ) : selectedCitation.source_url ? (
              <div
                style={{
                  padding: "1rem",
                  borderRadius: 12,
                  background: "rgba(148, 163, 184, 0.05)",
                  border: "1px solid rgba(148, 163, 184, 0.18)",
                  color: "var(--text-muted)",
                  lineHeight: 1.6,
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    color: "var(--text-primary)",
                    marginBottom: 8,
                  }}
                >
                  Source file is not a PDF preview
                </div>
                This citation is tied to a{" "}
                {selectedCitation.source_url.split(".").pop()?.toUpperCase() ||
                  "document"}{" "}
                file, so the app is showing the grounded excerpt and the
                original file link instead of a PDF viewer.
                <div
                  style={{
                    marginTop: "0.85rem",
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <a
                    href={selectedCitation.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-primary btn-sm"
                    style={{ textDecoration: "none" }}
                  >
                    Open original file
                  </a>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() =>
                      navigator.clipboard?.writeText(
                        selectedCitation.excerpt || ""
                      )
                    }
                  >
                    Copy excerpt
                  </button>
                </div>
              </div>
            ) : selectedCitation.image_url ? (
              <img
                src={selectedCitation.image_url}
                alt="Source visual"
                style={{ width: "100%", borderRadius: 10, display: "block" }}
              />
            ) : null}

            {(selectedCitation.source_url || selectedCitation.image_url) &&
              !selectedSourceIsPdf && (
                <div
                  style={{
                    marginTop: "0.75rem",
                    display: "flex",
                    justifyContent: "flex-end",
                  }}
                >
                  {selectedCitation.source_url && (
                    <a
                      href={selectedCitation.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-primary btn-sm"
                      style={{ textDecoration: "none" }}
                    >
                      Open full source
                    </a>
                  )}
                </div>
              )}
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={!!docToDelete}
        onClose={() => setDocToDelete(null)}
        onConfirm={confirmDelete}
        title="Delete document"
        message="This will permanently remove all embeddings and chat history for this document."
        confirmText="Delete"
        isDestructive
      />
    </div>
  );
}