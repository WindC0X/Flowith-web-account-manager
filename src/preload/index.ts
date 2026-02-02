import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  IPC_EVENTS,
  type DesktopApi,
  type AccountsImportProgressEvent,
  type DownloadEvent,
  type UpdaterEvent,
  type IpcArgs,
  type IpcChannel,
  type IpcResult,
} from "../shared/ipc";

function invoke<K extends IpcChannel>(channel: K, ...args: IpcArgs<K>): Promise<IpcResult<K>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcResult<K>>;
}

const api: DesktopApi = {
  workspace: {
    openTab: (accountId) => invoke(IPC_CHANNELS.WORKSPACE_OPEN_TAB, accountId),
    closeTab: (accountId) => invoke(IPC_CHANNELS.WORKSPACE_CLOSE_TAB, accountId),
    setActiveTab: (accountId) => invoke(IPC_CHANNELS.WORKSPACE_SET_ACTIVE_TAB, accountId),
    setViewportBounds: (bounds) => invoke(IPC_CHANNELS.WORKSPACE_SET_VIEWPORT_BOUNDS, bounds),
    setOverlayActive: (active) => invoke(IPC_CHANNELS.WORKSPACE_SET_OVERLAY_ACTIVE, active),
    captureTabSnapshot: (accountId) => invoke(IPC_CHANNELS.WORKSPACE_CAPTURE_TAB_SNAPSHOT, accountId),
    reloadActive: () => invoke(IPC_CHANNELS.WORKSPACE_RELOAD_ACTIVE),
    getState: () => invoke(IPC_CHANNELS.WORKSPACE_GET_STATE),
  },
  downloads: {
    subscribe: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: DownloadEvent) => {
        listener(payload);
      };
      ipcRenderer.on(IPC_EVENTS.DOWNLOAD_EVENT, handler);
      return () => {
        ipcRenderer.removeListener(IPC_EVENTS.DOWNLOAD_EVENT, handler);
      };
    },
    getHistory: () => invoke(IPC_CHANNELS.DOWNLOADS_GET_HISTORY),
    getPreferences: () => invoke(IPC_CHANNELS.DOWNLOADS_GET_PREFERENCES),
    setMode: (mode) => invoke(IPC_CHANNELS.DOWNLOADS_SET_MODE, mode),
    pickCustomDirectory: () => invoke(IPC_CHANNELS.DOWNLOADS_PICK_CUSTOM_DIRECTORY),
    showInFolder: (downloadId) => invoke(IPC_CHANNELS.DOWNLOADS_SHOW_IN_FOLDER, downloadId),
    open: (downloadId) => invoke(IPC_CHANNELS.DOWNLOADS_OPEN, downloadId),
    cancel: (downloadId) => invoke(IPC_CHANNELS.DOWNLOADS_CANCEL, downloadId),
    copyPath: (downloadId) => invoke(IPC_CHANNELS.DOWNLOADS_COPY_PATH, downloadId),
  },
  updater: {
    subscribe: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: UpdaterEvent) => {
        listener(payload);
      };
      ipcRenderer.on(IPC_EVENTS.UPDATER_EVENT, handler);
      return () => {
        ipcRenderer.removeListener(IPC_EVENTS.UPDATER_EVENT, handler);
      };
    },
    getStatus: () => invoke(IPC_CHANNELS.UPDATER_GET_STATUS),
    check: () => invoke(IPC_CHANNELS.UPDATER_CHECK),
    download: () => invoke(IPC_CHANNELS.UPDATER_DOWNLOAD),
    quitAndInstall: () => invoke(IPC_CHANNELS.UPDATER_QUIT_AND_INSTALL),
  },
  window: {
    minimize: () => invoke(IPC_CHANNELS.WINDOW_MINIMIZE),
    toggleMaximize: () => invoke(IPC_CHANNELS.WINDOW_TOGGLE_MAXIMIZE),
    isMaximized: () => invoke(IPC_CHANNELS.WINDOW_IS_MAXIMIZED),
    close: () => invoke(IPC_CHANNELS.WINDOW_CLOSE),
  },
  accounts: {
    list: () => invoke(IPC_CHANNELS.ACCOUNTS_LIST),
    subscribeImportProgress: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: AccountsImportProgressEvent) => {
        listener(payload);
      };
      ipcRenderer.on(IPC_EVENTS.ACCOUNTS_IMPORT_PROGRESS_EVENT, handler);
      return () => {
        ipcRenderer.removeListener(IPC_EVENTS.ACCOUNTS_IMPORT_PROGRESS_EVENT, handler);
      };
    },
    importRefreshTokens: (text, options) => invoke(IPC_CHANNELS.ACCOUNTS_IMPORT_REFRESH_TOKENS, text, options),
    exportRefreshTokens: (accountIds) => invoke(IPC_CHANNELS.ACCOUNTS_EXPORT_REFRESH_TOKENS, accountIds),
    syncCreditsFromOpenTab: (accountId) => invoke(IPC_CHANNELS.ACCOUNTS_SYNC_CREDITS_FROM_OPEN_TAB, accountId),
    isTokenEncryptionAvailable: () => invoke(IPC_CHANNELS.ACCOUNTS_IS_TOKEN_ENCRYPTION_AVAILABLE),
    delete: (accountId) => invoke(IPC_CHANNELS.ACCOUNTS_DELETE, accountId),
    testConnectivity: (accountId) => invoke(IPC_CHANNELS.ACCOUNTS_TEST_CONNECTIVITY, accountId),
    updateAccountMeta: (accountId, patch) => invoke(IPC_CHANNELS.ACCOUNTS_UPDATE_META, accountId, patch),
  },
  preferences: {
    get: () => invoke(IPC_CHANNELS.PREFERENCES_GET),
    update: (patch) => invoke(IPC_CHANNELS.PREFERENCES_UPDATE, patch),
  },
};

contextBridge.exposeInMainWorld("desktop", api);
