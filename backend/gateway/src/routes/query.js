const express = require('express');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /query
 * Executes hybrid retrieval (Vector + Keyword) and generates an evidence-backed answer.
 * Proxies the request to the Python worker's FastAPI inference server.
 */
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { knowledge_base_id, query, history = [] } = req.body;
        const user_id = req.user.id;

        if (!knowledge_base_id || !query) {
            return res.status(400).json({ error: 'knowledge_base_id and query are required' });
        }

        const pythonInferenceUrl = process.env.PYTHON_WORKER_URL || 'http://127.0.0.1:8000/query';
        const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

        const pythonResponse = await fetch(pythonInferenceUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ knowledge_base_id, query, history, user_id })
        });

        const data = await pythonResponse.json().catch(() => ({}));

        if (!pythonResponse.ok) {
            // Pass the worker's actual status through instead of collapsing
            // everything into a generic 500 — a 403 (access denied) is a
            // real, expected outcome (see api/router.py's ownership check),
            // not a server error, and reporting it as one hides what
            // actually happened from both the client and anyone debugging.
            console.error(`Query error: Python worker responded ${pythonResponse.status}`, data);
            return res.status(pythonResponse.status).json({ error: data.detail || data.error || 'Query failed' });
        }

        res.status(200).json(data);
    } catch (error) {
        console.error('Query error:', error);
        res.status(500).json({ error: 'Internal server error processing query' });
    }
});

module.exports = router;
