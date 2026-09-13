const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const supabase = require('../config/supabase');
const { authenticateToken } = require('../middleware/auth');
const { fetchUserProfile, isMissingColumnError } = require('../utils/userProfile');

const router = express.Router();

const uploadsDir = path.join(__dirname, '../../uploads');

/**
 * GET /account/me
 * Returns the authenticated user's full profile (name, verification state,
 * theme/notification preferences where the migration adding them has run).
 */
router.get('/me', authenticateToken, async (req, res) => {
    try {
        const profile = await fetchUserProfile(req.user.id);
        res.json({ user: profile });
    } catch (err) {
        console.error('Fetch profile error:', err);
        res.status(500).json({ error: 'Failed to load profile' });
    }
});

/**
 * PATCH /account/profile
 * Updates whichever of {name, theme, notifications_enabled} are provided.
 * Requires backend/migrations/002_account_features.sql — returns a clear
 * 501 (not a raw 500) if that hasn't been run yet, so the frontend can
 * show something more useful than "server error".
 */
router.patch('/profile', authenticateToken, async (req, res) => {
    try {
        const updates = {};
        if (typeof req.body.name === 'string') {
            const trimmed = req.body.name.trim();
            if (trimmed.length > 100) return res.status(400).json({ error: 'Name must be 100 characters or fewer' });
            updates.name = trimmed || null;
        }
        if (typeof req.body.theme === 'string') {
            if (!['dark', 'light'].includes(req.body.theme)) {
                return res.status(400).json({ error: "Theme must be 'dark' or 'light'" });
            }
            updates.theme = req.body.theme;
        }
        if (typeof req.body.notifications_enabled === 'boolean') {
            updates.notifications_enabled = req.body.notifications_enabled;
        }
        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'Nothing to update' });
        }

        const { data, error } = await supabase.from('users').update(updates).eq('id', req.user.id).select('*').single();
        if (error) {
            if (isMissingColumnError(error)) {
                return res.status(501).json({ error: 'Profile fields aren\'t set up on this server yet (missing DB migration — see backend/migrations/002_account_features.sql).' });
            }
            throw error;
        }

        const { password_hash, ...safeUser } = data;
        res.json({ user: safeUser });
    } catch (err) {
        console.error('Update profile error:', err);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

/**
 * PATCH /account/password
 * Changes the authenticated user's password. Requires the CURRENT password
 * — without this, anyone who grabs a still-valid JWT (e.g. from an
 * unlocked device) could lock the real owner out permanently.
 */
router.patch('/password', authenticateToken, async (req, res) => {
    try {
        const { current_password, new_password } = req.body;
        if (!current_password || !new_password) {
            return res.status(400).json({ error: 'Current and new password are required' });
        }
        if (new_password.length < 8) {
            return res.status(400).json({ error: 'New password must be at least 8 characters' });
        }

        const { data: user, error: fetchError } = await supabase
            .from('users')
            .select('id, password_hash')
            .eq('id', req.user.id)
            .single();
        if (fetchError || !user) return res.status(404).json({ error: 'User not found' });

        const isMatch = await bcrypt.compare(current_password, user.password_hash);
        if (!isMatch) return res.status(401).json({ error: 'Current password is incorrect' });

        const newHash = await bcrypt.hash(new_password, await bcrypt.genSalt(10));
        const { error: updateError } = await supabase.from('users').update({ password_hash: newHash }).eq('id', req.user.id);
        if (updateError) throw updateError;

        res.json({ message: 'Password updated successfully' });
    } catch (err) {
        console.error('Change password error:', err);
        res.status(500).json({ error: 'Failed to update password' });
    }
});

/**
 * DELETE /account
 * Permanently deletes the authenticated user's account and everything
 * that belongs to them: API keys, document chunks/embeddings, chat
 * history, and uploaded files on disk — then the user row itself. Requires
 * the current password as confirmation, since this is irreversible.
 *
 * Order matters: delete dependent data (api_keys, documents, chat_*)
 * BEFORE the users row, since chat_threads has an ON DELETE CASCADE FK to
 * users but api_keys/documents do not — deleting users first would leave
 * those orphaned (or fail, depending on FK setup) rather than cleaning up.
 */
router.delete('/', authenticateToken, async (req, res) => {
    try {
        const { password } = req.body;
        if (!password) return res.status(400).json({ error: 'Password confirmation is required' });

        const { data: user, error: fetchError } = await supabase
            .from('users')
            .select('id, password_hash')
            .eq('id', req.user.id)
            .single();
        if (fetchError || !user) return res.status(404).json({ error: 'User not found' });

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) return res.status(401).json({ error: 'Incorrect password' });

        const userId = req.user.id;

        // Best-effort disk cleanup of this user's uploaded files/images —
        // never let a filesystem hiccup block the actual data deletion below.
        try {
            const { data: docs } = await supabase.from('documents').select('metadata').eq('user_id', userId);
            for (const doc of docs || []) {
                const sourceFile = doc.metadata?.source_file;
                if (sourceFile) {
                    const p = path.join(uploadsDir, sourceFile);
                    if (fs.existsSync(p)) fs.unlinkSync(p);
                }
                const imageUrl = doc.metadata?.image_url;
                if (imageUrl) {
                    const imgName = imageUrl.split('/').pop();
                    const imgPath = path.join(uploadsDir, 'images', imgName);
                    if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
                }
            }
        } catch (fileErr) {
            console.error('Account deletion: file cleanup failed (non-fatal):', fileErr.message);
        }

        await supabase.from('api_keys').delete().eq('user_id', userId);
        await supabase.from('documents').delete().eq('user_id', userId);
        // Best-effort — this table may not exist in every deployment (see
        // api/router.py's own optional handling of it).
        await supabase.from('knowledge_bases').delete().eq('user_id', userId).then(null, () => {});
        // chat_threads cascades to chat_messages via its own FK; best-effort
        // since this table only exists once the migration below has run.
        await supabase.from('chat_threads').delete().eq('user_id', userId).then(null, () => {});

        const { error: deleteUserError } = await supabase.from('users').delete().eq('id', userId);
        if (deleteUserError) throw deleteUserError;

        res.json({ message: 'Account deleted' });
    } catch (err) {
        console.error('Account deletion error:', err);
        res.status(500).json({ error: 'Failed to delete account' });
    }
});

module.exports = router;
