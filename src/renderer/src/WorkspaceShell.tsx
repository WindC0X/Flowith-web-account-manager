import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AccountSummary,
  ConnectivityCheck,
  DownloadEvent,
  DownloadPreferencesPublic,
  DownloadSaveMode,
  ImportRefreshTokensResult,
  ProxyMode,
  UaMode,
} from "../../shared/ipc";
import logoOnDark from "./assets/logo-on-dark.png";
import logoOnLight from "./assets/logo-on-light.png";

type ExportDialogState =
  | { open: false }
  | { open: true; tokenText: string; selectedCount: number };

type Theme = "dark" | "light";
type Locale = "zh-CN" | "en";
type AccountListViewMode = "cards" | "table";

type AccountInfoStatus = "idle" | "loading" | "ready" | "unavailable";
type AccountInfoEntry = {
  status: AccountInfoStatus;
  subscription: string | null;
  credits: string | null;
  updatedAt: number | null;
  error: string | null;
};

type DownloadToastState = {
  id: string;
  accountId: string;
  filename: string;
  receivedBytes: number;
  totalBytes: number;
  state: "progressing" | "completed" | "cancelled" | "interrupted";
  copiedAt: number | null;
  updatedAt: number;
};

type UiPreferencesV1 = {
  version: 1;
  theme: Theme;
  locale: Locale;
  sidebarCollapsed: boolean;
  accountListView: AccountListViewMode;
};

const UI_PREFERENCES_KEY = "fwd_ui_preferences_v1";
const LEGACY_SIDEBAR_COLLAPSED_KEY = "fwd_sidebar_collapsed";

const DEFAULT_ACCOUNT_INFO: AccountInfoEntry = {
  status: "idle",
  subscription: null,
  credits: null,
  updatedAt: null,
  error: null,
};

const UI_STRINGS = {
  "zh-CN": {
    subtitle: "桌面端 MVP · 工作区",
    language: "语言",
    theme: "主题",
    themeDark: "深色",
    themeLight: "浅色",
    langZh: "简体中文",
    langEn: "English",
    settings: "设置",
    settingsTitle: "设置",
    downloadsSectionTitle: "下载",
    downloadsSaveMode: "保存策略",
    downloadsModeSaveAs: "每次另存为",
    downloadsModeDownloads: "自动保存到 Downloads",
    downloadsModeCustomDir: "自动保存到自定义目录",
    downloadsCustomDir: "自定义目录",
    downloadsPickDirectory: "选择目录",
    downloadsDirectoryNotSet: "未选择",
    downloadShowInFolder: "在文件夹中显示",
    downloadOpenFile: "打开",
    downloadCancelDownload: "取消下载",
    downloadCopyPath: "复制路径",
    downloadCopied: "已复制",
    downloadStateProgress: "下载中",
    downloadStateCompleted: "已完成",
    downloadStateCancelled: "已取消",
    downloadStateInterrupted: "已中断",
    searchPlaceholder: "搜索：displayName / id / tag",

    expandSidebar: "展开账号面板",
    collapseSidebar: "折叠账号面板",
    sidebarTitle: "账号",
    viewCards: "卡片视图",
    viewTable: "表格视图",
    selectAll: "全选",
    selectedCount: "已选择 {count} 个",
    noAccounts: "暂无账号。请先导入 refresh_token。",
    noMatch: "无匹配结果。",
    openDetails: "打开详情",
    focusedChip: "当前",

    proxyMode: "代理模式",
    proxySystem: "系统",
    proxyCustom: "自定义",
    proxyDirect: "直连",
    proxyPlaceholder: "http://127.0.0.1:7890 或 socks5://127.0.0.1:7891",
    proxyDisabledHint: "请选择一个账号后再配置代理/连通性。",
    networkSectionTitle: "网络",
    proxyRulesLabel: "代理地址",
    proxyHint: "代理设置按账号生效。修改后通常需要刷新当前 Tab 生效。",
    saveProxy: "保存代理",
    connectivity: "连通性测试",
    connectivityTitle: "连通性",
    statusOk: "OK",
    statusFail: "FAIL",
    windowMinimize: "最小化",
    windowMaximize: "最大化",
    windowRestore: "还原",
    windowClose: "关闭",

    import: "导入",
    export: "导出",
    batchOpen: "批量打开",
    refresh: "刷新",

    errorTitle: "错误",

    tabsAria: "账号标签页",
    noTabs: "暂无 Tab",
    workspaceTitle: "Flowith Web 工作区",
    workspaceSubtitle: "BrowserView 将覆盖此区域。折叠侧边栏 / 调整窗口尺寸不应遮挡顶栏与侧边栏控件。",
    openFocused: "打开（Focused）",
    closeFocused: "关闭（Focused）",
    reloadActive: "刷新当前 Tab",
    importResultChip: "导入结果：成功 {ok} · 失败 {fail}",
    openCloseHint: "选择一个账号以打开/关闭 Tab。",

    inspectorTitle: "账号详情",
    inspectorSelectHint: "选择一个账号以查看详情。",
    displayNameLabel: "显示名",
    accountIdLabel: "账号 ID",
    fingerprintLabel: "指纹",
    tagsLabel: "标签",
    accountInfoTitle: "账号信息",
    subscriptionLabel: "订阅",
    creditsLabel: "积分",
    refreshCredits: "刷新积分",
    updatedAtLabel: "更新时间",
    accountInfoUnavailable: "账号信息接口暂未接入（占位）",
    uaSectionTitle: "User-Agent",
    uaModeLabel: "模式",
    uaDefault: "默认",
    uaPreset: "预设",
    uaCustom: "自定义",
    uaValueLabel: "值",
    uaHint: "修改 User-Agent 通常需要刷新当前 Tab 生效。",
    openTab: "打开 Tab",
    closeTab: "关闭 Tab",
    saveUa: "保存 UA",
    reload: "刷新",
    close: "关闭",

    importDialogTitle: "导入 refresh_token",
    importDialogNote: "每行一个 refresh_token。导入后账号状态为“未校验”。",
    importPlaceholder: "每行一个 refresh_token",
    importHint: "UI 中只显示 token 指纹/掩码；导出才会输出明文。",
    cancel: "取消",
    confirmImport: "导入",

    exportDialogTitle: "导出 refresh_token",
    exportDialogNote: "将导出当前勾选账号的 refresh_token（每行一个）。",
    exportDanger: "注意：导出内容属于敏感凭据。UI 与日志中必须始终脱敏；请勿分享或粘贴到日志/工单中。",
    exportHint: "已导出 {count} 个账号的 token。默认不自动复制。",
    done: "完成",
    closeTabTitle: "关闭 Tab",
  },
  en: {
    subtitle: "Desktop MVP · Workspace UI",
    language: "Language",
    theme: "Theme",
    themeDark: "Dark",
    themeLight: "Light",
    langZh: "简体中文",
    langEn: "English",
    settings: "Settings",
    settingsTitle: "Settings",
    downloadsSectionTitle: "Downloads",
    downloadsSaveMode: "Save mode",
    downloadsModeSaveAs: "Always Save As",
    downloadsModeDownloads: "Auto to Downloads",
    downloadsModeCustomDir: "Auto to Custom directory",
    downloadsCustomDir: "Custom directory",
    downloadsPickDirectory: "Pick directory",
    downloadsDirectoryNotSet: "Not set",
    downloadShowInFolder: "Show in folder",
    downloadOpenFile: "Open",
    downloadCancelDownload: "Cancel",
    downloadCopyPath: "Copy path",
    downloadCopied: "Copied",
    downloadStateProgress: "Downloading",
    downloadStateCompleted: "Completed",
    downloadStateCancelled: "Cancelled",
    downloadStateInterrupted: "Interrupted",
    searchPlaceholder: "Search: displayName / id / tag",

    expandSidebar: "Expand accounts",
    collapseSidebar: "Collapse accounts",
    sidebarTitle: "Accounts",
    viewCards: "Cards view",
    viewTable: "Table view",
    selectAll: "Select all",
    selectedCount: "Selected {count}",
    noAccounts: "No accounts yet. Import refresh_token to create accounts.",
    noMatch: "No results.",
    openDetails: "Open details",
    focusedChip: "Focused",

    proxyMode: "Proxy mode",
    proxySystem: "System",
    proxyCustom: "Custom",
    proxyDirect: "Direct",
    proxyPlaceholder: "http://127.0.0.1:7890 or socks5://127.0.0.1:7891",
    proxyDisabledHint: "Select an account to configure proxy/connectivity.",
    networkSectionTitle: "Network",
    proxyRulesLabel: "Proxy",
    proxyHint: "Proxy settings apply per-account. Reload the active tab to apply.",
    saveProxy: "Save proxy",
    connectivity: "Connectivity",
    connectivityTitle: "Connectivity",
    statusOk: "OK",
    statusFail: "FAIL",
    windowMinimize: "Minimize",
    windowMaximize: "Maximize",
    windowRestore: "Restore",
    windowClose: "Close",

    import: "Import",
    export: "Export",
    batchOpen: "Open tabs",
    refresh: "Refresh",

    errorTitle: "Error",

    tabsAria: "Account tabs",
    noTabs: "No tabs",
    workspaceTitle: "Flowith Web Workspace",
    workspaceSubtitle:
      "BrowserView overlays this area. Sidebar collapse / window resize should not block controls.",
    openFocused: "Open (Focused)",
    closeFocused: "Close (Focused)",
    reloadActive: "Reload active",
    importResultChip: "Import: ok {ok} · failed {fail}",
    openCloseHint: "Select an account to open/close a tab.",

    inspectorTitle: "Account details",
    inspectorSelectHint: "Select an account to view details.",
    displayNameLabel: "Display name",
    accountIdLabel: "Account id",
    fingerprintLabel: "Fingerprint",
    tagsLabel: "Tags",
    accountInfoTitle: "Account info",
    subscriptionLabel: "Subscription",
    creditsLabel: "Credits",
    refreshCredits: "Refresh credits",
    updatedAtLabel: "Updated",
    accountInfoUnavailable: "Account info API not integrated yet (placeholder).",
    uaSectionTitle: "User-Agent",
    uaModeLabel: "Mode",
    uaDefault: "Default",
    uaPreset: "Preset",
    uaCustom: "Custom",
    uaValueLabel: "Value",
    uaHint: "Changing User-Agent usually requires reloading the tab.",
    openTab: "Open tab",
    closeTab: "Close tab",
    saveUa: "Save UA",
    reload: "Reload",
    close: "Close",

    importDialogTitle: "Import refresh_token",
    importDialogNote: "One refresh_token per line. Imported accounts are unverified.",
    importPlaceholder: "One refresh_token per line",
    importHint: "UI never displays tokens. Export is the only plaintext flow.",
    cancel: "Cancel",
    confirmImport: "Import",

    exportDialogTitle: "Export refresh_token",
    exportDialogNote: "Exports refresh_token for selected accounts (one per line).",
    exportDanger:
      "Sensitive: export contains credentials. Never paste into logs or tickets. UI/logs must remain redacted.",
    exportHint: "Exported token(s) for {count} account(s). Nothing is auto-copied.",
    done: "Done",
    closeTabTitle: "Close tab",
  },
} as const;

