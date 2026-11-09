const { createClient } = require('@supabase/supabase-js');
let client;

// مفتاح الخادم يبقى داخل الخلفية، والاختبارات تستخدم التخزين المؤقت المحلي.
function getSupabase() {
  if (process.env.NODE_ENV === 'test') return null;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url && !key) return null;
  if (!url || !key) throw new Error('Set SUPABASE_URL and a Supabase server secret key.');
  if (!client)
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: (url, options = {}) =>
          fetch(url, {
            ...options,
            signal: AbortSignal.any([options.signal, AbortSignal.timeout(60000)].filter(Boolean)),
          }),
      },
    });
  return client;
}

module.exports = { getSupabase };
