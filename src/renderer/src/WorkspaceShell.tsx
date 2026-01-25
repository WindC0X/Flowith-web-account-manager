import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type {
  AccountSummary,
  ConnectivityCheck,
  DownloadEvent,
  DownloadPreferencesPublic,
  DownloadSaveMode,
  ImportRefreshTokensOptions,
  ImportRefreshTokensResult,
  ProxyMode,
  Rect,
  UpdaterEvent,
  UpdaterStatus,
  UaMode,
} from "../../shared/ipc";
import { parseTagsInput } from "../../shared/tags";
import { USER_AGENT_PRESETS, findUserAgentPreset } from "../../shared/userAgentPresets";
import logoOnDark from "./assets/logo-on-dark.png";
import logoOnLight from "./assets/logo-on-light.png";

type ExportDialogState =
  | { open: false }
  | { open: true; tokenText: string; selectedCount: number };

type DeleteDialogState =
  | { open: false }
  | { open: true; accountId: string; displayName: string };

type BatchTagsDialogState =
  | { open: false }
  | { open: true; accountIds: string[] };

type BatchDeleteDialogState =
  | { open: false }
  | { open: true; accountIds: string[] };

type Theme = "dark" | "light";
type Locale = "zh-CN" | "en";
type AccountListViewMode = "cards" | "table";
type ImportUaMode = "auto" | UaMode;

