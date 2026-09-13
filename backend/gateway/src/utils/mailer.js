const nodemailer = require('nodemailer');

/**
 * Lazily builds an SMTP transport from env vars (SMTP_HOST, SMTP_PORT,
 * SMTP_USER, SMTP_PASS, SMTP_FROM). No SMTP provider is configured out of
 * the box — rather than hard-failing every flow that needs to send an
 * email (password reset, email verification, ingestion-complete
 * notifications), sendMail() below falls back to logging the email to the
 * console when SMTP isn't configured, so the app stays fully usable in
 * dev/without-a-mail-provider setups. Wire up real SMTP_* env vars in
 * production to actually deliver these.
 */
let transport = null;
let transportAttempted = false;

function getTransport() {
    if (transportAttempted) return transport;
    transportAttempted = true;
    if (!process.env.SMTP_HOST) return null;
    transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            : undefined,
    });
    return transport;
}

/**
 * Sends an email, or — if no SMTP_HOST is configured — logs it to the
 * console so the link/code inside it is still usable during development.
 * Never throws: a failed/unavailable mail send should never break the
 * calling request (registration, password reset, etc. all still succeed).
 */
async function sendMail({ to, subject, text, html }) {
    const t = getTransport();
    if (!t) {
        console.log(`\n[mailer] SMTP not configured — logging email instead of sending it.`);
        console.log(`[mailer] To: ${to}\n[mailer] Subject: ${subject}\n[mailer] Body:\n${text}\n`);
        return { delivered: false };
    }
    try {
        await t.sendMail({
            from: process.env.SMTP_FROM || 'Recall <no-reply@recall.local>',
            to,
            subject,
            text,
            html,
        });
        return { delivered: true };
    } catch (err) {
        console.error('[mailer] Failed to send email:', err.message);
        console.log(`[mailer] (undelivered) To: ${to}\nSubject: ${subject}\n${text}`);
        return { delivered: false };
    }
}

module.exports = { sendMail };
