const supabase = require('../config/supabase');

// Present once backend/migrations/002_account_features.sql has been run.
// Every column here is optional — every call site falls back to the base
// set below if these aren't present yet, so the app keeps working before
// that migration runs (just without name/verification/theme/notifications).
const EXTENDED_COLUMNS = ['name', 'email_verified', 'notifications_enabled', 'theme'];
const BASE_COLUMNS = ['id', 'email', 'tier', 'created_at'];

function isMissingColumnError(error) {
    if (!error) return false;
    // Raw Postgres: 42703 / "column ... does not exist". PostgREST (what
    // Supabase's JS client actually talks to) instead returns its own
    // schema-cache-miss shape — PGRST204 for updates, PGRST205-adjacent
    // wording for selects — rather than passing the Postgres error through.
    return (
        error.code === '42703' ||
        error.code === 'PGRST204' ||
        /column .* does not exist/i.test(error.message || '') ||
        /could not find the .* column/i.test(error.message || '')
    );
}

/**
 * Re-selects a user row with the extended profile columns, falling back to
 * the base columns if the migration adding them hasn't been run yet. Used
 * after register/login so the client always gets whatever profile fields
 * are actually available, without every call site duplicating this
 * try/fallback dance.
 */
async function fetchUserProfile(id) {
    let { data, error } = await supabase
        .from('users')
        .select([...BASE_COLUMNS, ...EXTENDED_COLUMNS].join(','))
        .eq('id', id)
        .single();

    if (error && isMissingColumnError(error)) {
        ({ data, error } = await supabase.from('users').select(BASE_COLUMNS.join(',')).eq('id', id).single());
    }
    if (error) throw error;
    return data;
}

module.exports = { fetchUserProfile, isMissingColumnError, EXTENDED_COLUMNS, BASE_COLUMNS };
