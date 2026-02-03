export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ProxyMode = "system" | "direct" | "custom";
export type ProxyConfig = {
  mode: ProxyMode;
  rules?: string;
};

export type UaMode = "default" | "preset" | "custom";
export type UaConfig = {
  mode: UaMode;
  value?: string;
};

export type AccountMeta = {
  displayName: string;
  pinned: boolean;
  tags: string[];
  net: {
    proxy: ProxyConfig;
  };
  ua: UaConfig;
};

export type AccountSummary = {
  id: string;
  fingerprint: string;
  displayName: string;
  pinned: boolean;
  tags: string[];
  sealed: boolean;
  net: {
    proxy: ProxyConfig;
  };
  ua: UaConfig;
};

export type AccountMetaPatch = Partial<AccountMeta>;

export type ImportRefreshTokensResult = {
  imported: number;
  failed: number;
  warnings: string[];
  errors: string[];
  creditsByAccountId?: Record<string, AccountCredits>;
  creditsErrorsByAccountId?: Record<string, string>;
};

export type ImportRefreshTokensOptions = {
  net?: {
    proxy: ProxyConfig;
  };
  ua?: UaConfig;
};

export type AccountCredits = {
  subscriptionType: string | null;
  subscriptionExpiresAt: number | null;
  remainingCredits: number;
  totalCredits: number;
  fetchedAt: number;
};

export type FlowithOsStatus = {
  userDataPath: string;
  sessionFilePath: string;
  sessionDirExists: boolean;
  sessionFileExists: boolean;
  sessionFileWritable: boolean;
  running: boolean;
  reason?: string;
  linkedAccountId: string | null;
  linkedUserId: string | null;
  lastSyncedAt: number | null;
  lastSeenAt: number | null;
  lastSeenUserId: string | null;
};

export type FlowithOsWriteSessionResult =
  | { success: true; backupPath: string | null; targetPath: string; userId: string | null; email: string | null }
  | { success: false; message: string };

export type FlowithOsSyncResult =
  | {
      success: true;
      updated: boolean;
      accountId: string | null;
      reason?: string;
      userId?: string | null;
      email?: string | null;
    }
  | { success: false; message: string };

export type ConnectivityCheck = {
  name: string;
  url: string;
  ok: boolean;
  latencyMs: number;
  status?: number;
  error?: string;
};

export type Preferences = {
  locale: "zh-CN" | "en";
  theme: "dark" | "light";
  sidebarCollapsed: boolean;
};

export type PreferencesPatch = Partial<Preferences>;

export type DownloadSaveMode = "saveAs" | "downloads" | "customDir";

export type DownloadPreferencesPublic = {
  mode: DownloadSaveMode;
  hasCustomDir: boolean;
  customDirName?: string | null;
};

export type DownloadEvent =
  | {
      type: "start";
      id: string;
      accountId: string;
      filename: string;
      totalBytes: number;
    }
  | {
      type: "progress";
      id: string;
      receivedBytes: number;
      totalBytes: number;
    }
  | {
      type: "done";
      id: string;
      state: "completed" | "cancelled" | "interrupted";
      error?: string;
    };

export type DownloadHistoryItem = {
  id: string;
  accountId: string;
  filename: string;
  receivedBytes: number;
  totalBytes: number;
  state: "progressing" | "completed" | "cancelled" | "interrupted";
  updatedAt: number;
};

export type AccountAuthDiagnostics = {
  accountId: string;
  hasOpenTab: boolean;
  href: string | null;
  selected: {
    accessTokenFp: string | null;
    refreshTokenFp: string | null;
    expiresAt: number | null;
  } | null;
  candidates: Array<{
    source: "local" | "session" | "cookie" | "idb";
    key: string;
    parsed: boolean;
    accessTokenFp: string | null;
    accessTokenLen: number | null;
    refreshTokenFp: string | null;
    refreshTokenLen: number | null;
    expiresAt: number | null;
  }>;
};

export type UpdaterState =
  | "idle"
  | "checking"
  | "available"
  | "notAvailable"
  | "downloading"
  | "downloaded"
  | "error";

