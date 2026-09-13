import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { BrowserRouter } from 'react-router-dom'
import { store } from './store/store'
import './index.css'
import App from './App.jsx'

// Applied before React mounts (not inside a component) so there's no flash
// of the wrong theme on load. localStorage is the immediate source of
// truth for this — SettingsPage also best-effort syncs it to the user's
// account (`theme` column) so it follows them across devices, but the
// local value is what avoids a paint of the default theme before that
// fetch could ever resolve.
try {
  const savedTheme = localStorage.getItem('recall_theme');
  if (savedTheme === 'light' || savedTheme === 'dark') {
    document.documentElement.setAttribute('data-theme', savedTheme);
  }
} catch {
  // Ignore — falls back to the default (dark) theme.
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Provider store={store}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </Provider>
  </StrictMode>,
)
