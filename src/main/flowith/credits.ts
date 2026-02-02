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

export class CreditsRateLimitedError extends Error {
  retryAfterMs: number;
  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = "CreditsRateLimitedError";
    this.retryAfterMs = Math.max(0, Math.round(retryAfterMs));
  }
}

function toAuthorizationHeader(accessToken: string): string {
  const token = accessToken.trim();
  if (!token) return "";
  if (token.toLowerCase().startsWith("bearer ")) return token;
  return `Bearer ${token}`;
}

const inFlightByAccountId = new Map<string, Promise<AccountCredits>>();
const rateLimitedUntilByAccountId = new Map<string, number>();
const rateLimitBackoffMsByAccountId = new Map<string, number>();

function parseRetryAfterMs(headers: Headers): number | null {
  const raw = headers.get("retry-after");
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));

  const asDate = Date.parse(value);
  if (Number.isFinite(asDate)) return Math.max(0, asDate - Date.now());

  return null;
}

function nextBackoffMs(accountId: string): number {
  const prev = rateLimitBackoffMsByAccountId.get(accountId) ?? 0;
  const base = prev > 0 ? Math.min(prev * 2, 5 * 60_000) : 15_000;
  const jitter = Math.floor(Math.random() * 800);
  const next = base + jitter;
  rateLimitBackoffMsByAccountId.set(accountId, base);
  return next;
}

async function fetchAccountCreditsWithAuthHeaderNetwork(accountId: string, authHeader: string): Promise<AccountCredits> {
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
    if (res.status === 429) {
      const retryAfter = parseRetryAfterMs(res.headers) ?? nextBackoffMs(accountId);
      const until = Date.now() + retryAfter;
      rateLimitedUntilByAccountId.set(accountId, until);
      const seconds = Math.max(1, Math.ceil(retryAfter / 1000));
      throw new CreditsRateLimitedError(`Rate limited (429). Retry after ${seconds}s.`, retryAfter);
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
    rateLimitBackoffMsByAccountId.delete(accountId);
    return { ...parsed, fetchedAt: Date.now() };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchAccountCreditsWithAuthHeader(accountId: string, authHeader: string): Promise<AccountCredits> {
  const until = rateLimitedUntilByAccountId.get(accountId) ?? 0;
  if (until > Date.now()) {
    const remaining = until - Date.now();
    const seconds = Math.max(1, Math.ceil(remaining / 1000));
    throw new CreditsRateLimitedError(`Rate limited (429). Retry after ${seconds}s.`, remaining);
  }

  const existing = inFlightByAccountId.get(accountId);
  if (existing) return existing;

  const task = (async () => {
    try {
      return await fetchAccountCreditsWithAuthHeaderNetwork(accountId, authHeader);
    } finally {
      inFlightByAccountId.delete(accountId);
    }
  })();

  inFlightByAccountId.set(accountId, task);
  return await task;
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