export type UpdaterProgress = {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
};

export type UpdaterStatus = {
  supported: boolean;
  currentVersion: string;
  state: UpdaterState;
  availableVersion: string | null;
  progress: UpdaterProgress | null;
  error: string | null;
  lastCheckedAt: number | null;
};

export type UpdaterEvent = { type: "status"; status: UpdaterStatus };

export type AccountsImportProgressEvent =
  | { type: "start"; total: number }
  | {
      type: "progress";
      done: number;
      total: number;
      imported: number;
      failed: number;
      creditsFailed: number;
      current?: { line: number; fingerprint: string; status: "ok" | "fail" };
    }
  | { type: "end"; total: number; imported: number; failed: number; creditsFailed: number };

export type DesktopApi = {
  workspace: {
    openTab(accountId: string): Promise<void>;
    closeTab(accountId: string): Promise<void>;
    setActiveTab(accountId: string): Promise<void>;
    setViewportBounds(bounds: Rect): Promise<void>;
    setOverlayActive(active: boolean): Promise<void>;
    captureTabSnapshot(accountId: string): Promise<string | null>;
    reloadActive(): Promise<void>;
    getState(): Promise<{ openTabIds: string[]; activeTabId: string | null }>;
  };
  downloads: {
    subscribe(listener: (event: DownloadEvent) => void): () => void;
    getHistory(): Promise<DownloadHistoryItem[]>;
    getPreferences(): Promise<DownloadPreferencesPublic>;
    setMode(mode: DownloadSaveMode): Promise<DownloadPreferencesPublic>;
    pickCustomDirectory(): Promise<DownloadPreferencesPublic>;
    showInFolder(downloadId: string): Promise<void>;
    open(downloadId: string): Promise<void>;
    cancel(downloadId: string): Promise<void>;
    copyPath(downloadId: string): Promise<void>;
  };
  updater: {
    subscribe(listener: (event: UpdaterEvent) => void): () => void;
    getStatus(): Promise<UpdaterStatus>;
    check(): Promise<UpdaterStatus>;
    download(): Promise<UpdaterStatus>;
    quitAndInstall(): Promise<void>;
  };
  window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    isMaximized(): Promise<boolean>;
    close(): Promise<void>;
  };
  clipboard: {
    writeText(text: string): Promise<void>;
  };
  accounts: {
    list(): Promise<AccountSummary[]>;
    subscribeImportProgress(listener: (event: AccountsImportProgressEvent) => void): () => void;
    importRefreshTokens(text: string, options?: ImportRefreshTokensOptions): Promise<ImportRefreshTokensResult>;
    exportRefreshTokens(accountIds: string[]): Promise<string>;
    exportMigrationRefreshTokens(accountIds: string[]): Promise<string>;
    syncCreditsFromOpenTab(accountId: string): Promise<AccountCredits | null>;
    debugAuthSources(accountId: string): Promise<AccountAuthDiagnostics>;
    isTokenEncryptionAvailable(): Promise<boolean>;
    delete(accountId: string): Promise<void>;
    testConnectivity(accountId: string): Promise<ConnectivityCheck[]>;
    updateAccountMeta(
      accountId: string,
      patch: AccountMetaPatch
    ): Promise<AccountSummary>;
  };
  preferences: {
    get(): Promise<Preferences>;
    update(patch: PreferencesPatch): Promise<Preferences>;
  };
};

