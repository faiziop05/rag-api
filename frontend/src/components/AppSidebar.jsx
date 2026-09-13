import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import {
  LayoutDashboard, Key, Settings, LogOut, Database
} from 'lucide-react';
import { logout } from '../store/slices/authSlice';

const NAV_ITEMS = [
  { icon: LayoutDashboard, label: 'Overview', path: '/dashboard' },
  { icon: Key,             label: 'API Keys', path: '/developer' },
  { icon: Settings,        label: 'Settings', path: '/settings' },
];

export default function AppSidebar() {
  const location = useLocation();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { user } = useSelector(s => s.auth);

  const displayName = user?.email?.split('@')[0] || 'User';
  const initials    = displayName.slice(0, 2).toUpperCase();

  return (
    <nav className="sidebar">
      <Link to="/dashboard" className="sidebar-logo" style={{ textDecoration: 'none' }}>
        Recall<span>.</span>
      </Link>

      <div className="sidebar-section-label">Menu</div>

      {NAV_ITEMS.map(({ icon: Icon, label, path }) => (
        <Link
          key={path}
          to={path}
          className={`sidebar-item ${location.pathname === path ? 'active' : ''}`}
        >
          <Icon size={16} /> {label}
        </Link>
      ))}

      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="sidebar-avatar">{initials}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sidebar-user-name truncate">{displayName}</div>
            <div className="sidebar-user-plan">{user?.tier || 'Free'} Plan</div>
          </div>
          <button
            className="btn-ghost"
            onClick={() => { dispatch(logout()); navigate('/login'); }}
            title="Sign out"
            id="btn-logout"
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </nav>
  );
}
