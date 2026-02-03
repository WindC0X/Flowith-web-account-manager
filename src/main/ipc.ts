import { BrowserWindow, clipboard, ipcMain, session } from "electron";
import {
  IPC_CHANNELS,
  IPC_EVENTS,
  type AccountsImportProgressEvent,
  type AccountMetaPatch,
  type DownloadSaveMode,
  type ImportRefreshTokensOptions,
  type Preferences,
  type PreferencesPatch,
  type ProxyConfig,
  type Rect,
  type UaConfig,
} from "../shared/ipc";
import { importRefreshTokens } from "./accounts/import";
import { normalizeAccountMetaPatch } from "./accounts/normalize";
import {
  deleteAccount,
  getAccount,
  getRefreshToken,
  isAccountSealed,
  isTokenEncryptionAvailable,
  listAccounts,
  setAccountSealed,
  setRefreshToken,
  upsertAccountMeta,
} from "./accounts/vault";
import {
  cancelDownload,
  copyDownloadedPath,
  getDownloadsHistory,
  getDownloadsPreferencesPublic,
  openDownloadedFile,
  pickDownloadsCustomDirectory,
  setDownloadsSaveMode,
  showDownloadInFolder,
} from "./downloads/service";
import { CreditsRateLimitedError, CreditsUnauthorizedError, fetchAccountCreditsWithAccessToken } from "./flowith/credits";
import { isKnownUsedRefreshToken, refreshFlowithSessionWithRefreshToken } from "./flowith/sessionRefresh";
import { testConnectivity } from "./network/connectivity";
import { applyProxy, validateProxyConfig } from "./network/proxy";
import { resolveUserAgent, validateUaConfig } from "./network/userAgent";
import { redactSensitive } from "./security/redact";
import { checkForUpdates, downloadUpdate, getUpdaterStatus, quitAndInstall } from "./updater/service";
import { partitionForAccount, type WebWorkspaceService } from "./workspace/WebWorkspaceService";
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

