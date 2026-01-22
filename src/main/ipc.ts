import { ipcMain } from "electron";
import {
  IPC_CHANNELS,
  type AccountMetaPatch,
  type Preferences,
  type PreferencesPatch,
  type Rect,
} from "../shared/ipc";
import { importRefreshTokens } from "./accounts/import";
import { getRefreshToken, listAccounts, upsertAccountMeta } from "./accounts/vault";
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
        return upsertAccountMeta(accountId, patch as AccountMetaPatch);
      } catch (e) {
        throw new Error(safeErrorMessage(e));
      }
    }
  );

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
