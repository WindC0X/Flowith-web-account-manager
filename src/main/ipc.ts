import { BrowserWindow, ipcMain } from "electron";
import {
  IPC_CHANNELS,
  type AccountMetaPatch,
  type DownloadSaveMode,
  type Preferences,
  type PreferencesPatch,
  type Rect,
} from "../shared/ipc";
import { importRefreshTokens } from "./accounts/import";
import { normalizeAccountMetaPatch } from "./accounts/normalize";
import { getRefreshToken, listAccounts, upsertAccountMeta } from "./accounts/vault";
import {
  cancelDownload,
  copyDownloadedPath,
  getDownloadsPreferencesPublic,
  openDownloadedFile,
  pickDownloadsCustomDirectory,
  setDownloadsSaveMode,
  showDownloadInFolder,
} from "./downloads/service";
import { testConnectivity } from "./network/connectivity";
import { validateProxyConfig } from "./network/proxy";
import { validateUaConfig } from "./network/userAgent";
import { redactSensitive } from "./security/redact";
import type { WebWorkspaceService } from "./workspace/WebWorkspaceService";
import type { FlowithLoginBootstrapService } from "./workspace/FlowithLoginBootstrapService";

const preferences: Preferences = {
  locale: "zh-CN",
  theme: "dark",
  sidebarCollapsed: false,
};

type IpcDeps = {
  workspace: WebWorkspaceService;
  loginBootstrap: FlowithLoginBootstrapService;
};

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === "string") {
    return redactSensitive(error.message);
  }
  return "Unknown error";
}

function assertString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string") throw new Error(`Invalid ${name}: expected string`);
  if (value.trim().length === 0) throw new Error(`Invalid ${name}: must be non-empty`);
}

