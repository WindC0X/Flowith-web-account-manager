import { copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import StoreImport from "electron-store-v10";
import { createClient } from "@supabase/supabase-js";
import { resolveFlowithSupabaseConfig } from "../flowith/supabase";

const FLOWITHOS_SESSION_STORE_NAME = "supabase-session";
const FLOWITHOS_SESSION_ENCRYPTION_KEY = "flowith-browser-supabase-encryption-key-2024";
const FLOWITHOS_SESSION_FILE_NAME = "supabase-session.json";
const BACKUP_DIR_NAME = ".flowithos-account-manager-backups";
const TMP_DIR_NAME = ".flowithos-account-manager-tmp";

type ElectronStore = {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
  delete: (key: string) => void;
};

function storeCtor() {
  return (StoreImport as unknown as { default?: typeof StoreImport }).default ?? StoreImport;
}

async function createElectronStore(cwd: string): Promise<ElectronStore> {
  const StoreCtor = storeCtor() as unknown as new (options: Record<string, unknown>) => ElectronStore;
  return new StoreCtor({
    cwd,
    name: FLOWITHOS_SESSION_STORE_NAME,
    encryptionKey: FLOWITHOS_SESSION_ENCRYPTION_KEY,
  });
}

function nowTimestampForFilename(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(
    d.getSeconds()
  )}`;
}

function getSupabaseSessionStorageKey(supabaseUrl: string): string | null {
  try {
    const url = new URL(supabaseUrl);
    const ref = url.hostname.split(".")[0];
    if (!ref) return null;
    return `sb-${ref}-auth-token`;
  } catch {
    return null;
  }
}

async function verifyFlowithOsSessionReadable(userDataPath: string): Promise<void> {
  const { url } = resolveFlowithSupabaseConfig();
  const storageKey = getSupabaseSessionStorageKey(url);
  if (!storageKey) throw new Error("invalid supabase url");

  const store = await createElectronStore(userDataPath);
  const raw = store.get(storageKey);
  if (typeof raw !== "string" || raw.length === 0) throw new Error("session store missing");
  try {
    JSON.parse(raw);
  } catch {
    throw new Error("session store invalid json");
  }
}

async function renameFile(from: string, to: string): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.rename(from, to);
}

async function buildFlowithOsSessionFile(params: {
  userDataPath: string;
  accessToken: string;
  refreshToken: string;
}): Promise<{ tmpDir: string; sessionFilePath: string }> {
  const { url, anonKey } = resolveFlowithSupabaseConfig();

  const tmpBaseDir = join(params.userDataPath, TMP_DIR_NAME);
  const stamp = nowTimestampForFilename();
  const tmpDir = join(tmpBaseDir, stamp);
  await mkdir(tmpDir, { recursive: true });

  const store = await createElectronStore(tmpDir);
  const electronStorage = {
    getItem: (key: string) => {
      const v = store.get(key);
      return v ? String(v) : null;
    },
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  };

  const supabase = createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: true,
      detectSessionInUrl: false,
      storage: electronStorage,
    },
  });

  const { error } = await supabase.auth.setSession({
    access_token: params.accessToken,
    refresh_token: params.refreshToken,
  });
  if (error) throw new Error("setSession failed");

  const sessionFilePath = join(tmpDir, FLOWITHOS_SESSION_FILE_NAME);
  const fileStat = await stat(sessionFilePath);
  if (fileStat.size <= 0) throw new Error("session file empty");

  const storageKey = getSupabaseSessionStorageKey(url);
  if (!storageKey) throw new Error("invalid supabase url");
  const stored = store.get(storageKey);
  if (typeof stored !== "string" || stored.length === 0) throw new Error("session store missing");
  try {
    JSON.parse(stored);
  } catch {
    throw new Error("session store invalid json");
  }

  return { tmpDir, sessionFilePath };
}

export async function createFlowithOsBackup(userDataPath: string): Promise<{ backupPath: string; targetPath: string }> {
  const targetPath = join(userDataPath, FLOWITHOS_SESSION_FILE_NAME);
  const backupDir = join(userDataPath, BACKUP_DIR_NAME);
  await mkdir(backupDir, { recursive: true });

  const backupPath = join(backupDir, `${FLOWITHOS_SESSION_FILE_NAME}.bak-${nowTimestampForFilename()}`);
  await copyFile(targetPath, backupPath);
  return { backupPath, targetPath };
}

export async function restoreFlowithOsBackup(params: {
  backupPath: string;
  targetPath: string;
}): Promise<{ success: true } | { success: false; message: string }> {
  try {
    const restoreTmp = join(dirname(params.targetPath), `${FLOWITHOS_SESSION_FILE_NAME}.restore-${nowTimestampForFilename()}.tmp`);
    await copyFile(params.backupPath, restoreTmp);
    await renameFile(restoreTmp, params.targetPath);
    return { success: true };
  } catch (e) {
    return { success: false, message: e instanceof Error ? e.message : "restore failed" };
  }
}

export async function writeFlowithOsSessionFromTokens(params: {
  userDataPath: string;
  accessToken: string;
  refreshToken: string;
}): Promise<
  | { success: true; backupPath: string | null; targetPath: string }
  | { success: false; message: string; backupPath?: string; targetPath?: string }
> {
  const targetPath = join(params.userDataPath, FLOWITHOS_SESSION_FILE_NAME);
  let backupPath: string | null = null;
  let tmpDir: string | null = null;
  try {
    const targetExists = await stat(targetPath)
      .then((s) => s.isFile())
      .catch(() => false);
    if (targetExists) {
      const backup = await createFlowithOsBackup(params.userDataPath);
      backupPath = backup.backupPath;
    }

    const built = await buildFlowithOsSessionFile({
      userDataPath: params.userDataPath,
      accessToken: params.accessToken,
      refreshToken: params.refreshToken,
    });
    tmpDir = built.tmpDir;

    await renameFile(built.sessionFilePath, targetPath);
    await verifyFlowithOsSessionReadable(params.userDataPath);
    if (tmpDir) {
      try {
        await rm(tmpDir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
    return { success: true, backupPath, targetPath };
  } catch (e) {
    if (backupPath) await restoreFlowithOsBackup({ backupPath, targetPath });
    if (tmpDir) {
      try {
        await rm(tmpDir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
    return {
      success: false,
      message: e instanceof Error ? e.message : "write failed",
      ...(backupPath ? { backupPath } : {}),
      ...(targetPath ? { targetPath } : {}),
    };
  }
}

export async function findLatestFlowithOsBackup(userDataPath: string): Promise<string | null> {
  const backupDir = join(userDataPath, BACKUP_DIR_NAME);
  try {
    const files = await readdir(backupDir, { withFileTypes: true });
    const candidates = files
      .filter((d) => d.isFile() && d.name.startsWith(`${FLOWITHOS_SESSION_FILE_NAME}.bak-`))
      .map((d) => d.name)
      .sort()
      .reverse();
    if (candidates.length === 0) return null;
    const latest = candidates[0];
    if (!latest) return null;
    return join(backupDir, latest);
  } catch {
    return null;
  }
}
