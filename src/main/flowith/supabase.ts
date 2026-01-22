import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function getFlowithSupabaseClient(): SupabaseClient {
  const url = process.env.FLOWITH_SUPABASE_URL;
  const anonKey = process.env.FLOWITH_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Supabase config is missing. Set FLOWITH_SUPABASE_URL and FLOWITH_SUPABASE_ANON_KEY."
    );
  }

  if (!client) {
    client = createClient(url, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }

  return client;
}

