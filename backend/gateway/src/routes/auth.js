const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');
const { JWT_SECRET } = require('../middleware/auth');
const { sendMail } = require('../utils/mailer');
const { fetchUserProfile } = require('../utils/userProfile');

const router = express.Router();

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

/**
 * Password-reset and email-verification tokens are short-lived, signed JWTs
 * rather than rows in a new DB table — this app's Supabase schema is
 * managed by hand (no migration runner), so a stateless token that needs no
 * storage or cleanup avoids requiring a schema change just for this. The
 * tradeoff (accepted here): a token stays valid for its full window and
 * can't be individually revoked early — acceptable for this app's stakes.
 */
function signActionToken(user, purpose) {
    return jwt.sign({ id: user.id, email: user.email, purpose }, JWT_SECRET, { expiresIn: '30m' });
}

function verifyActionToken(token, purpose) {
    const payload = jwt.verify(token, JWT_SECRET); // throws if invalid/expired
    if (payload.purpose !== purpose) throw new Error('Wrong token purpose');
    return payload;
}

/**
 * POST /auth/register
 * Creates a new user account and returns a signed JWT.
 */
router.post('/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        // Insert user
        const { data, error } = await supabase
            .from('users')
            .insert([{ email, password_hash: passwordHash }])
            .select('id, email, tier')
            .single();

        if (error) {
            if (error.code === '23505') return res.status(400).json({ error: 'Email already exists' });
            throw error;
        }

        // Generate JWT
        const token = jwt.sign({ id: data.id, email: data.email, tier: data.tier }, JWT_SECRET, { expiresIn: '7d' });

        // Best-effort — a failed verification email must never block registration.
        try {
            const verifyToken = signActionToken(data, 'verify_email');
            await sendMail({
                to: data.email,
                subject: 'Verify your Recall account',
                text: `Welcome to Recall! Verify your email: ${FRONTEND_URL}/verify-email?token=${verifyToken}\n\nThis link expires in 30 minutes.`,
            });
        } catch (mailErr) {
            console.error('Verification email failed (non-fatal):', mailErr.message);
        }

        const profile = await fetchUserProfile(data.id).catch(() => data);
        res.json({ token, user: profile });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * POST /auth/forgot-password
 * Always responds with the same generic message regardless of whether the
 * email exists — confirming/denying an email's existence here would let an
 * attacker enumerate registered accounts.
 */
router.post('/forgot-password', async (req, res) => {
    const GENERIC_OK = { message: 'If an account exists for that email, a reset link has been sent.' };
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        const { data: user } = await supabase.from('users').select('id, email').eq('email', email).single();
        if (user) {
            const resetToken = signActionToken(user, 'password_reset');
            await sendMail({
                to: user.email,
                subject: 'Reset your Recall password',
                text: `Reset your password: ${FRONTEND_URL}/reset-password?token=${resetToken}\n\nThis link expires in 30 minutes. If you didn't request this, ignore this email.`,
            });
        }
        res.json(GENERIC_OK);
    } catch (err) {
        console.error('Forgot-password error:', err);
        // Still generic — don't leak whether the failure was "no such user".
        res.json(GENERIC_OK);
    }
});

/**
 * POST /auth/reset-password
 * Completes a reset started by /forgot-password.
 */
router.post('/reset-password', async (req, res) => {
    try {
        const { token, new_password } = req.body;
        if (!token || !new_password) return res.status(400).json({ error: 'Token and new password are required' });
        if (new_password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

        let payload;
        try {
            payload = verifyActionToken(token, 'password_reset');
        } catch {
            return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' });
        }

        const passwordHash = await bcrypt.hash(new_password, await bcrypt.genSalt(10));
        const { error } = await supabase.from('users').update({ password_hash: passwordHash }).eq('id', payload.id);
        if (error) throw error;

        res.json({ message: 'Password updated. You can now log in with your new password.' });
    } catch (err) {
        console.error('Reset-password error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * POST /auth/send-verification
 * Re-sends the verification email (e.g. the first one expired or was lost).
 */
router.post('/send-verification', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        const { data: user } = await supabase.from('users').select('id, email').eq('email', email).single();
        if (user) {
            const verifyToken = signActionToken(user, 'verify_email');
            await sendMail({
                to: user.email,
                subject: 'Verify your Recall account',
                text: `Verify your email: ${FRONTEND_URL}/verify-email?token=${verifyToken}\n\nThis link expires in 30 minutes.`,
            });
        }
        res.json({ message: 'If an account exists for that email, a verification link has been sent.' });
    } catch (err) {
        console.error('Send-verification error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * POST /auth/verify-email
 * Completes verification started by registration or /send-verification.
 * Requires the `email_verified` column (see backend/migrations/002_account_features.sql) —
 * degrades to a clear error rather than a raw 500 if that migration hasn't run yet.
 */
router.post('/verify-email', async (req, res) => {
    try {
        const { token } = req.body;
        if (!token) return res.status(400).json({ error: 'Token is required' });

        let payload;
        try {
            payload = verifyActionToken(token, 'verify_email');
        } catch {
            return res.status(400).json({ error: 'This verification link is invalid or has expired.' });
        }

        const { error } = await supabase.from('users').update({ email_verified: true }).eq('id', payload.id);
        if (error) {
            if (/email_verified/i.test(error.message || '')) {
                return res.status(501).json({ error: 'Email verification isn\'t set up on this server yet (missing DB migration).' });
            }
            throw error;
        }

        res.json({ message: 'Email verified.' });
    } catch (err) {
        console.error('Verify-email error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * POST /auth/login
 * Validates credentials and returns a signed JWT.
 */
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();

        if (error || !user) return res.status(400).json({ error: 'Invalid credentials' });

        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) return res.status(400).json({ error: 'Invalid credentials' });

        const token = jwt.sign({ id: user.id, email: user.email, tier: user.tier }, JWT_SECRET, { expiresIn: '7d' });
        const { password_hash, ...safeUser } = user; // never send the hash to the client

        res.json({ token, user: safeUser });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
