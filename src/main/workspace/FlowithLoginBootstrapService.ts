import type {
  BeforeSendResponse,
  OnBeforeSendHeadersListenerDetails,
  OnCompletedListenerDetails,
  WebContents,
} from "electron";
import type { Session } from "@supabase/supabase-js";
import { resolveFlowithSupabaseConfig } from "../flowith/supabase";
import { getRefreshToken, setRefreshToken } from "../accounts/vault";
import { isKnownUsedRefreshToken, refreshFlowithSessionForAccount } from "../flowith/sessionRefresh";
import { redactSensitive } from "../security/redact";
import type { WebWorkspaceService } from "./WebWorkspaceService";
import { extractSupabaseSessionTokensFromStorageValue } from "./supabaseAuthStorage";

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

  private async readAccessTokenFromWebContents(webContents: WebContents): Promise<string | null> {
    const values = await this.readSupabaseAuthStorageValues(webContents);
    if (!values) return null;
    for (const entry of values) {
      const extracted = extractSupabaseSessionTokensFromStorageValue(entry.value);
      if (!extracted?.accessToken) continue;
      return extracted.accessToken;
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

    const values = await this.readSupabaseAuthStorageValues(webContents);
    if (!values) return;

    let nextRefreshToken: string | null = null;
    let nextAccessToken: string | null = null;

    for (const entry of values) {
      const extracted = extractSupabaseSessionTokensFromStorageValue(entry.value);
      if (!extracted) continue;
      if (!nextAccessToken && extracted.accessToken) nextAccessToken = extracted.accessToken;
      if (
        !nextRefreshToken &&
        allowRefreshTokenWrite &&
        extracted.refreshToken &&
        !isKnownUsedRefreshToken(accountId, extracted.refreshToken)
      ) {
        nextRefreshToken = extracted.refreshToken;
      }
      if (nextAccessToken && nextRefreshToken) break;
    }

    if (nextRefreshToken) {
      if (currentVaultRefreshToken !== nextRefreshToken) {
        setRefreshToken(accountId, nextRefreshToken);
      }
    }

    if (nextAccessToken) {
      this.ensureAuthHeaderInjection(accountId, webContents, nextAccessToken);
    }
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

  private ensureAuthHeaderInjection(accountId: string, webContents: WebContents, accessToken: string) {
    const existing = this.headerInjection.get(accountId);
    if (existing) {
      existing.setAccessToken(accessToken);
      return;
    }

    const supabaseHost = supabaseHostFromConfig();
    let token = accessToken;

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
          headers["Authorization"] = token;
        } else if (host === supabaseHost) {
          headers["Authorization"] = `Bearer ${token}`;
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
    await this.syncFromOpenTab(accountId, { timeoutMs: 1000, forceRefreshTokenWrite: true });

    const flowithSession = await refreshFlowithSessionForAccount(accountId, {
      onAlreadyUsed: async () => {
        await this.syncFromOpenTab(accountId, { timeoutMs: 1000, forceRefreshTokenWrite: true });
      },
    });
    await injectSupabaseSession(webContents, flowithSession);
    this.ensureAuthHeaderInjection(accountId, webContents, flowithSession.access_token ?? "");
    webContents.reload();
    this.ensureTokenSync(accountId, webContents);
  }
}
