import type { WebContents } from "electron";
import type { Session } from "@supabase/supabase-js";
import { getFlowithSupabaseClient } from "../flowith/supabase";
import { getRefreshToken, setRefreshToken } from "../accounts/vault";
import { redactSensitive } from "../security/redact";
import type { WebWorkspaceService } from "./WebWorkspaceService";

function isFlowithUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.origin === "https://flowith.io") return true;
    if (url.hostname.endsWith(".flowith.io")) return true;
    return false;
  } catch {
    return false;
  }
}

function storageKeyFromSupabaseUrl(): string {
  const raw = process.env.FLOWITH_SUPABASE_URL;
  if (!raw) throw new Error("FLOWITH_SUPABASE_URL is required to compute auth storage key.");
  const host = new URL(raw).host; // <ref>.supabase.co
  const projectRef = host.split(".")[0];
  if (!projectRef) throw new Error("Invalid FLOWITH_SUPABASE_URL.");
  return `sb-${projectRef}-auth-token`;
}

async function waitForFlowithReady(webContents: WebContents, timeoutMs: number) {
  const readyNow = isFlowithUrl(webContents.getURL()) && !webContents.isLoading();
  if (readyNow) return;

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timeout waiting for Flowith Web to load."));
    }, timeoutMs);

    const onFinish = () => {
      if (!isFlowithUrl(webContents.getURL())) return;
      cleanup();
      resolve();
    };

    const cleanup = () => {
      clearTimeout(timeout);
      webContents.removeListener("did-finish-load", onFinish);
    };

    webContents.on("did-finish-load", onFinish);
  });
}

async function injectSupabaseSession(webContents: WebContents, session: Session) {
  const storageKey = storageKeyFromSupabaseUrl();
  const value = JSON.stringify(session);

  const script = `
    (() => {
      try {
        localStorage.setItem(${JSON.stringify(storageKey)}, ${JSON.stringify(value)});
        localStorage.setItem("supabase.auth.token", ${JSON.stringify(value)});
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e && e.message ? String(e.message) : String(e) };
      }
    })();
  `;

  const result = (await webContents.executeJavaScript(script, true)) as
    | { ok: true }
    | { ok: false; error?: string }
    | undefined;

  if (!result || result.ok !== true) {
    throw new Error(`Failed to inject session: ${redactSensitive(result?.error ?? "unknown")}`);
  }
}

export class FlowithLoginBootstrapService {
  private workspace: WebWorkspaceService;

  constructor(workspace: WebWorkspaceService) {
    this.workspace = workspace;
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
    webContents.reload();
  }
}