export const IPC_CHANNELS = {
  WORKSPACE_OPEN_TAB: "workspace:openTab",
  WORKSPACE_CLOSE_TAB: "workspace:closeTab",
  WORKSPACE_SET_ACTIVE_TAB: "workspace:setActiveTab",
  WORKSPACE_SET_VIEWPORT_BOUNDS: "workspace:setViewportBounds",
  WORKSPACE_SET_OVERLAY_ACTIVE: "workspace:setOverlayActive",
  WORKSPACE_CAPTURE_TAB_SNAPSHOT: "workspace:captureTabSnapshot",
  WORKSPACE_RELOAD_ACTIVE: "workspace:reloadActive",
  WORKSPACE_GET_STATE: "workspace:getState",

  DOWNLOADS_GET_HISTORY: "downloads:getHistory",
  DOWNLOADS_GET_PREFERENCES: "downloads:getPreferences",
  DOWNLOADS_SET_MODE: "downloads:setMode",
  DOWNLOADS_PICK_CUSTOM_DIRECTORY: "downloads:pickCustomDirectory",
  DOWNLOADS_SHOW_IN_FOLDER: "downloads:showInFolder",
  DOWNLOADS_OPEN: "downloads:open",
  DOWNLOADS_CANCEL: "downloads:cancel",
  DOWNLOADS_COPY_PATH: "downloads:copyPath",

  UPDATER_GET_STATUS: "updater:getStatus",
  UPDATER_CHECK: "updater:check",
  UPDATER_DOWNLOAD: "updater:download",
  UPDATER_QUIT_AND_INSTALL: "updater:quitAndInstall",

  WINDOW_MINIMIZE: "window:minimize",
  WINDOW_TOGGLE_MAXIMIZE: "window:toggleMaximize",
  WINDOW_IS_MAXIMIZED: "window:isMaximized",
  WINDOW_CLOSE: "window:close",

  CLIPBOARD_WRITE_TEXT: "clipboard:writeText",

  ACCOUNTS_LIST: "accounts:list",
  ACCOUNTS_IMPORT_REFRESH_TOKENS: "accounts:importRefreshTokens",
  ACCOUNTS_EXPORT_REFRESH_TOKENS: "accounts:exportRefreshTokens",
  ACCOUNTS_EXPORT_MIGRATION_REFRESH_TOKENS: "accounts:exportMigrationRefreshTokens",
  ACCOUNTS_SYNC_CREDITS_FROM_OPEN_TAB: "accounts:syncCreditsFromOpenTab",
  ACCOUNTS_DEBUG_AUTH_SOURCES: "accounts:debugAuthSources",
  ACCOUNTS_IS_TOKEN_ENCRYPTION_AVAILABLE: "accounts:isTokenEncryptionAvailable",
  ACCOUNTS_DELETE: "accounts:delete",
  ACCOUNTS_TEST_CONNECTIVITY: "accounts:testConnectivity",
  ACCOUNTS_UPDATE_META: "accounts:updateMeta",

  PREFERENCES_GET: "preferences:get",
  PREFERENCES_UPDATE: "preferences:update",
} as const;

export const IPC_EVENTS = {
  DOWNLOAD_EVENT: "downloads:event",
  UPDATER_EVENT: "updater:event",
  ACCOUNTS_IMPORT_PROGRESS_EVENT: "accounts:importProgress",
} as const;

