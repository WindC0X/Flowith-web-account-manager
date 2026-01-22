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
  tags: string[];
  net: {
    proxy: ProxyConfig;
  };
  ua: UaConfig;
};

export type AccountSummary = {
  id: string;
  displayName: string;
  tags: string[];
  net: {
    proxy: ProxyConfig;
  };
  ua: UaConfig;
};

export type AccountMetaPatch = Partial<AccountMeta>;

export type ImportRefreshTokensResult = {
  imported: number;
  failed: number;
  errors: string[];
};

export type Preferences = {
  locale: "zh-CN" | "en";
  theme: "dark" | "light";
  sidebarCollapsed: boolean;
};

export type PreferencesPatch = Partial<Preferences>;

export type DesktopApi = {
  workspace: {
    openTab(accountId: string): Promise<void>;
    closeTab(accountId: string): Promise<void>;
    setActiveTab(accountId: string): Promise<void>;
    setViewportBounds(bounds: Rect): Promise<void>;
    reloadActive(): Promise<void>;
  };
  accounts: {
    list(): Promise<AccountSummary[]>;
    importRefreshTokens(text: string): Promise<ImportRefreshTokensResult>;
    exportRefreshTokens(accountIds: string[]): Promise<string>;
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
  WORKSPACE_RELOAD_ACTIVE: "workspace:reloadActive",

  ACCOUNTS_LIST: "accounts:list",
  ACCOUNTS_IMPORT_REFRESH_TOKENS: "accounts:importRefreshTokens",
  ACCOUNTS_EXPORT_REFRESH_TOKENS: "accounts:exportRefreshTokens",
  ACCOUNTS_UPDATE_META: "accounts:updateMeta",

  PREFERENCES_GET: "preferences:get",
  PREFERENCES_UPDATE: "preferences:update",
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
  [IPC_CHANNELS.WORKSPACE_RELOAD_ACTIVE]: { args: []; result: void };

  [IPC_CHANNELS.ACCOUNTS_LIST]: { args: []; result: AccountSummary[] };
  [IPC_CHANNELS.ACCOUNTS_IMPORT_REFRESH_TOKENS]: {
    args: [text: string];
    result: ImportRefreshTokensResult;
  };
  [IPC_CHANNELS.ACCOUNTS_EXPORT_REFRESH_TOKENS]: {
    args: [accountIds: string[]];
    result: string;
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

