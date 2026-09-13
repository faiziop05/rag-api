const { createClient } = require('@supabase/supabase-js');

/**
 * Shared Supabase client singleton for the gateway.
 * All route files import from here instead of calling createClient() themselves.
 */
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

module.exports = supabase;
