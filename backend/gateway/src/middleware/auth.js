const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-saas-key';

/**
 * Express middleware that authenticates a request via either:
 *   - A JWT bearer token (issued by /auth/login or /auth/register)
 *   - An API key (prefixed with "sk_", stored in the api_keys table)
 *
 * On success, attaches `req.user = { id, tier, is_api_key? }` and calls next().
 * On failure, responds with 401/403/500.
 */
const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    // --- API Key path (starts with sk_) ---
    if (token.startsWith('sk_')) {
        try {
            const { data: apiKey, error } = await supabase
                .from('api_keys')
                .select('user_id, requests_count, users(tier)')
                .eq('key_value', token)
                .single();

            if (error || !apiKey) return res.status(401).json({ error: 'Invalid API Key' });

            // Increment request count
            await supabase
                .from('api_keys')
                .update({ requests_count: (apiKey.requests_count || 0) + 1 })
                .eq('key_value', token);

            req.user = { id: apiKey.user_id, tier: apiKey.users?.tier || 'free', is_api_key: true };
            return next();
        } catch (e) {
            return res.status(500).json({ error: 'Server error validating API key' });
        }
    }

    // --- JWT path ---
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Forbidden' });
        req.user = user;
        next();
    });
};

module.exports = { authenticateToken, JWT_SECRET };
