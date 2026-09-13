const express = require('express');
const crypto = require('crypto');
const supabase = require('../config/supabase');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

const NAME_MAX_LENGTH = 60;

/**
 * Masks a secret key for display everywhere EXCEPT the one response right
 * after creation: "sk_" + first 4 chars visible, a fixed run of dots, then
 * the last 4 chars — enough for a user to recognize which key is which
 * without the full secret ever being retrievable again after creation.
 */
function maskKey(keyValue) {
    if (!keyValue || keyValue.length < 12) return '****';
    return `${keyValue.slice(0, 7)}••••••••••••${keyValue.slice(-4)}`;
}

/**
 * GET /api-keys
 * Returns all API keys belonging to the authenticated user, newest first.
 * The secret value is ALWAYS masked here — the full key is only ever
 * returned once, in the POST response at creation time. Returning the raw
 * secret on every subsequent fetch would mean anyone with read access to a
 * response (logs, browser history, a shoulder-surf) could reuse it forever.
 */
router.get('/', authenticateToken, async (req, res) => {
    try {
        let { data, error } = await supabase
            .from('api_keys')
            .select('*')
            .eq('user_id', req.user.id)
            .order('created_at', { ascending: false });

        // Older deployments of this table may not have a created_at column —
        // fall back to unordered rather than hard-failing the whole endpoint.
        if (error && /created_at/i.test(error.message || '')) {
            ({ data, error } = await supabase.from('api_keys').select('*').eq('user_id', req.user.id));
        }

        if (error) throw error;
        const apiKeys = (data || []).map((k) => ({
            ...k,
            key_value: maskKey(k.key_value),
        }));
        res.json({ apiKeys });
    } catch (err) {
        console.error('API Keys fetch error:', err);
        res.status(500).json({ error: 'Failed to load API keys. Please try again.' });
    }
});

/**
 * POST /api-keys
 * Generates a new sk_* API key for the authenticated user. The response is
 * the ONLY time the full, unmasked key is ever sent back — the frontend
 * must show it in a one-time "copy it now" reveal, since every later GET
 * will only ever see the masked form.
 */
router.post('/', authenticateToken, async (req, res) => {
    try {
        const name = (req.body?.name || '').trim();
        if (!name) return res.status(400).json({ error: 'Name is required' });
        if (name.length > NAME_MAX_LENGTH) {
            return res.status(400).json({ error: `Name must be ${NAME_MAX_LENGTH} characters or fewer` });
        }

        const keyValue = 'sk_' + crypto.randomBytes(24).toString('hex');

        const { data, error } = await supabase
            .from('api_keys')
            .insert([{ user_id: req.user.id, key_value: keyValue, name }])
            .select('*')
            .single();

        if (error) throw error;
        res.status(201).json({ apiKey: data });
    } catch (err) {
        console.error('API Key generation error:', err);
        res.status(500).json({ error: 'Failed to create API key. Please try again.' });
    }
});

/**
 * DELETE /api-keys/:id
 * Revokes (permanently deletes) an API key owned by the authenticated user.
 */
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabase
            .from('api_keys')
            .delete()
            .eq('id', id)
            .eq('user_id', req.user.id)
            .select('id');

        if (error) throw error;
        if (!data || data.length === 0) {
            return res.status(404).json({ error: 'API key not found' });
        }
        res.json({ success: true });
    } catch (err) {
        console.error('API Key deletion error:', err);
        res.status(500).json({ error: 'Failed to revoke API key. Please try again.' });
    }
});

module.exports = router;