export type IpcInvokeMap = {
  [IPC_CHANNELS.WORKSPACE_OPEN_TAB]: { args: [accountId: string]; result: void };
  [IPC_CHANNELS.WORKSPACE_CLOSE_TAB]: {
    args: [accountId: string];
    result: void;
  };
  [IPC_CHANNELS.WORKSPACE_SET_ACTIVE_TAB]: {
    args: [accountId: string];
    result: void;
  };
  [IPC_CHANNELS.WORKSPACE_SET_VIEWPORT_BOUNDS]: {
    args: [bounds: Rect];
    result: void;
  };
  [IPC_CHANNELS.WORKSPACE_SET_OVERLAY_ACTIVE]: { args: [active: boolean]; result: void };
  [IPC_CHANNELS.WORKSPACE_CAPTURE_TAB_SNAPSHOT]: { args: [accountId: string]; result: string | null };
  [IPC_CHANNELS.WORKSPACE_RELOAD_ACTIVE]: { args: []; result: void };
  [IPC_CHANNELS.WORKSPACE_GET_STATE]: { args: []; result: { openTabIds: string[]; activeTabId: string | null } };

  [IPC_CHANNELS.DOWNLOADS_GET_HISTORY]: { args: []; result: DownloadHistoryItem[] };
  [IPC_CHANNELS.DOWNLOADS_GET_PREFERENCES]: { args: []; result: DownloadPreferencesPublic };
  [IPC_CHANNELS.DOWNLOADS_SET_MODE]: { args: [mode: DownloadSaveMode]; result: DownloadPreferencesPublic };
  [IPC_CHANNELS.DOWNLOADS_PICK_CUSTOM_DIRECTORY]: { args: []; result: DownloadPreferencesPublic };
  [IPC_CHANNELS.DOWNLOADS_SHOW_IN_FOLDER]: { args: [downloadId: string]; result: void };
  [IPC_CHANNELS.DOWNLOADS_OPEN]: { args: [downloadId: string]; result: void };
  [IPC_CHANNELS.DOWNLOADS_CANCEL]: { args: [downloadId: string]; result: void };
  [IPC_CHANNELS.DOWNLOADS_COPY_PATH]: { args: [downloadId: string]; result: void };

  [IPC_CHANNELS.UPDATER_GET_STATUS]: { args: []; result: UpdaterStatus };
  [IPC_CHANNELS.UPDATER_CHECK]: { args: []; result: UpdaterStatus };
  [IPC_CHANNELS.UPDATER_DOWNLOAD]: { args: []; result: UpdaterStatus };
  [IPC_CHANNELS.UPDATER_QUIT_AND_INSTALL]: { args: []; result: void };

  [IPC_CHANNELS.WINDOW_MINIMIZE]: { args: []; result: void };
  [IPC_CHANNELS.WINDOW_TOGGLE_MAXIMIZE]: { args: []; result: void };
  [IPC_CHANNELS.WINDOW_IS_MAXIMIZED]: { args: []; result: boolean };
  [IPC_CHANNELS.WINDOW_CLOSE]: { args: []; result: void };

  [IPC_CHANNELS.CLIPBOARD_WRITE_TEXT]: { args: [text: string]; result: void };

  [IPC_CHANNELS.ACCOUNTS_LIST]: { args: []; result: AccountSummary[] };
  [IPC_CHANNELS.ACCOUNTS_IMPORT_REFRESH_TOKENS]: {
    args: [text: string, options?: ImportRefreshTokensOptions];
    result: ImportRefreshTokensResult;
  };
  [IPC_CHANNELS.ACCOUNTS_EXPORT_REFRESH_TOKENS]: {
    args: [accountIds: string[]];
    result: string;
  };
  [IPC_CHANNELS.ACCOUNTS_EXPORT_MIGRATION_REFRESH_TOKENS]: {
    args: [accountIds: string[]];
    result: string;
  };
  [IPC_CHANNELS.ACCOUNTS_SYNC_CREDITS_FROM_OPEN_TAB]: { args: [accountId: string]; result: AccountCredits | null };
  [IPC_CHANNELS.ACCOUNTS_DEBUG_AUTH_SOURCES]: { args: [accountId: string]; result: AccountAuthDiagnostics };
  [IPC_CHANNELS.ACCOUNTS_IS_TOKEN_ENCRYPTION_AVAILABLE]: { args: []; result: boolean };
  [IPC_CHANNELS.ACCOUNTS_DELETE]: { args: [accountId: string]; result: void };
  [IPC_CHANNELS.ACCOUNTS_TEST_CONNECTIVITY]: {
    args: [accountId: string];
    result: ConnectivityCheck[];
  };
  [IPC_CHANNELS.ACCOUNTS_UPDATE_META]: {
    args: [accountId: string, patch: AccountMetaPatch];
    result: AccountSummary;
  };

  [IPC_CHANNELS.PREFERENCES_GET]: { args: []; result: Preferences };
  [IPC_CHANNELS.PREFERENCES_UPDATE]: {
    args: [patch: PreferencesPatch];
    result: Preferences;
  };
};

export type IpcChannel = keyof IpcInvokeMap;
export type IpcArgs<K extends IpcChannel> = IpcInvokeMap[K]["args"];
export type IpcResult<K extends IpcChannel> = IpcInvokeMap[K]["result"];
