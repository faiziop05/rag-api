import React, { useEffect, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import {
  User, Moon, Shield, Trash2, Mail, Calendar, Bell, Loader2, AlertCircle,
  CheckCircle2, KeyRound, Sparkles, Check, AlertTriangle,
} from 'lucide-react';
import AppSidebar from '../components/AppSidebar';
import { logout, updateUser } from '../store/slices/authSlice';

const API_BASE = 'http://localhost:3000';

const PLANS = [
  { id: 'free', name: 'Free', price: '$0', blurb: 'Personal use, small document sets.' },
  { id: 'pro', name: 'Pro', price: '$29/mo', blurb: 'Higher limits, priority processing.' },
  { id: 'team', name: 'Team', price: 'Contact us', blurb: 'Shared workspaces, admin controls.' },
];

function formatDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function SettingsPage() {
  const { user, token } = useSelector((s) => s.auth);
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const [profile, setProfile] = useState(user || {});
  const [name, setName] = useState(user?.name || '');
  const [nameSaving, setNameSaving] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [nameError, setNameError] = useState(null);

  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('recall_theme') || 'dark'; } catch { return 'dark'; }
  });
  const [notifications, setNotifications] = useState(user?.notifications_enabled ?? true);
  const [prefsError, setPrefsError] = useState(null);
  const featureUnavailable = prefsError === 'MIGRATION_REQUIRED';

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwError, setPwError] = useState(null);
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);

  const [resendingVerification, setResendingVerification] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/account/me`, { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        if (res.ok && data.user) {
          setProfile(data.user);
          setName(data.user.name || '');
          if (typeof data.user.notifications_enabled === 'boolean') setNotifications(data.user.notifications_enabled);
          dispatch(updateUser(data.user));
        }
      } catch {
        // Keep whatever we already had from the login/register response.
      }
    })();
  }, [token, dispatch]);

  const applyTheme = (next) => {
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('recall_theme', next); } catch { /* ignore */ }
    // Best-effort cross-device sync — a missing migration shouldn't stop
    // the toggle from working immediately in THIS browser.
    fetch(`${API_BASE}/account/profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ theme: next }),
    }).catch(() => {});
  };

  const toggleNotifications = async () => {
    const next = !notifications;
    setNotifications(next);
    setPrefsError(null);
    try {
      const res = await fetch(`${API_BASE}/account/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ notifications_enabled: next }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNotifications(!next); // revert
        setPrefsError(res.status === 501 ? 'MIGRATION_REQUIRED' : (data.error || 'Failed to save'));
        return;
      }
      dispatch(updateUser({ notifications_enabled: next }));
    } catch {
      setNotifications(!next);
      setPrefsError('Failed to save — check your connection.');
    }
  };

  const handleSaveName = async (e) => {
    e.preventDefault();
    setNameError(null);
    setNameSaved(false);
    setNameSaving(true);
    try {
      const res = await fetch(`${API_BASE}/account/profile`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update name');
      dispatch(updateUser({ name: data.user?.name ?? name }));
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 2000);
    } catch (err) {
      setNameError(err.message);
    } finally {
      setNameSaving(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPwError(null);
    setPwSuccess(false);
    if (pwNew.length < 8) return setPwError('New password must be at least 8 characters');
    if (pwNew !== pwConfirm) return setPwError("New passwords don't match");

    setPwSaving(true);
    try {
      const res = await fetch(`${API_BASE}/account/password`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ current_password: pwCurrent, new_password: pwNew }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update password');
      setPwCurrent(''); setPwNew(''); setPwConfirm('');
      setPwSuccess(true);
      setTimeout(() => setPwSuccess(false), 3000);
    } catch (err) {
      setPwError(err.message);
    } finally {
      setPwSaving(false);
    }
  };

  const handleResendVerification = async () => {
    setResendingVerification(true);
    try {
      await fetch(`${API_BASE}/auth/send-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user?.email }),
      });
      setVerificationSent(true);
    } finally {
      setResendingVerification(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!deletePassword) { setDeleteError('Enter your password to confirm'); return; }
    setDeleteError(null);
    setIsDeleting(true);
    try {
      const res = await fetch(`${API_BASE}/account`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ password: deletePassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete account');
      dispatch(logout());
      navigate('/');
    } catch (err) {
      setDeleteError(err.message);
      setIsDeleting(false);
    }
  };

  const displayName = profile?.name || user?.email?.split('@')[0] || 'User';
  const joinDate = formatDate(profile?.created_at);
  const emailVerified = profile?.email_verified;
  const showVerificationBanner = emailVerified === false; // undefined (no migration) => don't nag

  return (
    <div className="app-layout page-enter">
      <AppSidebar />

      <main className="main-area">
        <div style={{ maxWidth: 680 }}>
          <div className="page-header">
            <div>
              <h1 className="page-title">Settings</h1>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                Manage your account and preferences.
              </p>
            </div>
          </div>

          {showVerificationBanner && (
            <div className="settings-verify-banner">
              <AlertCircle size={16} />
              <span>Your email address isn't verified yet.</span>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={handleResendVerification}
                disabled={resendingVerification || verificationSent}
              >
                {verificationSent ? 'Sent!' : resendingVerification ? 'Sending…' : 'Resend verification email'}
              </button>
            </div>
          )}

          {/* Profile */}
          <div className="settings-card">
            <div className="settings-card-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <User size={18} color="var(--primary-light)" /> Profile
              </h3>
            </div>

            <form onSubmit={handleSaveName} className="settings-row" style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div className="settings-row-label">Display Name</div>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.4rem' }}>
                  <input
                    type="text"
                    className="form-input"
                    value={name}
                    maxLength={100}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={displayName}
                    style={{ flex: 1 }}
                  />
                  <button type="submit" className="btn btn-secondary" disabled={nameSaving}>
                    {nameSaving ? <Loader2 size={14} className="lucide-spin" /> : nameSaved ? <Check size={14} /> : 'Save'}
                  </button>
                </div>
                {nameError && <div className="api-key-inline-error" style={{ marginTop: '0.4rem' }}><AlertCircle size={13} /> {nameError}</div>}
              </div>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg, var(--primary), var(--accent))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.85rem', color: '#fff', flexShrink: 0 }}>
                {displayName.slice(0, 2).toUpperCase()}
              </div>
            </form>

            <div className="settings-row">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Mail size={14} color="var(--text-subtle)" />
                <div>
                  <div className="settings-row-label">Email</div>
                  <div className="settings-row-value" style={{ marginTop: '0.15rem' }}>{user?.email || 'Not set'}</div>
                </div>
              </div>
              {emailVerified === true && (
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem', color: 'var(--success)' }}>
                  <CheckCircle2 size={14} /> Verified
                </span>
              )}
            </div>

            <div className="settings-row">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Shield size={14} color="var(--text-subtle)" />
                <div>
                  <div className="settings-row-label">Plan</div>
                  <div className="settings-row-value" style={{ marginTop: '0.15rem' }}>{user?.tier || 'Free'}</div>
                </div>
              </div>
              <span className="badge badge-primary" style={{ padding: '0.25rem 0.65rem', borderRadius: '99px', fontSize: '0.75rem', fontWeight: 600, background: 'rgba(79,70,229,0.12)', color: 'var(--primary-light)', border: '1px solid rgba(79,70,229,0.2)' }}>
                {user?.tier || 'Free'}
              </span>
            </div>

            <div className="settings-row" style={{ borderBottom: 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Calendar size={14} color="var(--text-subtle)" />
                <div>
                  <div className="settings-row-label">Member Since</div>
                  <div className="settings-row-value" style={{ marginTop: '0.15rem' }}>{joinDate || 'Unknown'}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Plans */}
          <div className="settings-card">
            <div className="settings-card-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Sparkles size={18} color="var(--primary-light)" /> Plans
              </h3>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
              {PLANS.map((plan) => {
                const isCurrent = (user?.tier || 'free').toLowerCase() === plan.id;
                return (
                  <div key={plan.id} className={`settings-plan-card ${isCurrent ? 'current' : ''}`}>
                    <div style={{ fontWeight: 700 }}>{plan.name}</div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 800, margin: '0.25rem 0' }}>{plan.price}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>{plan.blurb}</div>
                    {isCurrent ? (
                      <span className="settings-plan-current-badge">Current plan</span>
                    ) : (
                      <button type="button" className="btn btn-secondary" style={{ width: '100%', fontSize: '0.8rem' }} disabled title="Billing isn't configured yet">
                        Contact us
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-subtle)', marginTop: '0.75rem', marginBottom: 0 }}>
              Self-serve upgrades aren't wired up yet — this needs a payment provider (e.g. Stripe) configured on the backend.
            </p>
          </div>

          {/* Security */}
          <div className="settings-card">
            <div className="settings-card-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <KeyRound size={18} color="var(--primary-light)" /> Change Password
              </h3>
            </div>
            <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <input
                type="password"
                className="form-input"
                placeholder="Current password"
                value={pwCurrent}
                onChange={(e) => setPwCurrent(e.target.value)}
              />
              <input
                type="password"
                className="form-input"
                placeholder="New password (min. 8 characters)"
                value={pwNew}
                onChange={(e) => setPwNew(e.target.value)}
              />
              <input
                type="password"
                className="form-input"
                placeholder="Confirm new password"
                value={pwConfirm}
                onChange={(e) => setPwConfirm(e.target.value)}
              />
              {pwError && <div className="api-key-inline-error"><AlertCircle size={13} /> {pwError}</div>}
              {pwSuccess && <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--success)', fontSize: '0.85rem' }}><CheckCircle2 size={14} /> Password updated</div>}
              <button type="submit" className="btn btn-primary" disabled={pwSaving || !pwCurrent || !pwNew} style={{ alignSelf: 'flex-start' }}>
                {pwSaving ? <><Loader2 size={14} className="lucide-spin" /> Updating…</> : 'Update password'}
              </button>
            </form>
          </div>

          {/* Appearance */}
          <div className="settings-card">
            <div className="settings-card-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Moon size={18} color="var(--primary-light)" /> Appearance
              </h3>
            </div>

            <div className="settings-row">
              <div>
                <div className="settings-row-label">Dark Mode</div>
                <div className="settings-row-value" style={{ marginTop: '0.15rem' }}>Use dark theme across the platform</div>
              </div>
              <button
                className={`toggle-switch ${theme === 'dark' ? 'active' : ''}`}
                onClick={() => applyTheme(theme === 'dark' ? 'light' : 'dark')}
              />
            </div>

            <div className="settings-row" style={{ borderBottom: 'none' }}>
              <div style={{ flex: 1 }}>
                <div className="settings-row-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Bell size={13} /> Email Notifications
                </div>
                <div className="settings-row-value" style={{ marginTop: '0.15rem' }}>
                  Get an email when a document finishes (or fails to) process
                </div>
                {featureUnavailable && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-subtle)', marginTop: '0.3rem' }}>
                    Not available yet on this server (missing DB migration).
                  </div>
                )}
                {prefsError && !featureUnavailable && (
                  <div className="api-key-inline-error" style={{ marginTop: '0.3rem' }}><AlertCircle size={13} /> {prefsError}</div>
                )}
              </div>
              <button
                className={`toggle-switch ${notifications ? 'active' : ''}`}
                onClick={toggleNotifications}
                disabled={featureUnavailable}
              />
            </div>
          </div>

          {/* Danger Zone */}
          <div className="settings-card danger-zone">
            <div className="settings-card-header">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Trash2 size={18} /> Danger Zone
              </h3>
            </div>
            <p style={{ marginBottom: '1rem' }}>
              Once you delete your account, all of your data — including documents, embeddings, API keys, and chat history — will be permanently removed. This action cannot be undone.
            </p>
            <button
              className="btn"
              style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.25)', gap: '0.5rem' }}
              onClick={() => { setDeleteError(null); setDeletePassword(''); setShowDeleteModal(true); }}
              id="btn-delete-account"
            >
              <Trash2 size={14} /> Delete Account
            </button>
          </div>
        </div>
      </main>

      {showDeleteModal && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !isDeleting) setShowDeleteModal(false); }}>
          <div className="modal-card" style={{ maxWidth: 440 }}>
            <div className="modal-body">
              <div className="modal-danger-icon"><AlertTriangle size={20} /></div>
              <h3 className="modal-title">Delete your account</h3>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
                This will permanently remove your account and all associated data — documents, embeddings, API keys, and chat history. This cannot be undone.
              </p>
              <input
                type="password"
                className="form-input"
                placeholder="Enter your password to confirm"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                disabled={isDeleting}
                autoFocus
              />
              {deleteError && (
                <div className="api-key-inline-error"><AlertCircle size={13} /> {deleteError}</div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowDeleteModal(false)} disabled={isDeleting}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={handleDeleteAccount} disabled={isDeleting}>
                {isDeleting ? <><Loader2 size={14} className="lucide-spin" /> Deleting…</> : 'Delete Account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
