import type {
  BeforeSendResponse,
  Cookie,
  OnBeforeSendHeadersListenerDetails,
  OnCompletedListenerDetails,
  WebContents,
  Session as ElectronSession,
} from "electron";
import type { Session } from "@supabase/supabase-js";
import { resolveFlowithSupabaseConfig } from "../flowith/supabase";
import { getRefreshToken, setRefreshToken } from "../accounts/vault";
import { isKnownUsedRefreshToken, refreshFlowithSessionForAccount } from "../flowith/sessionRefresh";
import { redactSensitive } from "../security/redact";
import type { WebWorkspaceService } from "./WebWorkspaceService";
import { extractSupabaseSessionSnapshotFromStorageValue, type SupabaseSessionSnapshot } from "./supabaseAuthStorage";

const FLOWITH_WEB_TARGET_HOSTS = ["flowith.io", "flowith.net", "flo.ing"] as const;

function isFlowithUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") return false;
    return FLOWITH_WEB_TARGET_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

function storageKeysFromSupabaseUrl(): string[] {
  const { projectRef } = resolveFlowithSupabaseConfig();
  return [
    `sb-${projectRef}-auth-token`,
    `sb-${projectRef}-all-auth-token`,
    "sb-server-auth-token",
    "supabase.auth.token",
  ];
}

const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function safeDecodeCookieValue(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const candidates: string[] = [trimmed];
  try {
    const decoded = decodeURIComponent(trimmed);
    if (decoded && decoded !== trimmed) candidates.push(decoded);
  } catch {
    // ignore
  }

  if (/^[A-Za-z0-9+/=]{32,}$/.test(trimmed)) {
    try {
      const decoded = Buffer.from(trimmed, "base64").toString("utf-8").trim();
      if (decoded) candidates.push(decoded);
    } catch {
      // ignore
    }
  }

  return [...new Set(candidates)];
}

function supabaseHostFromConfig(): string {
  const { url } = resolveFlowithSupabaseConfig();
  try {
    return new URL(url).hostname;
  } catch {
    throw new Error("Invalid FLOWITH_SUPABASE_URL.");
  }
}

async function waitForFlowithReady(webContents: WebContents, timeoutMs: number) {
  const isDocumentOnFlowith = async (): Promise<boolean> => {
    try {
      const href = (await webContents.executeJavaScript("location.href", true)) as unknown;
      if (typeof href !== "string") return false;
      return isFlowithUrl(href);
    } catch {
      return false;
    }
  };

  if (await isDocumentOnFlowith()) return;

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timeout waiting for Flowith Web to load."));
    }, timeoutMs);

    const onFinish = () => {
      void (async () => {
        if (!(await isDocumentOnFlowith())) return;
        cleanup();
        resolve();
      })();
    };

    const cleanup = () => {
      clearTimeout(timeout);
      webContents.removeListener("did-finish-load", onFinish);
    };

    webContents.on("did-finish-load", onFinish);
  });
}

async function injectSupabaseSession(webContents: WebContents, session: Session) {
  const keys = storageKeysFromSupabaseUrl();
  const value = JSON.stringify(session);

  const script = `
	    (() => {
	      const keys = ${JSON.stringify(keys)};
	      const payload = ${JSON.stringify(value)};
	      const report = { local: {}, session: {}, meta: {} };
	      try {
	        report.meta = {
	          href: location && typeof location.href === "string" ? location.href.split("?")[0] : "",
	          readyState: document && typeof document.readyState === "string" ? document.readyState : "",
	        };
	      } catch {
	        report.meta = {};
	      }
	      try {
	        for (const k of keys) {
	          try {
	            localStorage.setItem(k, payload);
	            report.local[k] = localStorage.getItem(k) === payload;
	          } catch {
            report.local[k] = false;
          }
          try {
            sessionStorage.setItem(k, payload);
            report.session[k] = sessionStorage.getItem(k) === payload;
          } catch {
            report.session[k] = false;
          }
        }
	        try { localStorage.removeItem("userHasLoggedOut"); } catch {}
	        try { sessionStorage.removeItem("userHasLoggedOut"); } catch {}
	        return { ok: true, report };
	      } catch (e) {
	        return { ok: false, error: e && e.message ? String(e.message) : String(e) };
      }
    })();
  `;

  const result = (await webContents.executeJavaScript(script, true)) as
    | {
        ok: true;
        report?: {
          local: Record<string, boolean>;
          session: Record<string, boolean>;
          meta?: { href?: string; readyState?: string };
        };
      }
    | { ok: false; error?: string }
    | undefined;

  if (!result || result.ok !== true) {
    throw new Error(`Failed to inject session: ${redactSensitive(result?.error ?? "unknown")}`);
  }

  const report = result.report;
  const anyOk =
    !!report &&
    (Object.values(report.local ?? {}).some(Boolean) || Object.values(report.session ?? {}).some(Boolean));
  if (!anyOk) {
    const meta = report?.meta;
    const hint =
      meta?.href || meta?.readyState ? ` (href=${meta?.href ?? ""} readyState=${meta?.readyState ?? ""})` : "";
    throw new Error(`Failed to inject session: storage write failed.${hint}`);
  }
}

