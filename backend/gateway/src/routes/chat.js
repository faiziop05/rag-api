const express = require('express');
const supabase = require('../config/supabase');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

/**
 * Server-side chat history (backend/migrations/002_account_features.sql).
 * Chat previously lived ONLY in the browser's localStorage — cleared
 * storage or a different device meant every conversation was gone with no
 * way to recover it, and it wasn't included in account deletion either.
 * These endpoints let the frontend treat the backend as the source of
 * truth while keeping localStorage as an offline fallback.
 *
 * Every handler here treats "chat_threads/chat_messages don't exist yet"
 * (the migration not having been run) as a 501 with a clear message,
 * rather than a raw 500 — the frontend uses that to know it should keep
 * relying on localStorage until the migration is applied.
 */
function isMissingTableError(error) {
    if (!error) return false;
    // Raw Postgres: 42P01 / "relation ... does not exist".
    // PostgREST (what Supabase's JS client actually talks to): PGRST205 /
    // "Could not find the table '...' in the schema cache" — PostgREST
    // caches the schema and returns its OWN error shape for an unknown
    // table rather than passing through Postgres's.
    return (
        error.code === '42P01' ||
        error.code === 'PGRST205' ||
        /relation .* does not exist/i.test(error.message || '') ||
        /could not find the table/i.test(error.message || '')
    );
}

function migrationRequiredResponse(res) {
    return res.status(501).json({
        error: "Server-side chat history isn't set up on this server yet (missing DB migration — see backend/migrations/002_account_features.sql).",
    });
}

/**
 * GET /chat/:kbId/threads
 * Returns all threads (with their messages) for this user + knowledge base.
 */
router.get('/:kbId/threads', authenticateToken, async (req, res) => {
    try {
        const { kbId } = req.params;
        const { data: threads, error: threadsError } = await supabase
            .from('chat_threads')
            .select('*')
            .eq('user_id', req.user.id)
            .eq('knowledge_base_id', kbId)
            .order('updated_at', { ascending: false });

        if (threadsError) {
            if (isMissingTableError(threadsError)) return migrationRequiredResponse(res);
            throw threadsError;
        }
        if (!threads || threads.length === 0) return res.json({ threads: [] });

        const { data: messages, error: messagesError } = await supabase
            .from('chat_messages')
            .select('*')
            .in('thread_id', threads.map((t) => t.id))
            .order('created_at', { ascending: true });
        if (messagesError) throw messagesError;

        const messagesByThread = {};
        for (const m of messages || []) {
            (messagesByThread[m.thread_id] ||= []).push({
                role: m.role,
                content: m.content,
                citations: m.citations || undefined,
            });
        }

        res.json({
            threads: threads.map((t) => ({
                id: t.id,
                title: t.title,
                createdAt: new Date(t.created_at).getTime(),
                updatedAt: new Date(t.updated_at).getTime(),
                messages: messagesByThread[t.id] || [],
            })),
        });
    } catch (err) {
        console.error('Fetch chat threads error:', err);
        res.status(500).json({ error: 'Failed to load chat history' });
    }
});

/**
 * POST /chat/:kbId/threads
 * Creates a new thread. Body: { title? }
 */
router.post('/:kbId/threads', authenticateToken, async (req, res) => {
    try {
        const { kbId } = req.params;
        const title = (req.body?.title || 'New chat').slice(0, 200);

        const { data, error } = await supabase
            .from('chat_threads')
            .insert([{ user_id: req.user.id, knowledge_base_id: kbId, title }])
            .select('*')
            .single();
        if (error) {
            if (isMissingTableError(error)) return migrationRequiredResponse(res);
            throw error;
        }

        res.status(201).json({ thread: { id: data.id, title: data.title, createdAt: new Date(data.created_at).getTime(), updatedAt: new Date(data.updated_at).getTime(), messages: [] } });
    } catch (err) {
        console.error('Create chat thread error:', err);
        res.status(500).json({ error: 'Failed to create chat thread' });
    }
});

/**
 * PATCH /chat/:kbId/threads/:threadId
 * Renames a thread. Body: { title }
 */
router.patch('/:kbId/threads/:threadId', authenticateToken, async (req, res) => {
    try {
        const { threadId } = req.params;
        const title = (req.body?.title || '').slice(0, 200);
        if (!title) return res.status(400).json({ error: 'Title is required' });

        const { error } = await supabase
            .from('chat_threads')
            .update({ title, updated_at: new Date().toISOString() })
            .eq('id', threadId)
            .eq('user_id', req.user.id);
        if (error) {
            if (isMissingTableError(error)) return migrationRequiredResponse(res);
            throw error;
        }
        res.json({ message: 'Thread renamed' });
    } catch (err) {
        console.error('Rename chat thread error:', err);
        res.status(500).json({ error: 'Failed to rename thread' });
    }
});

/**
 * DELETE /chat/:kbId/threads/:threadId
 */
router.delete('/:kbId/threads/:threadId', authenticateToken, async (req, res) => {
    try {
        const { threadId } = req.params;
        const { error } = await supabase
            .from('chat_threads')
            .delete()
            .eq('id', threadId)
            .eq('user_id', req.user.id);
        if (error) {
            if (isMissingTableError(error)) return migrationRequiredResponse(res);
            throw error;
        }
        res.json({ message: 'Thread deleted' });
    } catch (err) {
        console.error('Delete chat thread error:', err);
        res.status(500).json({ error: 'Failed to delete thread' });
    }
});

/**
 * POST /chat/:kbId/threads/:threadId/messages
 * Appends one message. Body: { role, content, citations? }
 * Also bumps the thread's updated_at (for the "most recent first" ordering
 * above) and, the first time a user message lands on a still-default-titled
 * thread, derives a short title from it — mirroring what the old
 * localStorage-only chatSlice did.
 */
router.post('/:kbId/threads/:threadId/messages', authenticateToken, async (req, res) => {
    try {
        const { threadId } = req.params;
        const { role, content, citations } = req.body || {};
        if (!role || !content) return res.status(400).json({ error: 'role and content are required' });

        // Ownership check — a thread id alone shouldn't let one user append
        // messages into another user's thread.
        const { data: thread, error: threadError } = await supabase
            .from('chat_threads')
            .select('id, title')
            .eq('id', threadId)
            .eq('user_id', req.user.id)
            .single();
        if (threadError || !thread) {
            if (isMissingTableError(threadError)) return migrationRequiredResponse(res);
            return res.status(404).json({ error: 'Thread not found' });
        }

        const { data: message, error: insertError } = await supabase
            .from('chat_messages')
            .insert([{ thread_id: threadId, role, content, citations: citations || null }])
            .select('*')
            .single();
        if (insertError) throw insertError;

        const updates = { updated_at: new Date().toISOString() };
        if (thread.title === 'New chat' && role === 'user') {
            const preview = content.trim().replace(/\s+/g, ' ');
            updates.title = preview.length > 60 ? `${preview.slice(0, 60)}…` : preview;
        }
        await supabase.from('chat_threads').update(updates).eq('id', threadId);

        res.status(201).json({ message: { role: message.role, content: message.content, citations: message.citations || undefined }, title: updates.title });
    } catch (err) {
        console.error('Add chat message error:', err);
        res.status(500).json({ error: 'Failed to save message' });
    }
});

module.exports = router;
