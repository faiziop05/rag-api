import React from 'react';
import { X, AlertTriangle } from 'lucide-react';

export default function ConfirmModal({ isOpen, onClose, onConfirm, title, message, confirmText = 'Confirm', isDestructive = false }) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card" style={{ maxWidth: 420 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
          {isDestructive && (
            <div className="modal-danger-icon">
              <AlertTriangle size={20} />
            </div>
          )}
          <h3 className="modal-title">{title}</h3>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>{message}</p>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} id="btn-confirm-cancel">
            Cancel
          </button>
          <button
            className={`btn ${isDestructive ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => { onConfirm(); onClose(); }}
            id="btn-confirm-action"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
