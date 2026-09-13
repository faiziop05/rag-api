import React, { useState, useEffect, useCallback } from 'react';
import { useSelector } from 'react-redux';
import {
  Key, Plus, Copy, Check, Trash2, ChevronDown, ChevronRight,
  BookOpen, Shield, Loader2, AlertCircle, X, ShieldAlert,
} from 'lucide-react';
import AppSidebar from '../components/AppSidebar';
import ConfirmModal from '../components/ConfirmModal';

const API_BASE = 'http://localhost:3000';
const KEY_NAME_MAX = 60;

function timeAgo(isoString) {
  if (!isoString) return null;
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return null;
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth < 12) return `${diffMonth}mo ago`;
  return `${Math.floor(diffMonth / 12)}y ago`;
}

function CodeBlock({ label, code }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code.replace(/<[^>]+>/g, ''));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="api-code-block">
      <div className="api-code-header">
        <span>{label}</span>
        <button className={`api-code-copy ${copied ? 'copied' : ''}`} onClick={copy}>
          {copied ? <><Check size={10} /> Copied</> : <><Copy size={10} /> Copy</>}
        </button>
      </div>
      <pre className="api-code-content" dangerouslySetInnerHTML={{ __html: code }} />
    </div>
  );
}

// Shown exactly once, right after a key is created — the server never
// returns the unmasked secret again after this response, so this is the
// user's only chance to copy it.
function RevealKeyModal({ apiKey, onClose }) {
  const [copied, setCopied] = useState(false);
  if (!apiKey) return null;

  const copy = () => {
    navigator.clipboard.writeText(apiKey.key_value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card" style={{ maxWidth: 520 }}>
        <div className="modal-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <div className="modal-danger-icon" style={{ background: 'var(--success-bg)', color: 'var(--success)', margin: 0 }}>
              <Check size={20} />
            </div>
            <h3 className="modal-title" style={{ margin: 0 }}>API key created</h3>
          </div>

          <div className="api-key-reveal-warning">
            <ShieldAlert size={16} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
            <span>
              Copy this key now — for your security, we only show the full value once.
              You won't be able to view it again after closing this dialog.
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <code className="api-key-value api-key-value-full">{apiKey.key_value}</code>
            <button
              type="button"
              className={`btn ${copied ? 'btn-secondary' : 'btn-primary'}`}
              onClick={copy}
              style={{ flexShrink: 0 }}
            >
              {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
            </button>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-primary" onClick={onClose} id="btn-reveal-done">
            Done — I've saved it
          </button>
        </div>
      </div>
    </div>
  );
}

function Endpoint({ method, path, desc, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="api-endpoint">
      <div className="api-endpoint-header" onClick={() => setOpen(!open)}>
        <span className={`api-method ${method.toLowerCase()}`}>{method}</span>
        <span className="api-path">{path}</span>
        <span className="api-desc">{desc}</span>
        {open ? <ChevronDown size={16} color="var(--text-subtle)" /> : <ChevronRight size={16} color="var(--text-subtle)" />}
      </div>
      {open && <div className="api-endpoint-body">{children}</div>}
    </div>
  );
}

export default function DeveloperKeys() {
  const { token } = useSelector((state) => state.auth);
  const [apiKeys, setApiKeys] = useState([]);
  const [isListLoading, setIsListLoading] = useState(true);
  const [listError, setListError] = useState(null);

  const [newKeyName, setNewKeyName] = useState('');
  const [nameError, setNameError] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  const [revealKey, setRevealKey] = useState(null); // full key shown once, right after creation
  const [keyToRevoke, setKeyToRevoke] = useState(null);
  const [revokingId, setRevokingId] = useState(null);
  const [revokeError, setRevokeError] = useState(null);

  const fetchApiKeys = useCallback(async () => {
    setListError(null);
    try {
      const res = await fetch(`${API_BASE}/api-keys`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to load API keys');
      setApiKeys(data.apiKeys || []);
    } catch (err) {
      setListError(err.message || 'Failed to load API keys');
    } finally {
      setIsListLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchApiKeys(); }, [fetchApiKeys]);

  const validateName = (name) => {
    if (!name.trim()) return 'Give this key a name so you can identify it later';
    if (name.trim().length > KEY_NAME_MAX) return `Name must be ${KEY_NAME_MAX} characters or fewer`;
    if (apiKeys.some((k) => k.name.toLowerCase() === name.trim().toLowerCase())) {
      return 'You already have a key with this name';
    }
    return null;
  };

  const handleCreateApiKey = async (e) => {
    e.preventDefault();
    const trimmed = newKeyName.trim();
    const validationError = validateName(newKeyName);
    if (validationError) { setNameError(validationError); return; }

    setNameError(null);
    setCreateError(null);
    setIsCreating(true);
    try {
      const res = await fetch(`${API_BASE}/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to create API key');
      setNewKeyName('');
      setRevealKey(data.apiKey); // show the one-time full value
      fetchApiKeys();
    } catch (err) {
      setCreateError(err.message || 'Failed to create API key');
    } finally {
      setIsCreating(false);
    }
  };

  const handleConfirmRevoke = async () => {
    if (!keyToRevoke) return;
    const id = keyToRevoke.id;
    setRevokingId(id);
    setRevokeError(null);
    try {
      const res = await fetch(`${API_BASE}/api-keys/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to revoke API key');
      setApiKeys((prev) => prev.filter((k) => k.id !== id));
    } catch (err) {
      setRevokeError(err.message || 'Failed to revoke API key');
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <div className="app-layout page-enter">
      <AppSidebar />

      <main className="main-area">
        <div style={{ maxWidth: 860 }}>
          {/* Header */}
          <div className="page-header">
            <div>
              <h1 className="page-title">API Keys & Documentation</h1>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                Manage API keys and integrate Recall into your applications.
              </p>
            </div>
          </div>

          {/* Key Management */}
          <div className="settings-card">
            <div className="settings-card-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Key size={18} color="var(--primary-light)" /> Create New Key
              </h3>
            </div>

            <form
              onSubmit={handleCreateApiKey}
              noValidate
              style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1.5rem' }}
            >
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g., Production Environment"
                  value={newKeyName}
                  maxLength={KEY_NAME_MAX}
                  onChange={(e) => { setNewKeyName(e.target.value); setNameError(null); setCreateError(null); }}
                  style={{ flex: 1, borderColor: nameError ? 'var(--danger)' : undefined }}
                  id="api-key-name-input"
                  disabled={isCreating}
                />
                <button type="submit" className="btn btn-primary" disabled={isCreating} id="btn-create-key">
                  {isCreating ? <Loader2 size={16} className="lucide-spin" /> : <Plus size={16} />}
                  {isCreating ? 'Creating…' : 'Create Key'}
                </button>
              </div>
              {(nameError || createError) && (
                <div className="api-key-inline-error">
                  <AlertCircle size={13} /> {nameError || createError}
                </div>
              )}
            </form>

            <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-subtle)', marginBottom: '0.75rem' }}>
              Active Keys {!isListLoading && `(${apiKeys.length})`}
            </div>

            {listError && (
              <div className="api-key-banner-error">
                <AlertCircle size={15} />
                <span>{listError}</span>
                <button type="button" className="btn btn-ghost" onClick={fetchApiKeys}>Retry</button>
              </div>
            )}

            {isListLoading ? (
              <div style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-subtle)' }}>
                <Loader2 size={20} className="lucide-spin" />
              </div>
            ) : apiKeys.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2.5rem', background: 'var(--surface-2)', borderRadius: 'var(--radius)', border: '1px dashed var(--border-strong)' }}>
                <Shield size={24} color="var(--text-subtle)" style={{ marginBottom: '0.5rem' }} />
                <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-muted)' }}>No API keys generated yet.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {apiKeys.map((key) => {
                  const created = timeAgo(key.created_at);
                  return (
                    <div key={key.id} className="api-key-row">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: '0.88rem', marginBottom: '0.2rem' }}>{key.name}</div>
                        <code className="api-key-value" title="The full key is only shown once, at creation">
                          {key.key_value}
                        </code>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', marginTop: '0.15rem', display: 'block' }}>
                          {key.requests_count || 0} requests{created ? ` · created ${created}` : ''}
                        </span>
                      </div>
                      <button
                        className="btn btn-ghost"
                        style={{ color: 'var(--danger)', opacity: 0.7 }}
                        onClick={() => { setRevokeError(null); setKeyToRevoke(key); }}
                        onMouseOver={(e) => { e.currentTarget.style.opacity = '1'; }}
                        onMouseOut={(e) => { e.currentTarget.style.opacity = '0.7'; }}
                        disabled={revokingId === key.id}
                      >
                        {revokingId === key.id ? <Loader2 size={14} className="lucide-spin" /> : <Trash2 size={14} />}
                        Revoke
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <RevealKeyModal apiKey={revealKey} onClose={() => setRevealKey(null)} />

          <ConfirmModal
            isOpen={!!keyToRevoke}
            onClose={() => setKeyToRevoke(null)}
            onConfirm={handleConfirmRevoke}
            title="Revoke this API key?"
            message={
              keyToRevoke
                ? `"${keyToRevoke.name}" will stop working immediately. Any application still using it will get 401 Unauthorized responses. This cannot be undone.`
                : ''
            }
            confirmText="Revoke key"
            isDestructive
          />
          {revokeError && (
            <div className="api-key-banner-error" style={{ marginTop: '-1rem', marginBottom: '1.5rem' }}>
              <AlertCircle size={15} />
              <span>{revokeError}</span>
              <button type="button" className="btn btn-ghost" onClick={() => setRevokeError(null)}><X size={13} /></button>
            </div>
          )}

          {/* API Documentation */}
          <div className="api-docs-section">
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <BookOpen size={18} color="var(--primary-light)" />
                <h2 style={{ fontSize: '1.3rem', fontWeight: 800, margin: 0 }}>API Reference</h2>
              </div>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', margin: 0 }}>
                Base URL: <code style={{ background: 'var(--surface-2)', padding: '0.15rem 0.4rem', borderRadius: '4px', fontSize: '0.85rem', color: 'var(--primary-light)' }}>http://localhost:3000</code>
              </p>
            </div>

            {/* Auth info */}
            <div className="settings-card" style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0 0 0.75rem' }}>
                <Shield size={16} color="var(--accent)" /> Authentication
              </h3>
              <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: 1.7, margin: 0 }}>
                All API requests require authentication via the <code style={{ background: 'var(--surface-2)', padding: '0.1rem 0.35rem', borderRadius: '4px' }}>Authorization</code> header.
                You can use either a <strong>JWT token</strong> (obtained from login) or an <strong>API Key</strong> (generated above).
              </p>
              <CodeBlock
                label="Header Format"
                code={`Authorization: Bearer <span class="hl-str">YOUR_API_KEY_OR_JWT</span>`}
              />
            </div>

            {/* Endpoints */}
            <Endpoint method="POST" path="/auth/register" desc="Create a new account">
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0.75rem 0' }}>Register a new user account and receive a JWT token.</p>
              <CodeBlock
                label="Request (cURL)"
                code={`<span class="hl-cmd">curl</span> <span class="hl-flag">-X POST</span> http://localhost:3000/auth/register \\
  <span class="hl-flag">-H</span> <span class="hl-str">"Content-Type: application/json"</span> \\
  <span class="hl-flag">-d</span> <span class="hl-str">'{"email": "user@example.com", "password": "securepass"}'</span>`}
              />
              <CodeBlock
                label="Response (200)"
                code={`{
  <span class="hl-key">"token"</span>: <span class="hl-str">"eyJhbGciOiJIUzI1NiIs..."</span>,
  <span class="hl-key">"user"</span>: { <span class="hl-key">"id"</span>: <span class="hl-str">"uuid"</span>, <span class="hl-key">"email"</span>: <span class="hl-str">"user@example.com"</span>, <span class="hl-key">"tier"</span>: <span class="hl-str">"free"</span> }
}`}
              />
            </Endpoint>

            <Endpoint method="POST" path="/auth/login" desc="Authenticate and get JWT">
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0.75rem 0' }}>Login with email/password to receive a JWT token valid for 7 days.</p>
              <CodeBlock
                label="Request (cURL)"
                code={`<span class="hl-cmd">curl</span> <span class="hl-flag">-X POST</span> http://localhost:3000/auth/login \\
  <span class="hl-flag">-H</span> <span class="hl-str">"Content-Type: application/json"</span> \\
  <span class="hl-flag">-d</span> <span class="hl-str">'{"email": "user@example.com", "password": "securepass"}'</span>`}
              />
            </Endpoint>

            <Endpoint method="POST" path="/ingest" desc="Upload & process a document">
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0.75rem 0' }}>
                Upload a PDF, DOCX, or TXT file for parsing and embedding. Returns a job ID to poll for status.
              </p>
              <CodeBlock
                label="Request (cURL)"
                code={`<span class="hl-cmd">curl</span> <span class="hl-flag">-X POST</span> http://localhost:3000/ingest \\
  <span class="hl-flag">-H</span> <span class="hl-str">"Authorization: Bearer YOUR_API_KEY"</span> \\
  <span class="hl-flag">-F</span> <span class="hl-str">"file=@document.pdf"</span> \\
  <span class="hl-flag">-F</span> <span class="hl-str">"knowledge_base_id=my_project_kb"</span> \\
  <span class="hl-flag">-F</span> <span class="hl-str">"processing_mode=deep"</span>`}
              />
              <CodeBlock
                label="Response (202)"
                code={`{
  <span class="hl-key">"message"</span>: <span class="hl-str">"Document ingestion queued successfully"</span>,
  <span class="hl-key">"jobId"</span>: <span class="hl-num">42</span>,
  <span class="hl-key">"knowledge_base_id"</span>: <span class="hl-str">"my_project_kb"</span>,
  <span class="hl-key">"processing_mode"</span>: <span class="hl-str">"deep"</span>
}`}
              />
              <p style={{ fontSize: '0.82rem', color: 'var(--text-subtle)', marginTop: '0.5rem' }}>
                Processing modes: <code>fast</code> (text-only) or <code>deep</code> (vision OCR for tables & images).
              </p>
            </Endpoint>

            <Endpoint method="GET" path="/ingest/job/:id" desc="Check ingestion job status">
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0.75rem 0' }}>Poll this endpoint to check whether document processing has completed.</p>
              <CodeBlock
                label="Response (200)"
                code={`{
  <span class="hl-key">"id"</span>: <span class="hl-str">"42"</span>,
  <span class="hl-key">"state"</span>: <span class="hl-str">"completed"</span>,  // waiting | active | completed | failed
  <span class="hl-key">"progress"</span>: <span class="hl-num">100</span>
}`}
              />
            </Endpoint>

            <Endpoint method="POST" path="/query" desc="Ask a question about a document">
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0.75rem 0' }}>
                Send a natural language query against a knowledge base. Returns an AI-generated answer with citations.
              </p>
              <CodeBlock
                label="Request (cURL)"
                code={`<span class="hl-cmd">curl</span> <span class="hl-flag">-X POST</span> http://localhost:3000/query \\
  <span class="hl-flag">-H</span> <span class="hl-str">"Authorization: Bearer YOUR_API_KEY"</span> \\
  <span class="hl-flag">-H</span> <span class="hl-str">"Content-Type: application/json"</span> \\
  <span class="hl-flag">-d</span> <span class="hl-str">'{
    "knowledge_base_id": "my_project_kb",
    "query": "What are the key requirements?",
    "history": []
  }'</span>`}
              />
              <CodeBlock
                label="Response (200)"
                code={`{
  <span class="hl-key">"answer"</span>: <span class="hl-str">"The key requirements include..."</span>,
  <span class="hl-key">"citations"</span>: [
    {
      <span class="hl-key">"document"</span>: <span class="hl-str">"report.pdf"</span>,
      <span class="hl-key">"page"</span>: <span class="hl-num">14</span>,
      <span class="hl-key">"confidence_score"</span>: <span class="hl-num">0.95</span>,
      <span class="hl-key">"image_url"</span>: <span class="hl-str">null</span>
    }
  ]
}`}
              />
            </Endpoint>

            <Endpoint method="GET" path="/documents" desc="List all knowledge bases">
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0.75rem 0' }}>Returns all knowledge bases (uploaded documents) belonging to the authenticated user.</p>
              <CodeBlock
                label="Response (200)"
                code={`[
  {
    <span class="hl-key">"id"</span>: <span class="hl-str">"report_pdf_1234"</span>,
    <span class="hl-key">"filename"</span>: <span class="hl-str">"report.pdf"</span>,
    <span class="hl-key">"file_type"</span>: <span class="hl-str">"pdf"</span>
  }
]`}
              />
            </Endpoint>

            <Endpoint method="DELETE" path="/documents/:kbId" desc="Delete a knowledge base">
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0.75rem 0' }}>
                Permanently deletes a knowledge base and all associated embeddings.
              </p>
              <CodeBlock
                label="Request (cURL)"
                code={`<span class="hl-cmd">curl</span> <span class="hl-flag">-X DELETE</span> http://localhost:3000/documents/report_pdf_1234 \\
  <span class="hl-flag">-H</span> <span class="hl-str">"Authorization: Bearer YOUR_API_KEY"</span>`}
              />
            </Endpoint>
          </div>
        </div>
      </main>
    </div>
  );
}
