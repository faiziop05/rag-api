import React, { useState } from 'react';
import { useDispatch } from 'react-redux';
import { useNavigate, Link } from 'react-router-dom';
import { setCredentials } from '../store/slices/authSlice';
import { Loader2, Layers, FileText, Zap, Shield } from 'lucide-react';

export default function AuthPage({ isRegister = false }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    const endpoint = isRegister
      ? 'http://localhost:3000/auth/register'
      : 'http://localhost:3000/auth/login';

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Authentication failed');

      dispatch(setCredentials({ user: data.user, token: data.token }));
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch('http://localhost:3000/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
      setForgotSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const features = [
    { icon: Layers, text: 'Deep multi-modal parsing (tables, images, OCR)' },
    { icon: Zap,    text: 'Hybrid search + BGE cross-encoder reranking' },
    { icon: FileText, text: 'Pinpoint page citations on every answer' },
    { icon: Shield, text: 'Strict multi-tenant data isolation' },
  ];

  return (
    <div className="auth-layout page-enter">
      {/* Left — Form */}
      <div className="auth-left">
        {/* Logo */}
        <Link to="/" style={{ display: 'inline-block', textDecoration: 'none' }}>
          <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: '1.2rem', fontWeight: 800, letterSpacing: '-0.04em', color: 'var(--text)' }}>
            Recall<span style={{ color: 'var(--primary-light)' }}>.</span>
          </div>
        </Link>

        <div className="auth-form-area">
          <div className="auth-form-card">
            {forgotMode ? (
              <>
                <h2 className="auth-form-title">Reset your password</h2>
                <p className="auth-form-sub">
                  {forgotSent
                    ? "If an account exists for that email, we've sent a reset link."
                    : "Enter your email and we'll send you a reset link."}
                </p>

                {forgotSent ? (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ width: '100%', padding: '0.75rem', marginTop: '0.5rem' }}
                    onClick={() => { setForgotMode(false); setForgotSent(false); }}
                  >
                    Back to sign in
                  </button>
                ) : (
                  <form onSubmit={handleForgotSubmit} className="auth-form">
                    <div className="form-group">
                      <label className="form-label">Email address</label>
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="form-input"
                        placeholder="you@company.com"
                        id="forgot-email"
                      />
                    </div>

                    {error && <div className="auth-error">{error}</div>}

                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={isLoading}
                      style={{ width: '100%', padding: '0.75rem', marginTop: '0.25rem' }}
                    >
                      {isLoading ? <><Loader2 size={16} className="lucide-spin" /> Sending…</> : 'Send reset link'}
                    </button>
                    <p className="auth-switch">
                      <a href="#" onClick={(e) => { e.preventDefault(); setForgotMode(false); }}>Back to sign in</a>
                    </p>
                  </form>
                )}
              </>
            ) : (
              <>
                <h2 className="auth-form-title">
                  {isRegister ? 'Create an account' : 'Welcome back'}
                </h2>
                <p className="auth-form-sub">
                  {isRegister
                    ? 'Start talking to your documents — free, forever.'
                    : 'Sign in to your Recall workspace.'}
                </p>

                <form onSubmit={handleSubmit} className="auth-form">
                  <div className="form-group">
                    <label className="form-label">Email address</label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      className="form-input"
                      placeholder="you@company.com"
                      id="auth-email"
                    />
                  </div>

                  <div className="form-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <label className="form-label">Password</label>
                      {!isRegister && (
                        <a
                          href="#"
                          style={{ fontSize: '0.78rem', color: 'var(--primary-light)' }}
                          onClick={(e) => { e.preventDefault(); setError(''); setForgotMode(true); }}
                        >
                          Forgot password?
                        </a>
                      )}
                    </div>
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="form-input"
                      placeholder="••••••••••"
                      id="auth-password"
                    />
                  </div>

                  {error && <div className="auth-error">{error}</div>}

                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={isLoading}
                    id="auth-submit"
                    style={{ width: '100%', padding: '0.75rem', marginTop: '0.25rem' }}
                  >
                    {isLoading
                      ? <><Loader2 size={16} className="lucide-spin" /> {isRegister ? 'Creating account…' : 'Signing in…'}</>
                      : isRegister ? 'Create account' : 'Sign in'}
                  </button>
                </form>

                <p className="auth-switch">
                  {isRegister ? 'Already have an account? ' : "Don't have an account? "}
                  <Link to={isRegister ? '/login' : '/register'}>
                    {isRegister ? 'Sign in' : 'Sign up free'}
                  </Link>
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Right — Branding */}
      <div className="auth-right">
        <div className="auth-right-glow" />

        <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 380, display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--primary-light)', marginBottom: '0.75rem' }}>
              What makes Recall different
            </div>
            <h3 style={{ fontSize: '1.6rem', lineHeight: 1.2, marginBottom: '0.5rem' }}>
              Production-grade RAG,<br />not a wrapper.
            </h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: 1.65 }}>
              Most tools just extract text. Recall uses a state-of-the-art pipeline to understand the structure, tables, charts, and images in your documents.
            </p>
          </div>

          <div className="auth-feature-card">
            <ul className="auth-feature-list">
              {features.map(({ icon: Icon, text }) => (
                <li key={text}>
                  <div className="auth-feature-icon"><Icon size={13} /></div>
                  {text}
                </li>
              ))}
            </ul>
          </div>

          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '1.25rem 1.5rem' }}>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', fontStyle: 'italic', lineHeight: 1.6, marginBottom: '0.75rem' }}>
              "The multi-modal vision parsing saved us hundreds of engineering hours on our compliance workflow."
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg, var(--primary), var(--accent))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem', fontWeight: 700, color: '#fff' }}>SJ</div>
              <div>
                <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>Sarah Jenkins</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)' }}>CTO, LegalTech Inc.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
