import { createSlice } from '@reduxjs/toolkit';

const generateId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const createThread = (title = 'New chat', id = null) => ({
  id: id || generateId(),
  title,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  messages: [],
});

const ensureDocSession = (state, kbId) => {
  if (!state.sessions[kbId]) {
    const firstThread = createThread('New chat');
    state.sessions[kbId] = {
      threads: [firstThread],
      activeThreadId: firstThread.id,
    };
  }
  return state.sessions[kbId];
};

const initialState = {
  sessions: {},
  isTyping: false,
};

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    hydrateChats: (state, action) => {
      state.sessions = action.payload || {};
    },
    // Replaces one knowledge base's threads with the server's copy (used
    // when opening a chat for the first time in this browser — see
    // DocumentChat.jsx). Left alone if the local session already has real
    // content, so this never clobbers messages the server sync missed.
    hydrateKbThreads: (state, action) => {
      const { kbId, threads } = action.payload;
      if (!threads || threads.length === 0) return;
      state.sessions[kbId] = {
        threads,
        activeThreadId: threads[0].id,
      };
    },
    createChatThread: (state, action) => {
      const { kbId, title = 'New chat', id = null } = action.payload;
      const docSession = ensureDocSession(state, kbId);
      const thread = createThread(title, id);
      docSession.threads.push(thread);
      docSession.activeThreadId = thread.id;
    },
    switchChatThread: (state, action) => {
      const { kbId, threadId } = action.payload;
      const docSession = ensureDocSession(state, kbId);
      if (docSession.threads.some((thread) => thread.id === threadId)) {
        docSession.activeThreadId = threadId;
      }
    },
    addMessage: (state, action) => {
      const { kbId, threadId, message } = action.payload;
      const docSession = ensureDocSession(state, kbId);
      const targetThreadId = threadId || docSession.activeThreadId;
      const thread = docSession.threads.find((item) => item.id === targetThreadId) || docSession.threads[0];

      if (!thread) return;
      if (!thread.messages) thread.messages = [];
      thread.messages.push(message);
      thread.updatedAt = Date.now();

      if (thread.title === 'New chat' && message.role === 'user') {
        const preview = message.content.trim().replace(/\s+/g, ' ');
        thread.title = preview.length > 28 ? `${preview.slice(0, 28)}…` : preview;
      }

      docSession.activeThreadId = thread.id;
    },
    updateThreadTitle: (state, action) => {
      const { kbId, threadId, title } = action.payload;
      const docSession = ensureDocSession(state, kbId);
      const thread = docSession.threads.find((item) => item.id === threadId);
      if (thread) thread.title = title;
    },
    deleteChatThread: (state, action) => {
      const { kbId, threadId } = action.payload;
      const docSession = ensureDocSession(state, kbId);
      docSession.threads = docSession.threads.filter((thread) => thread.id !== threadId);
      if (docSession.threads.length === 0) {
        docSession.threads = [createThread('New chat')];
      }
      docSession.activeThreadId = docSession.threads[0].id;
    },
    setTyping: (state, action) => {
      state.isTyping = action.payload;
    },
    clearHistory: (state, action) => {
      const kbId = action.payload;
      const docSession = ensureDocSession(state, kbId);
      docSession.threads = [createThread('New chat')];
      docSession.activeThreadId = docSession.threads[0].id;
    },
  },
});

export const {
  hydrateChats,
  hydrateKbThreads,
  createChatThread,
  switchChatThread,
  addMessage,
  updateThreadTitle,
  deleteChatThread,
  setTyping,
  clearHistory,
} = chatSlice.actions;

export default chatSlice.reducer;
