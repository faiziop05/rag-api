import { configureStore } from '@reduxjs/toolkit';
import authReducer from './slices/authSlice';
import documentsReducer from './slices/documentsSlice';
import chatReducer from './slices/chatSlice';

const PERSIST_KEY = 'recall_app_state';

const loadPersistedState = () => {
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return undefined;
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

const persistedState = loadPersistedState();

export const store = configureStore({
  reducer: {
    auth: authReducer,
    documents: documentsReducer,
    chat: chatReducer,
  },
  preloadedState: persistedState,
});

store.subscribe(() => {
  try {
    const state = store.getState();
    if (!state.auth.isAuthenticated) {
      localStorage.removeItem(PERSIST_KEY);
      return;
    }

    const snapshot = {
      auth: {
        user: state.auth.user,
        token: state.auth.token,
        isAuthenticated: state.auth.isAuthenticated,
      },
      documents: {
        items: state.documents.items || [],
      },
      chat: {
        sessions: state.chat.sessions || {},
        isTyping: false,
      },
    };

    localStorage.setItem(PERSIST_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore persistence errors in restricted browsers.
  }
});
