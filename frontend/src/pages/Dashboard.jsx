import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import {
  Plus, FileText, MessageSquare,
  Search, Trash2, Database,
  Layers, Files, Clock,
  LayoutGrid, List, ArrowDownUp
} from 'lucide-react';
import { fetchDocuments, uploadDocument, deleteDocument } from '../store/slices/documentsSlice';
import ConfirmModal from '../components/ConfirmModal';
import UploadModal from '../components/UploadModal';
import AppSidebar from '../components/AppSidebar';

function timeAgo(dateString) {
  if (!dateString) return null;
  const then = new Date(dateString).getTime();
  if (Number.isNaN(then)) return null;

  const seconds = Math.floor((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export default function Dashboard() {
  const { user } = useSelector(state => state.auth);
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [uploadMode, setUploadMode] = useState('deep');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('recent');
  const [viewMode, setViewMode] = useState('grid');
  const fileInputRef = useRef(null);

  const { items: documents, isLoading: docsLoading } = useSelector(state => state.documents);
  const [documentToDelete, setDocumentToDelete] = useState(null);

  useEffect(() => { dispatch(fetchDocuments()); }, [dispatch]);

  const processFile = async (file, mode = 'deep') => {
    if (!file) return;

    // "Deep Vision" only means anything for PDFs/images/DOCX — the backend
    // parser for it hard-restricts to those formats (Docling has no concept
    // of doing OCR/image extraction on a plain text file), so picking Deep
    // Vision for a .txt/.md/.csv/.json upload would fail the whole
    // ingestion job outright. Those formats have no images or tables to
    // find anyway, so silently using Standard mode for them is lossless,
    // not a downgrade.
    const TEXT_ONLY_EXTENSIONS = ['.txt', '.md', '.csv', '.json'];
    const ext = `.${file.name.split('.').pop()?.toLowerCase() || ''}`;
    if (mode === 'deep' && TEXT_ONLY_EXTENSIONS.includes(ext)) {
      mode = 'lite';
    }

    setIsUploading(true);
    setUploadStatus('Uploading...');

    const cleanName = file.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    const kbId = `${cleanName}_${Date.now().toString().slice(-4)}`;

    try {
      const resultAction = await dispatch(uploadDocument({ file, knowledgeBaseId: kbId, mode }));
      if (uploadDocument.fulfilled.match(resultAction)) {
        const jobId = resultAction.payload.jobId;
        setUploadStatus('Parsing & embedding...');

        const poll = setInterval(async () => {
          try {
            const res = await fetch(`http://localhost:3000/ingest/job/${jobId}`, {
              headers: { 'Authorization': `Bearer ${user?.token || localStorage.getItem('token')}` }
            });
            const data = await res.json();
            if (data.state === 'completed') {
              clearInterval(poll);
              setUploadStatus('Done!');
              setTimeout(() => { setIsUploading(false); setIsUploadModalOpen(false); dispatch(fetchDocuments()); }, 800);
            } else if (data.state === 'failed') {
              clearInterval(poll);
              setUploadStatus('Processing failed.');
              setTimeout(() => { setIsUploading(false); setIsUploadModalOpen(false); }, 2000);
            } else {
              setUploadStatus('Extracting content...');
            }
          } catch { /* swallow */ }
        }, 1500);
      } else {
        setUploadStatus(`Error: ${resultAction.payload}`);
        setTimeout(() => { setIsUploading(false); setIsUploadModalOpen(false); }, 2000);
      }
    } catch {
      setUploadStatus('Something went wrong.');
      setTimeout(() => { setIsUploading(false); setIsUploadModalOpen(false); }, 2000);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileUpload = e => processFile(e.target.files[0], uploadMode);
  const handleDragOver   = e => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave  = e => { e.preventDefault(); setIsDragging(false); };
  const handleDrop       = e => {
    e.preventDefault(); setIsDragging(false);
    if (e.dataTransfer.files?.[0]) processFile(e.dataTransfer.files[0], uploadMode);
  };

  const confirmDelete = async () => {
    if (documentToDelete) { await dispatch(deleteDocument(documentToDelete)); setDocumentToDelete(null); }
  };

  const filteredDocs = useMemo(
    () => documents.filter(d => d.filename?.toLowerCase().includes(search.toLowerCase())),
    [documents, search]
  );

  const sortedDocs = useMemo(() => {
    const list = [...filteredDocs];
    switch (sortBy) {
      case 'name':
        return list.sort((a, b) => (a.filename || '').localeCompare(b.filename || ''));
      case 'chunks':
        return list.sort((a, b) => (b.chunk_count || 0) - (a.chunk_count || 0));
      case 'recent':
      default:
        return list.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    }
  }, [filteredDocs, sortBy]);

  const totalChunks = documents.reduce((sum, d) => sum + (d.chunk_count || 0), 0);
  const fileTypeCount = new Set(documents.map(d => d.file_type).filter(Boolean)).size;
  const mostRecent = documents.reduce((latest, d) => {
    if (!d.created_at) return latest;
    return !latest || new Date(d.created_at) > new Date(latest) ? d.created_at : latest;
  }, null);

  const stats = [
    { icon: Database, label: 'Knowledge Bases', value: documents.length, sub: documents.length === 1 ? '1 document uploaded' : `${documents.length} documents uploaded`, iconColor: 'var(--primary-light)' },
    { icon: Layers,   label: 'Chunks Indexed',  value: totalChunks.toLocaleString(), sub: 'vectors in your knowledge base', iconColor: 'var(--success)' },
    { icon: Files,    label: 'File Types',      value: fileTypeCount, sub: fileTypeCount === 1 ? 'format in use' : 'formats in use', iconColor: 'var(--warning)' },
    { icon: Clock,    label: 'Last Upload',     value: timeAgo(mostRecent) || '—', sub: mostRecent ? new Date(mostRecent).toLocaleDateString() : 'No uploads yet', iconColor: 'var(--accent)' },
  ];

  return (
    <div className="app-layout page-enter">
      <AppSidebar />

      {/* Main */}
      <main className="main-area main-area-modern">
        <div className="dashboard-header">
          <div className="header-content">
            <h1 className="dashboard-title">Knowledge Bases</h1>
            <p className="dashboard-subtitle">Manage your documents and chat with your data</p>
          </div>
          <button
            className="btn btn-primary btn-modern"
            id="btn-new-kb"
            onClick={() => setIsUploadModalOpen(true)}
          >
            <Plus size={18} /> New
          </button>
        </div>

        {/* Quick Stats */}
        <div className="stats-bar">
          {stats.map(({ icon: Icon, label, value, sub, iconColor }) => (
            <div key={label} className="stat-mini">
              <div className="stat-mini-top">
                <div className="stat-mini-label">{label}</div>
                <Icon size={16} color={iconColor} />
              </div>
              <div className="stat-mini-value">{value}</div>
              <div className="stat-mini-delta">{sub}</div>
            </div>
          ))}
        </div>

        {/* Search & Filter Bar */}
        <div className="controls-bar">
          <div className="search-box-modern">
            <Search size={16} />
            <input
              type="text"
              placeholder="Search knowledge bases…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              id="search-docs"
            />
          </div>

          <div className="sort-select-modern">
            <ArrowDownUp size={14} />
            <select value={sortBy} onChange={e => setSortBy(e.target.value)} id="sort-docs">
              <option value="recent">Most recent</option>
              <option value="name">Name (A–Z)</option>
              <option value="chunks">Most chunks</option>
            </select>
          </div>

          <div className="view-toggle-modern">
            <button
              className={viewMode === 'grid' ? 'active' : ''}
              onClick={() => setViewMode('grid')}
              title="Grid view"
              id="view-grid"
            >
              <LayoutGrid size={15} />
            </button>
            <button
              className={viewMode === 'list' ? 'active' : ''}
              onClick={() => setViewMode('list')}
              title="List view"
              id="view-list"
            >
              <List size={15} />
            </button>
          </div>

          <div className="filter-chip">{filteredDocs.length} {filteredDocs.length === 1 ? 'base' : 'bases'}</div>
        </div>

        {docsLoading ? (
          <div className={viewMode === 'grid' ? 'doc-grid-modern' : 'doc-list-modern'}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className={viewMode === 'grid' ? 'doc-card-modern skeleton-card' : 'doc-row-modern skeleton-card'}>
                <div className="skeleton-block skeleton-icon" />
                <div className="skeleton-lines">
                  <div className="skeleton-block skeleton-line" style={{ width: '70%' }} />
                  <div className="skeleton-block skeleton-line" style={{ width: '40%' }} />
                </div>
              </div>
            ))}
          </div>
        ) : sortedDocs.length > 0 ? (
          viewMode === 'grid' ? (
            <div className="doc-grid-modern">
              {sortedDocs.map(doc => (
                <div
                  key={doc.id}
                  className="doc-card-modern"
                  onClick={() => navigate(`/chat/${doc.id}`)}
                  id={`doc-card-${doc.id}`}
                >
                  <div className="doc-card-header-modern">
                    <div className="doc-icon-modern">
                      <FileText size={20} />
                    </div>
                    <button
                      className="btn-icon-modern"
                      onClick={e => { e.stopPropagation(); setDocumentToDelete(doc.id); }}
                      id={`btn-delete-${doc.id}`}
                      title="Delete"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>

                  <div className="doc-content-modern">
                    <div className="doc-name-modern truncate" title={doc.filename}>{doc.filename}</div>
                    <div className="doc-meta-modern">
                      <span className={`doc-status-dot ${doc.status === 'processing' ? 'processing' : ''}`} />
                      <span>{doc.status === 'processing' ? 'Processing…' : `${(doc.chunk_count ?? 0).toLocaleString()} chunks`}</span>
                    </div>
                  </div>

                  <div className="doc-footer-modern">
                    <span className="doc-type-modern">{doc.file_type?.toUpperCase() || 'PDF'}</span>
                    <span className="doc-footer-right">
                      {doc.created_at && <span className="doc-time-modern">{timeAgo(doc.created_at)}</span>}
                      <MessageSquare size={14} />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="doc-list-modern">
              {sortedDocs.map(doc => (
                <div
                  key={doc.id}
                  className="doc-row-modern"
                  onClick={() => navigate(`/chat/${doc.id}`)}
                  id={`doc-card-${doc.id}`}
                >
                  <div className="doc-icon-modern doc-icon-sm">
                    <FileText size={16} />
                  </div>
                  <div className="doc-row-name">
                    <span className="truncate" title={doc.filename}>{doc.filename}</span>
                    <span className="doc-type-modern">{doc.file_type?.toUpperCase() || 'PDF'}</span>
                  </div>
                  <div className="doc-row-meta">
                    <span className={`doc-status-dot ${doc.status === 'processing' ? 'processing' : ''}`} />
                    {doc.status === 'processing' ? 'Processing…' : `${(doc.chunk_count ?? 0).toLocaleString()} chunks`}
                  </div>
                  <div className="doc-row-meta doc-time-modern">{doc.created_at ? timeAgo(doc.created_at) : '—'}</div>
                  <button
                    className="btn-icon-modern"
                    onClick={e => { e.stopPropagation(); setDocumentToDelete(doc.id); }}
                    id={`btn-delete-${doc.id}`}
                    title="Delete"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )
        ) : (
          <div className="empty-state">
            <div className="empty-icon"><Database size={24} /></div>
            <h3>{search ? 'No results found' : 'No knowledge bases yet'}</h3>
            <p>{search ? 'Try a different search term.' : 'Upload your first document to get started.'}</p>
            {!search && (
              <button className="btn btn-primary" onClick={() => setIsUploadModalOpen(true)} id="btn-upload-first">
                <Plus size={15} /> Upload Document
              </button>
            )}
          </div>
        )}
      </main>

      <UploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onUpload={handleFileUpload}
        isUploading={isUploading}
        uploadStatus={uploadStatus}
        fileInputRef={fileInputRef}
        isDragging={isDragging}
        handleDragOver={handleDragOver}
        handleDragLeave={handleDragLeave}
        handleDrop={handleDrop}
        mode={uploadMode}
        onModeChange={setUploadMode}
      />

      <ConfirmModal
        isOpen={!!documentToDelete}
        onClose={() => setDocumentToDelete(null)}
        onConfirm={confirmDelete}
        title="Delete knowledge base"
        message="This will permanently remove all documents, embeddings, and chat history associated with this knowledge base. This action cannot be undone."
        confirmText="Delete"
        isDestructive
      />
    </div>
  );
}
