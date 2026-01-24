import type { BeforeSendResponse, OnBeforeSendHeadersListenerDetails, WebContents } from "electron";
import type { Session } from "@supabase/supabase-js";
import { getFlowithSupabaseClient, resolveFlowithSupabaseConfig } from "../flowith/supabase";
import { getRefreshToken, setRefreshToken } from "../accounts/vault";
import { redactSensitive } from "../security/redact";
import type { WebWorkspaceService } from "./WebWorkspaceService";

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

  constructor(workspace: WebWorkspaceService) {
    this.workspace = workspace;
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
    const refreshToken = getRefreshToken(accountId);
    if (!refreshToken) {
      throw new Error("No refresh_token available for this account. Import token first.");
    }

    const supabase = getFlowithSupabaseClient();
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
    if (error) throw error;
    if (!data?.session) throw new Error("Supabase refresh returned no session.");

    if (data.session.refresh_token) {
      setRefreshToken(accountId, data.session.refresh_token);
    }

    const webContents = this.workspace.getWebContents(accountId);
    if (!webContents) throw new Error("Workspace webContents not found for account.");

    await waitForFlowithReady(webContents, 30_000);
    await injectSupabaseSession(webContents, data.session);
    this.ensureAuthHeaderInjection(accountId, webContents, data.session.access_token);
    webContents.reload();
  }
}