function assertBoolean(value: unknown, name: string): asserts value is boolean {
  if (typeof value !== "boolean") throw new Error(`Invalid ${name}: expected boolean`);
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
      const account = getAccount(accountId);
      if (account?.sealed) {
        throw new Error("该账号已封存（迁移后不可在本机打开）。如需换机，请在新设备导入迁移 token。");
      }
      deps.workspace.openTab(accountId);
      await deps.loginBootstrap.bootstrap(accountId);
    } catch (e) {
      throw new Error(safeErrorMessage(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_CLOSE_TAB, async (_event, accountId: unknown) => {
    try {
      assertString(accountId, "accountId");
      await deps.loginBootstrap.syncFromOpenTab(accountId, { timeoutMs: 1000 });
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

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_SET_OVERLAY_ACTIVE, async (_event, active: unknown) => {
    try {
      assertBoolean(active, "active");
      deps.workspace.setOverlayActive(active);
    } catch (e) {
      throw new Error(safeErrorMessage(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_CAPTURE_TAB_SNAPSHOT, async (_event, accountId: unknown) => {
    try {
      assertString(accountId, "accountId");
      return await deps.workspace.captureTabSnapshot(accountId);
    } catch (e) {
      throw new Error(safeErrorMessage(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_RELOAD_ACTIVE, async () => {
    deps.workspace.reloadActive();
  });

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_GET_STATE, async () => {
    return deps.workspace.getState();
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOADS_GET_HISTORY, async () => {
    return getDownloadsHistory();
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

  ipcMain.handle(IPC_CHANNELS.UPDATER_GET_STATUS, async () => {
    return getUpdaterStatus();
  });

  ipcMain.handle(IPC_CHANNELS.UPDATER_CHECK, async () => {
    try {
      return await checkForUpdates();
    } catch (e) {
      throw new Error(safeErrorMessage(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS.UPDATER_DOWNLOAD, async () => {
    try {
      return await downloadUpdate();
    } catch (e) {
      throw new Error(safeErrorMessage(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS.UPDATER_QUIT_AND_INSTALL, async () => {
    try {
      quitAndInstall();
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

  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_WRITE_TEXT, async (_event, text: unknown) => {
    try {
      assertString(text, "text");
      clipboard.writeText(text);
    } catch (e) {
      throw new Error(safeErrorMessage(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS.ACCOUNTS_LIST, async () => {
    return listAccounts();
  });

  ipcMain.handle(IPC_CHANNELS.ACCOUNTS_IS_TOKEN_ENCRYPTION_AVAILABLE, async () => {
    return isTokenEncryptionAvailable();
  });

  ipcMain.handle(IPC_CHANNELS.ACCOUNTS_DEBUG_AUTH_SOURCES, async (_event, accountId: unknown) => {
    try {
      assertString(accountId, "accountId");
      return await deps.loginBootstrap.debugAuthSourcesFromOpenTab(accountId);
    } catch (e) {
      throw new Error(safeErrorMessage(e));
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.ACCOUNTS_IMPORT_REFRESH_TOKENS,
    async (event, text: unknown, options?: unknown) => {
      try {
        assertString(text, "text");
        const trimmed = text.trim();
        if (!trimmed) return { imported: 0, failed: 0, warnings: [], errors: [] };

        const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        if (lines.length === 0) return { imported: 0, failed: 0, warnings: [], errors: [] };

        const total = lines.length;
        const sendImportProgress = (payload: AccountsImportProgressEvent) => {
          try {
            event.sender.send(IPC_EVENTS.ACCOUNTS_IMPORT_PROGRESS_EVENT, payload);
          } catch {
            // ignore
          }
        };

        let importOptions: ImportRefreshTokensOptions | undefined;
        if (options !== undefined) {
          assertObject(options, "options");
          const raw = options as Partial<ImportRefreshTokensOptions>;
          const normalized: ImportRefreshTokensOptions = {};

          if (raw.net !== undefined) {
            assertObject(raw.net, "options.net");
            const net = raw.net as Partial<{ proxy: unknown }>;
            if (net.proxy !== undefined) {
              assertObject(net.proxy, "options.net.proxy");
              const proxy = net.proxy as Partial<{ mode: unknown; rules?: unknown }>;
              if (typeof proxy.mode !== "string") throw new Error("Invalid options.net.proxy.mode: expected string");
              if (proxy.rules !== undefined && typeof proxy.rules !== "string") {
                throw new Error("Invalid options.net.proxy.rules: expected string");
              }

              const proxyConfig: ProxyConfig = {
                mode: proxy.mode as ProxyConfig["mode"],
                ...(proxy.rules !== undefined ? { rules: proxy.rules } : {}),
              };
              normalized.net = { proxy: proxyConfig };
            }
          }

          if (raw.ua !== undefined) {
            assertObject(raw.ua, "options.ua");
            const ua = raw.ua as Partial<{ mode: unknown; value?: unknown }>;
            if (typeof ua.mode !== "string") throw new Error("Invalid options.ua.mode: expected string");
            if (ua.value !== undefined && typeof ua.value !== "string") {
              throw new Error("Invalid options.ua.value: expected string");
            }
            const uaConfig: UaConfig = {
              mode: ua.mode as UaConfig["mode"],
              ...(ua.value !== undefined ? { value: ua.value } : {}),
            };
            normalized.ua = uaConfig;
          }

          importOptions = normalized;
        }

        sendImportProgress({ type: "start", total });
        try {
          const result = await importRefreshTokens(lines, importOptions, (payload) => sendImportProgress(payload));
          const creditsFailed = Object.keys(result.creditsErrorsByAccountId ?? {}).length;
          sendImportProgress({
            type: "end",
            total,
            imported: result.imported,
            failed: result.failed,
            creditsFailed,
          });
          return result;
        } catch (e) {
          sendImportProgress({
            type: "end",
            total,
            imported: 0,
            failed: total,
            creditsFailed: 0,
          });
          throw e;
        }
      } catch (e) {
        throw new Error(safeErrorMessage(e));
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.ACCOUNTS_EXPORT_REFRESH_TOKENS,
    async (_event, accountIds: unknown) => {
      try {
        assertStringArray(accountIds, "accountIds");
        const ids = accountIds.map((id) => id.trim()).filter(Boolean);
        if (ids.length === 0) return "";

        const unique = new Set(ids);
        if (unique.size !== ids.length) throw new Error("Invalid accountIds: duplicate ids.");

        const exportSyncDeadline = Date.now() + 3000;
        for (const id of ids) {
          const remaining = exportSyncDeadline - Date.now();
          if (remaining <= 0) break;
          await deps.loginBootstrap.syncFromOpenTab(id, { timeoutMs: Math.min(1000, remaining) });
        }

        const missingTabs: string[] = [];
        const missing: string[] = [];
        const tokens: string[] = [];

        for (const id of ids) {
          let token: string | null = null;

          const hasOpenTab = Boolean(deps.workspace.getWebContents(id));
          if (hasOpenTab) {
            const tabToken = await deps.loginBootstrap.waitForRefreshTokenFromOpenTab(id, {
              timeoutMs: 2500,
              requireActiveAccess: true,
            });
            if (!tabToken) {
              throw new Error(
                "Tab 登录态可能已失效/未就绪：读取不到活跃会话的 refresh_token。为避免导出旧 token，请在该账号 Tab 内刷新页面后重试。"
              );
            }
            if (isKnownUsedRefreshToken(id, tabToken)) {
              throw new Error(
                "Tab refresh_token 疑似已被轮换/失效。为避免导出旧 token，请在该账号 Tab 内刷新页面后重试。"
              );
            }
            token = tabToken;
            try {
              setRefreshToken(id, tabToken);
            } catch {
              // ignore
            }
          } else {
            if (isAccountSealed(id)) {
              token = getRefreshToken(id);
            } else {
              missingTabs.push(id);
              continue;
            }
          }

          if (!token) {
            missing.push(id);
            continue;
          }
          tokens.push(token);
        }

        if (missingTabs.length > 0) {
          const preview = missingTabs.slice(0, 6);
          const suffix = missingTabs.length > preview.length ? `…（共 ${missingTabs.length} 个）` : "";
          throw new Error(
            `导出需要先打开所选账号 Tab（用于读取最新登录态）。未打开 Tab：${preview.join(", ")}${suffix}`
          );
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
    IPC_CHANNELS.ACCOUNTS_EXPORT_MIGRATION_REFRESH_TOKENS,
    async (_event, accountIds: unknown) => {
      try {
        assertStringArray(accountIds, "accountIds");
        const ids = accountIds.map((id) => id.trim()).filter(Boolean);
        if (ids.length === 0) return "";

        const unique = new Set(ids);
        if (unique.size !== ids.length) throw new Error("Invalid accountIds: duplicate ids.");

        const tokens: string[] = [];

        for (const accountId of ids) {
          const hasOpenTab = Boolean(deps.workspace.getWebContents(accountId));
          if (!hasOpenTab) {
            throw new Error(
              "迁移导出需要先打开该账号 Tab（用于获取最新登录态并避免导出旧 token）。请先打开 Tab 并确保页面已加载完成。"
            );
          }

          await deps.loginBootstrap.syncFromOpenTab(accountId, { timeoutMs: 1200, forceRefreshTokenWrite: true });
          const tabToken = await deps.loginBootstrap.waitForRefreshTokenFromOpenTab(accountId, {
            timeoutMs: 4000,
            requireActiveAccess: true,
          });
          if (!tabToken) {
            throw new Error(
              "迁移导出失败：读取不到 Tab 内 refresh_token。请在该账号 Tab 内刷新页面后重试。"
            );
          }
          if (isKnownUsedRefreshToken(accountId, tabToken)) {
            throw new Error(
              "迁移导出失败：当前 Tab refresh_token 疑似已被使用/轮换。请在该账号 Tab 内刷新页面后重试。"
            );
          }

          const supabaseSession = await refreshFlowithSessionWithRefreshToken(accountId, tabToken);
          const nextToken = supabaseSession.refresh_token?.trim() || null;
          if (!nextToken) throw new Error("迁移导出失败：refreshSession 未返回 refresh_token。");

          // Ensure the new token is persisted to the vault (encrypted storage or runtime), then export it.
          try {
            setRefreshToken(accountId, nextToken);
          } catch {
            // ignore
          }

          tokens.push(nextToken);

          // Seal local state to avoid the just-exported token being reused on this machine.
          try {
            await deps.loginBootstrap.syncFromOpenTab(accountId, { timeoutMs: 600 });
          } catch {
            // ignore
          }
          try {
            setAccountSealed(accountId, true);
          } catch {
            // ignore
          }
          try {
            deps.workspace.closeTab(accountId);
          } catch {
            // ignore
          }
          try {
            const ses = session.fromPartition(partitionForAccount(accountId));
            await ses.clearStorageData();
          } catch {
            // ignore
          }
        }

        return tokens.join("\n");
      } catch (e) {
        throw new Error(safeErrorMessage(e));
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.ACCOUNTS_DELETE, async (_event, accountId: unknown) => {
    try {
      assertString(accountId, "accountId");
      await deps.loginBootstrap.syncFromOpenTab(accountId, { timeoutMs: 1000 });
      deps.workspace.closeTab(accountId);

      const deleted = deleteAccount(accountId);
      if (!deleted) throw new Error("Account not found.");

      try {
        const ses = session.fromPartition(partitionForAccount(accountId));
        await ses.clearStorageData();
      } catch {
        void 0;
      }
    } catch (e) {
      throw new Error(safeErrorMessage(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS.ACCOUNTS_SYNC_CREDITS_FROM_OPEN_TAB, async (_event, accountId: unknown) => {
    try {
      assertString(accountId, "accountId");

      const tabAccessToken = await deps.loginBootstrap.waitForAccessTokenFromOpenTab(accountId, { timeoutMs: 2500 });
      if (!tabAccessToken) return null;

      try {
        return await fetchAccountCreditsWithAccessToken(accountId, tabAccessToken);
      } catch (e) {
        if (e instanceof CreditsRateLimitedError) throw e;
        if (e instanceof CreditsUnauthorizedError) {
          await deps.loginBootstrap.syncFromOpenTab(accountId, { timeoutMs: 800 });
          const nextAccessToken = await deps.loginBootstrap.waitForAccessTokenFromOpenTab(accountId, {
            timeoutMs: 2500,
          });
          if (!nextAccessToken) return null;

          try {
            return await fetchAccountCreditsWithAccessToken(accountId, nextAccessToken);
          } catch (e2) {
            if (e2 instanceof CreditsRateLimitedError) throw e2;
            if (e2 instanceof CreditsUnauthorizedError) return null;
            throw e2;
          }
        }
        throw e;
      }
    } catch (e) {
      throw new Error(safeErrorMessage(e));
    }
  });

	  ipcMain.handle(
	    IPC_CHANNELS.ACCOUNTS_UPDATE_META,
	    async (_event, accountId: unknown, patch: unknown) => {
	      try {
	        assertString(accountId, "accountId");
	        assertObject(patch, "patch");
	        const metaPatch = patch as AccountMetaPatch;
	        validateAccountMetaPatch(metaPatch);
	        const normalized = normalizeAccountMetaPatch(metaPatch);
	        const updated = upsertAccountMeta(accountId, normalized);

	        const shouldApplyProxy = normalized.net?.proxy !== undefined;
	        const shouldApplyUa = normalized.ua !== undefined;
	        if (shouldApplyProxy || shouldApplyUa) {
	          const webContents = deps.workspace.getWebContents(accountId);
	          if (webContents && !webContents.isDestroyed()) {
	            if (shouldApplyUa) {
	              try {
	                const userAgent = resolveUserAgent(updated.ua);
	                webContents.setUserAgent(userAgent ?? webContents.session.getUserAgent());
	              } catch {
	                // best-effort
	              }
	            }
	            if (shouldApplyProxy) {
	              try {
	                await applyProxy(webContents.session, updated.net.proxy);
	              } catch {
	                // best-effort
	              }
	            }
	          }
	        }

	        return updated;
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
