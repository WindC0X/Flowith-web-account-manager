import type { BeforeSendResponse, OnBeforeSendHeadersListenerDetails, WebContents } from "electron";
import type { Session } from "@supabase/supabase-js";
import { resolveFlowithSupabaseConfig } from "../flowith/supabase";
import { getRefreshToken, setRefreshToken } from "../accounts/vault";
import { refreshFlowithSessionForAccount } from "../flowith/sessionRefresh";
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

  constructor(workspace: WebWorkspaceService) {
    this.workspace = workspace;
  }

  private async syncTokensFromWebContents(accountId: string, webContents: WebContents): Promise<void> {
    if (webContents.isDestroyed()) return;

    let href: unknown;
    try {
      href = await webContents.executeJavaScript("location.href", true);
    } catch {
      return;
    }
    if (typeof href !== "string" || !isFlowithUrl(href)) return;

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

    if (!result || result.ok !== true || !Array.isArray(result.values)) return;

    let nextRefreshToken: string | null = null;
    let nextAccessToken: string | null = null;

    for (const entry of result.values) {
      const extracted = extractSupabaseSessionTokensFromStorageValue(entry.value);
      if (!extracted) continue;
      if (!nextAccessToken && extracted.accessToken) nextAccessToken = extracted.accessToken;
      if (!nextRefreshToken && extracted.refreshToken) nextRefreshToken = extracted.refreshToken;
      if (nextAccessToken && nextRefreshToken) break;
    }

    if (nextRefreshToken) {
      const current = getRefreshToken(accountId);
      if (current !== nextRefreshToken) {
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

    const stop = () => {
      stopped = true;
      if (handle) clearTimeout(handle);
      this.tokenSync.delete(accountId);
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
        handle = setTimeout(tick, 45_000);
      }
    };

    try {
      webContents.once("destroyed", stop);
    } catch {
      // ignore
    }

    handle = setTimeout(tick, 8_000);
    this.tokenSync.set(accountId, { stop });
  }

  async syncFromOpenTab(accountId: string): Promise<void> {
    const webContents = this.workspace.getWebContents(accountId);
    if (!webContents) return;
    try {
      await this.syncTokensFromWebContents(accountId, webContents);
    } catch {
      // best-effort
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
    const flowithSession = await refreshFlowithSessionForAccount(accountId);

    const webContents = this.workspace.getWebContents(accountId);
    if (!webContents) throw new Error("Workspace webContents not found for account.");

    await waitForFlowithReady(webContents, 30_000);
    await injectSupabaseSession(webContents, flowithSession);
    this.ensureAuthHeaderInjection(accountId, webContents, flowithSession.access_token ?? "");
    webContents.reload();
    this.ensureTokenSync(accountId, webContents);
  }
}