function isAlreadyUsedError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === "string") return /already used/i.test(error);
  if (error instanceof Error) return /already used/i.test(error.message);
  if (typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return /already used/i.test(message);
  }
  return false;
}

export class FlowithLoginBootstrapService {
  private workspace: WebWorkspaceService;
  private headerInjection = new Map<string, { setAccessToken: (token: string) => void }>();
  private tokenSync = new Map<string, { stop: () => void }>();
  private refreshTokenWriteDeadlines = new Map<string, number>();

  constructor(workspace: WebWorkspaceService) {
    this.workspace = workspace;
  }

	  private async readSupabaseAuthStorageValues(
	    webContents: WebContents
	  ): Promise<Array<{ storage: "local" | "session"; key: string; value: string }> | null> {
    if (webContents.isDestroyed()) return null;

    let href: unknown;
    try {
      href = await webContents.executeJavaScript("location.href", true);
    } catch {
      return null;
    }
    if (typeof href !== "string" || !isFlowithUrl(href)) return null;

    const keys = storageKeysFromSupabaseUrl();
    const script = `
		  (() => {
		    const keys = ${JSON.stringify(keys)};
		    const values = [];
		    const read = (storage, name) => {
		      for (const k of keys) {
		        try {
		          const v = storage.getItem(k);
		          if (typeof v === "string" && v.trim()) values.push({ storage: name, key: k, value: v });
		        } catch {
		          // ignore
		        }
		      }
		    };
		    try { read(localStorage, "local"); } catch {}
		    try { read(sessionStorage, "session"); } catch {}
		    return { ok: true, values };
		  })();
		`;

    const result = (await webContents.executeJavaScript(script, true)) as
      | { ok: true; values?: Array<{ storage: "local" | "session"; key: string; value: string }> }
      | { ok: false; error?: string }
      | undefined;

	    if (!result || result.ok !== true || !Array.isArray(result.values)) return null;
	    return result.values;
	  }

  private async readSupabaseAuthCookieValues(
    session: ElectronSession
  ): Promise<Array<{ storage: "cookie"; key: string; value: string }> | null> {
    const keys = storageKeysFromSupabaseUrl();
    const { projectRef } = resolveFlowithSupabaseConfig();

    let all: Cookie[] = [];
    try {
      all = await session.cookies.get({});
    } catch {
      return null;
    }

    if (!Array.isArray(all) || all.length === 0) return null;

    const acceptedDomains = FLOWITH_WEB_TARGET_HOSTS;
    const values: Array<{ storage: "cookie"; key: string; value: string }> = [];

    for (const cookie of all) {
      const domain = typeof cookie.domain === "string" ? cookie.domain.toLowerCase() : "";
      const name = typeof cookie.name === "string" ? cookie.name.trim() : "";
      const value = typeof cookie.value === "string" ? cookie.value : "";
      if (!name || !value) continue;

      const normalizedDomain = domain.startsWith(".") ? domain.slice(1) : domain;
      if (!acceptedDomains.some((host) => normalizedDomain === host || normalizedDomain.endsWith(`.${host}`))) continue;

      const lowerName = name.toLowerCase();
      const projectRefLower = projectRef.toLowerCase();
      const looksRelevant =
        keys.includes(name) ||
        lowerName.includes(projectRefLower) ||
        lowerName.startsWith("sb-") ||
        lowerName.includes("supabase");

      if (!looksRelevant) continue;

      for (const decoded of safeDecodeCookieValue(value)) {
        values.push({ storage: "cookie", key: name, value: decoded });
      }
    }

    if (values.length === 0) return null;

    // Some deployments store access/refresh tokens in separate cookies (not JSON).
    let accessToken: string | null = null;
    let refreshToken: string | null = null;
    for (const entry of values) {
      const lower = entry.key.toLowerCase();
      const v = entry.value.trim();
      if (!v) continue;
      if (!accessToken && lower.includes("access") && JWT_PATTERN.test(v)) accessToken = v;
      if (!refreshToken && lower.includes("refresh") && v.length >= 24) refreshToken = v;
    }

    if (accessToken || refreshToken) {
      const synthesized = JSON.stringify({ access_token: accessToken, refresh_token: refreshToken });
      values.unshift({ storage: "cookie", key: "__synthetic__", value: synthesized });
    }

    return values;
  }

