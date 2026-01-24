import { app } from "electron";
import type { BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import type { ProgressInfo, UpdateInfo } from "electron-updater";
import { getNetSession } from "electron-updater/out/electronHttpExecutor";
import { IPC_EVENTS, type ProxyConfig, type UpdaterEvent, type UpdaterProgress, type UpdaterStatus } from "../../shared/ipc";
import { listAccounts } from "../accounts/vault";
import { applyProxy, validateProxyConfig } from "../network/proxy";
import { redactSensitive } from "../security/redact";

let getWindow: (() => BrowserWindow | null) | null = null;
let initialized = false;

const updaterSession = getNetSession();

let status: UpdaterStatus = {
  supported: false,
  currentVersion: app.getVersion(),
  state: "idle",
  availableVersion: null,
  progress: null,
  error: null,
  lastCheckedAt: null,
};

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === "string") return redactSensitive(error.message);
  if (typeof error === "string") return redactSensitive(error);
  return "Unknown error";
}

function coerceProgress(raw: ProgressInfo): UpdaterProgress {
  const percent = typeof raw.percent === "number" && Number.isFinite(raw.percent) ? raw.percent : 0;
  const transferred = typeof raw.transferred === "number" && Number.isFinite(raw.transferred) ? raw.transferred : 0;
  const total = typeof raw.total === "number" && Number.isFinite(raw.total) ? raw.total : 0;
  const bytesPerSecond =
    typeof raw.bytesPerSecond === "number" && Number.isFinite(raw.bytesPerSecond) ? raw.bytesPerSecond : 0;

  return {
    percent: Math.max(0, Math.min(100, percent)),
    transferred: Math.max(0, transferred),
    total: Math.max(0, total),
    bytesPerSecond: Math.max(0, bytesPerSecond),
  };
}

function syncBaseFields(patch: Partial<UpdaterStatus> = {}): UpdaterStatus {
  return {
    ...status,
    ...patch,
    supported: app.isPackaged,
    currentVersion: app.getVersion(),
  };
}

function sendEvent(event: UpdaterEvent) {
  const win = getWindow?.();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IPC_EVENTS.UPDATER_EVENT, event);
}

function publish(patch: Partial<UpdaterStatus>) {
  status = syncBaseFields(patch);
  sendEvent({ type: "status", status });
}

function isSupported(): boolean {
  return app.isPackaged;
}

function collectSavedCustomProxies(): ProxyConfig[] {
  const seen = new Set<string>();
  const result: ProxyConfig[] = [];

  for (const account of listAccounts()) {
    const proxy = account.net.proxy;
    if (proxy.mode !== "custom") continue;
    const rules = typeof proxy.rules === "string" ? proxy.rules.trim() : "";
    if (!rules) continue;

    const normalized: ProxyConfig = { mode: "custom", rules };
    try {
      validateProxyConfig(normalized);
    } catch {
      continue;
    }

    if (seen.has(rules)) continue;
    seen.add(rules);
    result.push(normalized);
  }

  return result;
}

function buildUpdaterProxyFallbackList(): ProxyConfig[] {
  return [{ mode: "system" }, ...collectSavedCustomProxies(), { mode: "direct" }];
}

async function withUpdaterProxyFallback<T>(fn: () => Promise<T>): Promise<T> {
  const candidates = buildUpdaterProxyFallbackList();
  let lastError: unknown = null;

  for (const proxy of candidates) {
    try {
      await applyProxy(updaterSession, proxy);
      return await fn();
    } catch (e) {
      lastError = e;
    }
  }

  throw lastError ?? new Error("Update request failed.");
}

export function initUpdater(getWindowFn: () => BrowserWindow | null) {
  getWindow = getWindowFn;
  status = syncBaseFields();

  if (initialized) return;
  initialized = true;

  if (!isSupported()) return;

  autoUpdater.autoDownload = false;
  autoUpdater.logger = console;

  autoUpdater.on("checking-for-update", () => {
    publish({ state: "checking", progress: null, error: null });
  });

  autoUpdater.on("update-available", (info: UpdateInfo) => {
    publish({
      state: "available",
      availableVersion: info.version ?? null,
      progress: null,
      error: null,
      lastCheckedAt: Date.now(),
    });
  });

  autoUpdater.on("update-not-available", () => {
    publish({
      state: "notAvailable",
      availableVersion: null,
      progress: null,
      error: null,
      lastCheckedAt: Date.now(),
    });
  });

  autoUpdater.on("download-progress", (progress: ProgressInfo) => {
    publish({
      state: "downloading",
      progress: coerceProgress(progress),
      error: null,
    });
  });

  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    publish({
      state: "downloaded",
      availableVersion: info.version ?? status.availableVersion,
      progress: null,
      error: null,
    });
  });

  autoUpdater.on("error", (err) => {
    publish({
      state: "error",
      progress: null,
      error: safeErrorMessage(err),
    });
  });
}

export function getUpdaterStatus(): UpdaterStatus {
  status = syncBaseFields();
  return status;
}

export async function checkForUpdates(): Promise<UpdaterStatus> {
  status = syncBaseFields();
  if (!isSupported()) return status;

  try {
    publish({ state: "checking", error: null, progress: null });
    await withUpdaterProxyFallback(() => autoUpdater.checkForUpdates());
  } catch (e) {
    publish({ state: "error", error: safeErrorMessage(e), progress: null });
  }

  return status;
}

export async function downloadUpdate(): Promise<UpdaterStatus> {
  status = syncBaseFields();
  if (!isSupported()) return status;

  try {
    await withUpdaterProxyFallback(() => autoUpdater.downloadUpdate());
  } catch (e) {
    publish({ state: "error", error: safeErrorMessage(e), progress: null });
  }

  return status;
}

export function quitAndInstall(): void {
  status = syncBaseFields();
  if (!isSupported()) throw new Error("Updater is only available in packaged builds.");
  autoUpdater.quitAndInstall();
}