type StringKey = keyof (typeof UI_STRINGS)["zh-CN"];

function format(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => String(vars[key] ?? `{${key}}`));
}

function clsx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function maskFingerprint(fingerprint: string): string {
  if (!fingerprint) return "-";
  if (fingerprint.length <= 6) return fingerprint;
  return `${fingerprint.slice(0, 6)}…${fingerprint.slice(-4)}`;
}

function formatUpdatedAt(value: number, locale: Locale): string {
  try {
    return new Date(value).toLocaleString(locale);
  } catch {
    return new Date(value).toISOString();
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  const digits = unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function formatProxyModeLabel(mode: ProxyMode, t: (key: StringKey) => string): string {
  if (mode === "system") return t("proxySystem");
  if (mode === "custom") return t("proxyCustom");
  return t("proxyDirect");
}

function formatUaModeLabel(mode: UaMode, t: (key: StringKey) => string): string {
  if (mode === "default") return t("uaDefault");
  if (mode === "preset") return t("uaPreset");
  return t("uaCustom");
}

function formatDownloadStateLabel(state: DownloadToastState["state"], t: (key: StringKey) => string): string {
  if (state === "progressing") return t("downloadStateProgress");
  if (state === "completed") return t("downloadStateCompleted");
  if (state === "cancelled") return t("downloadStateCancelled");
  return t("downloadStateInterrupted");
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === "string") return error.message;
  return String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function normalizeTheme(value: unknown): Theme | null {
  return value === "dark" || value === "light" ? value : null;
}

function normalizeLocale(value: unknown): Locale | null {
  return value === "zh-CN" || value === "en" ? value : null;
}

function normalizeViewMode(value: unknown): AccountListViewMode | null {
  return value === "cards" || value === "table" ? value : null;
}

function normalizeBoolean(value: unknown): boolean | null {
  return value === true || value === false ? value : null;
}

function loadUiPreferences(): UiPreferencesV1 {
  const defaults: UiPreferencesV1 = {
    version: 1,
    theme: "dark",
    locale: "zh-CN",
    sidebarCollapsed: false,
    accountListView: "cards",
  };

  const next: UiPreferencesV1 = { ...defaults };

  try {
    const raw = window.localStorage.getItem(UI_PREFERENCES_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isRecord(parsed)) {
        const theme = normalizeTheme(parsed.theme);
        if (theme) next.theme = theme;

        const locale = normalizeLocale(parsed.locale);
        if (locale) next.locale = locale;

        const sidebarCollapsed = normalizeBoolean(parsed.sidebarCollapsed);
        if (sidebarCollapsed !== null) next.sidebarCollapsed = sidebarCollapsed;

        const view = normalizeViewMode(parsed.accountListView ?? parsed.viewMode);
        if (view) next.accountListView = view;
      }
    }
  } catch {
    // ignore
  }

  try {
    const legacy = window.localStorage.getItem(LEGACY_SIDEBAR_COLLAPSED_KEY);
    if (legacy === "1") next.sidebarCollapsed = true;
    if (legacy === "0") next.sidebarCollapsed = false;
  } catch {
    // ignore
  }

  return next;
}

function persistUiPreferences(prefs: UiPreferencesV1): void {
  try {
    window.localStorage.setItem(UI_PREFERENCES_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }

  try {
    window.localStorage.setItem(LEGACY_SIDEBAR_COLLAPSED_KEY, prefs.sidebarCollapsed ? "1" : "0");
  } catch {
    // ignore
  }
}

export default function WorkspaceShell() {
  const [uiPrefs, setUiPrefs] = useState<UiPreferencesV1>(() => loadUiPreferences());

  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusedAccountId, setFocusedAccountId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");

  const strings = UI_STRINGS[uiPrefs.locale];
  const t = useCallback((key: StringKey) => strings[key], [strings]);
  const isWindows = useMemo(() => /windows/i.test(navigator.userAgent), []);
  const [windowMaximized, setWindowMaximized] = useState(false);

  const viewMode = uiPrefs.accountListView;
  const sidebarCollapsed = uiPrefs.sidebarCollapsed;

  const updateUiPrefs = useCallback((patch: Partial<Omit<UiPreferencesV1, "version">>) => {
    setUiPrefs((prev) => ({ ...prev, ...patch, version: 1 }));
  }, []);

  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importResult, setImportResult] = useState<ImportRefreshTokensResult | null>(null);

  const [exportDialog, setExportDialog] = useState<ExportDialogState>({ open: false });

  const [proxyMode, setProxyMode] = useState<ProxyMode>("system");
  const [proxyRules, setProxyRules] = useState("");
  const [uaMode, setUaMode] = useState<UaMode>("default");
  const [uaValue, setUaValue] = useState("");

  const [connectivity, setConnectivity] = useState<ConnectivityCheck[] | null>(null);
  const [connectivityPopoverOpen, setConnectivityPopoverOpen] = useState(false);

  const [settingsPopoverOpen, setSettingsPopoverOpen] = useState(false);
  const [downloadPrefs, setDownloadPrefs] = useState<DownloadPreferencesPublic | null>(null);
  const [downloadToasts, setDownloadToasts] = useState<DownloadToastState[]>([]);

  const [accountInfoById, setAccountInfoById] = useState<Record<string, AccountInfoEntry>>({});

  const [openTabIds, setOpenTabIds] = useState<string[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const importDialogRef = useRef<HTMLDialogElement | null>(null);
  const exportDialogRef = useRef<HTMLDialogElement | null>(null);
  const connectivityPopoverRef = useRef<HTMLDivElement | null>(null);
  const settingsPopoverRef = useRef<HTMLDivElement | null>(null);
  const settingsContainerRef = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(() => [...selectedIds], [selectedIds]);

  const focusedAccount = useMemo(() => {
    if (!focusedAccountId) return null;
    return accounts.find((a) => a.id === focusedAccountId) ?? null;
  }, [accounts, focusedAccountId]);

  const focusedAccountInfo = useMemo(() => {
    if (!focusedAccountId) return DEFAULT_ACCOUNT_INFO;
    return accountInfoById[focusedAccountId] ?? DEFAULT_ACCOUNT_INFO;
  }, [accountInfoById, focusedAccountId]);

  useEffect(() => {
    if (!focusedAccount) return;
    setProxyMode(focusedAccount.net.proxy.mode);
    setProxyRules(focusedAccount.net.proxy.rules ?? "");
    setUaMode(focusedAccount.ua.mode);
    setUaValue(focusedAccount.ua.value ?? "");
  }, [focusedAccount]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", uiPrefs.theme);
    document.documentElement.lang = uiPrefs.locale;
    persistUiPreferences(uiPrefs);
  }, [uiPrefs]);

  useEffect(() => {
    if (!isWindows) return;
    void window.desktop.window
      .isMaximized()
      .then((max) => setWindowMaximized(max))
      .catch(() => void 0);
  }, [isWindows]);

  const minimizeWindow = useCallback(async () => {
    try {
      await window.desktop.window.minimize();
    } catch {
      // ignore
    }
  }, []);

  const toggleMaximizeWindow = useCallback(async () => {
    try {
      await window.desktop.window.toggleMaximize();
      const max = await window.desktop.window.isMaximized();
      setWindowMaximized(max);
    } catch {
      // ignore
    }
  }, []);

  const closeWindow = useCallback(async () => {
    try {
      await window.desktop.window.close();
    } catch {
      // ignore
    }
  }, []);

  const filteredAccounts = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter((a) => {
      const hay = [
        a.displayName,
        a.id,
        a.fingerprint,
        a.tags.join(" "),
        a.net.proxy.mode,
        a.net.proxy.rules ?? "",
        a.ua.mode,
        a.ua.value ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [accounts, searchText]);

  const allFilteredSelected =
    filteredAccounts.length > 0 && filteredAccounts.every((a) => selectedIds.has(a.id));
  const anyFilteredSelected = filteredAccounts.some((a) => selectedIds.has(a.id));

  useEffect(() => {
    const el = selectAllRef.current;
    if (!el) return;
    el.indeterminate = !allFilteredSelected && anyFilteredSelected;
  }, [allFilteredSelected, anyFilteredSelected]);

  const refreshAccounts = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const list = await window.desktop.accounts.list();
      setAccounts(list);

      setSelectedIds((prev) => {
        const allowed = new Set(list.map((a) => a.id));
        const next = new Set<string>();
        for (const id of prev) if (allowed.has(id)) next.add(id);
        return next;
      });

      setAccountInfoById((prev) => {
        const allowed = new Set(list.map((a) => a.id));
        const next: Record<string, AccountInfoEntry> = {};
        for (const [id, info] of Object.entries(prev)) if (allowed.has(id)) next[id] = info;
        return next;
      });

      setOpenTabIds((prev) => {
        const allowed = new Set(list.map((a) => a.id));
        return prev.filter((id) => allowed.has(id));
      });

      setFocusedAccountId((prev) => {
        if (!prev) return prev;
        const exists = list.some((a) => a.id === prev);
        if (exists) return prev;
        setInspectorOpen(false);
        return null;
      });

      setActiveTabId((prev) => {
        if (!prev) return prev;
        const exists = list.some((a) => a.id === prev);
        if (exists) return prev;
        return null;
      });
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refreshAccounts();
  }, [refreshAccounts]);

  const toggleSelected = useCallback((accountId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
  }, []);

  const toggleSelectAllFiltered = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const a of filteredAccounts) next.delete(a.id);
      } else {
        for (const a of filteredAccounts) next.add(a.id);
      }
      return next;
    });
  }, [allFilteredSelected, filteredAccounts]);

  const focusAccount = useCallback((accountId: string) => {
    setFocusedAccountId(accountId);
    setInspectorOpen(true);
  }, []);

  const pushViewportBounds = useCallback(async () => {
    const el = viewportRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    await window.desktop.workspace.setViewportBounds({
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        void pushViewportBounds();
      });
    };

    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);

    schedule();
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [pushViewportBounds]);

  useEffect(() => {
    if (!connectivityPopoverOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (connectivityPopoverRef.current?.contains(target)) return;
      setConnectivityPopoverOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
    };
  }, [connectivityPopoverOpen]);

  useEffect(() => {
    if (!settingsPopoverOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (settingsContainerRef.current?.contains(target)) return;
      setSettingsPopoverOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
    };
  }, [settingsPopoverOpen]);

  useEffect(() => {
    void window.desktop.downloads
      .getPreferences()
      .then((prefs) => setDownloadPrefs(prefs))
      .catch(() => void 0);
  }, []);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    try {
      unsubscribe = window.desktop.downloads.subscribe((event: DownloadEvent) => {
        const now = Date.now();
        setDownloadToasts((prev) => {
          if (event.type === "start") {
            const next: DownloadToastState = {
              id: event.id,
              accountId: event.accountId,
              filename: event.filename,
              receivedBytes: 0,
              totalBytes: Math.max(0, event.totalBytes),
              state: "progressing",
              copiedAt: null,
              updatedAt: now,
            };
            const rest = prev.filter((d) => d.id !== event.id);
            return [next, ...rest].slice(0, 6);
          }

          const index = prev.findIndex((d) => d.id === event.id);
          if (index < 0) return prev;

          const current = prev[index];
          if (!current) return prev;

          const next = [...prev];
          if (event.type === "progress") {
            next[index] = {
              ...current,
              receivedBytes: Math.max(0, event.receivedBytes),
              totalBytes: Math.max(0, event.totalBytes),
              updatedAt: now,
            };
          } else {
            next[index] = {
              ...current,
              state: event.state,
              updatedAt: now,
            };
          }
          return next;
        });
      });
    } catch {
      // ignore
    }

    return () => {
      try {
        unsubscribe?.();
      } catch {
        // ignore
      }
    };
  }, []);

  const dismissDownloadToast = useCallback((id: string) => {
    setDownloadToasts((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const setDownloadMode = useCallback(async (mode: DownloadSaveMode) => {
    setError(null);
    try {
      const next = await window.desktop.downloads.setMode(mode);
      setDownloadPrefs(next);
    } catch (e) {
      setError(toErrorMessage(e));
    }
  }, []);

  const pickDownloadDirectory = useCallback(async () => {
    setError(null);
    try {
      const next = await window.desktop.downloads.pickCustomDirectory();
      setDownloadPrefs(next);
    } catch (e) {
      setError(toErrorMessage(e));
    }
  }, []);

  const showDownloadInFolder = useCallback(async (id: string) => {
    setError(null);
    try {
      await window.desktop.downloads.showInFolder(id);
    } catch (e) {
      setError(toErrorMessage(e));
    }
  }, []);

  const openDownloadedFile = useCallback(async (id: string) => {
    setError(null);
    try {
      await window.desktop.downloads.open(id);
    } catch (e) {
      setError(toErrorMessage(e));
    }
  }, []);

  const cancelDownloadToast = useCallback(async (id: string) => {
    setError(null);
    try {
      await window.desktop.downloads.cancel(id);
    } catch (e) {
      setError(toErrorMessage(e));
    }
  }, []);

  const copyDownloadPath = useCallback(async (id: string) => {
    setError(null);
    try {
      await window.desktop.downloads.copyPath(id);
      const copiedAt = Date.now();
      setDownloadToasts((prev) => prev.map((d) => (d.id === id ? { ...d, copiedAt } : d)));
      window.setTimeout(() => {
        setDownloadToasts((prev) =>
          prev.map((d) => (d.id === id && d.copiedAt === copiedAt ? { ...d, copiedAt: null } : d))
        );
      }, 1800);
    } catch (e) {
      setError(toErrorMessage(e));
    }
  }, []);

  const runImport = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await window.desktop.accounts.importRefreshTokens(importText);
      setImportResult(result);
      setImportText("");
      await refreshAccounts();
      setImportDialogOpen(false);
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [importText, refreshAccounts]);

  const runExport = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const text = await window.desktop.accounts.exportRefreshTokens(selected);
      setExportDialog({ open: true, tokenText: text, selectedCount: selected.length });
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [selected]);

  const saveProxy = useCallback(async () => {
    if (!focusedAccountId) return;
    setError(null);
    setBusy(true);
    try {
      const proxy =
        proxyMode === "custom"
          ? { mode: "custom" as const, rules: proxyRules }
          : { mode: proxyMode };
      await window.desktop.accounts.updateAccountMeta(focusedAccountId, {
        net: {
          proxy,
        },
      });
      await refreshAccounts();
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [focusedAccountId, proxyMode, proxyRules, refreshAccounts]);

  const saveUserAgent = useCallback(async () => {
    if (!focusedAccountId) return;
    setError(null);
    setBusy(true);
    try {
      const ua =
        uaMode === "default"
          ? { mode: "default" as const }
          : { mode: uaMode, value: uaValue };
      await window.desktop.accounts.updateAccountMeta(focusedAccountId, { ua });
      await refreshAccounts();
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [focusedAccountId, refreshAccounts, uaMode, uaValue]);

  const refreshAccountInfo = useCallback(() => {
    if (!focusedAccountId) return;
    const accountId = focusedAccountId;

    setAccountInfoById((prev) => {
      const current = prev[accountId] ?? DEFAULT_ACCOUNT_INFO;
      return {
        ...prev,
        [accountId]: { ...current, status: "loading", error: null },
      };
    });

    const message = t("accountInfoUnavailable");
    setAccountInfoById((prev) => {
      const current = prev[accountId] ?? DEFAULT_ACCOUNT_INFO;
      return {
        ...prev,
        [accountId]: {
          ...current,
          status: "unavailable",
          error: message,
          updatedAt: Date.now(),
        },
      };
    });
  }, [focusedAccountId, t]);

  const runConnectivity = useCallback(async () => {
    if (!focusedAccountId) return;
    setError(null);
    setBusy(true);
    try {
      const report = await window.desktop.accounts.testConnectivity(focusedAccountId);
      setConnectivity(report);
      setConnectivityPopoverOpen(true);
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [focusedAccountId]);

  const openTab = useCallback(
    async (accountId: string) => {
      setError(null);
      setBusy(true);
      try {
        await pushViewportBounds();
        await window.desktop.workspace.openTab(accountId);
        setOpenTabIds((prev) => (prev.includes(accountId) ? prev : [...prev, accountId]));
        setActiveTabId(accountId);
      } catch (e) {
        setError(toErrorMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [pushViewportBounds]
  );

  const closeTab = useCallback(
    async (accountId: string) => {
      setError(null);
      setBusy(true);
      try {
        await window.desktop.workspace.closeTab(accountId);
        setOpenTabIds((prev) => prev.filter((id) => id !== accountId));
        setActiveTabId((prev) => {
          if (prev !== accountId) return prev;
          const next = openTabIds.filter((id) => id !== accountId)[0] ?? null;
          if (next) void window.desktop.workspace.setActiveTab(next);
          return next;
        });
      } catch (e) {
        setError(toErrorMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [openTabIds]
  );

  const activateTab = useCallback(async (accountId: string) => {
    setError(null);
    setBusy(true);
    try {
      await window.desktop.workspace.setActiveTab(accountId);
      setActiveTabId(accountId);
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const reloadWorkspace = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      await window.desktop.workspace.reloadActive();
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const batchOpenTabs = useCallback(async () => {
    for (const id of selected) {
      await openTab(id);
    }
  }, [openTab, selected]);

  const batchCloseTabs = useCallback(async () => {
    for (const id of selected) {
      await closeTab(id);
    }
  }, [closeTab, selected]);

  useEffect(() => {
    const dlg = importDialogRef.current;
    if (!dlg) return;
    try {
      if (importDialogOpen) {
        if (!dlg.open) dlg.showModal();
      } else if (dlg.open) {
        dlg.close();
      }
    } catch {
      // ignore dialog show/close failures in non-standard runtimes
    }
  }, [importDialogOpen]);

  useEffect(() => {
    const dlg = exportDialogRef.current;
    if (!dlg) return;
    try {
      if (exportDialog.open) {
        if (!dlg.open) dlg.showModal();
      } else if (dlg.open) {
        dlg.close();
      }
    } catch {
      // ignore dialog show/close failures in non-standard runtimes
    }
  }, [exportDialog.open]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img
            className="brand-logo"
            src={uiPrefs.theme === "dark" ? logoOnDark : logoOnLight}
            alt="Flowith"
          />
          <div>
            <div className="brand-title">Flowith Web Account Manager</div>
            <div className="brand-subtitle">{t("subtitle")}</div>
          </div>
        </div>

        <div className="topbar-group topbar-group-right" aria-label="Global actions">
          <input
            className="input topbar-search"
            type="text"
            placeholder={t("searchPlaceholder")}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            disabled={busy}
          />
          <button className="btn" onClick={() => setImportDialogOpen(true)} disabled={busy}>
            {t("import")}
          </button>
          <button className="btn" onClick={runExport} disabled={busy || selected.length === 0}>
            {t("export")}
          </button>
          <button className="btn" onClick={refreshAccounts} disabled={busy}>
            {t("refresh")}
          </button>
          <div style={{ position: "relative" }} ref={settingsContainerRef}>
            <button
              className="btn btn-ghost btn-icon"
              title={t("settings")}
              aria-label={t("settings")}
              onClick={() => setSettingsPopoverOpen((prev) => !prev)}
              disabled={busy}
            >
              ⚙
            </button>
            {settingsPopoverOpen ? (
              <div className="popover popover-end" ref={settingsPopoverRef}>
                <div className="popover-title">{t("settingsTitle")}</div>
                <div className="setting-grid">
                  <div className="setting-row">
                    <div className="muted">{t("language")}</div>
                    <select
                      value={uiPrefs.locale}
                      onChange={(e) => updateUiPrefs({ locale: e.target.value as Locale })}
                      aria-label={t("language")}
                      disabled={busy}
                    >
                      <option value="zh-CN">{t("langZh")}</option>
                      <option value="en">{t("langEn")}</option>
                    </select>
                  </div>
                  <div className="setting-row">
                    <div className="muted">{t("theme")}</div>
                    <select
                      value={uiPrefs.theme}
                      onChange={(e) => updateUiPrefs({ theme: e.target.value as Theme })}
                      aria-label={t("theme")}
                      disabled={busy}
                    >
                      <option value="dark">{t("themeDark")}</option>
                      <option value="light">{t("themeLight")}</option>
                    </select>
                  </div>
                </div>

                <div className="popover-title" style={{ marginTop: 10 }}>
                  {t("downloadsSectionTitle")}
                </div>
                <div className="setting-grid">
                  <div className="setting-row">
                    <div className="muted">{t("downloadsSaveMode")}</div>
                    <select
                      value={downloadPrefs?.mode ?? "saveAs"}
                      onChange={(e) => setDownloadMode(e.target.value as DownloadSaveMode)}
                      aria-label={t("downloadsSaveMode")}
                      disabled={busy}
                    >
                      <option value="saveAs">{t("downloadsModeSaveAs")}</option>
                      <option value="downloads">{t("downloadsModeDownloads")}</option>
                      <option value="customDir">{t("downloadsModeCustomDir")}</option>
                    </select>
                  </div>

                  <div className="setting-row">
                    <div className="muted">{t("downloadsCustomDir")}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <div
                        className="muted"
                        style={{
                          flex: 1,
                          minWidth: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={downloadPrefs?.customDirName ?? undefined}
                      >
                        {downloadPrefs?.hasCustomDir
                          ? downloadPrefs.customDirName ?? "-"
                          : t("downloadsDirectoryNotSet")}
                      </div>
                      <button className="btn" onClick={pickDownloadDirectory} disabled={busy}>
                        {t("downloadsPickDirectory")}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {isWindows ? (
          <div className="window-controls" aria-label="Window controls">
            <button
              className="btn btn-ghost btn-icon"
              title={t("windowMinimize")}
              aria-label={t("windowMinimize")}
              onClick={minimizeWindow}
              disabled={busy}
            >
              —
            </button>
            <button
              className="btn btn-ghost btn-icon"
              title={windowMaximized ? t("windowRestore") : t("windowMaximize")}
              aria-label={windowMaximized ? t("windowRestore") : t("windowMaximize")}
              onClick={toggleMaximizeWindow}
              disabled={busy}
            >
              {windowMaximized ? "❐" : "□"}
            </button>
            <button
              className="btn btn-danger btn-icon"
              title={t("windowClose")}
              aria-label={t("windowClose")}
              onClick={closeWindow}
              disabled={busy}
            >
              ×
            </button>
          </div>
        ) : null}
      </header>

      {error ? (
        <div className="error-banner" role="status">
          <div className="error-banner-title">{t("errorTitle")}</div>
          <div className="error-banner-body">{error}</div>
        </div>
      ) : null}

      <div
        className={clsx(
          "layout",
          sidebarCollapsed && "sidebar-collapsed",
          !inspectorOpen && "inspector-hidden"
        )}
      >
        <aside className={clsx("sidebar", sidebarCollapsed && "collapsed")} id="sidebar">
          <div className="sidebar-header">
            <div className="sidebar-title">{t("sidebarTitle")}</div>
            <div className="sidebar-header-right">
              <button
                className="btn btn-ghost btn-icon"
                title={sidebarCollapsed ? t("expandSidebar") : t("collapseSidebar")}
                aria-label={sidebarCollapsed ? t("expandSidebar") : t("collapseSidebar")}
                onClick={() => updateUiPrefs({ sidebarCollapsed: !sidebarCollapsed })}
                disabled={busy}
              >
                {sidebarCollapsed ? "»" : "«"}
              </button>
              {!sidebarCollapsed ? (
                <>
                  <button
                    className="btn btn-ghost btn-icon"
                    title={t("viewCards")}
                    onClick={() => updateUiPrefs({ accountListView: "cards" })}
                    disabled={busy}
                  >
                    ▦
                  </button>
                  <button
                    className="btn btn-ghost btn-icon"
                    title={t("viewTable")}
                    onClick={() => updateUiPrefs({ accountListView: "table" })}
                    disabled={busy}
                  >
                    ☰
                  </button>
                </>
              ) : null}
            </div>
          </div>

          <div className="sidebar-subheader">
            <label className="checkbox">
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allFilteredSelected}
                onChange={toggleSelectAllFiltered}
                disabled={busy || filteredAccounts.length === 0}
              />
              <span>{t("selectAll")}</span>
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div className="muted">{format(t("selectedCount"), { count: selected.length })}</div>
              <button
                className="btn btn-primary"
                onClick={batchOpenTabs}
                disabled={busy || selected.length === 0}
              >
                {t("batchOpen")}
              </button>
            </div>
          </div>

          <div className={clsx("account-list", viewMode === "table" && "view-table")}>
            {filteredAccounts.length === 0 ? (
              <div className="muted" style={{ padding: 10, fontSize: 12 }}>
                {accounts.length === 0 ? t("noAccounts") : t("noMatch")}
              </div>
            ) : (
              filteredAccounts.map((a) => {
                const selectedRow = selectedIds.has(a.id);
                const focused = a.id === focusedAccountId;
                return (
                  <div
                    key={a.id}
                    className={clsx("account", (selectedRow || focused) && "selected")}
                    role="button"
                    tabIndex={0}
                    onClick={() => focusAccount(a.id)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        focusAccount(a.id);
                      }
                    }}
                  >
                    <div className="account-row">
                      <label className="checkbox" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedRow}
                          onChange={() => toggleSelected(a.id)}
                          disabled={busy}
                        />
                      </label>
                      <div className="account-main">
                        <div className="account-name">{a.displayName}</div>
                        <div className="account-subtitle">id: {a.id}</div>
                        <div className="account-subtitle">fp: {maskFingerprint(a.fingerprint)}</div>
                      </div>
                      <div
                        className="chip"
                        title={`${t("proxyMode")}: ${formatProxyModeLabel(a.net.proxy.mode, t)}`}
                      >
                        <span className="dot dot-net" />
                        <span>{formatProxyModeLabel(a.net.proxy.mode, t)}</span>
                      </div>
                    </div>

                    <div className="account-meta">
                      <span className="chip">UA: {formatUaModeLabel(a.ua.mode, t)}</span>
                      {focused ? <span className="chip">{t("focusedChip")}</span> : null}
                    </div>

                    {a.tags.length ? (
                      <div className="account-tags">
                        {a.tags.map((t) => (
                          <span key={t} className="tag-chip">
                            {t}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    <div className="account-table">
                      <input
                        type="checkbox"
                        checked={selectedRow}
                        onChange={() => toggleSelected(a.id)}
                        disabled={busy}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="account-table-title">
                        <div className="account-table-name">{a.displayName}</div>
                        <div className="account-table-tags">
                          {a.tags.slice(0, 3).map((t) => (
                            <span key={t} className="tag-chip">
                              {t}
                            </span>
                          ))}
                        </div>
                      </div>
                      <span className="mono">{maskFingerprint(a.fingerprint)}</span>
                      <span className="mono">{formatProxyModeLabel(a.net.proxy.mode, t)}</span>
                      <span className="mono">{formatUaModeLabel(a.ua.mode, t)}</span>
                      <button
                        className="btn btn-ghost btn-icon"
                        title={t("openDetails")}
                        onClick={(e) => {
                          e.stopPropagation();
                          focusAccount(a.id);
                        }}
                        disabled={busy}
                      >
                        →
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {selected.length > 0 ? (
            <div className="batchbar">
              <div className="batchbar-left">{format(t("selectedCount"), { count: selected.length })}</div>
              <div className="batchbar-actions">
                <button className="btn btn-primary" onClick={batchOpenTabs} disabled={busy}>
                  {t("openTab")}
                </button>
                <button className="btn" onClick={batchCloseTabs} disabled={busy}>
                  {t("closeTab")}
                </button>
                <button className="btn" onClick={runExport} disabled={busy}>
                  {t("export")}
                </button>
              </div>
            </div>
          ) : null}
        </aside>

        <main className="workspace">
          <div className="tabs" role="tablist" aria-label={t("tabsAria")}>
            {openTabIds.length === 0 ? (
              <div className="tab active" role="tab" aria-selected="true">
                <span className="tab-title">{t("noTabs")}</span>
              </div>
            ) : (
              openTabIds.map((id) => {
                const a = accounts.find((x) => x.id === id);
                const label = a?.displayName ?? id;
                const active = id === activeTabId;
                return (
                  <div
                    key={id}
                    className={clsx("tab", active && "active")}
                    role="tab"
                    aria-selected={active}
                    tabIndex={0}
                    onClick={() => activateTab(id)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        void activateTab(id);
                      }
                    }}
                  >
                    <span className="tab-title">{label}</span>
                    <button
                      className="tab-close"
                      title={t("closeTabTitle")}
                      onClick={(e) => {
                        e.stopPropagation();
                        void closeTab(id);
                      }}
                      disabled={busy}
                    >
                      ×
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <div className="tab-content">
            <div className="workspace-viewport glass" ref={viewportRef}>
              <div className="workspace-viewport-placeholder">
                <div className="content-title">{t("workspaceTitle")}</div>
                <div className="content-subtitle">{t("workspaceSubtitle")}</div>
                <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {focusedAccountId ? (
                    <>
                      <button
                        className="btn btn-primary"
                        onClick={() => openTab(focusedAccountId)}
                        disabled={busy}
                      >
                        {t("openFocused")}
                      </button>
                      <button className="btn" onClick={() => closeTab(focusedAccountId)} disabled={busy}>
                        {t("closeFocused")}
                      </button>
                    </>
                  ) : (
                    <div className="muted" style={{ fontSize: 12 }}>
                      {t("openCloseHint")}
                    </div>
                  )}
                  <button className="btn" onClick={reloadWorkspace} disabled={busy}>
                    {t("reloadActive")}
                  </button>
                </div>

                {importResult ? (
                  <div style={{ marginTop: 12 }}>
                    <div className="chip">
                      {format(t("importResultChip"), {
                        ok: importResult.imported,
                        fail: importResult.failed,
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </main>

        {inspectorOpen ? (
          <aside className="inspector" id="inspector">
            <div className="inspector-header">
              <div className="inspector-title">{t("inspectorTitle")}</div>
              <button
                className="btn btn-icon"
                title={t("close")}
                onClick={() => setInspectorOpen(false)}
                disabled={busy}
              >
                ×
              </button>
            </div>

            <div className="inspector-body">
              {!focusedAccount ? (
                <div className="muted" style={{ fontSize: 12 }}>
                  {t("inspectorSelectHint")}
                </div>
              ) : (
                <>
                  <div className="field">
                    <div className="field-label">{t("displayNameLabel")}</div>
                    <div className="field-value">{focusedAccount.displayName}</div>
                  </div>
                  <div className="field">
                    <div className="field-label">{t("accountIdLabel")}</div>
                    <div className="field-value mono">{focusedAccount.id}</div>
                  </div>
                  <div className="field">
                    <div className="field-label">{t("fingerprintLabel")}</div>
                    <div className="field-value mono">{maskFingerprint(focusedAccount.fingerprint)}</div>
                  </div>
                  <div className="field">
                    <div className="field-label">{t("tagsLabel")}</div>
                    <div className="field-value">
                      {focusedAccount.tags.length ? focusedAccount.tags.join(", ") : <span className="muted">-</span>}
                    </div>
                  </div>

                  <div className="section-divider" />
                  <div className="section-title">{t("accountInfoTitle")}</div>
                  <div className="field">
                    <div className="field-label">{t("subscriptionLabel")}</div>
                    <div className="field-value">
                      {focusedAccountInfo.subscription ? (
                        <span className="mono">{focusedAccountInfo.subscription}</span>
                      ) : (
                        <span className="muted">-</span>
                      )}
                    </div>
                  </div>
                  <div className="field">
                    <div className="field-label">{t("creditsLabel")}</div>
                    <div className="field-value">
                      {focusedAccountInfo.credits ? (
                        <span className="mono">{focusedAccountInfo.credits}</span>
                      ) : (
                        <span className="muted">-</span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <button
                      className="btn"
                      onClick={refreshAccountInfo}
                      disabled={busy || !focusedAccountId || focusedAccountInfo.status === "loading"}
                    >
                      {t("refreshCredits")}
                    </button>
                    {focusedAccountInfo.updatedAt ? (
                      <span className="muted" style={{ fontSize: 11 }}>
                        {t("updatedAtLabel")}: {formatUpdatedAt(focusedAccountInfo.updatedAt, uiPrefs.locale)}
                      </span>
                    ) : null}
                    {focusedAccountInfo.status === "loading" ? (
                      <span className="muted" style={{ fontSize: 11 }}>
                        …
                      </span>
                    ) : null}
                  </div>
                  {focusedAccountInfo.error ? (
                    <div
                      className="muted"
                      style={{ marginTop: 8, fontSize: 11, whiteSpace: "pre-wrap" }}
                    >
                      {focusedAccountInfo.error}
                    </div>
                  ) : null}

                  <div className="section-divider" />
                  <div className="section-title">{t("networkSectionTitle")}</div>
                  <div className="setting-grid">
                    <div className="setting-row">
                      <div className="muted">{t("proxyMode")}</div>
                      <select
                        value={proxyMode}
                        onChange={(e) => setProxyMode(e.target.value as ProxyMode)}
                        disabled={busy}
                        aria-label={t("proxyMode")}
                      >
                        <option value="system">{t("proxySystem")}</option>
                        <option value="custom">{t("proxyCustom")}</option>
                        <option value="direct">{t("proxyDirect")}</option>
                      </select>
                    </div>

                    {proxyMode === "custom" ? (
                      <div className="setting-row">
                        <div className="muted">{t("proxyRulesLabel")}</div>
                        <input
                          className="input mono"
                          type="text"
                          placeholder={t("proxyPlaceholder")}
                          value={proxyRules}
                          onChange={(e) => setProxyRules(e.target.value)}
                          disabled={busy}
                        />
                      </div>
                    ) : null}
                  </div>

                  <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <button className="btn" onClick={saveProxy} disabled={busy || !focusedAccountId}>
                      {t("saveProxy")}
                    </button>
                    <div style={{ position: "relative" }}>
                      <button className="btn" onClick={runConnectivity} disabled={busy || !focusedAccountId}>
                        {t("connectivity")}
                      </button>
                      {connectivityPopoverOpen && connectivity ? (
                        <div className="popover" ref={connectivityPopoverRef}>
                          <div className="popover-title">{t("connectivityTitle")}</div>
                          <div style={{ display: "grid", gap: 8 }}>
                            {connectivity.map((c) => (
                              <div key={c.name} className="popover-row">
                                <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <span className={clsx("dot", c.ok ? "dot-ok" : "dot-bad")} />
                                    <span style={{ fontWeight: 650 }}>{c.name}</span>
                                  </div>
                                  <div
                                    className="muted"
                                    style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis" }}
                                  >
                                    {c.url}
                                  </div>
                                  {c.error ? (
                                    <div className="muted" style={{ fontSize: 11, whiteSpace: "pre-wrap" }}>
                                      {c.error}
                                    </div>
                                  ) : null}
                                </div>
                                <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                                  <div style={{ fontWeight: 750 }}>{c.ok ? t("statusOk") : t("statusFail")}</div>
                                  <div className="muted" style={{ fontSize: 11 }}>
                                    {c.latencyMs} ms
                                    {typeof c.status === "number" ? ` · HTTP ${c.status}` : ""}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="muted" style={{ marginTop: 8, fontSize: 12, lineHeight: 1.45 }}>
                    {t("proxyHint")}
                  </div>

                  <div className="section-divider" />
                  <div className="section-title">{t("uaSectionTitle")}</div>
                  <div className="setting-grid">
                    <div className="setting-row">
                      <div className="muted">{t("uaModeLabel")}</div>
                      <select
                        value={uaMode}
                        onChange={(e) => setUaMode(e.target.value as UaMode)}
                        disabled={busy}
                        aria-label="User-Agent mode"
                      >
                        <option value="default">{t("uaDefault")}</option>
                        <option value="preset">{t("uaPreset")}</option>
                        <option value="custom">{t("uaCustom")}</option>
                      </select>
                    </div>

                    {uaMode === "default" ? null : (
                      <div className="setting-row">
                        <div className="muted">{t("uaValueLabel")}</div>
                        <input
                          className="input mono"
                          value={uaValue}
                          onChange={(e) => setUaValue(e.target.value)}
                          placeholder="Mozilla/5.0 ..."
                          disabled={busy}
                        />
                      </div>
                    )}
                  </div>

                  <div className="muted" style={{ marginTop: 8, fontSize: 12, lineHeight: 1.45 }}>
                    {t("uaHint")}
                  </div>
                </>
              )}
            </div>

            <div className="inspector-actions">
              <button
                className="btn btn-primary"
                onClick={() => focusedAccountId && openTab(focusedAccountId)}
                disabled={busy || !focusedAccountId}
              >
                {t("openTab")}
              </button>
              <button
                className="btn"
                onClick={() => focusedAccountId && closeTab(focusedAccountId)}
                disabled={busy || !focusedAccountId}
              >
                {t("closeTab")}
              </button>
              <button className="btn" onClick={saveUserAgent} disabled={busy || !focusedAccountId}>
                {t("saveUa")}
              </button>
              <button className="btn" onClick={reloadWorkspace} disabled={busy}>
                {t("reload")}
              </button>
            </div>
          </aside>
        ) : null}
      </div>

      {downloadToasts.length > 0 ? (
        <div className="download-toasts" aria-label={t("downloadsSectionTitle")}>
          {downloadToasts.map((d) => {
            const percent = d.totalBytes > 0 ? Math.min(1, d.receivedBytes / d.totalBytes) : null;
            const progressText =
              d.state === "progressing"
                ? d.totalBytes > 0 && percent !== null
                  ? `${formatBytes(d.receivedBytes)} / ${formatBytes(d.totalBytes)} (${Math.round(percent * 100)}%)`
                  : formatBytes(d.receivedBytes)
                : formatDownloadStateLabel(d.state, t);

            const barClass = clsx(
              "download-progress-bar",
              d.state === "completed" && "download-progress-bar-ok",
              (d.state === "cancelled" || d.state === "interrupted") && "download-progress-bar-bad"
            );

            const barWidth =
              percent !== null
                ? `${Math.round(percent * 100)}%`
                : d.state === "progressing"
                  ? "20%"
                  : "100%";

            return (
              <div key={d.id} className="download-toast glass">
                <div className="download-toast-head">
                  <div className="download-toast-title" title={d.filename}>
                    {d.filename}
                  </div>
                  <button
                    className="btn btn-ghost btn-icon"
                    title={t("close")}
                    aria-label={t("close")}
                    onClick={() => dismissDownloadToast(d.id)}
                  >
                    ×
                  </button>
                </div>

                <div className="download-toast-meta muted">
                  <span>{progressText}</span>
                  {d.copiedAt ? <span className="chip download-chip">{t("downloadCopied")}</span> : null}
                </div>

                <div className="download-progress">
                  <div className={barClass} style={{ width: barWidth }} />
                </div>

                <div className="download-actions">
                  {d.state === "progressing" ? (
                    <button className="btn" onClick={() => cancelDownloadToast(d.id)}>
                      {t("downloadCancelDownload")}
                    </button>
                  ) : d.state === "completed" ? (
                    <>
                      <button className="btn" onClick={() => showDownloadInFolder(d.id)}>
                        {t("downloadShowInFolder")}
                      </button>
                      <button className="btn btn-primary" onClick={() => openDownloadedFile(d.id)}>
                        {t("downloadOpenFile")}
                      </button>
                      <button className="btn" onClick={() => copyDownloadPath(d.id)}>
                        {t("downloadCopyPath")}
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <dialog
        ref={importDialogRef}
        onCancel={(e) => {
          e.preventDefault();
          setImportDialogOpen(false);
        }}
        onClose={() => setImportDialogOpen(false)}
        aria-label={t("importDialogTitle")}
      >
        <div className="modal">
          <div className="modal-header">
            <div>
              <div className="modal-title">{t("importDialogTitle")}</div>
              <div className="modal-note">{t("importDialogNote")}</div>
            </div>
            <button
              className="btn btn-icon"
              title={t("close")}
              onClick={() => setImportDialogOpen(false)}
              disabled={busy}
            >
              ×
            </button>
          </div>

          <div className="modal-grid">
            <textarea
              className="secret-textarea"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={t("importPlaceholder")}
              disabled={busy}
            />
            <div className="muted" style={{ fontSize: 12 }}>
              {t("importHint")}
            </div>
          </div>

          <div className="modal-actions">
            <button className="btn" onClick={() => setImportDialogOpen(false)} disabled={busy}>
              {t("cancel")}
            </button>
            <button
              className="btn btn-primary"
              onClick={runImport}
              disabled={busy || importText.trim().length === 0}
            >
              {t("confirmImport")}
            </button>
          </div>
        </div>
      </dialog>

      <dialog
        ref={exportDialogRef}
        onCancel={(e) => {
          e.preventDefault();
          setExportDialog({ open: false });
        }}
        onClose={() => setExportDialog({ open: false })}
        aria-label={t("exportDialogTitle")}
      >
        {exportDialog.open ? (
          <div className="modal">
            <div className="modal-header">
              <div>
                <div className="modal-title">{t("exportDialogTitle")}</div>
                <div className="modal-note">{t("exportDialogNote")}</div>
              </div>
              <button
                className="btn btn-icon"
                title={t("close")}
                onClick={() => setExportDialog({ open: false })}
                disabled={busy}
              >
                ×
              </button>
            </div>

            <div className="danger-note">{t("exportDanger")}</div>

            <div className="modal-grid">
              <textarea className="mono" readOnly value={exportDialog.tokenText} />
              <div className="muted" style={{ fontSize: 12 }}>
                {format(t("exportHint"), { count: exportDialog.selectedCount })}
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => setExportDialog({ open: false })}>
                {t("done")}
              </button>
            </div>
          </div>
        ) : null}
      </dialog>
    </div>
  );
}
