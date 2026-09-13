require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const apiKeysRoutes = require('./routes/apiKeys');
const ingestRoutes = require('./routes/ingest');
const queryRoutes = require('./routes/query');
const documentsRoutes = require('./routes/documents');
const accountRoutes = require('./routes/account');
const chatRoutes = require('./routes/chat');
const { startIngestionNotifier } = require('./services/ingestionNotifier');

const app = express();
const port = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/auth', authRoutes);
app.use('/api-keys', apiKeysRoutes);
app.use('/ingest', ingestRoutes);
app.use('/query', queryRoutes);
app.use('/documents', documentsRoutes);
app.use('/account', accountRoutes);
app.use('/chat', chatRoutes);

// ── Healthcheck ───────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.listen(port, () => {
    console.log(`API Gateway running on port ${port}`);
});

startIngestionNotifier();
