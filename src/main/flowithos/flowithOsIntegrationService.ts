import { app } from "electron";
import StoreImport from "electron-store";
import FlowithOsStoreImport from "electron-store-v10";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { access, constants, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { Session as SupabaseSession } from "@supabase/supabase-js";
import type { FlowithOsStatus, FlowithOsSyncResult, FlowithOsWriteSessionResult } from "../../shared/ipc";
import { extractSupabaseSessionTokensFromStorageValue } from "../workspace/supabaseAuthStorage";
import { findAccountIdByFingerprint, getRefreshToken, setRefreshToken } from "../accounts/vault";
import { refreshFlowithSessionForAccount } from "../flowith/sessionRefresh";
import { resolveFlowithSupabaseConfig } from "../flowith/supabase";
import { redactSensitive } from "../security/redact";
import { writeFlowithOsSessionFromTokens } from "./flowithOsSessionWriter";
import { getFlowithOsAccountManagerStoreCwd } from "./storeDir";

const execFileAsync = promisify(execFile);

const SESSION_FILE_NAME = "supabase-session.json";
const FLOWITHOS_SESSION_STORE_NAME = "supabase-session";
const FLOWITHOS_SESSION_ENCRYPTION_KEY = "flowith-browser-supabase-encryption-key-2024";

const EXTERNAL_STORE_NAME = "flowithos-integration";
const EXTERNAL_SETTINGS_KEY = "flowithos.userDataPathOverride";

const INTERNAL_STORE_NAME = "fwd-flowithos-integration";
const INTERNAL_LINKED_ACCOUNT_ID_KEY = "flowithos.linkedAccountId";
const INTERNAL_LINKED_USER_ID_KEY = "flowithos.linkedUserId";
const INTERNAL_LAST_SYNC_AT_KEY = "flowithos.lastSyncedAt";
const INTERNAL_LAST_SEEN_AT_KEY = "flowithos.lastSeenAt";
const INTERNAL_LAST_SEEN_USER_ID_KEY = "flowithos.lastSeenUserId";

type InternalStoreSchema = Record<string, unknown>;

function storeCtor() {
  return (StoreImport as unknown as { default?: typeof StoreImport }).default ?? StoreImport;
}

function flowithOsStoreCtor() {
  return (FlowithOsStoreImport as unknown as { default?: typeof FlowithOsStoreImport }).default ?? FlowithOsStoreImport;
}

function fingerprintRefreshToken(refreshToken: string): string {
  return createHash("sha256").update(refreshToken).digest("hex").slice(0, 12);
}

function isWritableFile(path: string): Promise<boolean> {
  return access(path, constants.R_OK | constants.W_OK)
    .then(() => true)
    .catch(() => false);
}

function isWritableDir(path: string): Promise<boolean> {
  return access(path, constants.R_OK | constants.W_OK)
    .then(() => true)
    .catch(() => false);
}

async function canCreatePath(targetDir: string): Promise<boolean> {
  if (!targetDir) return false;

  let current = targetDir;
  for (let i = 0; i < 16; i += 1) {
    if (await isExistingDir(current)) {
      return await isWritableDir(current);
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return false;
}

async function isExistingDir(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function isExistingFile(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

let flowithOsRunningCache: { checkedAt: number; running: boolean } | null = null;

async function detectFlowithOsRunning(): Promise<boolean> {
  if (process.platform !== "win32") return false;
  const now = Date.now();
  if (flowithOsRunningCache && now - flowithOsRunningCache.checkedAt < 5000) {
    return flowithOsRunningCache.running;
  }
  try {
    const processNames = new Set(["flowith-os-beta.exe", "flowithos beta.exe"]);
    const { stdout } = await execFileAsync("tasklist", ["/FO", "CSV", "/NH"]);
    const lines = String(stdout)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    for (const line of lines) {
      if (!line.startsWith("\"")) continue;
      const end = line.indexOf("\",\"");
      if (end <= 1) continue;
      const imageName = line.slice(1, end).toLowerCase();
      if (processNames.has(imageName)) {
        flowithOsRunningCache = { checkedAt: now, running: true };
        return true;
      }
    }

    flowithOsRunningCache = { checkedAt: now, running: false };
    return false;
  } catch {
    flowithOsRunningCache = { checkedAt: now, running: false };
    return false;
  }
}

function safeString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  return String(value ?? "");
}

function readUserDataPathOverrideFromExternalStore(): string | null {
  try {
    const cwd = getFlowithOsAccountManagerStoreCwd();
    const StoreCtor = storeCtor();
    const store = new StoreCtor<Record<string, unknown>>({ name: EXTERNAL_STORE_NAME, ...(cwd ? { cwd } : {}) });
    const override = store.get(EXTERNAL_SETTINGS_KEY, null) as unknown;
    if (typeof override === "string" && override.trim()) return override.trim();
    return null;
  } catch {
    return null;
  }
}

function createInternalStore() {
  const StoreCtor = storeCtor();
  return new StoreCtor<InternalStoreSchema>({ name: INTERNAL_STORE_NAME });
}

type FlowithOsSessionSnapshot = {
  accessToken: string | null;
  refreshToken: string | null;
  userId: string | null;
  email: string | null;
};

function getFlowithOsSupabaseSessionStorageKey(): string {
  const { projectRef } = resolveFlowithSupabaseConfig();
  return `sb-${projectRef}-auth-token`;
}

function parseUserInfoFromSessionValue(value: unknown): { userId: string | null; email: string | null } {
  if (!value || typeof value !== "object") return { userId: null, email: null };
  const record = value as Record<string, unknown>;
  const user = record.user && typeof record.user === "object" ? (record.user as Record<string, unknown>) : null;
  const userId = user && typeof user.id === "string" ? String(user.id) : null;
  const email = user && typeof user.email === "string" ? String(user.email) : null;
  return { userId, email };
}

function readFlowithOsSessionFromUserDataPath(userDataPath: string): FlowithOsSessionSnapshot | null {
  try {
    const StoreCtor = flowithOsStoreCtor();
    const store = new StoreCtor<Record<string, unknown>>({
      cwd: userDataPath,
      name: FLOWITHOS_SESSION_STORE_NAME,
      encryptionKey: FLOWITHOS_SESSION_ENCRYPTION_KEY,
    });

    const storageKey = getFlowithOsSupabaseSessionStorageKey();
    const raw = store.get(storageKey);
    if (typeof raw !== "string" || !raw.trim()) return null;

    const tokens = extractSupabaseSessionTokensFromStorageValue(raw);
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    const userInfo = parseUserInfoFromSessionValue(parsed);
    return {
      accessToken: tokens?.accessToken ?? null,
      refreshToken: tokens?.refreshToken ?? null,
      userId: userInfo.userId,
      email: userInfo.email,
    };
  } catch {
    return null;
  }
}

export class FlowithOsIntegrationService {
  private readonly store = createInternalStore();
  private watcher: FSWatcher | null = null;
  private watchDir: string | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private syncInFlight: Promise<void> | null = null;
  private periodicSync: ReturnType<typeof setInterval> | null = null;

  dispose(): void {
    try {
      this.watcher?.close();
    } catch {
      // ignore
    }
    this.watcher = null;
    this.watchDir = null;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = null;
    if (this.periodicSync) clearInterval(this.periodicSync);
    this.periodicSync = null;
  }

  private ensurePeriodicSync(): void {
    if (this.periodicSync) return;
    this.periodicSync = setInterval(() => {
      void this.syncFromFlowithOs({ silent: true });
    }, 15_000);
  }

  private getDefaultUserDataPath(): string {
    return join(app.getPath("appData"), "flowith-os-beta");
  }

  async getUserDataPath(): Promise<string> {
    const override = readUserDataPathOverrideFromExternalStore();
    return override || this.getDefaultUserDataPath();
  }

  private linkedAccountId(): string | null {
    const raw = this.store.get(INTERNAL_LINKED_ACCOUNT_ID_KEY, null) as unknown;
    return typeof raw === "string" && raw.trim() ? raw.trim() : null;
  }

  private linkedUserId(): string | null {
    const raw = this.store.get(INTERNAL_LINKED_USER_ID_KEY, null) as unknown;
    return typeof raw === "string" && raw.trim() ? raw.trim() : null;
  }

  private lastSyncedAt(): number | null {
    const raw = this.store.get(INTERNAL_LAST_SYNC_AT_KEY, null) as unknown;
    return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  }

  private lastSeenAt(): number | null {
    const raw = this.store.get(INTERNAL_LAST_SEEN_AT_KEY, null) as unknown;
    return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  }

  private lastSeenUserId(): string | null {
    const raw = this.store.get(INTERNAL_LAST_SEEN_USER_ID_KEY, null) as unknown;
    return typeof raw === "string" && raw.trim() ? raw.trim() : null;
  }

  private noteSeen(session: FlowithOsSessionSnapshot): void {
    try {
      this.store.set(INTERNAL_LAST_SEEN_AT_KEY, Date.now());
      this.store.set(INTERNAL_LAST_SEEN_USER_ID_KEY, session.userId ?? "");
    } catch {
      // ignore
    }
  }

  private ensureWatcher(userDataPath: string): void {
    if (!userDataPath) return;
    if (this.watcher && this.watchDir === userDataPath) return;

    this.dispose();
    this.watchDir = userDataPath;
    this.ensurePeriodicSync();

    try {
      this.watcher = watch(userDataPath, { persistent: false }, (_eventType, filename) => {
        const name = typeof filename === "string" ? filename : "";
        if (!name || name !== SESSION_FILE_NAME) return;
        if (this.debounce) clearTimeout(this.debounce);
        this.debounce = setTimeout(() => {
          this.debounce = null;
          void this.syncFromFlowithOs({ silent: true });
        }, 600);
      });
    } catch {
      this.watcher = null;
      this.watchDir = null;
    }
  }

  async getStatus(): Promise<FlowithOsStatus> {
    const userDataPath = await this.getUserDataPath();
    const sessionFilePath = join(userDataPath, SESSION_FILE_NAME);

    const sessionDirExists = await isExistingDir(userDataPath);
    const sessionFileExists = await isExistingFile(sessionFilePath);
    const dirWritable = sessionDirExists ? await isWritableDir(userDataPath) : await canCreatePath(userDataPath);
    const fileWritable = sessionFileExists ? await isWritableFile(sessionFilePath) : true;
    const sessionFileWritable = dirWritable && fileWritable;
    const running = await detectFlowithOsRunning();

    let reason: string | undefined;
    if (running) reason = "检测到 flowithOS 正在运行，为避免写入竞争已禁用切号";
    else if (!dirWritable) reason = "flowithOS userData 目录不可写，无法创建/写入会话文件";
    else if (!sessionDirExists) reason = "未找到 flowithOS userData 目录，将在首次写入时创建";
    else if (!sessionFileExists) reason = "未找到 supabase-session.json，将在首次写入时创建";
    else if (!fileWritable) reason = "supabase-session.json 不可写，可能权限不足或文件占用";

    this.ensureWatcher(userDataPath);

    return {
      userDataPath,
      sessionFilePath,
      sessionDirExists,
      sessionFileExists,
      sessionFileWritable,
      running,
      ...(reason ? { reason } : {}),
      linkedAccountId: this.linkedAccountId(),
      linkedUserId: this.linkedUserId(),
      lastSyncedAt: this.lastSyncedAt(),
      lastSeenAt: this.lastSeenAt(),
      lastSeenUserId: this.lastSeenUserId(),
    };
  }

  async writeSessionFromAccount(
    accountId: string,
    options?: { onAlreadyUsed?: () => Promise<void> }
  ): Promise<FlowithOsWriteSessionResult> {
    const status = await this.getStatus();
    if (status.running) return { success: false, message: status.reason || "flowithOS 正在运行" };
    if (!status.sessionFileWritable) {
      return { success: false, message: status.reason || "目标文件不可用（不可写）" };
    }

    let session: SupabaseSession;
    try {
      const refreshOptions = options?.onAlreadyUsed ? { onAlreadyUsed: options.onAlreadyUsed } : undefined;
      session = await refreshFlowithSessionForAccount(accountId, refreshOptions);
    } catch (e) {
      return { success: false, message: redactSensitive(safeString(e)) };
    }

    const accessToken = session.access_token ?? "";
    const refreshToken = session.refresh_token ?? "";
    if (!accessToken || !refreshToken) return { success: false, message: "缺少 token，需要重新登录" };

    const writeRes = await writeFlowithOsSessionFromTokens({
      userDataPath: status.userDataPath,
      accessToken,
      refreshToken,
    });
    if (!writeRes.success) return { success: false, message: redactSensitive(writeRes.message) };

    try {
      this.store.set(INTERNAL_LINKED_ACCOUNT_ID_KEY, accountId);
      this.store.set(INTERNAL_LINKED_USER_ID_KEY, session.user?.id ?? "");
      this.store.set(INTERNAL_LAST_SYNC_AT_KEY, Date.now());
    } catch {
      // ignore
    }
    this.ensureWatcher(status.userDataPath);

    return {
      success: true,
      backupPath: writeRes.backupPath,
      targetPath: writeRes.targetPath,
      userId: session.user?.id ?? null,
      email: session.user?.email ?? null,
    };
  }

  async syncFromFlowithOs(options?: { silent?: boolean }): Promise<FlowithOsSyncResult> {
    if (this.syncInFlight) {
      try {
        await this.syncInFlight;
      } catch {
        // ignore
      }
      return { success: true, updated: false, accountId: null, reason: "in_flight" };
    }

    const task = (async (): Promise<FlowithOsSyncResult> => {
      const status = await this.getStatus();
      if (!status.sessionDirExists || !status.sessionFileExists) {
        const msg = status.reason || "目标文件不可用";
        return options?.silent ? { success: true, updated: false, accountId: null, reason: "unavailable" } : { success: false, message: msg };
      }

      const snapshot = readFlowithOsSessionFromUserDataPath(status.userDataPath);
      if (!snapshot || !snapshot.refreshToken) {
        const msg = "无法从 flowithOS 会话文件读取 refresh_token";
        return options?.silent ? { success: true, updated: false, accountId: null, reason: "missing_tokens" } : { success: false, message: msg };
      }

      this.noteSeen(snapshot);

      const linkedAccountId = this.linkedAccountId();
      const linkedUserId = this.linkedUserId();

      let targetAccountId: string | null = null;
      if (linkedAccountId) {
        if (linkedUserId && snapshot.userId && linkedUserId !== snapshot.userId) {
          return { success: true, updated: false, accountId: linkedAccountId, reason: "user_mismatch", userId: snapshot.userId, email: snapshot.email };
        }
        targetAccountId = linkedAccountId;
      } else {
        const fp = fingerprintRefreshToken(snapshot.refreshToken);
        targetAccountId = findAccountIdByFingerprint(fp);
        if (targetAccountId) {
          try {
            this.store.set(INTERNAL_LINKED_ACCOUNT_ID_KEY, targetAccountId);
            this.store.set(INTERNAL_LINKED_USER_ID_KEY, snapshot.userId ?? "");
          } catch {
            // ignore
          }
        }
      }

      if (!targetAccountId) {
        return { success: true, updated: false, accountId: null, reason: "no_match", userId: snapshot.userId, email: snapshot.email };
      }

      const current = getRefreshToken(targetAccountId);
      if (current && current === snapshot.refreshToken) {
        return { success: true, updated: false, accountId: targetAccountId, reason: "up_to_date", userId: snapshot.userId, email: snapshot.email };
      }

      try {
        setRefreshToken(targetAccountId, snapshot.refreshToken);
        this.store.set(INTERNAL_LAST_SYNC_AT_KEY, Date.now());
        if (!linkedAccountId) {
          this.store.set(INTERNAL_LINKED_ACCOUNT_ID_KEY, targetAccountId);
          this.store.set(INTERNAL_LINKED_USER_ID_KEY, snapshot.userId ?? "");
        }
      } catch {
        // ignore
      }

      return { success: true, updated: true, accountId: targetAccountId, userId: snapshot.userId, email: snapshot.email };
    })();

    this.syncInFlight = task.then(() => void 0).catch(() => void 0).finally(() => {
      this.syncInFlight = null;
    });

    return await task;
  }
}
