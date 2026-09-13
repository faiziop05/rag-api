const { QueueEvents } = require('bullmq');
const { connection, ingestQueue } = require('../config/redis');
const supabase = require('../config/supabase');
const { sendMail } = require('../utils/mailer');

/**
 * Makes the Settings page's "Email Notifications" toggle actually do
 * something: previously it was inert local state with no notification
 * system behind it anywhere in the app. Ingestion completing/failing is
 * the one event this app already tracks server-side (the BullMQ
 * 'ingestion' queue), so it's the natural first real notification —
 * listens for job completion/failure and emails the document's owner,
 * unless they've turned notifications off.
 *
 * Reads `notifications_enabled` best-effort: if the column doesn't exist
 * yet (migration not run), defaults to sending — a user who never saw the
 * toggle can't have meaningfully opted out of it.
 */
function startIngestionNotifier() {
    const queueEvents = new QueueEvents('ingestion', { connection });

    async function notify(jobId, { failed, reason } = {}) {
        try {
            const job = await ingestQueue.getJob(jobId);
            if (!job) return;
            const { user_id, originalName, knowledge_base_id } = job.data || {};
            if (!user_id) return;

            const { data: user, error } = await supabase
                .from('users')
                .select('email, notifications_enabled')
                .eq('id', user_id)
                .single();
            if (error || !user) return;
            if (user.notifications_enabled === false) return; // explicit opt-out only

            const name = originalName || knowledge_base_id || 'Your document';
            if (failed) {
                await sendMail({
                    to: user.email,
                    subject: `Failed to process "${name}"`,
                    text: `We couldn't finish processing "${name}".\n\nReason: ${reason || 'Unknown error'}\n\nYou can try re-uploading it.`,
                });
            } else {
                await sendMail({
                    to: user.email,
                    subject: `"${name}" is ready`,
                    text: `"${name}" has finished processing and is ready to chat with in Recall.`,
                });
            }
        } catch (err) {
            console.error('Ingestion notification failed (non-fatal):', err.message);
        }
    }

    queueEvents.on('completed', ({ jobId }) => notify(jobId));
    queueEvents.on('failed', ({ jobId, failedReason }) => notify(jobId, { failed: true, reason: failedReason }));

    return queueEvents;
}

module.exports = { startIngestionNotifier };