type AccountInfoStatus = "idle" | "loading" | "ready" | "unavailable";
type AccountInfoEntry = {
  status: AccountInfoStatus;
  subscription: string | null;
  subscriptionExpiresAt: number | null;
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

type UiToastKind = "success" | "error" | "info";
type UiToastState = {
  id: string;
  kind: UiToastKind;
  message: string;
  createdAt: number;
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
  subscriptionExpiresAt: null,
  credits: null,
  updatedAt: null,
  error: null,
};

const UI_STRINGS = {
  "zh-CN": {
    subtitle: "桌面端 · 工作区",
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
	    toastDownloadStarted: "开始下载：{filename}",
	    toastDownloadCompleted: "下载已完成：{filename}",
	    toastDownloadCancelled: "下载已取消：{filename}",
	    toastDownloadInterrupted: "下载已中断：{filename}",
	    updatesSectionTitle: "更新",
	    updateCurrentVersion: "当前版本",
	    updateStateLabel: "状态",
	    updateActionsLabel: "操作",
	    updateProgressLabel: "进度",
	    updateCheck: "检查更新",
	    updateDownload: "下载更新",
	    updateInstall: "重启安装",
	    updateUnsupportedHint: "仅发布版（安装包）可用",
	    updateStateIdle: "未检查",
	    updateStateChecking: "检查中…",
	    updateStateAvailable: "发现新版本",
	    updateStateNotAvailable: "已是最新版本",
	    updateStateDownloading: "下载中…",
	    updateStateDownloaded: "已下载",
	    updateStateError: "更新失败",
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
	    proxyPresetLabel: "代理预设",
	    proxyPresetManual: "（手动输入）",
	    proxyPlaceholder: "http://127.0.0.1:7890 或 socks5://127.0.0.1:7891",
	    proxyDisabledHint: "请选择一个账号后再配置代理/连通性。",
	    networkSectionTitle: "网络",
	    proxyRulesLabel: "代理地址",
    proxyHint: "代理设置按账号生效。修改后通常需要刷新当前 Tab 生效。",
    saveProxy: "保存代理",
    toastProxySaved: "代理已保存",
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
    batchTags: "批量标签",
    batchRefresh: "批量刷新",
    batchDelete: "批量删除",
    refresh: "刷新",

    errorTitle: "错误",
    toastTabOpened: "已打开 Tab",
    toastTabClosed: "已关闭 Tab",
    toastTabReloaded: "已刷新当前 Tab",
    toastCreditsRefreshed: "积分已更新",

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
    tagsPlaceholder: "tag1, tag2",
    saveTags: "保存标签",
    toastTagsSaved: "标签已保存",
    accountInfoTitle: "账号信息",
    subscriptionLabel: "订阅",
    subscriptionExpiresAtLabel: "订阅到期",
    subscriptionExpiresAtChip: "到期 {date}",
    creditsLabel: "积分",
    refreshCredits: "刷新积分",
    updatedAtLabel: "更新时间",
    accountInfoUnavailable: "账号信息接口暂未接入（占位）",
    uaSectionTitle: "User-Agent",
    uaModeLabel: "模式",
    uaAuto: "随机预设",
    uaDefault: "默认",
    uaPreset: "预设",
    uaCustom: "自定义",
    uaValueLabel: "值",
    uaHint: "默认：跟随系统；预设：从内置列表选择；自定义：输入 UA 字符串。修改后通常需要刷新当前 Tab 生效。",
    uaErrorRequired: "请填写有效的 User-Agent。",
    uaErrorTooLong: "User-Agent 过长（最多 512 字符）。",
    uaErrorSingleLine: "User-Agent 不能包含换行。",
    uaErrorPresetUnknown: "请选择一个有效的 User-Agent 预设。",
	    openTab: "打开 Tab",
	    closeTab: "关闭 Tab",
	    saveUa: "保存 UA",
	    toastUaSaved: "User-Agent 已保存",
	    reload: "刷新",
	    deleteAccount: "删除账号",
	    toastAccountDeleted: "账号已删除",
	    close: "关闭",

    importDialogTitle: "导入 refresh_token",
    importDialogNote:
      "每行一个 refresh_token。导入时会尝试刷新 Supabase Session 以校验 token；导入结果会在弹窗内显示。",
    importPlaceholder: "每行一个 refresh_token",
    importHint: "UI 中只显示 token 指纹/掩码；导出才会输出明文。",
    importOptionsTitle: "导入设置",
    cancel: "取消",
    confirmImport: "导入",

    exportDialogTitle: "导出 refresh_token",
    exportDialogNote: "将导出当前勾选账号的 refresh_token（每行一个）。",
	    exportDanger: "注意：导出内容属于敏感凭据。UI 与日志中必须始终脱敏；请勿分享或粘贴到日志/工单中。",
	    exportHint: "已导出 {count} 个账号的 token。默认不自动复制。",
	    done: "完成",
	    deleteAccountTitle: "删除账号",
	    deleteAccountNote: "将移除本地保存的账号信息与登录态，并关闭对应 Tab。此操作不可撤销。",
	    confirmDelete: "确认删除",
    closeTabTitle: "关闭 Tab",

    batchTagsTitle: "批量设置标签",
    batchTagsNote: "将把标签应用到已选择的 {count} 个账号（逗号/空白分隔）。",
    batchDeleteTitle: "批量删除账号",
    batchDeleteNote: "将删除已选择的 {count} 个账号并关闭对应 Tab。此操作不可撤销。",
    confirmApply: "应用",
    toastBatchTagsResult: "批量标签：成功 {ok} · 失败 {fail}",
    toastBatchRefreshResult: "批量刷新：成功 {ok} · 失败 {fail}",
    toastBatchDeleteResult: "批量删除：成功 {ok} · 失败 {fail}",
  },
  en: {
    subtitle: "Desktop · Workspace UI",
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
	    toastDownloadStarted: "Download started: {filename}",
	    toastDownloadCompleted: "Download completed: {filename}",
	    toastDownloadCancelled: "Download cancelled: {filename}",
	    toastDownloadInterrupted: "Download interrupted: {filename}",
	    updatesSectionTitle: "Updates",
	    updateCurrentVersion: "Current version",
	    updateStateLabel: "Status",
	    updateActionsLabel: "Actions",
	    updateProgressLabel: "Progress",
	    updateCheck: "Check updates",
	    updateDownload: "Download",
	    updateInstall: "Restart & install",
	    updateUnsupportedHint: "Only available in packaged builds",
	    updateStateIdle: "Idle",
	    updateStateChecking: "Checking…",
	    updateStateAvailable: "Update available",
	    updateStateNotAvailable: "Up to date",
	    updateStateDownloading: "Downloading…",
	    updateStateDownloaded: "Downloaded",
	    updateStateError: "Update failed",
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
	    proxyPresetLabel: "Proxy preset",
	    proxyPresetManual: "(Manual input)",
	    proxyPlaceholder: "http://127.0.0.1:7890 or socks5://127.0.0.1:7891",
	    proxyDisabledHint: "Select an account to configure proxy/connectivity.",
	    networkSectionTitle: "Network",
	    proxyRulesLabel: "Proxy",
    proxyHint: "Proxy settings apply per-account. Reload the active tab to apply.",
    saveProxy: "Save proxy",
    toastProxySaved: "Proxy saved",
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
    batchTags: "Batch tags",
    batchRefresh: "Batch refresh",
    batchDelete: "Batch delete",
    refresh: "Refresh",

    errorTitle: "Error",
    toastTabOpened: "Tab opened",
    toastTabClosed: "Tab closed",
    toastTabReloaded: "Tab reloaded",
    toastCreditsRefreshed: "Credits updated",

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
    tagsPlaceholder: "tag1, tag2",
    saveTags: "Save tags",
    toastTagsSaved: "Tags saved",
    accountInfoTitle: "Account info",
    subscriptionLabel: "Subscription",
    subscriptionExpiresAtLabel: "Subscription expires",
    subscriptionExpiresAtChip: "Exp {date}",
    creditsLabel: "Credits",
    refreshCredits: "Refresh credits",
    updatedAtLabel: "Updated",
    accountInfoUnavailable: "Account info API not integrated yet (placeholder).",
    uaSectionTitle: "User-Agent",
    uaModeLabel: "Mode",
    uaAuto: "Random preset",
    uaDefault: "Default",
    uaPreset: "Preset",
    uaCustom: "Custom",
    uaValueLabel: "Value",
    uaHint:
      "Default: follow system; Preset: choose from built-in list; Custom: enter UA string. Changing User-Agent usually requires reloading the tab.",
    uaErrorRequired: "Please enter a valid User-Agent.",
    uaErrorTooLong: "User-Agent is too long (max 512 chars).",
    uaErrorSingleLine: "User-Agent must be single-line.",
    uaErrorPresetUnknown: "Please select a valid User-Agent preset.",
		    openTab: "Open tab",
		    closeTab: "Close tab",
		    saveUa: "Save UA",
		    toastUaSaved: "User-Agent saved",
		    reload: "Reload",
		    deleteAccount: "Delete account",
		    toastAccountDeleted: "Account deleted",
		    close: "Close",

    importDialogTitle: "Import refresh_token",
    importDialogNote:
      "One refresh_token per line. Import validates each token by refreshing a Supabase session; results are shown in the dialog.",
    importPlaceholder: "One refresh_token per line",
    importHint: "UI never displays tokens. Export is the only plaintext flow.",
    importOptionsTitle: "Import settings",
    cancel: "Cancel",
    confirmImport: "Import",

    exportDialogTitle: "Export refresh_token",
    exportDialogNote: "Exports refresh_token for selected accounts (one per line).",
	    exportDanger:
	      "Sensitive: export contains credentials. Never paste into logs or tickets. UI/logs must remain redacted.",
	    exportHint: "Exported token(s) for {count} account(s). Nothing is auto-copied.",
	    done: "Done",
	    deleteAccountTitle: "Delete account",
	    deleteAccountNote: "Removes local account data and closes its tab. This cannot be undone.",
	    confirmDelete: "Delete",
    closeTabTitle: "Close tab",

    batchTagsTitle: "Batch tags",
    batchTagsNote: "Applies tags to {count} selected account(s) (comma/space separated).",
    batchDeleteTitle: "Batch delete",
    batchDeleteNote: "Deletes {count} selected account(s) and closes their tabs. This cannot be undone.",
    confirmApply: "Apply",
    toastBatchTagsResult: "Batch tags: ok {ok} · failed {fail}",
    toastBatchRefreshResult: "Batch refresh: ok {ok} · failed {fail}",
    toastBatchDeleteResult: "Batch delete: ok {ok} · failed {fail}",
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

function formatDate(value: number, locale: Locale): string {
  try {
    return new Date(value).toLocaleDateString(locale);
  } catch {
    return new Date(value).toISOString().slice(0, 10);
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

function containsProxyCredentials(text: string): boolean {
  return /(^|\W)[^\s;,@/:]+:[^\s;,@/]+@/.test(text);
}

function validateProxyDraft(mode: ProxyMode, rules: string): string | null {
  if (mode !== "custom") return null;
  const trimmed = rules.trim();
  if (!trimmed) return "Custom proxy rules are required.";
  if (containsProxyCredentials(trimmed)) {
    return "Proxy rules must not include username:password credentials.";
  }
  return null;
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

function formatUpdaterStateLabel(state: UpdaterStatus["state"], t: (key: StringKey) => string): string {
  if (state === "idle") return t("updateStateIdle");
  if (state === "checking") return t("updateStateChecking");
  if (state === "available") return t("updateStateAvailable");
  if (state === "notAvailable") return t("updateStateNotAvailable");
  if (state === "downloading") return t("updateStateDownloading");
  if (state === "downloaded") return t("updateStateDownloaded");
  return t("updateStateError");
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

const ACCOUNT_INFO_CACHE_KEY_V1 = "fwd_account_info_cache_v1";
const ACCOUNT_INFO_CACHE_KEY_V2 = "fwd_account_info_cache_v2";

type AccountInfoCacheV1 = {
  version: 1;
  byId: Record<string, { subscription: string | null; credits: string | null; updatedAt: number }>;
};

type AccountInfoCacheV2 = {
  version: 2;
  byId: Record<
    string,
    { subscription: string | null; subscriptionExpiresAt: number | null; credits: string | null; updatedAt: number }
  >;
};

function loadAccountInfoCache(): Record<string, AccountInfoEntry> {
  try {
    const raw =
      window.localStorage.getItem(ACCOUNT_INFO_CACHE_KEY_V2) ??
      window.localStorage.getItem(ACCOUNT_INFO_CACHE_KEY_V1);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return {};
    if (parsed.version !== 1 && parsed.version !== 2) return {};
    if (!isRecord(parsed.byId)) return {};

    const next: Record<string, AccountInfoEntry> = {};
    for (const [accountId, entry] of Object.entries(parsed.byId)) {
      if (!isRecord(entry)) continue;
      const updatedAt = entry.updatedAt;
      if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt) || updatedAt <= 0) continue;
      const subscription = typeof entry.subscription === "string" ? entry.subscription : null;
      const subscriptionExpiresAt =
        typeof entry.subscriptionExpiresAt === "number" &&
        Number.isFinite(entry.subscriptionExpiresAt) &&
        entry.subscriptionExpiresAt > 0
          ? entry.subscriptionExpiresAt
          : null;
      const credits = typeof entry.credits === "string" ? entry.credits : null;
      next[accountId] = { status: "ready", subscription, subscriptionExpiresAt, credits, updatedAt, error: null };
    }

    return next;
  } catch {
    return {};
  }
}

function persistAccountInfoCache(entries: Record<string, AccountInfoEntry>): void {
  const byId: AccountInfoCacheV2["byId"] = {};
  for (const [accountId, entry] of Object.entries(entries)) {
    if (!entry.updatedAt) continue;
    if (entry.status === "idle") continue;
    byId[accountId] = {
      subscription: entry.subscription ?? null,
      subscriptionExpiresAt: entry.subscriptionExpiresAt ?? null,
      credits: entry.credits ?? null,
      updatedAt: entry.updatedAt,
    };
  }

  try {
    const payload: AccountInfoCacheV2 = { version: 2, byId };
    window.localStorage.setItem(ACCOUNT_INFO_CACHE_KEY_V2, JSON.stringify(payload));
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
  const [uiToasts, setUiToasts] = useState<UiToastState[]>([]);
  const [searchText, setSearchText] = useState("");

  const strings = UI_STRINGS[uiPrefs.locale];
  const t = useCallback((key: StringKey) => strings[key], [strings]);
  const isWindows = useMemo(() => /windows/i.test(navigator.userAgent), []);
  const [windowMaximized, setWindowMaximized] = useState(false);

  const dismissUiToast = useCallback((toastId: string) => {
    const handle = uiToastTimersRef.current.get(toastId);
    if (typeof handle === "number") {
      window.clearTimeout(handle);
      uiToastTimersRef.current.delete(toastId);
    }
    setUiToasts((prev) => prev.filter((t) => t.id !== toastId));
  }, []);

  const pushUiToast = useCallback(
    (kind: UiToastKind, message: string, opts?: { autoDismissMs?: number }) => {
      for (const handle of uiToastTimersRef.current.values()) window.clearTimeout(handle);
      uiToastTimersRef.current.clear();

      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

      const normalized = message.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();

      setUiToasts([{ id, kind, message: normalized, createdAt: Date.now() }]);

      const autoDismissMs = opts?.autoDismissMs ?? (kind === "error" ? 8000 : 3500);
      const timeout = window.setTimeout(() => dismissUiToast(id), autoDismissMs);
      uiToastTimersRef.current.set(id, timeout);
    },
    [dismissUiToast]
  );

  useEffect(() => {
    const uiToastTimers = uiToastTimersRef.current;
    const downloadTimers = downloadAutoDismissTimersRef.current;
    return () => {
      for (const handle of uiToastTimers.values()) window.clearTimeout(handle);
      uiToastTimers.clear();
      for (const handle of downloadTimers.values()) window.clearTimeout(handle);
      downloadTimers.clear();
    };
  }, []);

  useEffect(() => {
    if (!error) return;
    const timeout = window.setTimeout(() => setError(null), 8000);
    return () => window.clearTimeout(timeout);
  }, [error]);

  const viewMode = uiPrefs.accountListView;
  const sidebarCollapsed = uiPrefs.sidebarCollapsed;

  const updateUiPrefs = useCallback((patch: Partial<Omit<UiPreferencesV1, "version">>) => {
    setUiPrefs((prev) => ({ ...prev, ...patch, version: 1 }));
  }, []);

  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importResult, setImportResult] = useState<ImportRefreshTokensResult | null>(null);
  const [importProxyMode, setImportProxyMode] = useState<ProxyMode>("system");
  const [importProxyRules, setImportProxyRules] = useState("");
  const [importProxyInlineError, setImportProxyInlineError] = useState<string | null>(null);
  const [importUaMode, setImportUaMode] = useState<ImportUaMode>("auto");
  const [importUaValue, setImportUaValue] = useState("");
  const [importUaInlineError, setImportUaInlineError] = useState<string | null>(null);

  const [exportDialog, setExportDialog] = useState<ExportDialogState>({ open: false });
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState>({ open: false });
  const [batchTagsDialog, setBatchTagsDialog] = useState<BatchTagsDialogState>({ open: false });
  const [batchTagsDraft, setBatchTagsDraft] = useState("");
  const [batchDeleteDialog, setBatchDeleteDialog] = useState<BatchDeleteDialogState>({ open: false });
  const [batchRefreshRunning, setBatchRefreshRunning] = useState(false);

  const [tagsDraft, setTagsDraft] = useState("");
  const [proxyMode, setProxyMode] = useState<ProxyMode>("system");
  const [proxyRules, setProxyRules] = useState("");
  const [proxyInlineError, setProxyInlineError] = useState<string | null>(null);
  const [uaMode, setUaMode] = useState<UaMode>("default");
  const [uaValue, setUaValue] = useState("");
  const [uaInlineError, setUaInlineError] = useState<string | null>(null);

  const [connectivity, setConnectivity] = useState<ConnectivityCheck[] | null>(null);
  const [connectivityPopoverOpen, setConnectivityPopoverOpen] = useState(false);
  const [connectivityPopoverStyle, setConnectivityPopoverStyle] = useState<CSSProperties | null>(null);

  const [settingsPopoverOpen, setSettingsPopoverOpen] = useState(false);
  const [downloadsPopoverOpen, setDownloadsPopoverOpen] = useState(false);
  const [selectOverlayOpen, setSelectOverlayOpen] = useState(false);
  const [downloadPrefs, setDownloadPrefs] = useState<DownloadPreferencesPublic | null>(null);
  const [downloadToasts, setDownloadToasts] = useState<DownloadToastState[]>([]);
  const [updaterStatus, setUpdaterStatus] = useState<UpdaterStatus | null>(null);
  const [updaterRunning, setUpdaterRunning] = useState(false);

  const [accountInfoById, setAccountInfoById] = useState<Record<string, AccountInfoEntry>>(() => loadAccountInfoCache());

  const [openTabIds, setOpenTabIds] = useState<string[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [activeTabSnapshot, setActiveTabSnapshot] = useState<string | null>(null);
  const tabSnapshotCacheRef = useRef<Map<string, { snapshot: string; capturedAt: number }>>(new Map());
  const tabSnapshotInFlightRef = useRef<Map<string, Promise<string | null>>>(new Map());

  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const viewportBoundsDesiredRef = useRef<Rect | null>(null);
  const viewportBoundsFlushInFlightRef = useRef<Promise<void> | null>(null);
  const viewportBoundsFlushNeededRef = useRef(false);
  const importDialogRef = useRef<HTMLDialogElement | null>(null);
  const exportDialogRef = useRef<HTMLDialogElement | null>(null);
  const deleteDialogRef = useRef<HTMLDialogElement | null>(null);
  const batchTagsDialogRef = useRef<HTMLDialogElement | null>(null);
  const batchDeleteDialogRef = useRef<HTMLDialogElement | null>(null);
  const connectivityPopoverAnchorRef = useRef<HTMLDivElement | null>(null);
  const connectivityPopoverRef = useRef<HTMLDivElement | null>(null);
  const settingsPopoverRef = useRef<HTMLDivElement | null>(null);
  const settingsContainerRef = useRef<HTMLDivElement | null>(null);
  const downloadsPopoverRef = useRef<HTMLDivElement | null>(null);
  const downloadsPopoverContainerRef = useRef<HTMLDivElement | null>(null);
  const uiToastTimersRef = useRef<Map<string, number>>(new Map());
  const downloadAutoDismissTimersRef = useRef<Map<string, number>>(new Map());
  const downloadFilenameByIdRef = useRef<Map<string, string>>(new Map());

  const selected = useMemo(() => [...selectedIds], [selectedIds]);
  const proxyPresets = useMemo(() => {
    const presets = new Set<string>();
    for (const a of accounts) {
      if (a.net.proxy.mode !== "custom") continue;
      const rules = typeof a.net.proxy.rules === "string" ? a.net.proxy.rules.trim() : "";
      if (!rules) continue;
      if (validateProxyDraft("custom", rules)) continue;
      presets.add(rules);
    }
    return [...presets].slice(0, 16);
  }, [accounts]);
  const proxyPresetValue = useMemo(() => {
    const trimmed = proxyRules.trim();
    return trimmed && proxyPresets.includes(trimmed) ? trimmed : "";
  }, [proxyPresets, proxyRules]);
  const importProxyPresetValue = useMemo(() => {
    const trimmed = importProxyRules.trim();
    return trimmed && proxyPresets.includes(trimmed) ? trimmed : "";
  }, [importProxyRules, proxyPresets]);

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
    setUaInlineError(null);
    setProxyInlineError(null);
    setTagsDraft(focusedAccount.tags.join(", "));
    setProxyMode(focusedAccount.net.proxy.mode);
    setProxyRules(focusedAccount.net.proxy.rules ?? "");
    const uaMode = focusedAccount.ua.mode;
    const uaValue = focusedAccount.ua.value ?? "";
    if (uaMode === "preset") {
      const preset = uaValue ? findUserAgentPreset(uaValue) : null;
      if (preset) {
        setUaMode("preset");
        setUaValue(preset.id);
      } else if (uaValue.trim()) {
        setUaMode("custom");
        setUaValue(uaValue);
      } else {
        setUaMode("preset");
        setUaValue(USER_AGENT_PRESETS[0]?.id ?? "");
      }
    } else {
      setUaMode(uaMode);
      setUaValue(uaValue);
    }
  }, [focusedAccount]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", uiPrefs.theme);
    document.documentElement.lang = uiPrefs.locale;
    persistUiPreferences(uiPrefs);
  }, [uiPrefs]);

  useEffect(() => {
    persistAccountInfoCache(accountInfoById);
  }, [accountInfoById]);

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

  const openSelectOverlay = useCallback(() => setSelectOverlayOpen(true), []);
  const closeSelectOverlay = useCallback(() => setSelectOverlayOpen(false), []);

  const overlayActive =
    importDialogOpen ||
    exportDialog.open ||
    deleteDialog.open ||
    batchTagsDialog.open ||
    batchDeleteDialog.open ||
    settingsPopoverOpen ||
    downloadsPopoverOpen ||
    connectivityPopoverOpen ||
    selectOverlayOpen;

  useEffect(() => {
    void window.desktop.workspace.setOverlayActive(overlayActive).catch(() => void 0);
  }, [overlayActive]);

  const computeViewportBounds = useCallback((): Rect | null => {
    if (overlayActive) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    const el = viewportRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      x: Math.floor(rect.left),
      y: Math.floor(rect.top),
      width: Math.floor(rect.width),
      height: Math.floor(rect.height),
    };
  }, [overlayActive]);

  const pushViewportBounds = useCallback(() => {
    const desired = computeViewportBounds();
    if (!desired) return Promise.resolve();

    viewportBoundsDesiredRef.current = desired;
    viewportBoundsFlushNeededRef.current = true;

    const existing = viewportBoundsFlushInFlightRef.current;
    if (existing) return existing;

    const task = (async () => {
      try {
        while (viewportBoundsFlushNeededRef.current) {
          viewportBoundsFlushNeededRef.current = false;
          const nextBounds = viewportBoundsDesiredRef.current;
          if (!nextBounds) continue;
          await window.desktop.workspace.setViewportBounds(nextBounds);
        }
      } finally {
        viewportBoundsFlushInFlightRef.current = null;
      }
    })();

    viewportBoundsFlushInFlightRef.current = task;
    return task;
  }, [computeViewportBounds]);

  useEffect(() => {
    void pushViewportBounds().catch(() => void 0);
  }, [pushViewportBounds, sidebarCollapsed, inspectorOpen, uiPrefs.locale, error]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        void pushViewportBounds().catch(() => void 0);
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

  const cacheTabSnapshot = useCallback((tabId: string, snapshot: string) => {
    const normalized = snapshot.trim();
    if (!normalized) return;

    const cache = tabSnapshotCacheRef.current;
    cache.delete(tabId);
    cache.set(tabId, { snapshot: normalized, capturedAt: Date.now() });
    while (cache.size > 3) {
      const key = cache.keys().next().value as string | undefined;
      if (!key) break;
      cache.delete(key);
    }
  }, []);

  const requestTabSnapshot = useCallback(
    async (tabId: string): Promise<string | null> => {
      const normalizedId = tabId.trim();
      if (!normalizedId) return null;

      const inFlight = tabSnapshotInFlightRef.current.get(normalizedId);
      if (inFlight) return inFlight;

      const task = (async () => {
        try {
          const snapshot = await window.desktop.workspace.captureTabSnapshot(normalizedId);
          if (typeof snapshot === "string" && snapshot.trim()) {
            cacheTabSnapshot(normalizedId, snapshot);
            return snapshot;
          }
          return null;
        } catch {
          return null;
        } finally {
          tabSnapshotInFlightRef.current.delete(normalizedId);
        }
      })();

      tabSnapshotInFlightRef.current.set(normalizedId, task);
      return task;
    },
    [cacheTabSnapshot]
  );

  useEffect(() => {
    if (!activeTabId) {
      setActiveTabSnapshot(null);
      return;
    }
    const cached = tabSnapshotCacheRef.current.get(activeTabId)?.snapshot ?? null;
    setActiveTabSnapshot(cached);
  }, [activeTabId]);

  useEffect(() => {
    if (!activeTabId) return;
    if (!overlayActive) return;

    const cached = tabSnapshotCacheRef.current.get(activeTabId);
    if (cached && Date.now() - cached.capturedAt < 1500) return;

    void requestTabSnapshot(activeTabId).then((snapshot) => {
      if (snapshot) setActiveTabSnapshot(snapshot);
    });
  }, [activeTabId, overlayActive, requestTabSnapshot]);

  useEffect(() => {
    if (!activeTabId) return;
    const cached = tabSnapshotCacheRef.current.get(activeTabId);
    if (cached) return;
    const timer = window.setTimeout(() => {
      void requestTabSnapshot(activeTabId);
    }, 800);
    return () => {
      window.clearTimeout(timer);
    };
  }, [activeTabId, requestTabSnapshot]);

  useEffect(() => {
    if (!connectivityPopoverOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (connectivityPopoverRef.current?.contains(target)) return;
      if (connectivityPopoverAnchorRef.current?.contains(target)) return;
      setConnectivityPopoverOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
    };
  }, [connectivityPopoverOpen]);

  useEffect(() => {
    if (!connectivityPopoverOpen) {
      setConnectivityPopoverStyle(null);
      return;
    }

    const measure = () => {
      const popover = connectivityPopoverRef.current;
      const anchor = connectivityPopoverAnchorRef.current;
      if (!popover || !anchor) return;

      const popoverRect = popover.getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();

      const margin = 12;
      const desiredLeft = anchorRect.right - popoverRect.width;
      const left = Math.max(margin, Math.min(desiredLeft, window.innerWidth - margin - popoverRect.width));

      const spaceBelow = window.innerHeight - anchorRect.bottom - margin;
      const spaceAbove = anchorRect.top - margin;
      const placeBelow = spaceBelow >= popoverRect.height + 8 || spaceBelow >= spaceAbove;
      const desiredTop = placeBelow ? anchorRect.bottom + 8 : anchorRect.top - popoverRect.height - 8;
      const top = Math.max(margin, Math.min(desiredTop, window.innerHeight - margin - popoverRect.height));

      setConnectivityPopoverStyle({
        position: "fixed",
        top: Math.round(top),
        left: Math.round(left),
        zIndex: 80,
      });
    };

    const raf = window.requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [connectivityPopoverOpen, connectivity]);

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
    if (!downloadsPopoverOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (downloadsPopoverContainerRef.current?.contains(target)) return;
      setDownloadsPopoverOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
    };
  }, [downloadsPopoverOpen]);

  useEffect(() => {
    if (!downloadsPopoverOpen) return;
    if (downloadToasts.length > 0) return;
    setDownloadsPopoverOpen(false);
  }, [downloadToasts, downloadsPopoverOpen]);

  useEffect(() => {
    void window.desktop.downloads
      .getPreferences()
      .then((prefs) => setDownloadPrefs(prefs))
      .catch(() => void 0);
  }, []);

  useEffect(() => {
    void window.desktop.updater
      .getStatus()
      .then((next) => setUpdaterStatus(next))
      .catch(() => void 0);

    let unsubscribe: (() => void) | null = null;
    try {
      unsubscribe = window.desktop.updater.subscribe((event: UpdaterEvent) => {
        if (event.type !== "status") return;
        setUpdaterStatus(event.status);
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

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    try {
      unsubscribe = window.desktop.downloads.subscribe((event: DownloadEvent) => {
        const now = Date.now();
        const filenameCache = downloadFilenameByIdRef.current;

        setDownloadToasts((prev) => {
          if (event.type === "start") {
            filenameCache.set(event.id, event.filename);
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

        if (event.type === "start") {
          pushUiToast("info", format(t("toastDownloadStarted"), { filename: event.filename }));
          return;
        }

        if (event.type === "done") {
          const filename = filenameCache.get(event.id) ?? "";
          filenameCache.delete(event.id);

          const toastKey: StringKey =
            event.state === "completed"
              ? "toastDownloadCompleted"
              : event.state === "cancelled"
                ? "toastDownloadCancelled"
                : "toastDownloadInterrupted";
          const kind: UiToastKind =
            event.state === "interrupted" ? "error" : event.state === "completed" ? "success" : "info";

          pushUiToast(kind, format(t(toastKey), { filename: filename || event.id }));
        }
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
  }, [pushUiToast, t]);

  const dismissDownloadToast = useCallback((id: string) => {
    setDownloadToasts((prev) => prev.filter((d) => d.id !== id));
  }, []);

  useEffect(() => {
    const timers = downloadAutoDismissTimersRef.current;
    const active = new Set(downloadToasts.map((d) => d.id));

    for (const [id, handle] of [...timers.entries()]) {
      if (active.has(id)) continue;
      window.clearTimeout(handle);
      timers.delete(id);
    }

    for (const toast of downloadToasts) {
      if (toast.state === "progressing") continue;
      if (timers.has(toast.id)) continue;
      const handle = window.setTimeout(() => dismissDownloadToast(toast.id), 12_000);
      timers.set(toast.id, handle);
    }
  }, [dismissDownloadToast, downloadToasts]);

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

  const checkForUpdates = useCallback(async () => {
    setError(null);
    setUpdaterRunning(true);
    try {
      const next = await window.desktop.updater.check();
      setUpdaterStatus(next);
    } catch (e) {
      const message = toErrorMessage(e);
      setError(message);
      pushUiToast("error", message);
    } finally {
      setUpdaterRunning(false);
    }
  }, [pushUiToast]);

  const downloadAppUpdate = useCallback(async () => {
    setError(null);
    setUpdaterRunning(true);
    try {
      const next = await window.desktop.updater.download();
      setUpdaterStatus(next);
    } catch (e) {
      const message = toErrorMessage(e);
      setError(message);
      pushUiToast("error", message);
    } finally {
      setUpdaterRunning(false);
    }
  }, [pushUiToast]);

  const installUpdate = useCallback(async () => {
    setError(null);
    setUpdaterRunning(true);
    try {
      await window.desktop.updater.quitAndInstall();
    } catch (e) {
      const message = toErrorMessage(e);
      setError(message);
      pushUiToast("error", message);
    } finally {
      setUpdaterRunning(false);
    }
  }, [pushUiToast]);

  const runImport = useCallback(async () => {
    setImportProxyInlineError(null);
    setImportUaInlineError(null);

    const proxyError = validateProxyDraft(importProxyMode, importProxyRules);
    if (proxyError) {
      setImportProxyInlineError(proxyError);
      return;
    }

    let importUa: ImportRefreshTokensOptions["ua"] | undefined;
    if (importUaMode === "auto") {
      importUa = undefined;
    } else if (importUaMode === "default") {
      importUa = { mode: "default" };
    } else {
      const trimmed = importUaValue.trim();
      if (!trimmed) {
        setImportUaInlineError(t("uaErrorRequired"));
        return;
      }
      if (trimmed.length > 512) {
        setImportUaInlineError(t("uaErrorTooLong"));
        return;
      }
      if (/[\r\n]/.test(trimmed)) {
        setImportUaInlineError(t("uaErrorSingleLine"));
        return;
      }
      if (importUaMode === "preset" && !findUserAgentPreset(trimmed)) {
        setImportUaInlineError(t("uaErrorPresetUnknown"));
        return;
      }
      importUa = { mode: importUaMode, value: trimmed };
    }

    setError(null);
    setBusy(true);
    try {
      const proxy =
        importProxyMode === "custom"
          ? { mode: "custom" as const, rules: importProxyRules }
          : { mode: importProxyMode };
      const options: ImportRefreshTokensOptions = {
        net: { proxy },
        ...(importUa ? { ua: importUa } : {}),
      };

      const result = await window.desktop.accounts.importRefreshTokens(importText, options);
      setImportResult(result);
      setImportText("");
      await refreshAccounts();
      const summary = format(t("importResultChip"), { ok: result.imported, fail: result.failed });
      pushUiToast(result.failed > 0 ? "error" : "success", summary);
    } catch (e) {
      const message = toErrorMessage(e);
      setError(message);
      pushUiToast("error", message);
    } finally {
      setBusy(false);
    }
  }, [
    importProxyMode,
    importProxyRules,
    importText,
    importUaMode,
    importUaValue,
    pushUiToast,
    refreshAccounts,
    t,
  ]);

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

  const openDeleteDialog = useCallback(() => {
    if (!focusedAccount) return;
    setDeleteDialog({
      open: true,
      accountId: focusedAccount.id,
      displayName: focusedAccount.displayName,
    });
  }, [focusedAccount]);

  const runDeleteAccount = useCallback(async () => {
    if (!deleteDialog.open) return;
    setError(null);
    setBusy(true);
    try {
      const accountId = deleteDialog.accountId;
      await window.desktop.accounts.delete(accountId);

      const nextOpenTabIds = openTabIds.filter((id) => id !== accountId);
      setOpenTabIds(nextOpenTabIds);

      const nextActiveTabId =
        activeTabId && activeTabId !== accountId ? activeTabId : nextOpenTabIds[0] ?? null;

      if (nextActiveTabId) {
        await window.desktop.workspace.setActiveTab(nextActiveTabId);
      }
      setActiveTabId(nextActiveTabId);

      setAccounts((prev) => prev.filter((a) => a.id !== accountId));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(accountId);
        return next;
      });
      setAccountInfoById((prev) => {
        if (!Object.prototype.hasOwnProperty.call(prev, accountId)) return prev;
        const next = { ...prev };
        delete next[accountId];
        return next;
      });
      setFocusedAccountId((prev) => {
        if (prev !== accountId) return prev;
        setInspectorOpen(false);
        return null;
      });

      setDeleteDialog({ open: false });
      pushUiToast("success", t("toastAccountDeleted"));
    } catch (e) {
      const message = toErrorMessage(e);
      setError(message);
      pushUiToast("error", message);
    } finally {
      setBusy(false);
    }
  }, [activeTabId, deleteDialog, openTabIds, pushUiToast, t]);

  const saveProxy = useCallback(async () => {
    if (!focusedAccountId) return;
    setProxyInlineError(null);
    const proxyError = validateProxyDraft(proxyMode, proxyRules);
    if (proxyError) {
      setProxyInlineError(proxyError);
      return;
    }
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
      pushUiToast("success", t("toastProxySaved"));
    } catch (e) {
      const message = toErrorMessage(e);
      setError(message);
      pushUiToast("error", message);
    } finally {
      setBusy(false);
    }
  }, [focusedAccountId, proxyMode, proxyRules, pushUiToast, refreshAccounts, t]);

  const saveTags = useCallback(async () => {
    if (!focusedAccountId) return;
    setError(null);
    setBusy(true);
    try {
      const tags = parseTagsInput(tagsDraft);
      await window.desktop.accounts.updateAccountMeta(focusedAccountId, { tags });
      await refreshAccounts();
      pushUiToast("success", t("toastTagsSaved"));
    } catch (e) {
      const message = toErrorMessage(e);
      setError(message);
      pushUiToast("error", message);
    } finally {
      setBusy(false);
    }
  }, [focusedAccountId, pushUiToast, refreshAccounts, t, tagsDraft]);

  const saveUserAgent = useCallback(async () => {
    if (!focusedAccountId) return;
    setUaInlineError(null);
    const trimmed = uaValue.trim();
    if (uaMode !== "default") {
      if (!trimmed) {
        setUaInlineError(t("uaErrorRequired"));
        return;
      }
      if (trimmed.length > 512) {
        setUaInlineError(t("uaErrorTooLong"));
        return;
      }
      if (/[\r\n]/.test(trimmed)) {
        setUaInlineError(t("uaErrorSingleLine"));
        return;
      }
      if (uaMode === "preset" && !findUserAgentPreset(trimmed)) {
        setUaInlineError(t("uaErrorPresetUnknown"));
        return;
      }
    }

    setError(null);
    setBusy(true);
    try {
      const ua =
        uaMode === "default"
          ? { mode: "default" as const }
          : { mode: uaMode, value: trimmed };
      await window.desktop.accounts.updateAccountMeta(focusedAccountId, { ua });
      await refreshAccounts();
      pushUiToast("success", t("toastUaSaved"));
    } catch (e) {
      const message = toErrorMessage(e);
      setUaInlineError(message);
      pushUiToast("error", message);
    } finally {
      setBusy(false);
    }
  }, [focusedAccountId, pushUiToast, refreshAccounts, t, uaMode, uaValue]);

  const refreshCreditsForAccount = useCallback(async (accountId: string, opts?: { announce?: boolean }) => {
    setAccountInfoById((prev) => {
      const current = prev[accountId] ?? DEFAULT_ACCOUNT_INFO;
      return {
        ...prev,
        [accountId]: { ...current, status: "loading", error: null },
      };
    });

    try {
      const info = await window.desktop.accounts.refreshCredits(accountId);
      const remaining = Math.round(info.remainingCredits);
      const total = Math.round(info.totalCredits);

      setAccountInfoById((prev) => {
        const current = prev[accountId] ?? DEFAULT_ACCOUNT_INFO;
        return {
          ...prev,
          [accountId]: {
            ...current,
            status: "ready",
            subscription: info.subscriptionType,
            subscriptionExpiresAt: info.subscriptionExpiresAt,
            credits: `${remaining}/${total}`,
            updatedAt: info.fetchedAt,
            error: null,
          },
        };
      });
      if (opts?.announce) {
        pushUiToast("success", t("toastCreditsRefreshed"));
      }
      return true;
    } catch (e) {
      const message = toErrorMessage(e);
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
      if (opts?.announce) {
        pushUiToast("error", message);
      }
      return false;
    }
  }, [pushUiToast, t]);

  const syncCreditsFromOpenTabForAccount = useCallback(async (accountId: string) => {
    try {
      const info = await window.desktop.accounts.syncCreditsFromOpenTab(accountId);
      if (!info) return false;

      const remaining = Math.round(info.remainingCredits);
      const total = Math.round(info.totalCredits);

      setAccountInfoById((prev) => {
        const current = prev[accountId] ?? DEFAULT_ACCOUNT_INFO;
        if (current.status === "loading") return prev;
        return {
          ...prev,
          [accountId]: {
            ...current,
            status: "ready",
            subscription: info.subscriptionType,
            subscriptionExpiresAt: info.subscriptionExpiresAt,
            credits: `${remaining}/${total}`,
            updatedAt: info.fetchedAt,
            error: null,
          },
        };
      });

      return true;
    } catch {
      return false;
    }
  }, []);

  const refreshAccountInfo = useCallback(() => {
    if (!focusedAccountId) return;
    void refreshCreditsForAccount(focusedAccountId, { announce: true });
  }, [focusedAccountId, refreshCreditsForAccount]);

  useEffect(() => {
    if (!activeTabId) return;

    const sync = () => {
      void syncCreditsFromOpenTabForAccount(activeTabId);
    };

    const first = window.setTimeout(sync, 1500);
    const interval = window.setInterval(sync, 30_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, [activeTabId, syncCreditsFromOpenTabForAccount]);

  useEffect(() => {
    if (!focusedAccountId || !inspectorOpen) return;
    const info = accountInfoById[focusedAccountId];
    if (info && info.status !== "idle") return;
    void refreshCreditsForAccount(focusedAccountId);
  }, [accountInfoById, focusedAccountId, inspectorOpen, refreshCreditsForAccount]);

  const runConnectivity = useCallback(async () => {
    if (!focusedAccountId) return;
    setProxyInlineError(null);
    const proxyError = validateProxyDraft(proxyMode, proxyRules);
    if (proxyError) {
      setProxyInlineError(proxyError);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const proxy =
        proxyMode === "custom"
          ? { mode: "custom" as const, rules: proxyRules }
          : { mode: proxyMode };
      const savedProxy = focusedAccount?.net.proxy ?? { mode: "system" as const };
      const savedRules = savedProxy.mode === "custom" ? (savedProxy.rules ?? "") : "";
      const draftRules = proxy.mode === "custom" ? (proxy.rules ?? "") : "";
      const shouldPersistDraft = savedProxy.mode !== proxy.mode || savedRules !== draftRules;
      if (shouldPersistDraft) {
        const updated = await window.desktop.accounts.updateAccountMeta(focusedAccountId, {
          net: {
            proxy,
          },
        });
        setAccounts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      }
      const report = await window.desktop.accounts.testConnectivity(focusedAccountId);
      setConnectivity(report);
      setConnectivityPopoverOpen(true);
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [focusedAccount, focusedAccountId, proxyMode, proxyRules]);

  const openTab = useCallback(
    async (accountId: string) => {
      setError(null);
      setBusy(true);
      try {
        await pushViewportBounds();
        await window.desktop.workspace.openTab(accountId);
        setOpenTabIds((prev) => (prev.includes(accountId) ? prev : [...prev, accountId]));
        setActiveTabId(accountId);
        pushUiToast("success", t("toastTabOpened"));
      } catch (e) {
        const message = toErrorMessage(e);
        setError(message);
        pushUiToast("error", message);
      } finally {
        setBusy(false);
      }
    },
    [pushUiToast, pushViewportBounds, t]
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
        pushUiToast("info", t("toastTabClosed"));
      } catch (e) {
        const message = toErrorMessage(e);
        setError(message);
        pushUiToast("error", message);
      } finally {
        setBusy(false);
      }
    },
    [openTabIds, pushUiToast, t]
  );

  const activateTab = useCallback(async (accountId: string) => {
    setError(null);
    setBusy(true);
    try {
      await window.desktop.workspace.setActiveTab(accountId);
      setActiveTabId(accountId);
    } catch (e) {
      const message = toErrorMessage(e);
      setError(message);
      pushUiToast("error", message);
    } finally {
      setBusy(false);
    }
  }, [pushUiToast]);

  const reloadWorkspace = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      await window.desktop.workspace.reloadActive();
      pushUiToast("info", t("toastTabReloaded"));
    } catch (e) {
      const message = toErrorMessage(e);
      setError(message);
      pushUiToast("error", message);
    } finally {
      setBusy(false);
    }
  }, [pushUiToast, t]);

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

  const runBatchRefreshCredits = useCallback(async () => {
    if (selected.length === 0) return;
    setError(null);
    setBatchRefreshRunning(true);
    try {
      let ok = 0;
      let fail = 0;
      for (const accountId of selected) {
        const current = accountInfoById[accountId] ?? DEFAULT_ACCOUNT_INFO;
        if (current.status === "loading") continue;
        const success = await refreshCreditsForAccount(accountId);
        if (success) ok++;
        else fail++;
      }
      pushUiToast(
        fail > 0 ? "error" : "success",
        format(t("toastBatchRefreshResult"), {
          ok,
          fail,
        })
      );
    } catch (e) {
      const message = toErrorMessage(e);
      setError(message);
      pushUiToast("error", message);
    } finally {
      setBatchRefreshRunning(false);
    }
  }, [accountInfoById, pushUiToast, refreshCreditsForAccount, selected, t]);

  const openBatchTagsDialog = useCallback(() => {
    if (selected.length === 0) return;
    setBatchTagsDraft("");
    setBatchTagsDialog({ open: true, accountIds: selected });
  }, [selected]);

  const runBatchTags = useCallback(async () => {
    if (!batchTagsDialog.open) return;
    setError(null);
    setBusy(true);
    try {
      const tags = parseTagsInput(batchTagsDraft);
      let ok = 0;
      let fail = 0;
      for (const accountId of batchTagsDialog.accountIds) {
        try {
          await window.desktop.accounts.updateAccountMeta(accountId, { tags });
          ok++;
        } catch {
          fail++;
        }
      }
      await refreshAccounts();
      setSelectedIds(new Set());
      setBatchTagsDialog({ open: false });
      pushUiToast(
        fail > 0 ? "error" : "success",
        format(t("toastBatchTagsResult"), {
          ok,
          fail,
        })
      );
    } catch (e) {
      const message = toErrorMessage(e);
      setError(message);
      pushUiToast("error", message);
    } finally {
      setBusy(false);
    }
  }, [batchTagsDialog, batchTagsDraft, pushUiToast, refreshAccounts, t]);

  const openBatchDeleteDialog = useCallback(() => {
    if (selected.length === 0) return;
    setBatchDeleteDialog({ open: true, accountIds: selected });
  }, [selected]);

  const runBatchDelete = useCallback(async () => {
    if (!batchDeleteDialog.open) return;
    setError(null);
    setBusy(true);
    try {
      let ok = 0;
      let fail = 0;
      for (const accountId of batchDeleteDialog.accountIds) {
        try {
          await window.desktop.accounts.delete(accountId);
          ok++;
        } catch {
          fail++;
        }
      }
      setBatchDeleteDialog({ open: false });
      setSelectedIds(new Set());
      await refreshAccounts();
      pushUiToast(
        fail > 0 ? "error" : "success",
        format(t("toastBatchDeleteResult"), {
          ok,
          fail,
        })
      );
    } catch (e) {
      const message = toErrorMessage(e);
      setError(message);
      pushUiToast("error", message);
    } finally {
      setBusy(false);
    }
  }, [batchDeleteDialog, pushUiToast, refreshAccounts, t]);

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
    if (!importDialogOpen) return;
    setImportProxyInlineError(null);
    setImportUaInlineError(null);
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

  useEffect(() => {
    const dlg = deleteDialogRef.current;
    if (!dlg) return;
    try {
      if (deleteDialog.open) {
        if (!dlg.open) dlg.showModal();
      } else if (dlg.open) {
        dlg.close();
      }
    } catch {
      // ignore dialog show/close failures in non-standard runtimes
    }
  }, [deleteDialog.open]);

  useEffect(() => {
    const dlg = batchTagsDialogRef.current;
    if (!dlg) return;
    try {
      if (batchTagsDialog.open) {
        if (!dlg.open) dlg.showModal();
      } else if (dlg.open) {
        dlg.close();
      }
    } catch {
      // ignore dialog show/close failures in non-standard runtimes
    }
  }, [batchTagsDialog.open]);

  useEffect(() => {
    const dlg = batchDeleteDialogRef.current;
    if (!dlg) return;
    try {
      if (batchDeleteDialog.open) {
        if (!dlg.open) dlg.showModal();
      } else if (dlg.open) {
        dlg.close();
      }
    } catch {
      // ignore dialog show/close failures in non-standard runtimes
    }
  }, [batchDeleteDialog.open]);

  const downloadInProgressCount = downloadToasts.reduce(
    (acc, d) => acc + (d.state === "progressing" ? 1 : 0),
    0
  );
  const latestDownloadToast = downloadToasts[0] ?? null;
  const downloadIndicatorBadgeText =
    downloadToasts.length === 0
      ? null
      : downloadInProgressCount > 0
        ? downloadInProgressCount > 99
          ? "99+"
          : String(downloadInProgressCount)
        : latestDownloadToast?.state === "completed"
          ? "✓"
          : latestDownloadToast
            ? "!"
            : null;
  const downloadIndicatorTitle =
    downloadToasts.length === 0
      ? t("downloadsSectionTitle")
      : downloadInProgressCount > 0
        ? `${t("downloadStateProgress")} · ${downloadIndicatorBadgeText}`
        : latestDownloadToast
          ? `${t("downloadsSectionTitle")} · ${formatDownloadStateLabel(latestDownloadToast.state, t)}`
          : t("downloadsSectionTitle");

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
          <div className="topbar-actions">
            <input
              className="input topbar-search"
              type="text"
              placeholder={t("searchPlaceholder")}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              disabled={busy}
            />
            <button
              className="btn"
              onClick={() => {
                setImportResult(null);
                setImportText("");
                setImportDialogOpen(true);
              }}
              disabled={busy}
            >
              {t("import")}
            </button>
            <button className="btn" onClick={runExport} disabled={busy || selected.length === 0}>
              {t("export")}
            </button>
            <button className="btn" onClick={refreshAccounts} disabled={busy}>
              {t("refresh")}
            </button>
          </div>
          {downloadToasts.length > 0 ? (
            <div className="topbar-downloads" style={{ position: "relative" }} ref={downloadsPopoverContainerRef}>
              <button
                className="btn btn-ghost btn-icon download-indicator"
                title={downloadIndicatorTitle}
                aria-label={t("downloadsSectionTitle")}
                onClick={() => setDownloadsPopoverOpen((prev) => !prev)}
                disabled={busy}
              >
                ⬇
                {downloadIndicatorBadgeText ? (
                  <span
                    className={clsx(
                      "download-indicator-badge",
                      downloadInProgressCount === 0 &&
                        latestDownloadToast?.state === "completed" &&
                        "download-indicator-badge-ok",
                      downloadInProgressCount === 0 &&
                        latestDownloadToast &&
                        latestDownloadToast.state !== "completed" &&
                        "download-indicator-badge-bad"
                    )}
                  >
                    {downloadIndicatorBadgeText}
                  </span>
                ) : null}
              </button>
              {downloadsPopoverOpen ? (
                <div className="popover popover-end" ref={downloadsPopoverRef}>
                  <div className="popover-title">{t("downloadsSectionTitle")}</div>
                  <div className="downloads-popover-list">
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
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="topbar-settings" style={{ position: "relative" }} ref={settingsContainerRef}>
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
                      onPointerDown={openSelectOverlay}
                      onBlur={closeSelectOverlay}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") openSelectOverlay();
                      }}
                      onChange={(e) => {
                        closeSelectOverlay();
                        updateUiPrefs({ locale: e.target.value as Locale });
                      }}
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
                      onPointerDown={openSelectOverlay}
                      onBlur={closeSelectOverlay}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") openSelectOverlay();
                      }}
                      onChange={(e) => {
                        closeSelectOverlay();
                        updateUiPrefs({ theme: e.target.value as Theme });
                      }}
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
                      onPointerDown={openSelectOverlay}
                      onBlur={closeSelectOverlay}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") openSelectOverlay();
                      }}
                      onChange={(e) => {
                        closeSelectOverlay();
                        setDownloadMode(e.target.value as DownloadSaveMode);
                      }}
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

	                <div className="popover-title" style={{ marginTop: 10 }}>
	                  {t("updatesSectionTitle")}
	                </div>
	                <div className="setting-grid">
	                  <div className="setting-row">
	                    <div className="muted">{t("updateCurrentVersion")}</div>
	                    <div className="mono" style={{ fontSize: 12 }}>
	                      {updaterStatus?.currentVersion ?? "-"}
	                    </div>
	                  </div>

	                  <div className="setting-row">
	                    <div className="muted">{t("updateStateLabel")}</div>
	                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
	                      <span>
	                        {updaterStatus ? formatUpdaterStateLabel(updaterStatus.state, t) : "-"}
	                      </span>
	                      {updaterStatus?.availableVersion ? (
	                        <span className="chip" title={updaterStatus.availableVersion}>
	                          {updaterStatus.availableVersion}
	                        </span>
	                      ) : null}
	                    </div>
	                  </div>

	                  <div className="setting-row">
	                    <div className="muted">{t("updateActionsLabel")}</div>
	                    {updaterStatus ? (
	                      updaterStatus.supported ? (
	                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
	                          <button className="btn" onClick={checkForUpdates} disabled={busy || updaterRunning}>
	                            {t("updateCheck")}
	                          </button>
	                          {updaterStatus.state === "available" ? (
	                            <button className="btn" onClick={downloadAppUpdate} disabled={busy || updaterRunning}>
	                              {t("updateDownload")}
	                            </button>
	                          ) : null}
	                          {updaterStatus.state === "downloaded" ? (
	                            <button
	                              className="btn btn-primary"
	                              onClick={installUpdate}
	                              disabled={busy || updaterRunning}
	                            >
	                              {t("updateInstall")}
	                            </button>
	                          ) : null}
	                        </div>
	                      ) : (
	                        <div className="muted" style={{ fontSize: 11, lineHeight: 1.45 }}>
	                          {t("updateUnsupportedHint")}
	                        </div>
	                      )
	                    ) : (
	                      <div className="muted" style={{ fontSize: 11, lineHeight: 1.45 }}>
	                        -
	                      </div>
	                    )}
	                  </div>

	                  {updaterStatus?.progress ? (
	                    <div className="setting-row">
	                      <div className="muted">{t("updateProgressLabel")}</div>
	                      <div style={{ display: "grid", gap: 6 }}>
	                        <div className="muted" style={{ fontSize: 11 }}>
	                          {Math.round(updaterStatus.progress.percent)}% · {formatBytes(updaterStatus.progress.transferred)} /{" "}
	                          {formatBytes(updaterStatus.progress.total)}
	                        </div>
	                        <div className="download-progress">
	                          <div
	                            className="download-progress-bar"
	                            style={{ width: `${Math.round(updaterStatus.progress.percent)}%` }}
	                          />
	                        </div>
	                      </div>
	                    </div>
	                  ) : null}

	                  {updaterStatus?.error ? <div className="inline-error">{updaterStatus.error}</div> : null}
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
          <div className="error-banner-content">
            <div className="error-banner-title">{t("errorTitle")}</div>
            <div className="error-banner-body">{error}</div>
          </div>
          <button
            type="button"
            className="error-banner-close"
            title={t("close")}
            aria-label={t("close")}
            onClick={() => setError(null)}
          >
            ×
          </button>
        </div>
      ) : null}

      {uiToasts.length > 0 ? (
        <div className="ui-toasts" aria-label="Notifications">
          {uiToasts.map((toast) => (
            <div
              key={toast.id}
              className={clsx(
                "ui-toast",
                toast.kind === "success" && "ui-toast-success",
                toast.kind === "error" && "ui-toast-error"
              )}
              role={toast.kind === "error" ? "alert" : "status"}
              title={toast.message}
            >
              <span
                className={clsx(
                  "ui-toast-dot",
                  toast.kind === "success" && "ui-toast-dot-ok",
                  toast.kind === "error" && "ui-toast-dot-bad",
                  toast.kind === "info" && "ui-toast-dot-info"
                )}
              />
              <div className="ui-toast-message">{toast.message}</div>
              <button
                type="button"
                className="ui-toast-close"
                title={t("close")}
                aria-label={t("close")}
                onClick={() => dismissUiToast(toast.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {connectivityPopoverOpen && connectivity
        ? createPortal(
            <div
              className="popover"
              ref={connectivityPopoverRef}
              style={
                connectivityPopoverStyle ?? {
                  position: "fixed",
                  top: -9999,
                  left: -9999,
                  zIndex: 80,
                  visibility: "hidden",
                }
              }
            >
              <div className="popover-title">{t("connectivityTitle")}</div>
              <div style={{ display: "grid", gap: 8 }}>
                {connectivity.map((c) => (
                  <div key={c.name} className="popover-row">
                    <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className={clsx("dot", c.ok ? "dot-ok" : "dot-bad")} />
                        <span style={{ fontWeight: 650 }}>{c.name}</span>
                      </div>
                      <div className="muted" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis" }}>
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
            </div>,
            document.body
          )
        : null}

      <div
        className={clsx(
          "layout",
          sidebarCollapsed && "sidebar-collapsed",
          !inspectorOpen && "inspector-hidden"
        )}
      >
        {sidebarCollapsed ? (
          <button
            type="button"
            className="sidebar-expand-float-btn"
            title={t("expandSidebar")}
            aria-label={t("expandSidebar")}
            onClick={() => updateUiPrefs({ sidebarCollapsed: false })}
            disabled={busy}
          >
            »
          </button>
        ) : null}

        <aside className={clsx("sidebar", sidebarCollapsed && "collapsed")} id="sidebar">
          <div className="sidebar-header">
            <div className="sidebar-title">{t("sidebarTitle")}</div>
            <div className="sidebar-header-right">
              {!sidebarCollapsed ? (
                <>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    title={t("collapseSidebar")}
                    aria-label={t("collapseSidebar")}
                    onClick={() => updateUiPrefs({ sidebarCollapsed: true })}
                    disabled={busy}
                  >
                    «
                  </button>
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
	                const info = accountInfoById[a.id] ?? DEFAULT_ACCOUNT_INFO;
	                const subscription = info.subscription ?? "-";
	                const expiresAt = info.subscriptionExpiresAt ? formatDate(info.subscriptionExpiresAt, uiPrefs.locale) : "-";
	                const credits = info.credits ?? "-";
	                const updatedAt = info.updatedAt ? formatUpdatedAt(info.updatedAt, uiPrefs.locale) : null;
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
	                      <span className="chip" title={`${t("subscriptionLabel")}: ${subscription}`}>
	                        {subscription}
	                      </span>
	                      {info.subscription ? (
	                        <span className="chip" title={`${t("subscriptionExpiresAtLabel")}: ${expiresAt}`}>
	                          {format(t("subscriptionExpiresAtChip"), { date: expiresAt })}
	                        </span>
	                      ) : null}
	                      <span className="chip mono" title={`${t("creditsLabel")}: ${credits}`}>
	                        {credits}
	                      </span>
		                      {updatedAt ? (
		                        <span className="muted" style={{ fontSize: 11 }} title={`${t("updatedAtLabel")}: ${updatedAt}`}>
		                          {updatedAt}
		                        </span>
		                      ) : null}
		                      <button
		                        className="btn btn-ghost btn-icon"
		                        title={t("openTab")}
		                        onClick={(e) => {
		                          e.stopPropagation();
		                          void openTab(a.id);
		                        }}
		                        disabled={busy}
		                      >
		                        ↗
		                      </button>
		                      <button
		                        className="btn btn-ghost btn-icon"
		                        title={t("refreshCredits")}
	                        onClick={(e) => {
	                          e.stopPropagation();
	                          void refreshCreditsForAccount(a.id);
	                        }}
	                        disabled={busy || info.status === "loading"}
	                      >
	                        ⟳
	                      </button>
	                      {info.status === "loading" ? (
	                        <span className="muted" style={{ fontSize: 11 }}>
	                          …
	                        </span>
	                      ) : null}
	                      {focused ? <span className="chip">{t("focusedChip")}</span> : null}
	                    </div>
	
	                    {info.error ? (
	                      <div
	                        className="muted"
	                        style={{
	                          marginTop: 6,
	                          fontSize: 11,
	                          color: "rgba(248, 113, 113, 1)",
	                          whiteSpace: "pre-wrap",
	                        }}
	                      >
	                        {info.error}
	                      </div>
	                    ) : null}
	
		                    {a.tags.length ? (
		                      <div className="account-tags">
		                        {a.tags.map((t) => (
	                          <button
	                            key={t}
	                            type="button"
	                            className="tag-chip"
	                            onClick={(e) => {
	                              e.stopPropagation();
	                              setSearchText(t);
	                            }}
	                            disabled={busy}
	                          >
	                            {t}
	                          </button>
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
	                            <button
	                              key={t}
	                              type="button"
	                              className="tag-chip"
	                              onClick={(e) => {
	                                e.stopPropagation();
	                                setSearchText(t);
	                              }}
	                              disabled={busy}
	                            >
	                              {t}
	                            </button>
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
		                <button className="btn btn-primary" onClick={batchOpenTabs} disabled={busy || batchRefreshRunning}>
		                  {t("openTab")}
		                </button>
		                <button className="btn" onClick={batchCloseTabs} disabled={busy || batchRefreshRunning}>
		                  {t("closeTab")}
		                </button>
                    <button
                      className="btn"
                      onClick={runBatchRefreshCredits}
                      disabled={busy || batchRefreshRunning}
                    >
                      {t("batchRefresh")}
                    </button>
		                <button className="btn" onClick={openBatchTagsDialog} disabled={busy || batchRefreshRunning}>
		                  {t("batchTags")}
		                </button>
		                <button className="btn" onClick={runExport} disabled={busy || batchRefreshRunning}>
		                  {t("export")}
		                </button>
		                <button
                      className="btn btn-danger"
                      onClick={openBatchDeleteDialog}
                      disabled={busy || batchRefreshRunning}
                    >
		                  {t("batchDelete")}
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
              {activeTabSnapshot ? (
                <img
                  className={clsx("workspace-snapshot", overlayActive && "is-visible")}
                  alt=""
                  src={activeTabSnapshot}
                />
              ) : null}

              {openTabIds.length === 0 ? (
                <div className="workspace-viewport-placeholder">
                  <div className="content-title">{t("workspaceTitle")}</div>
                  <div className="content-subtitle">{t("workspaceSubtitle")}</div>
                  <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {focusedAccountId ? (
                      <>
                        <button className="btn btn-primary" onClick={() => openTab(focusedAccountId)} disabled={busy}>
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
              ) : null}
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
                    <div className="field-value" style={{ display: "grid", gap: 6 }}>
                      <input
                        className="input"
                        type="text"
                        value={tagsDraft}
                        onChange={(e) => setTagsDraft(e.target.value)}
                        placeholder={t("tagsPlaceholder")}
                        disabled={busy}
                      />
                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <button className="btn" onClick={saveTags} disabled={busy || !focusedAccountId}>
                          {t("saveTags")}
                        </button>
                      </div>
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
                    <div className="field-label">{t("subscriptionExpiresAtLabel")}</div>
                    <div className="field-value">
                      {focusedAccountInfo.subscriptionExpiresAt ? (
                        <span className="mono">
                          {formatDate(focusedAccountInfo.subscriptionExpiresAt, uiPrefs.locale)}
                        </span>
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
                        onPointerDown={openSelectOverlay}
                        onBlur={closeSelectOverlay}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") openSelectOverlay();
                        }}
                        onChange={(e) => {
                          closeSelectOverlay();
                          setProxyInlineError(null);
                          setProxyMode(e.target.value as ProxyMode);
                        }}
                        disabled={busy}
                        aria-label={t("proxyMode")}
                      >
                        <option value="system">{t("proxySystem")}</option>
                        <option value="custom">{t("proxyCustom")}</option>
                        <option value="direct">{t("proxyDirect")}</option>
                      </select>
                    </div>

	                    {proxyMode === "custom" ? (
	                      <>
	                        {proxyPresets.length > 0 ? (
	                          <div className="setting-row">
	                            <div className="muted">{t("proxyPresetLabel")}</div>
	                            <select
	                              value={proxyPresetValue}
	                              onPointerDown={openSelectOverlay}
	                              onBlur={closeSelectOverlay}
	                              onKeyDown={(e) => {
	                                if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") openSelectOverlay();
	                              }}
	                              onChange={(e) => {
	                                closeSelectOverlay();
	                                setProxyInlineError(null);
	                                const next = e.target.value;
	                                if (next) setProxyRules(next);
	                              }}
	                              disabled={busy}
	                              aria-label={t("proxyPresetLabel")}
	                            >
	                              <option value="">{t("proxyPresetManual")}</option>
	                              {proxyPresets.map((preset) => (
	                                <option key={preset} value={preset}>
	                                  {preset}
	                                </option>
	                              ))}
	                            </select>
	                          </div>
	                        ) : null}
	                        <div className="setting-row">
	                          <div className="muted">{t("proxyRulesLabel")}</div>
	                          <input
	                            className="input mono"
	                            type="text"
	                            placeholder={t("proxyPlaceholder")}
	                            value={proxyRules}
	                            onChange={(e) => {
	                              setProxyInlineError(null);
	                              setProxyRules(e.target.value);
	                            }}
	                            disabled={busy}
	                          />
	                          {proxyInlineError ? <div className="inline-error">{proxyInlineError}</div> : null}
	                        </div>
	                      </>
	                    ) : null}
	                  </div>

                  <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <button className="btn" onClick={saveProxy} disabled={busy || !focusedAccountId}>
                      {t("saveProxy")}
                    </button>
                    <div ref={connectivityPopoverAnchorRef}>
                      <button className="btn" onClick={runConnectivity} disabled={busy || !focusedAccountId}>
                        {t("connectivity")}
                      </button>
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
                        onPointerDown={openSelectOverlay}
                        onBlur={closeSelectOverlay}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") openSelectOverlay();
                        }}
                        onChange={(e) => {
                          closeSelectOverlay();
                          setUaInlineError(null);
                          const nextMode = e.target.value as UaMode;
                          if (nextMode === "preset") {
                            const current = uaValue.trim();
                            const preset = current ? findUserAgentPreset(current) : null;
                            setUaValue(preset?.id ?? USER_AGENT_PRESETS[0]?.id ?? "");
                          } else if (nextMode === "default") {
                            setUaValue("");
                          } else if (uaMode === "preset") {
                            const preset = findUserAgentPreset(uaValue);
                            if (preset) setUaValue(preset.value);
                          }
                          setUaMode(nextMode);
                        }}
                        disabled={busy}
                        aria-label="User-Agent mode"
                      >
                        <option value="default">{t("uaDefault")}</option>
                        <option value="preset">{t("uaPreset")}</option>
                        <option value="custom">{t("uaCustom")}</option>
                      </select>
                    </div>

                    {uaMode === "default" ? null : uaMode === "preset" ? (
                      <>
                        <div className="setting-row">
                          <div className="muted">{t("uaPreset")}</div>
                          <select
                            value={uaValue}
                            onPointerDown={openSelectOverlay}
                            onBlur={closeSelectOverlay}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") openSelectOverlay();
                            }}
                            onChange={(e) => {
                              closeSelectOverlay();
                              setUaInlineError(null);
                              setUaValue(e.target.value);
                            }}
                            disabled={busy}
                            aria-label={t("uaPreset")}
                          >
                            {USER_AGENT_PRESETS.map((preset) => (
                              <option key={preset.id} value={preset.id}>
                                {preset.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        {findUserAgentPreset(uaValue)?.value ? (
                          <div
                            className="muted mono"
                            style={{ fontSize: 11, whiteSpace: "pre-wrap" }}
                            title={findUserAgentPreset(uaValue)?.value ?? undefined}
                          >
                            {findUserAgentPreset(uaValue)?.value}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <div className="setting-row">
                        <div className="muted">{t("uaValueLabel")}</div>
                        <input
                          className="input mono"
                          value={uaValue}
                          onChange={(e) => {
                            setUaInlineError(null);
                            setUaValue(e.target.value);
                          }}
                          placeholder="Mozilla/5.0 ..."
                          disabled={busy}
                        />
                      </div>
                    )}
                  </div>

                  {uaInlineError ? (
                    <div
                      className="muted"
                      style={{ marginTop: 8, fontSize: 11, color: "rgba(248, 113, 113, 1)", whiteSpace: "pre-wrap" }}
                    >
                      {uaInlineError}
                    </div>
                  ) : null}
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
              <button className="btn btn-danger" onClick={openDeleteDialog} disabled={busy || !focusedAccountId}>
                {t("deleteAccount")}
              </button>
            </div>
          </aside>
        ) : null}
	      </div>

	      <dialog
	        ref={importDialogRef}
	        onCancel={(e) => {
          e.preventDefault();
          setImportDialogOpen(false);
          setImportText("");
        }}
        onClose={() => {
          setImportDialogOpen(false);
          setImportText("");
        }}
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
              onClick={() => {
                setImportDialogOpen(false);
                setImportText("");
              }}
              disabled={busy}
            >
              ×
            </button>
          </div>

          <div className="modal-grid">
            <textarea
              className="secret-textarea"
              value={importText}
              onChange={(e) => {
                setImportText(e.target.value);
                if (importResult) setImportResult(null);
              }}
              placeholder={t("importPlaceholder")}
              disabled={busy}
            />
            <div className="muted" style={{ fontSize: 12 }}>
              {t("importHint")}
            </div>

            <div className="section-title">{t("importOptionsTitle")}</div>
            <div className="setting-grid">
              <div className="setting-row">
                <div className="muted">{t("proxyMode")}</div>
                <select
                  value={importProxyMode}
                  onPointerDown={openSelectOverlay}
                  onBlur={closeSelectOverlay}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") openSelectOverlay();
                  }}
                  onChange={(e) => {
                    closeSelectOverlay();
                    setImportProxyInlineError(null);
                    setImportProxyMode(e.target.value as ProxyMode);
                  }}
                  disabled={busy}
                  aria-label={t("proxyMode")}
                >
                  <option value="system">{t("proxySystem")}</option>
                  <option value="custom">{t("proxyCustom")}</option>
                  <option value="direct">{t("proxyDirect")}</option>
                </select>
              </div>

	              {importProxyMode === "custom" ? (
	                <>
	                  {proxyPresets.length > 0 ? (
	                    <div className="setting-row">
	                      <div className="muted">{t("proxyPresetLabel")}</div>
	                      <select
	                        value={importProxyPresetValue}
	                        onPointerDown={openSelectOverlay}
	                        onBlur={closeSelectOverlay}
	                        onKeyDown={(e) => {
	                          if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") openSelectOverlay();
	                        }}
	                        onChange={(e) => {
	                          closeSelectOverlay();
	                          setImportProxyInlineError(null);
	                          const next = e.target.value;
	                          if (next) setImportProxyRules(next);
	                        }}
	                        disabled={busy}
	                        aria-label={t("proxyPresetLabel")}
	                      >
	                        <option value="">{t("proxyPresetManual")}</option>
	                        {proxyPresets.map((preset) => (
	                          <option key={preset} value={preset}>
	                            {preset}
	                          </option>
	                        ))}
	                      </select>
	                    </div>
	                  ) : null}
	                  <div className="setting-row">
	                    <div className="muted">{t("proxyRulesLabel")}</div>
	                    <input
	                      className="input mono"
	                      type="text"
	                      placeholder={t("proxyPlaceholder")}
	                      value={importProxyRules}
	                      onChange={(e) => {
	                        setImportProxyInlineError(null);
	                        setImportProxyRules(e.target.value);
	                      }}
	                      disabled={busy}
	                    />
	                    {importProxyInlineError ? <div className="inline-error">{importProxyInlineError}</div> : null}
	                  </div>
	                </>
	              ) : null}

              <div className="setting-row">
                <div className="muted">{t("uaModeLabel")}</div>
                <select
                  value={importUaMode}
                  onPointerDown={openSelectOverlay}
                  onBlur={closeSelectOverlay}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") openSelectOverlay();
                  }}
                  onChange={(e) => {
                    closeSelectOverlay();
                    setImportUaInlineError(null);
                    const nextMode = e.target.value as ImportUaMode;
                    if (nextMode === "preset") {
                      const current = importUaValue.trim();
                      const preset = current ? findUserAgentPreset(current) : null;
                      setImportUaValue(preset?.id ?? USER_AGENT_PRESETS[0]?.id ?? "");
                    } else if (nextMode === "default" || nextMode === "auto") {
                      setImportUaValue("");
                    } else if (importUaMode === "preset") {
                      const preset = findUserAgentPreset(importUaValue);
                      if (preset) setImportUaValue(preset.value);
                    }
                    setImportUaMode(nextMode);
                  }}
                  disabled={busy}
                  aria-label="Import User-Agent mode"
                >
                  <option value="auto">{t("uaAuto")}</option>
                  <option value="default">{t("uaDefault")}</option>
                  <option value="preset">{t("uaPreset")}</option>
                  <option value="custom">{t("uaCustom")}</option>
                </select>
              </div>

              {importUaMode === "preset" ? (
                <div className="setting-row">
                  <div className="muted">{t("uaPreset")}</div>
                  <select
                    value={importUaValue}
                    onPointerDown={openSelectOverlay}
                    onBlur={closeSelectOverlay}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") openSelectOverlay();
                    }}
                    onChange={(e) => {
                      closeSelectOverlay();
                      setImportUaInlineError(null);
                      setImportUaValue(e.target.value);
                    }}
                    disabled={busy}
                    aria-label={t("uaPreset")}
                  >
                    {USER_AGENT_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                  {importUaInlineError ? <div className="inline-error">{importUaInlineError}</div> : null}
                </div>
              ) : importUaMode === "custom" ? (
                <div className="setting-row">
                  <div className="muted">{t("uaValueLabel")}</div>
                  <input
                    className="input"
                    type="text"
                    placeholder={"Mozilla/5.0 ..."}
                    value={importUaValue}
                    onChange={(e) => {
                      setImportUaInlineError(null);
                      setImportUaValue(e.target.value);
                    }}
                    disabled={busy}
                    aria-label={t("uaValueLabel")}
                  />
                  {importUaInlineError ? <div className="inline-error">{importUaInlineError}</div> : null}
                </div>
              ) : null}
            </div>

            {importResult ? (
              <div style={{ display: "grid", gap: 10 }}>
                <div className="chip" style={{ alignSelf: "flex-start" }}>
                  <span className={clsx("dot", importResult.failed > 0 ? "dot-bad" : "dot-ok")} />
                  {format(t("importResultChip"), {
                    ok: importResult.imported,
                    fail: importResult.failed,
                  })}
                </div>

                {importResult.warnings.length > 0 ? (
                  <div className="muted" style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>
                    {importResult.warnings.join("\n")}
                  </div>
                ) : null}

                {importResult.errors.length > 0 ? (
                  <div
                    className="danger-note mono"
                    style={{ whiteSpace: "pre-wrap", maxHeight: 240, overflow: "auto" }}
                  >
                    {importResult.errors.join("\n")}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="modal-actions">
            <button
              className="btn"
              onClick={() => {
                setImportDialogOpen(false);
                setImportText("");
              }}
              disabled={busy}
            >
              {importResult ? t("done") : t("cancel")}
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

      <dialog
        ref={deleteDialogRef}
        onCancel={(e) => {
          e.preventDefault();
          setDeleteDialog({ open: false });
        }}
        onClose={() => setDeleteDialog({ open: false })}
        aria-label={t("deleteAccountTitle")}
      >
        {deleteDialog.open ? (
          <div className="modal">
            <div className="modal-header">
              <div>
                <div className="modal-title">{t("deleteAccountTitle")}</div>
                <div className="modal-note">{t("deleteAccountNote")}</div>
              </div>
              <button
                className="btn btn-icon"
                title={t("close")}
                onClick={() => setDeleteDialog({ open: false })}
                disabled={busy}
              >
                ×
              </button>
            </div>

            <div className="danger-note">
              <div style={{ fontWeight: 750 }}>{deleteDialog.displayName}</div>
              <div className="mono" style={{ marginTop: 6 }}>
                {deleteDialog.accountId}
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn" onClick={() => setDeleteDialog({ open: false })} disabled={busy}>
                {t("cancel")}
              </button>
              <button className="btn btn-danger" onClick={runDeleteAccount} disabled={busy}>
                {t("confirmDelete")}
              </button>
            </div>
          </div>
        ) : null}
      </dialog>

      <dialog
        ref={batchTagsDialogRef}
        onCancel={(e) => {
          e.preventDefault();
          setBatchTagsDialog({ open: false });
          setBatchTagsDraft("");
        }}
        onClose={() => {
          setBatchTagsDialog({ open: false });
          setBatchTagsDraft("");
        }}
        aria-label={t("batchTagsTitle")}
      >
        {batchTagsDialog.open ? (
          <div className="modal">
            <div className="modal-header">
              <div>
                <div className="modal-title">{t("batchTagsTitle")}</div>
                <div className="modal-note">
                  {format(t("batchTagsNote"), { count: batchTagsDialog.accountIds.length })}
                </div>
              </div>
              <button
                className="btn btn-icon"
                title={t("close")}
                onClick={() => {
                  setBatchTagsDialog({ open: false });
                  setBatchTagsDraft("");
                }}
                disabled={busy}
              >
                ×
              </button>
            </div>

            <div className="modal-grid">
              <input
                className="input"
                type="text"
                value={batchTagsDraft}
                onChange={(e) => setBatchTagsDraft(e.target.value)}
                placeholder={t("tagsPlaceholder")}
                disabled={busy}
              />
            </div>

            <div className="modal-actions">
              <button
                className="btn"
                onClick={() => {
                  setBatchTagsDialog({ open: false });
                  setBatchTagsDraft("");
                }}
                disabled={busy}
              >
                {t("cancel")}
              </button>
              <button className="btn btn-primary" onClick={runBatchTags} disabled={busy}>
                {t("confirmApply")}
              </button>
            </div>
          </div>
        ) : null}
      </dialog>

      <dialog
        ref={batchDeleteDialogRef}
        onCancel={(e) => {
          e.preventDefault();
          setBatchDeleteDialog({ open: false });
        }}
        onClose={() => setBatchDeleteDialog({ open: false })}
        aria-label={t("batchDeleteTitle")}
      >
        {batchDeleteDialog.open ? (
          <div className="modal">
            <div className="modal-header">
              <div>
                <div className="modal-title">{t("batchDeleteTitle")}</div>
                <div className="modal-note">
                  {format(t("batchDeleteNote"), { count: batchDeleteDialog.accountIds.length })}
                </div>
              </div>
              <button
                className="btn btn-icon"
                title={t("close")}
                onClick={() => setBatchDeleteDialog({ open: false })}
                disabled={busy}
              >
                ×
              </button>
            </div>

            <div className="modal-actions">
              <button className="btn" onClick={() => setBatchDeleteDialog({ open: false })} disabled={busy}>
                {t("cancel")}
              </button>
              <button className="btn btn-danger" onClick={runBatchDelete} disabled={busy}>
                {t("confirmDelete")}
              </button>
            </div>
          </div>
        ) : null}
      </dialog>
    </div>
  );
}
