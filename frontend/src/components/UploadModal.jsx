import React, { useRef } from 'react';
import { X, Upload, Loader2, FileText, CheckCircle } from 'lucide-react';

export default function UploadModal({
  isOpen, onClose, onUpload, isUploading, uploadStatus,
  fileInputRef, isDragging, handleDragOver, handleDragLeave, handleDrop,
  mode, onModeChange,
}) {
  if (!isOpen) return null;

  const isDone = uploadStatus === 'Done!';

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !isUploading) onClose(); }}>
      <div className="modal-card">
        <div className="modal-header">
          <h3 className="modal-title">New Knowledge Base</h3>
          {!isUploading && (
            <button className="btn-ghost" onClick={onClose} id="btn-close-upload">
              <X size={18} />
            </button>
          )}
        </div>

        <div className="modal-body">
          {!isUploading ? (
            <>
              <div
                className={`dropzone ${isDragging ? 'active' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                id="upload-dropzone"
              >
                <div className="dropzone-icon">
                  <Upload size={22} />
                </div>
                <p><strong style={{ color: 'var(--text)' }}>Drop your file here</strong> or click to browse</p>
                <span>PDF, DOCX, or TXT — up to 50 MB</span>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.txt"
                style={{ display: 'none' }}
                onChange={onUpload}
                id="file-input"
              />

              <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0.85rem 1rem' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem', fontWeight: 500 }}>Processing mode</div>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  {[
                    { id: 'lite', label: 'Standard', desc: 'Text-only, fast' },
                    { id: 'deep', label: 'Deep Vision', desc: 'Tables + images (slower)' },
                  ].map(({ id, label, desc }) => (
                    <label
                      key={id}
                      style={{
                        flex: 1,
                        background: 'var(--surface-3)',
                        border: mode === id ? '1px solid var(--primary)' : '1px solid var(--border-strong)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '0.65rem 0.85rem',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.15rem',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <input
                          type="radio"
                          name="mode"
                          value={id}
                          checked={mode === id}
                          onChange={() => onModeChange?.(id)}
                          style={{ accentColor: 'var(--primary)' }}
                        />
                        <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{label}</span>
                      </div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', marginLeft: '1.25rem' }}>{desc}</span>
                    </label>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '0.5rem 0' }}>
              {isDone ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1rem', background: 'var(--success-bg)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 'var(--radius)', color: 'var(--success)' }}>
                  <CheckCircle size={20} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Processing complete!</div>
                    <div style={{ fontSize: '0.8rem', opacity: 0.8 }}>Your knowledge base is ready.</div>
                  </div>
                </div>
              ) : (
                <div className="upload-progress">
                  <div className="progress-spinner" />
                  <div>
                    <div style={{ fontWeight: 500, fontSize: '0.88rem', color: 'var(--text)' }}>{uploadStatus}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-subtle)', marginTop: '0.15rem' }}>This may take a few minutes for large documents.</div>
                  </div>
                </div>
              )}

              <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius)', padding: '1rem' }}>
                <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '0.75rem' }}>
                  {['Uploading file', 'Parsing structure', 'Embedding chunks', 'Indexing'].map((step, i) => (
                    <div key={step} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.3rem', alignItems: 'center' }}>
                      <div style={{
                        width: '100%',
                        height: 3,
                        borderRadius: 99,
                        background: i <= (uploadStatus === 'Done!' ? 3 : uploadStatus.includes('embed') ? 2 : uploadStatus.includes('Extract') ? 1 : 0)
                          ? 'var(--primary)' : 'var(--surface-3)'
                      }} />
                      <span style={{ fontSize: '0.67rem', color: 'var(--text-subtle)', textAlign: 'center', whiteSpace: 'nowrap' }}>{step}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
