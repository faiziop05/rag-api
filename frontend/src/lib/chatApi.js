const API_BASE = 'http://localhost:3000';

/**
 * Thin wrapper around the server-side chat history endpoints
 * (backend/gateway/src/routes/chat.js). Every function here returns `null`
 * on failure — including the expected 501 when the DB migration adding
 * chat_threads/chat_messages hasn't been run yet — rather than throwing, so
 * callers can treat "no server sync available" as a normal, silent
 * fallback to the existing localStorage-only behavior instead of an error
 * to handle everywhere.
 */

async function safeFetch(path, token, options = {}) {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchThreads(kbId, token) {
  const data = await safeFetch(`/chat/${encodeURIComponent(kbId)}/threads`, token);
  return data?.threads ?? null;
}

export async function createThread(kbId, token, title = 'New chat') {
  const data = await safeFetch(`/chat/${encodeURIComponent(kbId)}/threads`, token, {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
  return data?.thread ?? null;
}

export async function renameThread(kbId, token, threadId, title) {
  const data = await safeFetch(`/chat/${encodeURIComponent(kbId)}/threads/${threadId}`, token, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });
  return !!data;
}

export async function deleteThread(kbId, token, threadId) {
  const data = await safeFetch(`/chat/${encodeURIComponent(kbId)}/threads/${threadId}`, token, {
    method: 'DELETE',
  });
  return !!data;
}

export async function addMessage(kbId, token, threadId, message) {
  const data = await safeFetch(`/chat/${encodeURIComponent(kbId)}/threads/${threadId}/messages`, token, {
    method: 'POST',
    body: JSON.stringify(message),
  });
  return data ?? null;
}
