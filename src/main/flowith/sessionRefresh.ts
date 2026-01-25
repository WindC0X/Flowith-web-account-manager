import type { Session as SupabaseSession } from "@supabase/supabase-js";
import { getRefreshToken, setRefreshToken } from "../accounts/vault";
import { getFlowithSupabaseClient } from "./supabase";

const inFlightByAccountId = new Map<string, Promise<SupabaseSession>>();
const usedRefreshTokensByAccountId = new Map<string, string[]>();

function isAlreadyUsedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /already used/i.test(error.message);
}

function markRefreshTokenUsed(accountId: string, refreshToken: string) {
  const normalized = refreshToken.trim();
  if (!normalized) return;

  const existing = usedRefreshTokensByAccountId.get(accountId) ?? [];
  if (existing.includes(normalized)) return;

  existing.unshift(normalized);
  if (existing.length > 8) existing.length = 8;
  usedRefreshTokensByAccountId.set(accountId, existing);
}

export function isKnownUsedRefreshToken(accountId: string, refreshToken: string): boolean {
  const normalized = refreshToken.trim();
  if (!normalized) return false;
  const existing = usedRefreshTokensByAccountId.get(accountId);
  if (!existing) return false;
  return existing.includes(normalized);
}

async function refreshWithToken(accountId: string, refreshToken: string): Promise<SupabaseSession> {
  const supabase = getFlowithSupabaseClient();
  const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
  if (error) throw error;
  if (!data?.session) throw new Error("Supabase refresh returned no session.");

  if (data.session.refresh_token) {
    setRefreshToken(accountId, data.session.refresh_token);
    if (data.session.refresh_token !== refreshToken) {
      markRefreshTokenUsed(accountId, refreshToken);
    }
  }

  return data.session;
}

export async function refreshFlowithSessionForAccount(
  accountId: string,
  options?: { onAlreadyUsed?: () => Promise<void> }
): Promise<SupabaseSession> {
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
      markRefreshTokenUsed(accountId, refreshToken);

      try {
        await options?.onAlreadyUsed?.();
      } catch {
        // best-effort
      }

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
