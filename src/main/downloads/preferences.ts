import { basename } from "node:path";
import StoreImport from "electron-store";
import type { DownloadPreferencesPublic, DownloadSaveMode } from "../../shared/ipc";

type DownloadsPreferencesV1 = {
  version: 1;
  mode: DownloadSaveMode;
  customDir: string | null;
};

type DownloadsStoreSchema = {
  downloads: DownloadsPreferencesV1;
};

type DownloadsStore = StoreImport<DownloadsStoreSchema>;

let store: DownloadsStore | null = null;

function getStore(): DownloadsStore {
  if (!store) {
    const StoreCtor = (StoreImport as unknown as { default?: typeof StoreImport }).default ?? StoreImport;
    store = new StoreCtor<DownloadsStoreSchema>({
      defaults: {
        downloads: {
          version: 1,
          mode: "saveAs",
          customDir: null,
        },
      },
    });
  }
  return store;
}

function normalizeMode(mode: unknown): DownloadSaveMode | null {
  if (mode === "saveAs" || mode === "downloads" || mode === "customDir") return mode;
  return null;
}

export function getDownloadsPreferencesInternal(): DownloadsPreferencesV1 {
  const raw = getStore().get("downloads");
  if (!raw || raw.version !== 1) {
    return { version: 1, mode: "saveAs", customDir: null };
  }
  const mode = normalizeMode(raw.mode) ?? "saveAs";
  const customDir = typeof raw.customDir === "string" ? raw.customDir : null;
  return { version: 1, mode, customDir };
}

function setDownloadsPreferencesInternal(next: DownloadsPreferencesV1): void {
  getStore().set("downloads", next);
}

export function setDownloadsMode(mode: DownloadSaveMode): DownloadsPreferencesV1 {
  const current = getDownloadsPreferencesInternal();
  const next: DownloadsPreferencesV1 = { ...current, mode };
  setDownloadsPreferencesInternal(next);
  return next;
}

export function setDownloadsCustomDir(customDir: string | null): DownloadsPreferencesV1 {
  const current = getDownloadsPreferencesInternal();
  const next: DownloadsPreferencesV1 = { ...current, customDir };
  setDownloadsPreferencesInternal(next);
  return next;
}

export function toDownloadsPreferencesPublic(state: DownloadsPreferencesV1): DownloadPreferencesPublic {
  const hasCustomDir = Boolean(state.customDir);
  return {
    mode: state.mode,
    hasCustomDir,
    customDirName: state.customDir ? basename(state.customDir) : null,
  };
}