	  private pickBestSupabaseSnapshot(values: Array<{ value: string }>): SupabaseSessionSnapshot | null {
	    const candidates: SupabaseSessionSnapshot[] = [];
	    for (const entry of values) {
	      const extracted = extractSupabaseSessionSnapshotFromStorageValue(entry.value);
      if (!extracted) continue;
      if (!extracted.accessToken && !extracted.refreshToken) continue;
      candidates.push(extracted);
    }
    if (candidates.length === 0) return null;

    const rank = (snapshot: SupabaseSessionSnapshot): number => {
      if (snapshot.accessToken && snapshot.refreshToken) return 3;
      if (snapshot.refreshToken) return 2;
      if (snapshot.accessToken) return 1;
      return 0;
    };

    candidates.sort((a, b) => {
      const ar = rank(a);
      const br = rank(b);
      if (ar !== br) return br - ar;
      const ae = a.expiresAt ?? 0;
      const be = b.expiresAt ?? 0;
      if (ae !== be) return be - ae;
      return 0;
    });

	    return candidates[0] ?? null;
	  }

  private async readBestSupabaseSnapshotFromCookies(session: ElectronSession): Promise<SupabaseSessionSnapshot | null> {
    const values = await this.readSupabaseAuthCookieValues(session);
    if (!values) return null;
    return this.pickBestSupabaseSnapshot(values);
  }

	  private async readBestSupabaseSnapshotFromWebContents(webContents: WebContents): Promise<SupabaseSessionSnapshot | null> {
	    const values = await this.readSupabaseAuthStorageValues(webContents);
      const snapshotFromStorage = values ? this.pickBestSupabaseSnapshot(values) : null;
      if (snapshotFromStorage) return snapshotFromStorage;
      return await this.readBestSupabaseSnapshotFromCookies(webContents.session);
	  }

  private async waitForSupabaseSnapshotFromWebContents(
    webContents: WebContents,
    options?: { timeoutMs?: number }
  ): Promise<SupabaseSessionSnapshot | null> {
    const timeoutMs = Math.max(0, options?.timeoutMs ?? 0);
    if (timeoutMs <= 0) return await this.readBestSupabaseSnapshotFromWebContents(webContents);

    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      if (webContents.isDestroyed()) return null;
      try {
        const snapshot = await this.readBestSupabaseSnapshotFromWebContents(webContents);
        if (snapshot?.accessToken || snapshot?.refreshToken) return snapshot;
      } catch {
        // ignore
      }

      if (Date.now() >= deadline) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }

