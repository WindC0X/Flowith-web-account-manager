import { session } from "electron";
import type { AccountCredits } from "../../shared/ipc";
import { getAccount } from "../accounts/vault";
import { applyProxy } from "../network/proxy";
import { partitionForAccount } from "../workspace/WebWorkspaceService";
import { parseUserCreditsResponse } from "./creditsParsing";
import { refreshFlowithSessionForAccount } from "./sessionRefresh";

const FLOWITH_EDGE_CREDITS_URL = "https://edge.flowith.net/user/credits";

export class CreditsUnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreditsUnauthorizedError";
  }
}

function toAuthorizationHeader(accessToken: string): string {
  const token = accessToken.trim();
  if (!token) return "";
  if (token.toLowerCase().startsWith("bearer ")) return token;
  return `Bearer ${token}`;
}

async function fetchAccountCreditsWithAuthHeader(accountId: string, authHeader: string): Promise<AccountCredits> {
  if (!authHeader.trim()) throw new Error("Missing Authorization header.");

  const account = getAccount(accountId);
  if (!account) throw new Error("Account not found.");

  const ses = session.fromPartition(partitionForAccount(accountId));
  await applyProxy(ses, account.net.proxy ?? { mode: "system" });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await ses.fetch(FLOWITH_EDGE_CREDITS_URL, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: authHeader,
      },
      signal: controller.signal,
    });

    if (res.status === 401 || res.status === 403) {
      throw new CreditsUnauthorizedError("Unauthorized (401/403). Access token may be invalid or expired.");
    }
    if (!res.ok) {
      throw new Error(`Credits request failed: HTTP ${res.status}.`);
    }

    const text = await res.text();
    if (text.length > 1_000_000) throw new Error("Credits response too large.");

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("Credits response is not valid JSON.");
    }

    const parsed = parseUserCreditsResponse(payload);
    return { ...parsed, fetchedAt: Date.now() };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchAccountCreditsWithAccessToken(accountId: string, accessToken: string): Promise<AccountCredits> {
  const auth = toAuthorizationHeader(accessToken);
  if (!auth) throw new Error("Supabase session returned no access_token.");
  return await fetchAccountCreditsWithAuthHeader(accountId, auth);
}

export async function refreshAccountCredits(
  accountId: string,
  options?: { onAlreadyUsed?: () => Promise<void> }
): Promise<AccountCredits> {
  const flowithSession = await refreshFlowithSessionForAccount(
    accountId,
    options?.onAlreadyUsed ? { onAlreadyUsed: options.onAlreadyUsed } : undefined
  );
  return await fetchAccountCreditsWithAccessToken(accountId, flowithSession.access_token ?? "");
}
