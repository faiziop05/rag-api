const express = require('express');
const supabase = require('../config/supabase');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /documents
 * Returns all uploaded documents for the authenticated user,
 * grouped by knowledge_base_id and with a human-readable filename.
 */
router.get('/', authenticateToken, async (req, res) => {
    try {
        // Fetch user documents — only need the KB ID, metadata, and a couple of
        // optional columns used for real (not fabricated) dashboard stats.
        // Some deployments' `documents` table may not have `created_at`, so we
        // fall back to a minimal select rather than letting the whole request fail.
        let { data, error } = await supabase
            .from('documents')
            .select('knowledge_base_id, metadata, created_at')
            .eq('user_id', req.user.id);

        if (error) {
            ({ data, error } = await supabase
                .from('documents')
                .select('knowledge_base_id, metadata')
                .eq('user_id', req.user.id));
        }

        if (error) throw error;

        // Group by knowledge_base_id since one document has many vector chunks
        const docsMap = {};
        for (const doc of data) {
            if (!docsMap[doc.knowledge_base_id]) {
                let name = doc.metadata?.document_name || doc.metadata?.filename;
                // If name is a UUID (multer artifact), try to extract a better name from kbId
                if (!name || /^[a-f0-9]{25,}$/i.test(name.replace(/-/g, ''))) {
                    // kbId looks like: graduate_faizan_hanif_cv_pdf_0762
                    const kbId = doc.knowledge_base_id;
                    const match = kbId.match(/^(.*)_(pdf|docx|txt|md)_\d{4}$/);
                    if (match) {
                        name = `${match[1]}.${match[2]}`;
                    } else {
                        name = kbId;
                    }
                }

                const sourceFile = doc.metadata?.source_file || null;
                const sourceUrl = sourceFile
                    ? (sourceFile.startsWith('http') ? sourceFile : `http://localhost:3000/uploads/${sourceFile}`)
                    : null;

                docsMap[doc.knowledge_base_id] = {
                    id: doc.knowledge_base_id,
                    filename: name,
                    file_type: doc.metadata?.file_type || 'unknown',
                    source: doc.metadata?.source || 'uploaded',
                    source_file: sourceFile,
                    source_url: sourceUrl,
                    chunk_count: 0,
                    created_at: doc.created_at || null,
                };
            }

            // Every row is one vector chunk of the knowledge base.
            docsMap[doc.knowledge_base_id].chunk_count += 1;

            // Track the earliest chunk timestamp as the KB's "created" date.
            if (doc.created_at) {
                const existing = docsMap[doc.knowledge_base_id].created_at;
                if (!existing || doc.created_at < existing) {
                    docsMap[doc.knowledge_base_id].created_at = doc.created_at;
                }
            }
        }

        res.json(Object.values(docsMap));
    } catch (err) {
        console.error('Error fetching documents:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * DELETE /documents/:kbId
 * Deletes a document and all its vector chunks from Supabase.
 * The documents table uses ON DELETE CASCADE so related data is cleaned up automatically.
 */
router.delete('/:kbId', authenticateToken, async (req, res) => {
    try {
        const { kbId } = req.params;

        const { error } = await supabase
            .from('documents')
            .delete()
            .eq('knowledge_base_id', kbId)
            .eq('user_id', req.user.id);

        if (error) throw error;

        res.json({ message: 'Document deleted successfully', kbId });
    } catch (err) {
        console.error('Error deleting document:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
