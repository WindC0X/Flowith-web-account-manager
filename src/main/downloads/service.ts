import { app, clipboard, dialog, shell } from "electron";
import type { BrowserWindow, DownloadItem, Session } from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, parse } from "node:path";
import {
  IPC_EVENTS,
  type DownloadEvent,
  type DownloadHistoryItem,
  type DownloadPreferencesPublic,
  type DownloadSaveMode,
} from "../../shared/ipc";
import {
  getDownloadsPreferencesInternal,
  setDownloadsCustomDir,
  setDownloadsMode,
  toDownloadsPreferencesPublic,
} from "./preferences";
import { computeSaveAsDedupKeys } from "./saveAsDedup";

type DownloadRecordState = "progressing" | "completed" | "cancelled" | "interrupted";
type DownloadRecord = {
  id: string;
  accountId: string;
  filename: string;
  receivedBytes: number;
  totalBytes: number;
  state: DownloadRecordState;
  item: DownloadItem | null;
  savePath: string | null;
  lastProgressEventAt: number;
  updatedAt: number;
};

type PersistedDownloadRecord = {
  id: string;
  accountId: string;
  filename: string;
  receivedBytes: number;
  totalBytes: number;
  state: DownloadRecordState;
  updatedAt: number;
  savePath: string | null;
};

const attachedSessions = new WeakSet<Session>();
const downloadsById = new Map<string, DownloadRecord>();
const downloadIdByItem = new WeakMap<DownloadItem, string>();
const saveAsInFlightByKey = new Map<string, number>();

const DOWNLOAD_HISTORY_LIMIT = 1000;
const DOWNLOAD_HISTORY_FILENAME = "downloads-history.json";
let historyLoaded = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function sendEvent(getWindow: () => BrowserWindow | null, event: DownloadEvent) {
  const win = getWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IPC_EVENTS.DOWNLOAD_EVENT, event);
}

function getHistoryPath(): string | null {
  try {
    const base = app.getPath("userData");
    if (!base) return null;
    return join(base, DOWNLOAD_HISTORY_FILENAME);
  } catch {
    return null;
  }
}

function persistHistorySoon(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const path = getHistoryPath();
    if (!path) return;

    const all = [...downloadsById.values()];
    const sorted = all.sort((a, b) => b.updatedAt - a.updatedAt);
    const keep = sorted.slice(0, DOWNLOAD_HISTORY_LIMIT);

    const keepIds = new Set(keep.map((r) => r.id));
    for (const id of downloadsById.keys()) {
      if (keepIds.has(id)) continue;
      downloadsById.delete(id);
    }

    const payload: PersistedDownloadRecord[] = keep.map((r) => ({
      id: r.id,
      accountId: r.accountId,
      filename: r.filename,
      receivedBytes: r.receivedBytes,
      totalBytes: r.totalBytes,
      state: r.state,
      updatedAt: r.updatedAt,
      savePath: r.savePath,
    }));

    try {
      const tmp = `${path}.tmp`;
      const dir = dirname(path);
      if (dir && !existsSync(dir)) {
        // Best-effort; userData should exist already, but keep this safe.
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(tmp, JSON.stringify(payload), "utf-8");
      try {
        renameSync(tmp, path);
      } catch {
        try {
          unlinkSync(path);
          renameSync(tmp, path);
        } catch {
          try {
            writeFileSync(path, JSON.stringify(payload), "utf-8");
          } catch {
            // ignore
          }
          try {
            unlinkSync(tmp);
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore persistence failures
    }
  }, 250);
}

function ensureHistoryLoaded(): void {
  if (historyLoaded) return;
  historyLoaded = true;

  const path = getHistoryPath();
  if (!path || !existsSync(path)) return;

  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return;

    let mutated = false;
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Partial<PersistedDownloadRecord>;
      const id = typeof record.id === "string" ? record.id : "";
      if (!id || downloadsById.has(id)) continue;

      const state: DownloadRecordState =
        record.state === "completed" || record.state === "cancelled" || record.state === "interrupted"
          ? record.state
          : "interrupted";
      if (record.state === "progressing") mutated = true;

      const loaded: DownloadRecord = {
        id,
        accountId: typeof record.accountId === "string" ? record.accountId : "unknown",
        filename: typeof record.filename === "string" ? record.filename : "download",
        receivedBytes: typeof record.receivedBytes === "number" ? Math.max(0, record.receivedBytes) : 0,
        totalBytes: typeof record.totalBytes === "number" ? Math.max(0, record.totalBytes) : 0,
        state,
        item: null,
        savePath: typeof record.savePath === "string" ? record.savePath : null,
        lastProgressEventAt: 0,
        updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : Date.now(),
      };

      downloadsById.set(id, loaded);
    }

    if (mutated) persistHistorySoon();
  } catch {
    // ignore parse failures
  }
}

