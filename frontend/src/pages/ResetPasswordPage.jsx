import React, { useState } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) return setError('Password must be at least 8 characters');
    if (password !== confirm) return setError("Passwords don't match");

    setIsLoading(true);
    try {
      const res = await fetch('http://localhost:3000/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reset password');
      setDone(true);
      setTimeout(() => navigate('/login'), 2500);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-layout page-enter" style={{ gridTemplateColumns: '1fr' }}>
      <div className="auth-left" style={{ maxWidth: 440, margin: '0 auto' }}>
        <Link to="/" style={{ display: 'inline-block', textDecoration: 'none' }}>
          <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: '1.2rem', fontWeight: 800, letterSpacing: '-0.04em', color: 'var(--text)' }}>
            Recall<span style={{ color: 'var(--primary-light)' }}>.</span>
          </div>
        </Link>

        <div className="auth-form-area">
          <div className="auth-form-card">
            {!token ? (
              <>
                <h2 className="auth-form-title">Invalid link</h2>
                <p className="auth-form-sub">This reset link is missing its token. Request a new one from the sign-in page.</p>
                <Link to="/login" className="btn btn-primary" style={{ width: '100%', padding: '0.75rem', marginTop: '1rem', justifyContent: 'center' }}>
                  Back to sign in
                </Link>
              </>
            ) : done ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.5rem' }}>
                  <CheckCircle2 size={22} color="var(--success)" />
                  <h2 className="auth-form-title" style={{ margin: 0 }}>Password updated</h2>
                </div>
                <p className="auth-form-sub">Redirecting you to sign in…</p>
              </>
            ) : (
              <>
                <h2 className="auth-form-title">Set a new password</h2>
                <p className="auth-form-sub">Choose a new password for your account.</p>

                <form onSubmit={handleSubmit} className="auth-form">
                  <div className="form-group">
                    <label className="form-label">New password</label>
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="form-input"
                      placeholder="••••••••••"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Confirm new password</label>
                    <input
                      type="password"
                      required
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      className="form-input"
                      placeholder="••••••••••"
                    />
                  </div>

                  {error && (
                    <div className="auth-error">
                      <AlertTriangle size={14} style={{ marginRight: '0.4rem' }} />
                      {error}
                    </div>
                  )}

                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={isLoading}
                    style={{ width: '100%', padding: '0.75rem', marginTop: '0.25rem' }}
                  >
                    {isLoading ? <><Loader2 size={16} className="lucide-spin" /> Updating…</> : 'Update password'}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
