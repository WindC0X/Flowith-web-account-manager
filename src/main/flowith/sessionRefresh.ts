import type { Session as SupabaseSession } from "@supabase/supabase-js";
import { getRefreshToken, setRefreshToken } from "../accounts/vault";
import { getFlowithSupabaseClient } from "./supabase";

const inFlightByAccountId = new Map<string, Promise<SupabaseSession>>();

function isAlreadyUsedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /already used/i.test(error.message);
}

async function refreshWithToken(accountId: string, refreshToken: string): Promise<SupabaseSession> {
  const supabase = getFlowithSupabaseClient();
  const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
  if (error) throw error;
  if (!data?.session) throw new Error("Supabase refresh returned no session.");

  if (data.session.refresh_token) {
    setRefreshToken(accountId, data.session.refresh_token);
  }

  return data.session;
}

export async function refreshFlowithSessionForAccount(accountId: string): Promise<SupabaseSession> {
  const existing = inFlightByAccountId.get(accountId);
  if (existing) return existing;

  const task = (async () => {
    const refreshToken = getRefreshToken(accountId);
    if (!refreshToken) {
      throw new Error("No refresh_token available for this account. Import token first.");
    }

    try {
      return await refreshWithToken(accountId, refreshToken);
    } catch (e) {
      if (!isAlreadyUsedError(e)) throw e;

      const nextToken = getRefreshToken(accountId);
      if (!nextToken || nextToken === refreshToken) throw e;

      return await refreshWithToken(accountId, nextToken);
    }
  })();

  inFlightByAccountId.set(accountId, task);
  try {
    return await task;
  } finally {
    inFlightByAccountId.delete(accountId);
  }
}