function nextAvailablePath(dir: string, filename: string): string {
  const parsed = parse(filename);
  const base = parsed.name || "download";
  const ext = parsed.ext || "";

  const direct = join(dir, `${base}${ext}`);
  if (!existsSync(direct)) return direct;

  for (let i = 1; i <= 999; i++) {
    const candidate = join(dir, `${base} (${i})${ext}`);
    if (!existsSync(candidate)) return candidate;
  }

  return join(dir, `${base} (${Date.now()})${ext}`);
}

function resolveAutoDirectory(mode: DownloadSaveMode, customDir: string | null): string | null {
  if (mode === "downloads") return app.getPath("downloads");
  if (mode === "customDir" && customDir && existsSync(customDir)) return customDir;
  return null;
}

function readItemSavePath(item: DownloadItem): string | null {
  try {
    const raw = item.getSavePath();
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}

function syncSavePath(record: DownloadRecord, item: DownloadItem): void {
  const path = readItemSavePath(item);
  if (!path) return;
  record.savePath = path;
}

function trackDownload(
  downloadId: string,
  item: DownloadItem,
  getWindow: () => BrowserWindow | null
): DownloadRecord {
  ensureHistoryLoaded();
  const now = Date.now();
  const record: DownloadRecord = {
    id: downloadId,
    accountId: "unknown",
    filename: item.getFilename() || "download",
    receivedBytes: 0,
    totalBytes: Math.max(0, item.getTotalBytes()),
    state: "progressing",
    item,
    savePath: readItemSavePath(item),
    lastProgressEventAt: 0,
    updatedAt: now,
  };

  downloadsById.set(downloadId, record);

  item.on("updated", () => {
    record.receivedBytes = Math.max(0, item.getReceivedBytes());
    record.totalBytes = Math.max(0, item.getTotalBytes());
    syncSavePath(record, item);
    record.updatedAt = Date.now();

    const now = Date.now();
    if (now - record.lastProgressEventAt < 350) return;
    record.lastProgressEventAt = now;

    sendEvent(getWindow, {
      type: "progress",
      id: downloadId,
      receivedBytes: record.receivedBytes,
      totalBytes: record.totalBytes,
    });
  });

  item.on("done", (_event, state) => {
    record.receivedBytes = Math.max(0, item.getReceivedBytes());
    record.totalBytes = Math.max(0, item.getTotalBytes());
    syncSavePath(record, item);
    record.item = null;
    record.state = state;
    record.updatedAt = Date.now();
    persistHistorySoon();

    sendEvent(getWindow, {
      type: "done",
      id: downloadId,
      state,
    });
  });

  return record;
}

export function attachDownloadsToSession(
  session: Session,
  accountId: string,
  getWindow: () => BrowserWindow | null
): void {
  if (attachedSessions.has(session)) return;
  attachedSessions.add(session);

  session.on("will-download", (_event, item) => {
    const existingId = downloadIdByItem.get(item);
    if (existingId) return;

    const prefs = getDownloadsPreferencesInternal();
    const autoDir = resolveAutoDirectory(prefs.mode, prefs.customDir);
    const filename = item.getFilename() || "download";
    const saveAsKeys = computeSaveAsDedupKeys(accountId, item, filename);

    if (!autoDir) {
      const hasInFlight = saveAsKeys.some((key) => typeof saveAsInFlightByKey.get(key) === "number");
      if (hasInFlight) {
        item.cancel();
        return;
      }
      const now = Date.now();
      for (const key of saveAsKeys) saveAsInFlightByKey.set(key, now);
      item.once("done", () => {
        for (const key of saveAsKeys) saveAsInFlightByKey.delete(key);
      });
    }

    const downloadId = randomUUID();
    downloadIdByItem.set(item, downloadId);
    const record = trackDownload(downloadId, item, getWindow);
    record.accountId = accountId;

    sendEvent(getWindow, {
      type: "start",
      id: downloadId,
      accountId,
      filename,
      totalBytes: record.totalBytes,
    });
    record.updatedAt = Date.now();
    persistHistorySoon();

	    if (!autoDir) {
	      try {
	        const defaultPath = nextAvailablePath(app.getPath("downloads"), filename);
	        item.setSaveDialogOptions({ defaultPath });
	      } catch {
	        // ignore
	      }
	      return;
	    }

    const savePath = nextAvailablePath(autoDir, filename);
    record.savePath = savePath;
    item.setSavePath(savePath);
  });
}

export function getDownloadsPreferencesPublic(): DownloadPreferencesPublic {
  return toDownloadsPreferencesPublic(getDownloadsPreferencesInternal());
}

export function setDownloadsSaveMode(mode: DownloadSaveMode): DownloadPreferencesPublic {
  return toDownloadsPreferencesPublic(setDownloadsMode(mode));
}

export async function pickDownloadsCustomDirectory(
  win: BrowserWindow | null
): Promise<DownloadPreferencesPublic> {
  const openDialog = win
    ? dialog.showOpenDialog(win, {
        title: "Select download directory",
        properties: ["openDirectory", "createDirectory"],
      })
    : dialog.showOpenDialog({
        title: "Select download directory",
        properties: ["openDirectory", "createDirectory"],
      });

  const result = await openDialog;

  if (!result.canceled && result.filePaths[0]) {
    setDownloadsMode("customDir");
    setDownloadsCustomDir(result.filePaths[0]);
  }

  return toDownloadsPreferencesPublic(getDownloadsPreferencesInternal());
}

function requireDownload(downloadId: string): DownloadRecord {
  ensureHistoryLoaded();
  const record = downloadsById.get(downloadId);
  if (!record) throw new Error("Download not found.");
  return record;
}

function requireSavePath(record: DownloadRecord): string {
  if (!record.savePath) throw new Error("Save path is unavailable for this download.");
  return record.savePath;
}

export function showDownloadInFolder(downloadId: string): void {
  const record = requireDownload(downloadId);
  shell.showItemInFolder(requireSavePath(record));
}

export async function openDownloadedFile(downloadId: string): Promise<void> {
  const record = requireDownload(downloadId);
  const error = await shell.openPath(requireSavePath(record));
  if (error) throw new Error("Failed to open the downloaded file.");
}

export function cancelDownload(downloadId: string): void {
  const record = requireDownload(downloadId);
  record.item?.cancel();
}

export function copyDownloadedPath(downloadId: string): void {
  const record = requireDownload(downloadId);
  clipboard.writeText(requireSavePath(record));
}

export function getDownloadsHistory(): DownloadHistoryItem[] {
  ensureHistoryLoaded();
  return [...downloadsById.values()]
    .map((r) => ({
      id: r.id,
      accountId: r.accountId,
      filename: r.filename,
      receivedBytes: r.receivedBytes,
      totalBytes: r.totalBytes,
      state: r.state,
      updatedAt: r.updatedAt,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, DOWNLOAD_HISTORY_LIMIT);
}