    return null;
  }

  private isLikelyActiveAccessToken(expiresAt: number | null): boolean {
    if (!expiresAt || !Number.isFinite(expiresAt)) return true;
    // Give a small buffer to avoid treating near-expiry token as "active".
    return expiresAt > Date.now() + 60_000;
  }

  private async readAccessTokenFromWebContents(webContents: WebContents): Promise<string | null> {
    const snapshot = await this.readBestSupabaseSnapshotFromWebContents(webContents);
    return snapshot?.accessToken ?? null;
  }

  private async waitForAccessTokenFromWebContents(
    webContents: WebContents,
    options?: { timeoutMs?: number }
  ): Promise<string | null> {
    const timeoutMs = Math.max(0, options?.timeoutMs ?? 0);
    if (timeoutMs <= 0) return await this.readAccessTokenFromWebContents(webContents);

    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      if (webContents.isDestroyed()) return null;
      try {
        const token = await this.readAccessTokenFromWebContents(webContents);
        if (token) return token;
      } catch {
        // ignore
      }

      if (Date.now() >= deadline) break;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 250);
      });
    }
    return null;
  }

  async peekAccessTokenFromOpenTab(accountId: string, options?: { timeoutMs?: number }): Promise<string | null> {
    const webContents = this.workspace.getWebContents(accountId);
    if (!webContents) return null;

    const timeoutMs = options?.timeoutMs ?? 0;
    const task = (async () => {
      try {
        return await this.readAccessTokenFromWebContents(webContents);
      } catch {
        return null;
      }
    })();

    if (timeoutMs <= 0) return await task;

    return await Promise.race([
      task,
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  }

  async peekRefreshTokenFromOpenTab(accountId: string, options?: { timeoutMs?: number }): Promise<string | null> {
    const webContents = this.workspace.getWebContents(accountId);
    if (!webContents) return null;

    const timeoutMs = options?.timeoutMs ?? 0;
    const task = (async () => {
      try {
        const snapshot = await this.readBestSupabaseSnapshotFromWebContents(webContents);
        return snapshot?.refreshToken ?? null;
      } catch {
        return null;
      }
    })();

    if (timeoutMs <= 0) return await task;

    return await Promise.race([
      task,
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  }

  async waitForAccessTokenFromOpenTab(accountId: string, options?: { timeoutMs?: number }): Promise<string | null> {
    const webContents = this.workspace.getWebContents(accountId);
    if (!webContents) return null;
    try {
      return await this.waitForAccessTokenFromWebContents(webContents, options);
    } catch {
      return null;
    }
  }

  async waitForRefreshTokenFromOpenTab(accountId: string, options?: { timeoutMs?: number }): Promise<string | null> {
    const webContents = this.workspace.getWebContents(accountId);
    if (!webContents) return null;
    try {
      const snapshot = await this.waitForSupabaseSnapshotFromWebContents(webContents, options);
      return snapshot?.refreshToken ?? null;
    } catch {
      return null;
    }
  }

  async reconcileSessionForOpenTab(
    accountId: string,
    session: Session,
    options?: { timeoutMs?: number; reload?: boolean }
  ): Promise<boolean> {
    const webContents = this.workspace.getWebContents(accountId);
    if (!webContents || webContents.isDestroyed()) return false;

    const timeoutMs = options?.timeoutMs ?? 0;
    if (timeoutMs > 0) {
      try {
        await waitForFlowithReady(webContents, timeoutMs);
      } catch {
        return false;
      }
    } else {
      let href: unknown;
      try {
        href = await webContents.executeJavaScript("location.href", true);
      } catch {
        return false;
      }
      if (typeof href !== "string" || !isFlowithUrl(href)) return false;
    }

    try {
      await injectSupabaseSession(webContents, session);
    } catch {
      return false;
    }

    this.ensureAuthHeaderInjection(accountId, webContents, session.access_token ?? "");
    if (options?.reload ?? true) {
      try {
        webContents.reload();
      } catch {
        // ignore
      }
    }
    this.ensureTokenSync(accountId, webContents);
    return true;
  }

  private async syncTokensFromWebContents(
    accountId: string,
    webContents: WebContents,
    options?: { forceRefreshTokenWrite?: boolean }
  ): Promise<void> {
    if (webContents.isDestroyed()) return;

    const currentVaultRefreshToken = getRefreshToken(accountId);
    const canOverwriteVaultRefreshToken =
      !currentVaultRefreshToken || isKnownUsedRefreshToken(accountId, currentVaultRefreshToken);

    const allowRefreshTokenWrite =
      (this.refreshTokenWriteDeadlines.get(accountId) ?? 0) > Date.now() ||
      (options?.forceRefreshTokenWrite && canOverwriteVaultRefreshToken) ||
      canOverwriteVaultRefreshToken;

    const snapshot = await this.readBestSupabaseSnapshotFromWebContents(webContents);
    if (!snapshot) return;

    const nextAccessToken = snapshot.accessToken ?? null;
    const nextRefreshToken = snapshot.refreshToken ?? null;

    if (nextRefreshToken && currentVaultRefreshToken !== nextRefreshToken) {
      const shouldWriteRefreshToken =
        allowRefreshTokenWrite ||
        !currentVaultRefreshToken ||
        (nextAccessToken && this.isLikelyActiveAccessToken(snapshot.expiresAt));

      if (shouldWriteRefreshToken && !isKnownUsedRefreshToken(accountId, nextRefreshToken)) {
        setRefreshToken(accountId, nextRefreshToken);
      }
    }

    if (nextAccessToken) this.ensureAuthHeaderInjection(accountId, webContents, nextAccessToken);
  }

  private ensureTokenSync(accountId: string, webContents: WebContents) {
    if (this.tokenSync.has(accountId)) return;
    if (webContents.isDestroyed()) return;

    let stopped = false;
    let handle: ReturnType<typeof setTimeout> | null = null;
    let refreshSyncDebounce: ReturnType<typeof setTimeout> | null = null;

    const stop = () => {
      stopped = true;
      if (handle) clearTimeout(handle);
      if (refreshSyncDebounce) clearTimeout(refreshSyncDebounce);
      this.refreshTokenWriteDeadlines.delete(accountId);
      try {
        webContents.session.webRequest.onCompleted(null);
      } catch {
        // ignore
      }
      this.tokenSync.delete(accountId);
    };

    const scheduleSyncSoon = () => {
      if (stopped) return;
      if (refreshSyncDebounce) clearTimeout(refreshSyncDebounce);
      refreshSyncDebounce = setTimeout(async () => {
        refreshSyncDebounce = null;
        if (stopped || webContents.isDestroyed()) return;
        try {
          await this.syncTokensFromWebContents(accountId, webContents);
        } catch {
          // best-effort
        }
      }, 1000);
    };

    const tick = async () => {
      if (stopped) return;
      if (webContents.isDestroyed()) {
        stop();
        return;
      }

      try {
        await this.syncTokensFromWebContents(accountId, webContents);
      } catch {
        // best-effort
      }

      if (!stopped) {
        handle = setTimeout(tick, 15_000);
      }
    };

    try {
      webContents.once("destroyed", stop);
    } catch {
      // ignore
    }

    try {
      const supabaseHost = supabaseHostFromConfig();
      const filter = {
        urls: [`https://${supabaseHost}/auth/v1/token*`],
      };

      const listener = (details: OnCompletedListenerDetails) => {
        if (stopped) return;
        try {
          const url = new URL(details.url);
          if (!url.pathname.includes("/auth/v1/token")) return;
          const grantType = url.searchParams.get("grant_type");
          if (grantType && grantType !== "refresh_token") return;
        } catch {
          return;
        }

        this.refreshTokenWriteDeadlines.set(accountId, Date.now() + 30_000);
        scheduleSyncSoon();
      };

      webContents.session.webRequest.onCompleted(filter, listener);
    } catch {
      // ignore
    }

    handle = setTimeout(tick, 8_000);
    this.tokenSync.set(accountId, { stop });
  }

  async syncFromOpenTab(
    accountId: string,
    options?: { timeoutMs?: number; forceRefreshTokenWrite?: boolean }
  ): Promise<void> {
    const webContents = this.workspace.getWebContents(accountId);
    if (!webContents) return;
    const timeoutMs = options?.timeoutMs ?? 0;
    const task = (async () => {
      try {
        if (timeoutMs > 0) {
          await this.waitForSupabaseSnapshotFromWebContents(webContents, { timeoutMs });
        }
        await this.syncTokensFromWebContents(
          accountId,
          webContents,
          options?.forceRefreshTokenWrite ? { forceRefreshTokenWrite: true } : undefined
        );
      } catch {
        // best-effort
      }
    })();

    if (timeoutMs <= 0) {
      await task;
      return;
    }

    await Promise.race([
      task,
      new Promise<void>((resolve) => {
        setTimeout(resolve, timeoutMs);
      }),
    ]);
  }

  async syncOpenTabsBeforeQuit(options?: { totalTimeoutMs?: number; perTabTimeoutMs?: number }): Promise<void> {
    const totalTimeoutMs = options?.totalTimeoutMs ?? 2000;
    const perTabTimeoutMs = options?.perTabTimeoutMs ?? 800;
    const deadline = Date.now() + totalTimeoutMs;

    for (const accountId of this.workspace.listOpenTabs()) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const budget = Math.min(perTabTimeoutMs, remaining);
      await this.syncFromOpenTab(accountId, { timeoutMs: budget });
    }
  }

  async waitForNewRefreshTokenFromOpenTab(
    accountId: string,
    options?: { totalTimeoutMs?: number; perSyncTimeoutMs?: number }
  ): Promise<boolean> {
    const webContents = this.workspace.getWebContents(accountId);
    if (!webContents || webContents.isDestroyed()) return false;

    const totalTimeoutMs = options?.totalTimeoutMs ?? 8000;
    const perSyncTimeoutMs = options?.perSyncTimeoutMs ?? 1000;

    const before = getRefreshToken(accountId);
    const deadline = Date.now() + totalTimeoutMs;
    while (Date.now() < deadline) {
      await this.syncFromOpenTab(accountId, { timeoutMs: perSyncTimeoutMs, forceRefreshTokenWrite: true });
      const current = getRefreshToken(accountId);
      if (current && current !== before && !isKnownUsedRefreshToken(accountId, current)) return true;
      await new Promise<void>((resolve) => setTimeout(resolve, 600));
    }

    return false;
  }

  private ensureAuthHeaderInjection(accountId: string, webContents: WebContents, accessToken: string) {
    const existing = this.headerInjection.get(accountId);
    if (existing) {
      existing.setAccessToken(accessToken);
      return;
    }

    const supabaseHost = supabaseHostFromConfig();
    let token = accessToken;
    const toBearer = (value: string): string => {
      const raw = value.trim();
      if (!raw) return "";
      return raw.toLowerCase().startsWith("bearer ") ? raw : `Bearer ${raw}`;
    };

    const filter = {
      urls: ["https://edge.flowith.net/*", `https://${supabaseHost}/*`, `wss://${supabaseHost}/*`],
    };

    const injector = (details: OnBeforeSendHeadersListenerDetails, callback: (response: BeforeSendResponse) => void) => {
      try {
        if (!token) {
          callback({ requestHeaders: details.requestHeaders });
          return;
        }
        if (details.method === "OPTIONS") {
          callback({ requestHeaders: details.requestHeaders });
          return;
        }

        const headers = { ...details.requestHeaders } as Record<string, string | string[]>;
        const hasAuthorization = Object.keys(headers).some((k) => k.toLowerCase() === "authorization");
        if (hasAuthorization) {
          callback({ requestHeaders: headers });
          return;
        }

        let host = "";
        try {
          host = new URL(details.url).hostname;
        } catch {
          callback({ requestHeaders: headers });
          return;
        }

        if (host === "edge.flowith.net") {
          headers["Authorization"] = toBearer(token);
        } else if (host === supabaseHost) {
          headers["Authorization"] = toBearer(token);
        }

        callback({ requestHeaders: headers });
      } catch {
        callback({ requestHeaders: details.requestHeaders });
      }
    };

    try {
      webContents.session.webRequest.onBeforeSendHeaders(filter, injector);
    } catch {
      return;
    }

    this.headerInjection.set(accountId, {
      setAccessToken: (next) => {
        token = next;
      },
    });
  }

  async bootstrap(accountId: string) {
    const webContents = this.workspace.getWebContents(accountId);
    if (!webContents) throw new Error("Workspace webContents not found for account.");

    await waitForFlowithReady(webContents, 30_000);
    this.ensureTokenSync(accountId, webContents);
    await this.syncFromOpenTab(accountId, { timeoutMs: 1000, forceRefreshTokenWrite: true });

    // Tab-first: if the page already has a valid access token in its own storage (persisted profile),
    // do not refresh via vault refresh_token. This avoids "already used" caused by vault/tab divergence.
    const tabSnapshot = await this.waitForSupabaseSnapshotFromWebContents(webContents, { timeoutMs: 4000 });
    const tabAccessToken = tabSnapshot?.accessToken ?? null;
    if (tabAccessToken) {
      this.ensureAuthHeaderInjection(accountId, webContents, tabAccessToken);
      return;
    }
    // If we can see a refresh_token in the tab, assume the tab will recover its own access token.
    // Avoid refreshing via vault to prevent refresh_token divergence.
    if (tabSnapshot?.refreshToken) {
      return;
    }

    let flowithSession: Session;
    try {
      flowithSession = await refreshFlowithSessionForAccount(accountId, {
        onAlreadyUsed: async () => {
          await this.waitForNewRefreshTokenFromOpenTab(accountId);
        },
      });
    } catch (e) {
      if (!isAlreadyUsedError(e)) throw e;
      await this.waitForNewRefreshTokenFromOpenTab(accountId);
      return;
    }

    await injectSupabaseSession(webContents, flowithSession);
    this.ensureAuthHeaderInjection(accountId, webContents, flowithSession.access_token ?? "");
    webContents.reload();
    this.ensureTokenSync(accountId, webContents);
  }
}
