import { app, clipboard, dialog, shell } from "electron";
import type { BrowserWindow, DownloadItem, Session } from "electron";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, parse } from "node:path";
import {
  IPC_EVENTS,
  type DownloadEvent,
  type DownloadPreferencesPublic,
  type DownloadSaveMode,
} from "../../shared/ipc";
import {
  getDownloadsPreferencesInternal,
  setDownloadsCustomDir,
  setDownloadsMode,
  toDownloadsPreferencesPublic,
} from "./preferences";

type DownloadRecord = {
  id: string;
  accountId: string;
  filename: string;
  receivedBytes: number;
  totalBytes: number;
  item: DownloadItem | null;
  savePath: string | null;
  lastProgressEventAt: number;
};

const attachedSessions = new WeakSet<Session>();
const downloadsById = new Map<string, DownloadRecord>();

function sendEvent(getWindow: () => BrowserWindow | null, event: DownloadEvent) {
  const win = getWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IPC_EVENTS.DOWNLOAD_EVENT, event);
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

function trackDownload(
  downloadId: string,
  item: DownloadItem,
  getWindow: () => BrowserWindow | null
): DownloadRecord {
  const record: DownloadRecord = {
    id: downloadId,
    accountId: "unknown",
    filename: item.getFilename() || "download",
    receivedBytes: 0,
    totalBytes: Math.max(0, item.getTotalBytes()),
    item,
    savePath: null,
    lastProgressEventAt: 0,
  };

  downloadsById.set(downloadId, record);

  item.on("updated", () => {
    record.receivedBytes = Math.max(0, item.getReceivedBytes());
    record.totalBytes = Math.max(0, item.getTotalBytes());

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
    record.item = null;

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
    const downloadId = randomUUID();
    const record = trackDownload(downloadId, item, getWindow);
    record.accountId = accountId;

    sendEvent(getWindow, {
      type: "start",
      id: downloadId,
      accountId,
      filename: record.filename,
      totalBytes: record.totalBytes,
    });

    const prefs = getDownloadsPreferencesInternal();
    const autoDir = resolveAutoDirectory(prefs.mode, prefs.customDir);

    if (!autoDir) {
      item.pause();
      const win = getWindow();
      const defaultPath = nextAvailablePath(app.getPath("downloads"), record.filename);
      const saveDialog = win
        ? dialog.showSaveDialog(win, { defaultPath })
        : dialog.showSaveDialog({ defaultPath });

      void saveDialog
        .then(({ canceled, filePath }) => {
          if (canceled || !filePath) {
            item.cancel();
            return;
          }
          record.savePath = filePath;
          item.setSavePath(filePath);
          item.resume();
        })
        .catch(() => {
          item.cancel();
        });
      return;
    }

    const savePath = nextAvailablePath(autoDir, record.filename);
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
