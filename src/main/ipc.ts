import { ipcMain } from "electron";
import {
  IPC_CHANNELS,
  type AccountMetaPatch,
  type Preferences,
  type PreferencesPatch,
  type Rect,
} from "../shared/ipc";
import { isTokenEncryptionAvailable, listAccounts, upsertAccountMeta } from "./accounts/vault";

const preferences: Preferences = {
  locale: "zh-CN",
  theme: "dark",
  sidebarCollapsed: false,
};

let activeAccountId: string | null = null;

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === "string") {
    return redactSensitive(error.message);
  }
  return "Unknown error";
}

function redactSensitive(text: string): string {
  return text
    .replace(/\\b[a-zA-Z0-9_\\-]{24,}\\b/g, "[REDACTED]")
    .slice(0, 400);
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

export function registerIpcHandlers() {
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_OPEN_TAB, async (_event, accountId: unknown) => {
    try {
      assertString(accountId, "accountId");
      activeAccountId = accountId;
    } catch (e) {
      throw new Error(safeErrorMessage(e));
    }
  });

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_CLOSE_TAB, async (_event, accountId: unknown) => {
    try {
      assertString(accountId, "accountId");
      if (activeAccountId === accountId) activeAccountId = null;
    } catch (e) {
      throw new Error(safeErrorMessage(e));
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.WORKSPACE_SET_ACTIVE_TAB,
    async (_event, accountId: unknown) => {
      try {
        assertString(accountId, "accountId");
        activeAccountId = accountId;
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
      } catch (e) {
        throw new Error(safeErrorMessage(e));
      }
    }
  );

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_RELOAD_ACTIVE, async () => {
    return;
  });

  ipcMain.handle(IPC_CHANNELS.ACCOUNTS_LIST, async () => {
    return listAccounts();
  });

  ipcMain.handle(IPC_CHANNELS.ACCOUNTS_IMPORT_REFRESH_TOKENS, async (_event, text: unknown) => {
    try {
      assertString(text, "text");
      const trimmed = text.trim();
      if (!trimmed) return { imported: 0, failed: 0, errors: [] };

      const lines = trimmed.split(/\\r?\\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) return { imported: 0, failed: 0, errors: [] };

      if (!isTokenEncryptionAvailable()) {
        return {
          imported: 0,
          failed: lines.length,
          errors: [
            "Token encryption is unavailable on this host. Tokens will not be persisted and must be re-imported after restart.",
            "Import is not implemented yet.",
          ],
        };
      }

      return {
        imported: 0,
        failed: lines.length,
        errors: ["Import is not implemented yet."],
      };
    } catch (e) {
      throw new Error(safeErrorMessage(e));
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.ACCOUNTS_EXPORT_REFRESH_TOKENS,
    async (_event, accountIds: unknown) => {
      try {
        assertStringArray(accountIds, "accountIds");
        return "";
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
