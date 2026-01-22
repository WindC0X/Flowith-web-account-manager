import { ipcMain } from "electron";
import {
  IPC_CHANNELS,
  type AccountMetaPatch,
  type AccountSummary,
  type Preferences,
  type PreferencesPatch,
  type Rect,
} from "../shared/ipc";

const preferences: Preferences = {
  locale: "zh-CN",
  theme: "dark",
  sidebarCollapsed: false,
};

const accounts = new Map<string, AccountSummary>();
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
    return [...accounts.values()];
  });

  ipcMain.handle(IPC_CHANNELS.ACCOUNTS_IMPORT_REFRESH_TOKENS, async (_event, text: unknown) => {
    try {
      assertString(text, "text");
      const trimmed = text.trim();
      if (!trimmed) return { imported: 0, failed: 0, errors: [] };

      const lines = trimmed.split(/\\r?\\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) return { imported: 0, failed: 0, errors: [] };

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
        const current = accounts.get(accountId) ?? {
          id: accountId,
          displayName: "Account",
          tags: [],
          net: { proxy: { mode: "system" } },
          ua: { mode: "default" },
        };
        const next = applyAccountMetaPatch(current, patch as AccountMetaPatch);
        accounts.set(accountId, next);
        return next;
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

function applyAccountMetaPatch(current: AccountSummary, patch: AccountMetaPatch): AccountSummary {
  const next: AccountSummary = {
    ...current,
    displayName: patch.displayName ?? current.displayName,
    tags: patch.tags ?? current.tags,
    net: patch.net ?? current.net,
    ua: patch.ua ?? current.ua,
  };

  if (next.id === current.id) return next;
  return { ...next, id: current.id };
}

function applyPreferencesPatch(current: Preferences, patch: PreferencesPatch): Preferences {
  const next: Preferences = {
    locale: patch.locale ?? current.locale,
    theme: patch.theme ?? current.theme,
    sidebarCollapsed: patch.sidebarCollapsed ?? current.sidebarCollapsed,
  };

  return next;
}