function assertStringArray(value: unknown, name: string): asserts value is string[] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${name}: expected string[]`);
  for (const item of value) assertString(item, `${name}[]`);
}

function assertRect(value: unknown): asserts value is Rect {
  if (!value || typeof value !== "object") throw new Error("Invalid bounds: expected object");
  const v = value as Partial<Record<keyof Rect, unknown>>;
  for (const key of ["x", "y", "width", "height"] as const) {
    if (typeof v[key] !== "number" || !Number.isFinite(v[key])) {
      throw new Error(`Invalid bounds.${key}: expected finite number`);
    }
  }
}

function assertObject(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object") throw new Error(`Invalid ${name}: expected object`);
}

function assertDownloadSaveMode(value: unknown, name: string): asserts value is DownloadSaveMode {
  if (value === "saveAs" || value === "downloads" || value === "customDir") return;
  throw new Error(`Invalid ${name}: expected saveAs|downloads|customDir`);
}

function validateAccountMetaPatch(patch: AccountMetaPatch) {
  const proxy = patch.net?.proxy;
  if (proxy) validateProxyConfig(proxy);
  if (patch.ua) validateUaConfig(patch.ua);
}

export function registerIpcHandlers(deps: IpcDeps) {
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_OPEN_TAB, async (_event, accountId: unknown) => {
    try {
      assertString(accountId, "accountId");
      deps.workspace.openTab(accountId);
      await deps.loginBootstrap.bootstrap(accountId);
    } catch (e) {
      throw new Error(safeErrorMessage(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_CLOSE_TAB, async (_event, accountId: unknown) => {
    try {
      assertString(accountId, "accountId");
      deps.workspace.closeTab(accountId);
    } catch (e) {
      throw new Error(safeErrorMessage(e));
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.WORKSPACE_SET_ACTIVE_TAB,
    async (_event, accountId: unknown) => {
      try {
        assertString(accountId, "accountId");
        deps.workspace.setActiveTab(accountId);
      } catch (e) {
        throw new Error(safeErrorMessage(e));
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.WORKSPACE_SET_VIEWPORT_BOUNDS,
    async (_event, bounds: unknown) => {
      try {
        assertRect(bounds);
        deps.workspace.setViewportBounds(bounds);
      } catch (e) {
        throw new Error(safeErrorMessage(e));
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_RELOAD_ACTIVE, async () => {
    deps.workspace.reloadActive();
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOADS_GET_PREFERENCES, async () => {
    return getDownloadsPreferencesPublic();
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOADS_SET_MODE, async (_event, mode: unknown) => {
    try {
      assertDownloadSaveMode(mode, "mode");
      return setDownloadsSaveMode(mode);
    } catch (e) {
      throw new Error(safeErrorMessage(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOADS_PICK_CUSTOM_DIRECTORY, async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      return await pickDownloadsCustomDirectory(win ?? null);
    } catch (e) {
      throw new Error(safeErrorMessage(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOADS_SHOW_IN_FOLDER, async (_event, downloadId: unknown) => {
    try {
      assertString(downloadId, "downloadId");
      showDownloadInFolder(downloadId);
    } catch (e) {
      throw new Error(safeErrorMessage(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOADS_OPEN, async (_event, downloadId: unknown) => {
    try {
      assertString(downloadId, "downloadId");
      await openDownloadedFile(downloadId);
    } catch (e) {
      throw new Error(safeErrorMessage(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOADS_CANCEL, async (_event, downloadId: unknown) => {
    try {
      assertString(downloadId, "downloadId");
      cancelDownload(downloadId);
    } catch (e) {
      throw new Error(safeErrorMessage(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOADS_COPY_PATH, async (_event, downloadId: unknown) => {
    try {
      assertString(downloadId, "downloadId");
      copyDownloadedPath(downloadId);
    } catch (e) {
      throw new Error(safeErrorMessage(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_MINIMIZE, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.minimize();
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_TOGGLE_MAXIMIZE, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_IS_MAXIMIZED, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win?.isMaximized() ?? false;
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_CLOSE, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.close();
  });

  ipcMain.handle(IPC_CHANNELS.ACCOUNTS_LIST, async () => {
    return listAccounts();
  });

  ipcMain.handle(IPC_CHANNELS.ACCOUNTS_IMPORT_REFRESH_TOKENS, async (_event, text: unknown) => {
    try {
      assertString(text, "text");
      const trimmed = text.trim();
      if (!trimmed) return { imported: 0, failed: 0, warnings: [], errors: [] };

      const lines = trimmed.split(/\\r?\\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) return { imported: 0, failed: 0, warnings: [], errors: [] };

      return await importRefreshTokens(lines);
    } catch (e) {
      throw new Error(safeErrorMessage(e));
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.ACCOUNTS_EXPORT_REFRESH_TOKENS,
    async (_event, accountIds: unknown) => {
      try {
        assertStringArray(accountIds, "accountIds");
        const ids = accountIds.map((id) => id.trim()).filter(Boolean);
        if (ids.length === 0) return "";

        const unique = new Set(ids);
        if (unique.size !== ids.length) throw new Error("Invalid accountIds: duplicate ids.");

        const missing: string[] = [];
        const tokens: string[] = [];

        for (const id of ids) {
          const token = getRefreshToken(id);
          if (!token) {
            missing.push(id);
            continue;
          }
          tokens.push(token);
        }

        if (missing.length > 0) {
          throw new Error(
            `Token unavailable for ${missing.length} selected account(s). If safeStorage encryption is unavailable, you must re-import tokens after restart.`
          );
        }

        return tokens.join("\n");
      } catch (e) {
        throw new Error(safeErrorMessage(e));
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.ACCOUNTS_UPDATE_META,
    async (_event, accountId: unknown, patch: unknown) => {
      try {
        assertString(accountId, "accountId");
        assertObject(patch, "patch");
        const metaPatch = patch as AccountMetaPatch;
        validateAccountMetaPatch(metaPatch);
        const normalized = normalizeAccountMetaPatch(metaPatch);
        return upsertAccountMeta(accountId, normalized);
      } catch (e) {
        throw new Error(safeErrorMessage(e));
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.ACCOUNTS_TEST_CONNECTIVITY, async (_event, accountId: unknown) => {
    try {
      assertString(accountId, "accountId");
      return await testConnectivity(accountId);
    } catch (e) {
      throw new Error(safeErrorMessage(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS.PREFERENCES_GET, async () => {
    return { ...preferences };
  });

  ipcMain.handle(IPC_CHANNELS.PREFERENCES_UPDATE, async (_event, patch: unknown) => {
    try {
      assertObject(patch, "patch");
      const next = applyPreferencesPatch(preferences, patch as PreferencesPatch);
      preferences.locale = next.locale;
      preferences.theme = next.theme;
      preferences.sidebarCollapsed = next.sidebarCollapsed;
      return { ...preferences };
    } catch (e) {
      throw new Error(safeErrorMessage(e));
    }
  });
}

function applyPreferencesPatch(current: Preferences, patch: PreferencesPatch): Preferences {
  const next: Preferences = {
    locale: patch.locale ?? current.locale,
    theme: patch.theme ?? current.theme,
    sidebarCollapsed: patch.sidebarCollapsed ?? current.sidebarCollapsed,
  };

  return next;
}
