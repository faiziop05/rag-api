import React, { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [status, setStatus] = useState(token ? 'verifying' : 'missing'); // verifying | success | error | missing
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await fetch('http://localhost:3000/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Verification failed');
        setStatus('success');
      } catch (err) {
        setStatus('error');
        setMessage(err.message);
      }
    })();
  }, [token]);

  return (
    <div className="auth-layout page-enter" style={{ gridTemplateColumns: '1fr' }}>
      <div className="auth-left" style={{ maxWidth: 440, margin: '0 auto' }}>
        <Link to="/" style={{ display: 'inline-block', textDecoration: 'none' }}>
          <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: '1.2rem', fontWeight: 800, letterSpacing: '-0.04em', color: 'var(--text)' }}>
            Recall<span style={{ color: 'var(--primary-light)' }}>.</span>
          </div>
        </Link>

        <div className="auth-form-area">
          <div className="auth-form-card" style={{ textAlign: 'center' }}>
            {status === 'verifying' && (
              <>
                <Loader2 size={28} className="lucide-spin" style={{ marginBottom: '0.75rem' }} />
                <h2 className="auth-form-title">Verifying your email…</h2>
              </>
            )}
            {status === 'success' && (
              <>
                <CheckCircle2 size={28} color="var(--success)" style={{ marginBottom: '0.75rem' }} />
                <h2 className="auth-form-title">Email verified</h2>
                <p className="auth-form-sub">Your email address has been confirmed.</p>
                <Link to="/dashboard" className="btn btn-primary" style={{ width: '100%', padding: '0.75rem', marginTop: '1rem', justifyContent: 'center' }}>
                  Go to dashboard
                </Link>
              </>
            )}
            {status === 'error' && (
              <>
                <AlertTriangle size={28} color="var(--danger)" style={{ marginBottom: '0.75rem' }} />
                <h2 className="auth-form-title">Verification failed</h2>
                <p className="auth-form-sub">{message || 'This link is invalid or has expired.'}</p>
                <Link to="/settings" className="btn btn-secondary" style={{ width: '100%', padding: '0.75rem', marginTop: '1rem', justifyContent: 'center' }}>
                  Request a new link from Settings
                </Link>
              </>
            )}
            {status === 'missing' && (
              <>
                <AlertTriangle size={28} color="var(--danger)" style={{ marginBottom: '0.75rem' }} />
                <h2 className="auth-form-title">Invalid link</h2>
                <p className="auth-form-sub">This verification link is missing its token.</p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
