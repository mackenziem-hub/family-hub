// Family Hub - Supabase service client.
// .trim() every env read: Vercel can append a trailing newline, which breaks auth.
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_KEY || '').trim();

// Service client - bypasses RLS. The server is the only DB client; auth is the
// session gate on each handler, so we never ship a client-side anon key.
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export const supabaseConfigured = Boolean(supabaseUrl && supabaseServiceKey);
