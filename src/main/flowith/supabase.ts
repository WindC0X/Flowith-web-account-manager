import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

const DEFAULT_FLOWITH_SUPABASE_URL = "https://aibdxsebwhalbnugsqel.supabase.co";
const DEFAULT_FLOWITH_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFpYmR4c2Vid2hhbGJudWdzcWVsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDQ0Mjk4NDksImV4cCI6MjAyMDAwNTg0OX0.FZz_aYXHu7YA_TljWyvSylrqaMBF1dGhkV-ZD01QyYI";

export function resolveFlowithSupabaseConfig(): { url: string; anonKey: string; projectRef: string } {
  const url = process.env.FLOWITH_SUPABASE_URL || DEFAULT_FLOWITH_SUPABASE_URL;
  const anonKey = process.env.FLOWITH_SUPABASE_ANON_KEY || DEFAULT_FLOWITH_SUPABASE_ANON_KEY;

  let projectRef = "";
  try {
    const host = new URL(url).host;
    projectRef = host.split(".")[0] || "";
  } catch {
    throw new Error("Invalid FLOWITH_SUPABASE_URL.");
  }

  if (!projectRef) {
    throw new Error("Invalid FLOWITH_SUPABASE_URL.");
  }

  return { url, anonKey, projectRef };
}

export function getFlowithSupabaseClient(): SupabaseClient {
  const { url, anonKey } = resolveFlowithSupabaseConfig();

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
