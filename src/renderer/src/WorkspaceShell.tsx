import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type {
  AccountAuthDiagnostics,
  AccountSummary,
  AccountsImportProgressEvent,
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
  | { open: true; tokenText: string; selectedCount: number; mode: "standard" | "migration" };

type DeleteDialogState =
  | { open: false }
  | { open: true; accountId: string; displayName: string };

type OpenLinkDialogState =
  | { open: false }
  | { open: true; accountId: string; url: string };

type BatchTagsDialogState =
  | { open: false }
  | { open: true; accountIds: string[] };

type BatchProxyDialogState =
  | { open: false }
  | { open: true; accountIds: string[] };

type BatchUserAgentDialogState =
  | { open: false }
  | { open: true; accountIds: string[] };

type BatchDeleteDialogState =
  | { open: false }
  | { open: true; accountIds: string[] };

type ImportProgressState = {
  total: number;
  done: number;
  imported: number;
  failed: number;
  creditsFailed: number;
  currentFingerprint: string | null;
};

type Theme = "dark" | "light" | "system";
type Locale = "zh-CN" | "en";
type AccountListViewMode = "cards" | "table";
type AccountSortMode = "default" | "displayName" | "lastUsed" | "subscriptionExpiresAt" | "creditsUpdatedAt";
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

type UiPreferencesV2 = {
  version: 2;
  theme: Theme;
  locale: Locale;
  sidebarCollapsed: boolean;
  accountListView: AccountListViewMode;
  accountSort: AccountSortMode;
};

function isSameStringArray(a: string[], b: string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

const DOWNLOAD_HISTORY_LIMIT = 1000;
const DOWNLOAD_POPOVER_LIMIT = 10;

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

const USER_AGENT_PRESETS_VISIBLE = USER_AGENT_PRESETS.filter((p) => p.id !== "safari_ios");
const USER_AGENT_PRESET_VISIBLE_IDS = new Set(USER_AGENT_PRESETS_VISIBLE.map((p) => p.id));

const FLOWITH_WEB_TARGET_HOSTS = ["flowith.io", "flowith.net", "flo.ing"] as const;

function normalizeFlowithUrl(raw: string): string | null {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return null;

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/+/, "")}`;

  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:") return null;
    const okHost = FLOWITH_WEB_TARGET_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
    if (!okHost) return null;
    return url.toString();
  } catch {
    return null;
  }
}

const UI_STRINGS = {
  "zh-CN": {
    subtitle: "桌面端 · 工作区",
    language: "语言",
	    theme: "主题",
	    themeDark: "深色",
	    themeLight: "浅色",
	    themeSystem: "跟随系统",
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
    downloadsViewAll: "查看全部",
    downloadsHistoryTitle: "下载历史",
    downloadsHistoryCount: "共 {count} 条记录",
    downloadShowInFolder: "打开文件夹",
    downloadOpenFile: "打开",
    downloadCancelDownload: "取消下载",
    downloadCopyPath: "复制路径",
    downloadCopied: "已复制",
	    downloadStateProgress: "下载中",
	    downloadStateCompleted: "已完成",
	    downloadStateCancelled: "已取消",
	    downloadStateInterrupted: "已中断",
	    downloadsEmpty: "暂无下载记录。",
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
	    toastUpdateAvailable: "发现新版本 {version}，请到“设置 > 更新”下载。",
	    searchPlaceholder: "搜索：displayName / id / tag",

    expandSidebar: "展开账号面板",
    collapseSidebar: "折叠账号面板",
	    sidebarTitle: "账号",
	    viewCards: "卡片视图",
	    viewTable: "表格视图",
	    sortLabel: "排序",
	    sortDefault: "默认",
	    sortDisplayName: "显示名",
	    sortLastUsed: "最近使用",
	    sortSubscriptionExpiresAt: "订阅到期",
	    sortCreditsUpdatedAt: "积分更新时间",
	    selectAll: "全选",
	    selectedCount: "已选择 {count} 个",
	    selectedCountShort: "已选 {count}",
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
	    batchProxy: "批量代理",
	    batchUa: "批量 UA",
	    batchDelete: "批量删除",
		    refresh: "刷新",

	    errorTitle: "错误",
	    tokenEncryptionWarningTitle: "重要提示",
	    tokenEncryptionWarningBody: "系统加密不可用：refresh_token 不会持久化，重启后需要重新导入。",
	    toastTabOpened: "已打开 Tab",
	    toastTabClosed: "已关闭 Tab",
	    toastTabReloaded: "已刷新当前 Tab",

    tabsAria: "账号标签页",
    noTabs: "暂无 Tab",
    workspaceTitle: "Flowith Web 工作区",
    workspaceSubtitle: "BrowserView 将覆盖此区域。折叠侧边栏 / 调整窗口尺寸不应遮挡顶栏与侧边栏控件。",
    openFocused: "打开（Focused）",
    closeFocused: "关闭（Focused）",
	    reloadActive: "刷新当前 Tab",
	    importResultChip: "导入结果：成功 {ok} · 失败 {fail}",
	    importProgressChip: "导入中：{done}/{total} · 成功 {ok} · 失败 {fail}",
	    openCloseHint: "选择一个账号以打开/关闭 Tab。",

	    inspectorTitle: "账号详情",
	    inspectorSelectHint: "选择一个账号以查看详情。",
	    displayNameLabel: "显示名",
	    saveDisplayName: "保存显示名",
	    toastDisplayNameSaved: "显示名已保存",
	    displayNameErrorRequired: "显示名不能为空。",
	    identitySectionTitle: "基础信息",
	    accountIdLabel: "账号 ID",
	    fingerprintLabel: "指纹",
	    advancedTechnicalIds: "高级 / 技术信息",
	    authDebug: "会话诊断",
	    authDebugHint: "仅显示指纹/长度，不包含明文 token。",
	    tagsLabel: "标签",
	    tagsPlaceholder: "tag1, tag2",
	    saveTags: "保存标签",
	    toastTagsSaved: "标签已保存",
    accountInfoTitle: "账号信息",
    subscriptionLabel: "订阅",
    subscriptionExpiresAtLabel: "订阅到期",
	    subscriptionExpiresAtChip: "到期 {date}",
	    creditsLabel: "积分",
	    creditsSyncHintOpenTab: "已打开 Tab：积分将从该 Tab 自动同步。",
	    creditsSyncHintClosedTab: "未打开 Tab：打开该账号 Tab 后才能同步积分。",
	    pin: "置顶",
	    unpin: "取消置顶",
	    tabChip: "Tab",
	    tabOpenTitle: "Tab 已打开",
	    tabClosedTitle: "Tab 未打开",
	    logPanel: "日志",
	    clearLog: "清空日志",
	    copyLog: "复制日志",
	    toastCopied: "已复制",
	    errorUnknown: "未知错误",
	    errorNetworkGeneric: "网络错误，请检查网络/代理后重试。",
	    errorRequestTimeout: "请求超时，请检查网络/代理后重试。",
	    errorPageLoadTimeout: "页面加载超时，请检查网络/代理，或在该账号 Tab 内刷新后重试。",
	    errorTokenNotImported: "该账号尚未导入 token。",
	    errorTokenMissingForExportWithCount:
	      "无法获取所选 {count} 个账号的 token。请先打开这些账号的 Tab 并确认已登录，然后重试导出。",
	    errorRefreshTokenAlreadyUsed: "该 token 已失效/已被轮换（already used）。请重新获取最新 token 并重新导入。",
	    errorUnauthorized: "登录态可能已失效/未就绪。请在该账号 Tab 内刷新页面或重新登录。",
	    errorRateLimited: "请求过于频繁，被限流（429）。稍后会自动重试。",
	    errorRateLimitedWithDelay: "请求过于频繁，被限流（429）。{seconds}s 后自动重试。",
	    errorCreditsSyncUnavailable: "积分同步暂不可用：Tab 登录态未就绪/已失效。请在该账号 Tab 内刷新或重新登录。",
	    errorProxyRulesRequired: "代理地址不能为空。",
	    errorProxyCredentialsNotAllowed: "代理地址暂不支持包含账号密码。",
	    errorProxyInvalidMode: "代理模式无效。",
	    uaErrorModeInvalid: "User-Agent 模式无效。",
	    errorDownloadNotFound: "下载记录不存在（可能已被清理）。",
	    errorDownloadPathUnavailable: "该下载暂无可用的保存路径。",
	    errorDownloadOpenFailed: "打开下载文件失败。",
	    errorUpdaterPackagedOnly: "更新功能仅发布版（安装包）可用。",
	    errorAccountNotFound: "账号不存在。",
	    errorWorkspaceTabNotFound: "该账号 Tab 未就绪/已关闭，请重新打开后重试。",
	    errorInvalidSelection: "所选账号列表无效，请刷新后重试。",
	    logDangerNote: "注意：日志用于排障回溯，可能包含敏感信息（已脱敏）。请勿外发/截图公开。",
	    logEmpty: "暂无日志。",
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
		    activateTab: "切换到 Tab",
		    closeTab: "关闭 Tab",
        openLink: "打开链接",
        openLinkTitle: "用该账号打开链接",
        openLinkNote: "仅支持 Flowith 分享链接（flowith.io / flo.ing）。将在该账号 Tab 内打开。",
        openLinkPlaceholder: "粘贴 Flowith 分享链接，例如 https://flowith.io/conv/...",
        toastLinkOpened: "已打开链接",
        errorInvalidLink: "链接无效：仅支持 https://flowith.io / https://flo.ing 等 Flowith 链接。",
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
	    exportRequiresOpenTab: "导出/迁移导出前请先打开所选账号 Tab（还缺 {count} 个）。",
	    exportMigration: "迁移导出",
	    exportMigrationDialogTitle: "迁移导出（换机）",
	    exportMigrationDialogNote:
	      "将为所选账号执行一次刷新以生成全新 refresh_token（每行一个），用于在新设备导入。",
	    exportMigrationDanger:
	      "注意：迁移导出会封存本机该账号（本机将退出且不可再打开）。迁移 token 会保留在本地（如系统支持加密存储）以便你忘记复制时可再次导出；请尽快复制并在新设备导入。",
	    exportMigrationDangerNoVault:
	      "注意：当前系统不支持加密存储。迁移导出后本机仍会封存该账号（本机将退出且不可再打开），且迁移 token 无法长期保留：一旦你关闭/崩溃/重启程序就可能永久丢失。请立刻复制并在新设备导入。",
		    exportDanger: "注意：导出内容属于敏感凭据。UI 与日志中必须始终脱敏；请勿分享或粘贴到日志/工单中。",
		    exportHint: "已导出 {count} 个账号的 token。默认不自动复制。",
		    exportMigrationCloseConfirm: "你还没有复制迁移 token。确定关闭？",
		    copyToClipboard: "复制到剪贴板",
		    toastCopiedToClipboard: "已复制到剪贴板",
		    sealedBadge: "已封存",
		    sealedHint:
		      "该账号已迁移封存：本机不可打开，避免 refresh_token 被再次使用。若你忘记保存迁移 token，可勾选该账号后使用“导出”再次获取（前提：系统支持加密存储）。",
		    errorAccountSealed: "该账号已封存，不能在本机打开。请在新设备导入迁移 token。",
		    errorMigrationExportSealed: "所选账号包含已封存账号：无法再次迁移导出。",
		    toastBatchOpenSkippedSealed: "已跳过 {count} 个封存账号（不可在本机打开）。",
		    done: "完成",
		    deleteAccountTitle: "删除账号",
		    deleteAccountNote: "将移除本地保存的账号信息与登录态，并关闭对应 Tab。此操作不可撤销。",
	    confirmDelete: "确认删除",
    closeTabTitle: "关闭 Tab",

	    batchTagsTitle: "批量设置标签",
	    batchTagsNote: "将把标签应用到已选择的 {count} 个账号（逗号/空白分隔）。",
	    batchProxyTitle: "批量设置代理",
	    batchProxyNote: "将把代理设置应用到已选择的 {count} 个账号。",
	    batchUaTitle: "批量设置 User-Agent",
	    batchUaNote: "将把 User-Agent 设置应用到已选择的 {count} 个账号。",
	    batchDeleteTitle: "批量删除账号",
	    batchDeleteNote: "将删除已选择的 {count} 个账号并关闭对应 Tab。此操作不可撤销。",
		    confirmApply: "应用",
		    toastBatchTagsResult: "批量标签：成功 {ok} · 失败 {fail}",
		    toastBatchProxyResult: "批量代理：成功 {ok} · 失败 {fail}",
		    toastBatchUaResult: "批量 User-Agent：成功 {ok} · 失败 {fail}",
		    toastBatchDeleteResult: "批量删除：成功 {ok} · 失败 {fail}",
	  },
  en: {
    subtitle: "Desktop · Workspace UI",
    language: "Language",
	    theme: "Theme",
	    themeDark: "Dark",
	    themeLight: "Light",
	    themeSystem: "System",
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
    downloadsViewAll: "View all",
    downloadsHistoryTitle: "Download history",
    downloadsHistoryCount: "Total {count} items",
    downloadShowInFolder: "Show in folder",
    downloadOpenFile: "Open",
    downloadCancelDownload: "Cancel",
    downloadCopyPath: "Copy path",
    downloadCopied: "Copied",
	    downloadStateProgress: "Downloading",
	    downloadStateCompleted: "Completed",
	    downloadStateCancelled: "Cancelled",
	    downloadStateInterrupted: "Interrupted",
	    downloadsEmpty: "No downloads yet.",
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
	    toastUpdateAvailable: "Update available: {version}. Open “Settings > Updates” to download.",
	    searchPlaceholder: "Search: displayName / id / tag",

    expandSidebar: "Expand accounts",
    collapseSidebar: "Collapse accounts",
	    sidebarTitle: "Accounts",
	    viewCards: "Cards view",
	    viewTable: "Table view",
	    sortLabel: "Sort",
	    sortDefault: "Default",
	    sortDisplayName: "Display name",
	    sortLastUsed: "Last used",
	    sortSubscriptionExpiresAt: "Subscription expires",
	    sortCreditsUpdatedAt: "Credits updated",
	    selectAll: "Select all",
	    selectedCount: "Selected {count}",
	    selectedCountShort: "{count} selected",
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
	    batchProxy: "Batch proxy",
	    batchUa: "Batch UA",
    batchDelete: "Batch delete",
		    refresh: "Refresh",

	    errorTitle: "Error",
	    tokenEncryptionWarningTitle: "Important",
	    tokenEncryptionWarningBody: "Token encryption is unavailable. refresh_token is not persisted and must be re-imported after restart.",
	    toastTabOpened: "Tab opened",
	    toastTabClosed: "Tab closed",
	    toastTabReloaded: "Tab reloaded",

    tabsAria: "Account tabs",
    noTabs: "No tabs",
    workspaceTitle: "Flowith Web Workspace",
    workspaceSubtitle:
      "BrowserView overlays this area. Sidebar collapse / window resize should not block controls.",
    openFocused: "Open (Focused)",
    closeFocused: "Close (Focused)",
	    reloadActive: "Reload active",
	    importResultChip: "Import: ok {ok} · failed {fail}",
	    importProgressChip: "Importing: {done}/{total} · ok {ok} · failed {fail}",
	    openCloseHint: "Select an account to open/close a tab.",

	    inspectorTitle: "Account details",
	    inspectorSelectHint: "Select an account to view details.",
	    displayNameLabel: "Display name",
	    saveDisplayName: "Save display name",
	    toastDisplayNameSaved: "Display name saved",
	    displayNameErrorRequired: "Display name is required.",
	    identitySectionTitle: "Identity",
	    accountIdLabel: "Account id",
	    fingerprintLabel: "Fingerprint",
	    advancedTechnicalIds: "Advanced / technical",
	    authDebug: "Auth diagnostics",
	    authDebugHint: "Fingerprints/length only; no raw tokens.",
	    tagsLabel: "Tags",
	    tagsPlaceholder: "tag1, tag2",
	    saveTags: "Save tags",
	    toastTagsSaved: "Tags saved",
    accountInfoTitle: "Account info",
    subscriptionLabel: "Subscription",
    subscriptionExpiresAtLabel: "Subscription expires",
	    subscriptionExpiresAtChip: "Exp {date}",
	    creditsLabel: "Credits",
	    creditsSyncHintOpenTab: "Tab is open. Credits are synced automatically from the tab.",
	    creditsSyncHintClosedTab: "Open the tab to sync credits.",
	    pin: "Pin",
	    unpin: "Unpin",
	    tabChip: "Tab",
	    tabOpenTitle: "Tab is open",
	    tabClosedTitle: "Tab is closed",
	    logPanel: "Logs",
	    clearLog: "Clear logs",
	    copyLog: "Copy logs",
	    toastCopied: "Copied",
	    errorUnknown: "Unknown error",
	    errorNetworkGeneric: "Network error. Check network/proxy and try again.",
	    errorRequestTimeout: "Request timed out. Check network/proxy and try again.",
	    errorPageLoadTimeout: "Page load timed out. Check network/proxy or reload within the tab.",
	    errorTokenNotImported: "Token not imported for this account.",
	    errorTokenMissingForExportWithCount:
	      "Token unavailable for {count} selected account(s). Open the account tab(s), ensure they are logged in, then export again.",
	    errorRefreshTokenAlreadyUsed:
	      "Token is already used/rotated. Re-export the latest token from the original environment and re-import.",
	    errorUnauthorized: "Login state may be expired/not ready. Reload or re-login inside the tab.",
	    errorRateLimited: "Too many requests (429). Will retry later.",
	    errorRateLimitedWithDelay: "Too many requests (429). Retrying in {seconds}s.",
	    errorCreditsSyncUnavailable: "Credits sync unavailable: tab login is not ready/expired. Reload or re-login inside the tab.",
	    errorProxyRulesRequired: "Proxy rules are required.",
	    errorProxyCredentialsNotAllowed: "Proxy rules must not include username:password credentials.",
	    errorProxyInvalidMode: "Invalid proxy mode.",
	    uaErrorModeInvalid: "Invalid User-Agent mode.",
	    errorDownloadNotFound: "Download record not found.",
	    errorDownloadPathUnavailable: "Save path is unavailable for this download.",
	    errorDownloadOpenFailed: "Failed to open the downloaded file.",
	    errorUpdaterPackagedOnly: "Updater is only available in packaged builds.",
	    errorAccountNotFound: "Account not found.",
	    errorWorkspaceTabNotFound: "Account tab is not ready/closed. Reopen the tab and try again.",
	    errorInvalidSelection: "Invalid account selection. Refresh and try again.",
	    logDangerNote: "Sensitive: logs are for troubleshooting and may contain redacted secrets. Do not share publicly.",
	    logEmpty: "No logs yet.",
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
			    activateTab: "Activate tab",
			    closeTab: "Close tab",
        openLink: "Open link",
        openLinkTitle: "Open link with this account",
        openLinkNote: "Only Flowith share links are supported (flowith.io / flo.ing). Opens inside this account tab.",
        openLinkPlaceholder: "Paste a Flowith share link, e.g. https://flowith.io/conv/...",
        toastLinkOpened: "Link opened",
        errorInvalidLink: "Invalid link: only https://flowith.io / https://flo.ing Flowith links are supported.",
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
	    exportRequiresOpenTab: "Open selected tabs before exporting (missing {count}).",
	    exportMigration: "Migration export",
	    exportMigrationDialogTitle: "Migration export",
	    exportMigrationDialogNote:
	      "Refreshes once to generate a new refresh_token (one per line) for importing on a new device.",
	    exportMigrationDanger:
	      "Note: Migration export seals this account on this machine (it will be signed out and cannot be opened). Tokens are kept locally (when encrypted storage is available) so you can re-copy if needed; import on the new device ASAP.",
	    exportMigrationDangerNoVault:
	      "Warning: Token encryption is unavailable on this host. Migration export will still seal the account on this device (signed out and cannot be opened), and the migration token cannot be kept safely: once you close/crash/restart the app, it may be lost permanently. Copy it immediately and import on the new device.",
		    exportDanger:
		      "Sensitive: export contains credentials. Never paste into logs or tickets. UI/logs must remain redacted.",
		    exportHint: "Exported token(s) for {count} account(s). Nothing is auto-copied.",
		    exportMigrationCloseConfirm: "You haven't copied the migration token yet. Close anyway?",
		    copyToClipboard: "Copy to clipboard",
		    toastCopiedToClipboard: "Copied to clipboard",
		    sealedBadge: "Sealed",
		    sealedHint:
		      "This account is sealed after migration export to prevent refresh_token reuse. If you forgot to save the migration token, select this account and use “Export” to retrieve it again (requires encrypted storage).",
		    errorAccountSealed: "This account is sealed and cannot be opened on this machine. Import the migration token on the new device.",
		    errorMigrationExportSealed: "Selection contains sealed account(s): migration export is not allowed.",
		    toastBatchOpenSkippedSealed: "Skipped {count} sealed account(s) (cannot be opened on this machine).",
		    done: "Done",
		    deleteAccountTitle: "Delete account",
		    deleteAccountNote: "Removes local account data and closes its tab. This cannot be undone.",
	    confirmDelete: "Delete",
    closeTabTitle: "Close tab",

	    batchTagsTitle: "Batch tags",
	    batchTagsNote: "Applies tags to {count} selected account(s) (comma/space separated).",
	    batchProxyTitle: "Batch proxy",
	    batchProxyNote: "Applies proxy settings to {count} selected account(s).",
	    batchUaTitle: "Batch User-Agent",
	    batchUaNote: "Applies User-Agent settings to {count} selected account(s).",
	    batchDeleteTitle: "Batch delete",
	    batchDeleteNote: "Deletes {count} selected account(s) and closes their tabs. This cannot be undone.",
		    confirmApply: "Apply",
		    toastBatchTagsResult: "Batch tags: ok {ok} · failed {fail}",
		    toastBatchProxyResult: "Batch proxy: ok {ok} · failed {fail}",
		    toastBatchUaResult: "Batch UA: ok {ok} · failed {fail}",
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

function formatUpdatedAgeShort(value: number, locale: Locale): string {
  if (!Number.isFinite(value) || value <= 0) return "-";
  const deltaMs = Date.now() - value;
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return "-";
  if (deltaMs < 60_000) return locale === "zh-CN" ? "刚刚" : "now";
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
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

function formatCreditsValue(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "-";
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex === -1) return trimmed;
  return trimmed.slice(0, slashIndex).trim() || trimmed;
}

function formatProxyModeLabel(mode: ProxyMode, t: (key: StringKey) => string): string {
  if (mode === "system") return t("proxySystem");
  if (mode === "custom") return t("proxyCustom");
  return t("proxyDirect");
}

function formatProxyModeShort(mode: ProxyMode): string {
  if (mode === "system") return "SYS";
  if (mode === "custom") return "CUS";
  return "DIR";
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

function formatUaModeShort(mode: UaMode): string {
  if (mode === "default") return "D";
  if (mode === "preset") return "P";
  return "C";
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
  const raw = error instanceof Error && typeof error.message === "string" ? error.message : String(error);

  // Electron invoke errors are often wrapped like:
  // "Error invoking remote method 'channel': Error: <message>"
  const withoutInvokePrefix = raw.replace(/^Error invoking remote method '[^']+':\s*/i, "");
  return withoutInvokePrefix.replace(/^Error:\s*/i, "").trim() || "Unknown error";
}

function humanizeErrorMessage(raw: string, t: (key: StringKey) => string): string {
  const message = raw.trim();
  if (!message || /^unknown error$/i.test(message)) return t("errorUnknown");

  if (/Timeout waiting for Flowith Web to load\./i.test(message)) return t("errorPageLoadTimeout");
  if (/No refresh_token available for this account/i.test(message)) return t("errorTokenNotImported");
  if (/Invalid accountIds: duplicate ids\./i.test(message)) return t("errorInvalidSelection");
  if (/Account not found\./i.test(message)) return t("errorAccountNotFound");
  if (/Workspace webContents not found for account\./i.test(message)) return t("errorWorkspaceTabNotFound");
  if (/Updater is only available in packaged builds\./i.test(message)) return t("errorUpdaterPackagedOnly");

  const tokenUnavailableMatch = message.match(/^Token unavailable for\s+(\d+)\s+selected account\(s\)\./i);
  if (tokenUnavailableMatch) {
    const count = Number(tokenUnavailableMatch[1]);
    const safeCount = Number.isFinite(count) ? Math.max(0, count) : 0;
    return format(t("errorTokenMissingForExportWithCount"), { count: safeCount });
  }

  const rateLimitedMatch = message.match(/Rate limited\s*\(429\)\.\s*Retry after\s+(\d+)s\./i);
  if (rateLimitedMatch) {
    const seconds = Number(rateLimitedMatch[1]);
    const safeSeconds = Number.isFinite(seconds) ? Math.max(1, seconds) : 1;
    return format(t("errorRateLimitedWithDelay"), { seconds: safeSeconds });
  }

  if (/Invalid proxy mode\./i.test(message)) return t("errorProxyInvalidMode");
  if (/Custom proxy rules are required\./i.test(message)) return t("errorProxyRulesRequired");
  if (/Proxy rules must not include username:password credentials\./i.test(message)) return t("errorProxyCredentialsNotAllowed");

  if (/Invalid User-Agent mode\./i.test(message)) return t("uaErrorModeInvalid");
  if (/User-Agent value is required/i.test(message)) return t("uaErrorRequired");
  if (/User-Agent value is too long\./i.test(message)) return t("uaErrorTooLong");
  if (/User-Agent value must be single-line\./i.test(message)) return t("uaErrorSingleLine");
  if (/Unknown User-Agent preset\./i.test(message)) return t("uaErrorPresetUnknown");

  if (/Download not found\./i.test(message)) return t("errorDownloadNotFound");
  if (/Save path is unavailable for this download\./i.test(message)) return t("errorDownloadPathUnavailable");
  if (/Failed to open the downloaded file\./i.test(message)) return t("errorDownloadOpenFailed");

  if (/already used/i.test(message)) return t("errorRefreshTokenAlreadyUsed");
  if (/\b429\b/i.test(message) || /rate limited/i.test(message)) return t("errorRateLimited");
  if (/\b401\b|\b403\b/i.test(message) || /unauthorized/i.test(message)) return t("errorUnauthorized");

  if (/The operation was aborted|aborted/i.test(message)) return t("errorRequestTimeout");
  if (
    /Failed to fetch/i.test(message) ||
    /(ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ERR_NETWORK)/i.test(message)
  ) {
    return t("errorNetworkGeneric");
  }

  return message;
}

function toUiErrorMessage(error: unknown, t: (key: StringKey) => string): string {
  return humanizeErrorMessage(toErrorMessage(error), t);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function normalizeTheme(value: unknown): Theme | null {
  return value === "dark" || value === "light" || value === "system" ? value : null;
}

function normalizeLocale(value: unknown): Locale | null {
  return value === "zh-CN" || value === "en" ? value : null;
}

function normalizeViewMode(value: unknown): AccountListViewMode | null {
  return value === "cards" || value === "table" ? value : null;
}

function normalizeAccountSort(value: unknown): AccountSortMode | null {
  if (
    value === "default" ||
    value === "displayName" ||
    value === "lastUsed" ||
    value === "subscriptionExpiresAt" ||
    value === "creditsUpdatedAt"
  ) {
    return value;
  }
  return null;
}

function normalizeBoolean(value: unknown): boolean | null {
  return value === true || value === false ? value : null;
}

function loadUiPreferences(): UiPreferencesV2 {
  const defaults: UiPreferencesV2 = {
    version: 2,
    theme: "dark",
    locale: "zh-CN",
    sidebarCollapsed: false,
    accountListView: "cards",
    accountSort: "default",
  };

  const next: UiPreferencesV2 = { ...defaults };

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

        const sort = normalizeAccountSort(parsed.accountSort);
        if (sort) next.accountSort = sort;
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

function persistUiPreferences(prefs: UiPreferencesV2): void {
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

const ACCOUNT_LAST_USED_CACHE_KEY_V1 = "fwd_account_last_used_cache_v1";
type AccountLastUsedCacheV1 = { version: 1; byId: Record<string, number> };

function loadAccountLastUsedCache(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(ACCOUNT_LAST_USED_CACHE_KEY_V1);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.byId)) return {};
    const next: Record<string, number> = {};
    for (const [accountId, value] of Object.entries(parsed.byId)) {
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
      next[accountId] = value;
    }
    return next;
  } catch {
    return {};
  }
}

function persistAccountLastUsedCache(byId: Record<string, number>): void {
  try {
    const payload: AccountLastUsedCacheV1 = { version: 1, byId };
    window.localStorage.setItem(ACCOUNT_LAST_USED_CACHE_KEY_V1, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

const UI_LOG_CACHE_KEY_V1 = "fwd_ui_log_cache_v1";
type UiLogEntry = { kind: UiToastKind; message: string; createdAt: number };
type UiLogCacheV1 = { version: 1; entries: UiLogEntry[] };

function loadUiLogCache(): UiLogEntry[] {
  try {
    const raw = window.localStorage.getItem(UI_LOG_CACHE_KEY_V1);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1) return [];
    if (!Array.isArray(parsed.entries)) return [];

    const next: UiLogEntry[] = [];
    for (const item of parsed.entries) {
      if (!isRecord(item)) continue;
      const kind = item.kind;
      if (kind !== "success" && kind !== "error" && kind !== "info") continue;
      const message = typeof item.message === "string" ? item.message : null;
      const createdAt = item.createdAt;
      if (!message) continue;
      if (typeof createdAt !== "number" || !Number.isFinite(createdAt) || createdAt <= 0) continue;
      next.push({ kind, message, createdAt });
    }
    return next.slice(0, 200);
  } catch {
    return [];
  }
}

function persistUiLogCache(entries: UiLogEntry[]): void {
  try {
    const payload: UiLogCacheV1 = { version: 1, entries: entries.slice(0, 200) };
    window.localStorage.setItem(UI_LOG_CACHE_KEY_V1, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

export default function WorkspaceShell() {
  const [uiPrefs, setUiPrefs] = useState<UiPreferencesV2>(() => loadUiPreferences());

  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusedAccountId, setFocusedAccountId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uiToasts, setUiToasts] = useState<UiToastState[]>([]);
  const [uiLog, setUiLog] = useState<UiLogEntry[]>(() => loadUiLogCache());
  const [tokenEncryptionAvailable, setTokenEncryptionAvailable] = useState<boolean | null>(null);
  const [searchText, setSearchText] = useState("");

	  const strings = UI_STRINGS[uiPrefs.locale];
	  const t = useCallback((key: StringKey) => strings[key], [strings]);
	  const formatErrorMessage = useCallback((e: unknown) => toUiErrorMessage(e, t), [t]);
	  const isWindows = useMemo(() => /windows/i.test(navigator.userAgent), []);
	  const [windowMaximized, setWindowMaximized] = useState(false);
	  const [systemTheme, setSystemTheme] = useState<"dark" | "light">(() => {
	    try {
	      return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
	    } catch {
	      return "dark";
	    }
	  });
	  const resolvedTheme = uiPrefs.theme === "system" ? systemTheme : uiPrefs.theme;

  const dismissUiToast = useCallback((toastId: string) => {
    const handle = uiToastTimersRef.current.get(toastId);
    if (typeof handle === "number") {
      window.clearTimeout(handle);
      uiToastTimersRef.current.delete(toastId);
    }
    setUiToasts((prev) => prev.filter((t) => t.id !== toastId));
  }, []);

	  const pushUiToast = useCallback(
	    (kind: UiToastKind, message: string, opts?: { autoDismissMs?: number | null }) => {
	      const id =
	        typeof crypto !== "undefined" && "randomUUID" in crypto
	          ? crypto.randomUUID()
	          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

	      const normalized = message.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
	      const createdAt = Date.now();

	      setUiToasts((prev) => {
	        const nextToast = { id, kind, message: normalized, createdAt };
	        if (kind === "error") return [nextToast, ...prev].slice(0, 4);
	        return [nextToast, ...prev.filter((t) => t.kind === "error")].slice(0, 4);
	      });

	      setUiLog((prev) => [{ kind, message: normalized, createdAt }, ...prev].slice(0, 200));

	      const autoDismissMs = opts?.autoDismissMs ?? (kind === "error" ? null : 3500);
	      if (typeof autoDismissMs === "number" && autoDismissMs > 0) {
	        const timeout = window.setTimeout(() => dismissUiToast(id), autoDismissMs);
	        uiToastTimersRef.current.set(id, timeout);
	      }
	    },
	    [dismissUiToast]
	  );

  useEffect(() => {
    const timers = uiToastTimersRef.current;
    const active = new Set(uiToasts.map((t) => t.id));
    for (const [id, handle] of [...timers.entries()]) {
      if (active.has(id)) continue;
      window.clearTimeout(handle);
      timers.delete(id);
    }
  }, [uiToasts]);

  useEffect(() => {
    const uiToastTimers = uiToastTimersRef.current;
    const downloadTimers = downloadAutoDismissTimersRef.current;
    const creditSyncTimers = creditSyncTimersRef.current;
    return () => {
      for (const handle of uiToastTimers.values()) window.clearTimeout(handle);
      uiToastTimers.clear();
      for (const handle of downloadTimers.values()) window.clearTimeout(handle);
      downloadTimers.clear();
      for (const handles of creditSyncTimers.values()) for (const handle of handles) window.clearTimeout(handle);
      creditSyncTimers.clear();
    };
  }, []);

  const viewMode = uiPrefs.accountListView;
  const sidebarCollapsed = uiPrefs.sidebarCollapsed;

  const updateUiPrefs = useCallback((patch: Partial<Omit<UiPreferencesV2, "version">>) => {
    setUiPrefs((prev) => ({ ...prev, ...patch, version: 2 }));
  }, []);

  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [logDialogOpen, setLogDialogOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importResult, setImportResult] = useState<ImportRefreshTokensResult | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgressState | null>(null);
  const [importProxyMode, setImportProxyMode] = useState<ProxyMode>("system");
  const [importProxyRules, setImportProxyRules] = useState("");
  const [importProxyInlineError, setImportProxyInlineError] = useState<string | null>(null);
  const [importUaMode, setImportUaMode] = useState<ImportUaMode>("auto");
  const [importUaValue, setImportUaValue] = useState("");
  const [importUaInlineError, setImportUaInlineError] = useState<string | null>(null);

	  const [exportDialog, setExportDialog] = useState<ExportDialogState>({ open: false });
	  const [exportCopied, setExportCopied] = useState(false);
	  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState>({ open: false });
    const [openLinkDialog, setOpenLinkDialog] = useState<OpenLinkDialogState>({ open: false });
    const [openLinkInlineError, setOpenLinkInlineError] = useState<string | null>(null);
  const [batchTagsDialog, setBatchTagsDialog] = useState<BatchTagsDialogState>({ open: false });
  const [batchTagsDraft, setBatchTagsDraft] = useState("");
  const [batchProxyDialog, setBatchProxyDialog] = useState<BatchProxyDialogState>({ open: false });
  const [batchProxyMode, setBatchProxyMode] = useState<ProxyMode>("system");
  const [batchProxyRules, setBatchProxyRules] = useState("");
  const [batchProxyInlineError, setBatchProxyInlineError] = useState<string | null>(null);
  const [batchUserAgentDialog, setBatchUserAgentDialog] = useState<BatchUserAgentDialogState>({ open: false });
  const [batchUaMode, setBatchUaMode] = useState<UaMode>("default");
  const [batchUaValue, setBatchUaValue] = useState("");
  const [batchUaInlineError, setBatchUaInlineError] = useState<string | null>(null);
  const [batchDeleteDialog, setBatchDeleteDialog] = useState<BatchDeleteDialogState>({ open: false });
	  const [authDebug, setAuthDebug] = useState<AccountAuthDiagnostics | null>(null);

	  const sealedAccountIds = useMemo(() => {
	    return new Set(accounts.filter((a) => a.sealed).map((a) => a.id));
	  }, [accounts]);

  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [displayNameInlineError, setDisplayNameInlineError] = useState<string | null>(null);
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
  const [downloadsDialogOpen, setDownloadsDialogOpen] = useState(false);
  const [selectOverlayOpen, setSelectOverlayOpen] = useState(false);
  const [downloadPrefs, setDownloadPrefs] = useState<DownloadPreferencesPublic | null>(null);
  const [downloadToasts, setDownloadToasts] = useState<DownloadToastState[]>([]);
  const [updaterStatus, setUpdaterStatus] = useState<UpdaterStatus | null>(null);
  const [updaterRunning, setUpdaterRunning] = useState(false);
  const notifiedUpdateVersionRef = useRef<string | null>(null);

  const [accountInfoById, setAccountInfoById] = useState<Record<string, AccountInfoEntry>>(() => loadAccountInfoCache());
  const [lastUsedAtByAccountId, setLastUsedAtByAccountId] = useState<Record<string, number>>(() => loadAccountLastUsedCache());

  const [openTabIds, setOpenTabIds] = useState<string[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [activeTabSnapshot, setActiveTabSnapshot] = useState<string | null>(null);
  const tabSnapshotCacheRef = useRef<Map<string, { snapshot: string; capturedAt: number }>>(new Map());
  const tabSnapshotInFlightRef = useRef<Map<string, Promise<string | null>>>(new Map());
  const lastTabSnapshotRef = useRef<string | null>(null);
  const snapshotVisibleTimerRef = useRef<number | null>(null);
  const [snapshotHold, setSnapshotHold] = useState(false);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const viewportBoundsDesiredRef = useRef<Rect | null>(null);
  const viewportBoundsFlushInFlightRef = useRef<Promise<void> | null>(null);
  const viewportBoundsFlushNeededRef = useRef(false);
  const importDialogRef = useRef<HTMLDialogElement | null>(null);
  const logDialogRef = useRef<HTMLDialogElement | null>(null);
  const downloadsDialogRef = useRef<HTMLDialogElement | null>(null);
  const exportDialogRef = useRef<HTMLDialogElement | null>(null);
  const openLinkDialogRef = useRef<HTMLDialogElement | null>(null);
  const deleteDialogRef = useRef<HTMLDialogElement | null>(null);
  const batchTagsDialogRef = useRef<HTMLDialogElement | null>(null);
  const batchProxyDialogRef = useRef<HTMLDialogElement | null>(null);
  const batchUserAgentDialogRef = useRef<HTMLDialogElement | null>(null);
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
	  const creditSyncTimersRef = useRef<Map<string, number[]>>(new Map());

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
    setDisplayNameInlineError(null);
    setUaInlineError(null);
    setProxyInlineError(null);
    setDisplayNameDraft(focusedAccount.displayName);
    setTagsDraft(focusedAccount.tags.join(", "));
    setProxyMode(focusedAccount.net.proxy.mode);
    setProxyRules(focusedAccount.net.proxy.rules ?? "");
    const uaMode = focusedAccount.ua.mode;
    const uaValue = focusedAccount.ua.value ?? "";
    if (uaMode === "preset") {
      const preset = uaValue ? findUserAgentPreset(uaValue) : null;
      if (preset) {
        if (USER_AGENT_PRESET_VISIBLE_IDS.has(preset.id)) {
          setUaMode("preset");
          setUaValue(preset.id);
        } else {
          setUaMode("custom");
          setUaValue(preset.value);
        }
      } else if (uaValue.trim()) {
        setUaMode("custom");
        setUaValue(uaValue);
      } else {
        setUaMode("preset");
        setUaValue(USER_AGENT_PRESETS_VISIBLE[0]?.id ?? "");
      }
    } else {
      setUaMode(uaMode);
      setUaValue(uaValue);
    }
  }, [focusedAccount]);

  useEffect(() => {
    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia("(prefers-color-scheme: light)");
    } catch {
      return;
    }

    const onChange = () => setSystemTheme(mq?.matches ? "light" : "dark");
    onChange();
    try {
      mq.addEventListener("change", onChange);
      return () => mq?.removeEventListener("change", onChange);
    } catch {
      // Safari/WebKit legacy
      (mq as unknown as { addListener?: (fn: () => void) => void }).addListener?.(onChange);
      return () => (mq as unknown as { removeListener?: (fn: () => void) => void }).removeListener?.(onChange);
    }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolvedTheme);
    document.documentElement.lang = uiPrefs.locale;
    persistUiPreferences(uiPrefs);
  }, [resolvedTheme, uiPrefs]);

  useEffect(() => {
    persistAccountInfoCache(accountInfoById);
  }, [accountInfoById]);

  useEffect(() => {
    persistAccountLastUsedCache(lastUsedAtByAccountId);
  }, [lastUsedAtByAccountId]);

  useEffect(() => {
    persistUiLogCache(uiLog);
  }, [uiLog]);

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
    const base = q
      ? accounts.filter((a) => {
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
        })
      : [...accounts];

    const indexById = new Map(accounts.map((a, index) => [a.id, index] as const));
    const defaultIndexOf = (id: string): number => indexById.get(id) ?? Number.MAX_SAFE_INTEGER;

    const comparePinnedFirst = (a: AccountSummary, b: AccountSummary): number => {
      if (a.pinned === b.pinned) return 0;
      return a.pinned ? -1 : 1;
    };

    const compareDisplayName = (a: AccountSummary, b: AccountSummary): number =>
      a.displayName.localeCompare(b.displayName, uiPrefs.locale, { sensitivity: "base" });

    const compareLastUsedDesc = (a: AccountSummary, b: AccountSummary): number => {
      const av = lastUsedAtByAccountId[a.id] ?? 0;
      const bv = lastUsedAtByAccountId[b.id] ?? 0;
      return bv - av;
    };

    const compareSubscriptionExpiresAtAsc = (a: AccountSummary, b: AccountSummary): number => {
      const av = accountInfoById[a.id]?.subscriptionExpiresAt ?? Number.POSITIVE_INFINITY;
      const bv = accountInfoById[b.id]?.subscriptionExpiresAt ?? Number.POSITIVE_INFINITY;
      return av - bv;
    };

    const compareCreditsUpdatedAtDesc = (a: AccountSummary, b: AccountSummary): number => {
      const av = accountInfoById[a.id]?.updatedAt ?? 0;
      const bv = accountInfoById[b.id]?.updatedAt ?? 0;
      return bv - av;
    };

    const compareDefault = (a: AccountSummary, b: AccountSummary): number =>
      defaultIndexOf(a.id) - defaultIndexOf(b.id);

    base.sort((a, b) => {
      const pinned = comparePinnedFirst(a, b);
      if (pinned) return pinned;

      const sortMode = uiPrefs.accountSort;
      if (sortMode === "displayName") {
        const cmp = compareDisplayName(a, b);
        return cmp || compareDefault(a, b);
      }
      if (sortMode === "lastUsed") {
        const cmp = compareLastUsedDesc(a, b);
        return cmp || compareDefault(a, b);
      }
      if (sortMode === "subscriptionExpiresAt") {
        const cmp = compareSubscriptionExpiresAtAsc(a, b);
        return cmp || compareDefault(a, b);
      }
      if (sortMode === "creditsUpdatedAt") {
        const cmp = compareCreditsUpdatedAtDesc(a, b);
        return cmp || compareDefault(a, b);
      }

      return compareDefault(a, b);
    });

    return base;
  }, [accountInfoById, accounts, lastUsedAtByAccountId, searchText, uiPrefs.accountSort, uiPrefs.locale]);

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

      const workspaceState = await window.desktop.workspace.getState().catch(() => null);
      const allowed = new Set(list.map((a) => a.id));
      const openTabIdsFromWorkspace = workspaceState
        ? (workspaceState.openTabIds ?? []).filter((id) => allowed.has(id))
        : null;
      const activeTabIdFromWorkspace =
        workspaceState?.activeTabId && allowed.has(workspaceState.activeTabId)
          ? workspaceState.activeTabId
          : null;

      if (!activeTabIdFromWorkspace && openTabIdsFromWorkspace && openTabIdsFromWorkspace.length > 0) {
        try {
          await window.desktop.workspace.setActiveTab(openTabIdsFromWorkspace[0]!);
        } catch {
          // ignore
        }
      }

      setSelectedIds((prev) => {
        const next = new Set<string>();
        for (const id of prev) if (allowed.has(id)) next.add(id);
        return next;
      });

      setAccountInfoById((prev) => {
        const next: Record<string, AccountInfoEntry> = {};
        for (const [id, info] of Object.entries(prev)) if (allowed.has(id)) next[id] = info;
        return next;
      });

      setOpenTabIds((prev) => {
        if (openTabIdsFromWorkspace) return openTabIdsFromWorkspace;
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
        if (activeTabIdFromWorkspace) return activeTabIdFromWorkspace;
        const fallback = prev && allowed.has(prev) ? prev : null;
        if (openTabIdsFromWorkspace && openTabIdsFromWorkspace.length > 0) {
          if (fallback && openTabIdsFromWorkspace.includes(fallback)) return fallback;
          return openTabIdsFromWorkspace[0] ?? null;
        }
        return fallback;
      });
    } catch (e) {
      setError(formatErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [formatErrorMessage]);

  useEffect(() => {
    void refreshAccounts();
  }, [refreshAccounts]);

  useEffect(() => {
    let cancelled = false;
    let repairingActive = false;
    const poll = async () => {
      if (cancelled) return;
      try {
        const workspaceState = await window.desktop.workspace.getState().catch(() => null);
        if (cancelled || !workspaceState) return;

        // When the accounts list is temporarily empty (e.g. renderer reload), do not filter out open tabs.
        // Otherwise the UI may get stuck showing "暂无 Tab" even though BrowserViews are still alive in main.
        const allowed = accounts.length > 0 ? new Set(accounts.map((a) => a.id)) : null;
        const nextOpenTabIds = allowed
          ? (workspaceState.openTabIds ?? []).filter((id) => allowed.has(id))
          : (workspaceState.openTabIds ?? []);
        const activeFromWorkspace =
          workspaceState.activeTabId && (!allowed || allowed.has(workspaceState.activeTabId))
            ? workspaceState.activeTabId
            : null;

        setOpenTabIds((prev) => (isSameStringArray(prev, nextOpenTabIds) ? prev : nextOpenTabIds));

        setActiveTabId((prev) => {
          if (activeFromWorkspace) return activeFromWorkspace;
          if (prev && nextOpenTabIds.includes(prev)) return prev;
          return nextOpenTabIds[0] ?? null;
        });

        if (!activeFromWorkspace && nextOpenTabIds.length > 0 && !repairingActive) {
          repairingActive = true;
          window.desktop.workspace
            .setActiveTab(nextOpenTabIds[0]!)
            .catch(() => void 0)
            .finally(() => {
              repairingActive = false;
            });
        }
      } catch {
        // ignore
      }
    };

    void poll();
    const interval = window.setInterval(poll, 1500);
    const onFocus = () => void poll();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [accounts]);

  useEffect(() => {
    void window.desktop.accounts
      .isTokenEncryptionAvailable()
      .then((available) => setTokenEncryptionAvailable(Boolean(available)))
      .catch(() => setTokenEncryptionAvailable(null));
  }, []);

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

  const recordAccountUsed = useCallback((accountId: string) => {
    const normalized = accountId.trim();
    if (!normalized) return;
    const now = Date.now();
    setLastUsedAtByAccountId((prev) => {
      if (prev[normalized] === now) return prev;
      return { ...prev, [normalized]: now };
    });
  }, []);

  const focusAccount = useCallback((accountId: string) => {
    recordAccountUsed(accountId);
    setFocusedAccountId(accountId);
    setInspectorOpen(true);
  }, [recordAccountUsed]);

  const openSelectOverlay = useCallback(() => setSelectOverlayOpen(true), []);
  const closeSelectOverlay = useCallback(() => setSelectOverlayOpen(false), []);

  const overlayActive =
    importDialogOpen ||
    logDialogOpen ||
    downloadsDialogOpen ||
    exportDialog.open ||
    openLinkDialog.open ||
    deleteDialog.open ||
    batchTagsDialog.open ||
    batchProxyDialog.open ||
    batchUserAgentDialog.open ||
    batchDeleteDialog.open ||
    settingsPopoverOpen ||
    downloadsPopoverOpen ||
    connectivityPopoverOpen ||
    selectOverlayOpen;

  useEffect(() => {
    void window.desktop.workspace.setOverlayActive(overlayActive).catch(() => void 0);
  }, [overlayActive]);

  const snapshotVisible = overlayActive || snapshotHold;

  useEffect(() => {
    if (snapshotVisibleTimerRef.current) {
      window.clearTimeout(snapshotVisibleTimerRef.current);
      snapshotVisibleTimerRef.current = null;
    }

    if (overlayActive) {
      setSnapshotHold(true);
      return;
    }

    snapshotVisibleTimerRef.current = window.setTimeout(() => {
      snapshotVisibleTimerRef.current = null;
      setSnapshotHold(false);
    }, 220);

    return () => {
      if (snapshotVisibleTimerRef.current) {
        window.clearTimeout(snapshotVisibleTimerRef.current);
        snapshotVisibleTimerRef.current = null;
      }
    };
  }, [overlayActive]);

  const computeViewportBounds = useCallback((): Rect | null => {
    if (overlayActive) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    const el = viewportRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
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
  }, [pushViewportBounds, sidebarCollapsed, inspectorOpen, uiPrefs.locale, error, overlayActive]);

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
    lastTabSnapshotRef.current = normalized;
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

      if (overlayActive) {
        return tabSnapshotCacheRef.current.get(normalizedId)?.snapshot ?? null;
      }

      const inFlight = tabSnapshotInFlightRef.current.get(normalizedId);
      if (inFlight) return inFlight;

      const task = (async () => {
        try {
          const snapshot = await window.desktop.workspace.captureTabSnapshot(normalizedId);
          if (typeof snapshot === "string" && snapshot.trim()) {
            cacheTabSnapshot(normalizedId, snapshot);
            if (normalizedId === activeTabId) setActiveTabSnapshot(snapshot);
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
    [activeTabId, cacheTabSnapshot, overlayActive]
  );

  useEffect(() => {
    if (!activeTabId) {
      setActiveTabSnapshot(null);
      return;
    }
    const cached = tabSnapshotCacheRef.current.get(activeTabId)?.snapshot ?? lastTabSnapshotRef.current ?? null;
    setActiveTabSnapshot(cached);
  }, [activeTabId]);

  useEffect(() => {
    if (!activeTabId) return;
    if (overlayActive) return;

    const cached = tabSnapshotCacheRef.current.get(activeTabId);
    const shouldCaptureSoon = !cached || Date.now() - cached.capturedAt > 4000;
    const delayMs = !cached ? 800 : shouldCaptureSoon ? 300 : 1500;

    const timer = window.setTimeout(() => {
      void requestTabSnapshot(activeTabId);
    }, delayMs);

    const interval = window.setInterval(() => {
      void requestTabSnapshot(activeTabId);
    }, 20_000);

    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [activeTabId, overlayActive, requestTabSnapshot]);

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

  // Keep Downloads popover available even when the list is empty (persistent download history).

  useEffect(() => {
    void window.desktop.downloads
      .getPreferences()
      .then((prefs) => setDownloadPrefs(prefs))
      .catch(() => void 0);
  }, []);

  useEffect(() => {
    void window.desktop.downloads
      .getHistory()
      .then((history) => {
        setDownloadToasts((prev) => {
          const byId = new Map<string, DownloadToastState>();
          for (const d of prev) byId.set(d.id, d);

          for (const item of history) {
            if (byId.has(item.id)) continue;
            byId.set(item.id, {
              id: item.id,
              accountId: item.accountId,
              filename: item.filename,
              receivedBytes: item.receivedBytes,
              totalBytes: item.totalBytes,
              state: item.state,
              copiedAt: null,
              updatedAt: item.updatedAt,
            });
          }

          return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, DOWNLOAD_HISTORY_LIMIT);
        });
      })
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
    const s = updaterStatus;
    if (!s || !s.supported) return;
    if (s.state !== "available") return;
    const version = (s.availableVersion ?? "").trim();
    if (!version) return;
    if (notifiedUpdateVersionRef.current === version) return;
    notifiedUpdateVersionRef.current = version;
    pushUiToast("info", format(t("toastUpdateAvailable"), { version }), { autoDismissMs: 9000 });
  }, [pushUiToast, t, updaterStatus]);

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
            return [next, ...rest].slice(0, DOWNLOAD_HISTORY_LIMIT);
          }

          const index = prev.findIndex((d) => d.id === event.id);
          if (index < 0) return prev;

          const current = prev[index];
          if (!current) return prev;

          const rest = prev.filter((d) => d.id !== event.id);
          if (event.type === "progress") {
            const updated: DownloadToastState = {
              ...current,
              receivedBytes: Math.max(0, event.receivedBytes),
              totalBytes: Math.max(0, event.totalBytes),
              updatedAt: now,
            };
            return [updated, ...rest].slice(0, DOWNLOAD_HISTORY_LIMIT);
          } else {
            const updated: DownloadToastState = {
              ...current,
              state: event.state,
              updatedAt: now,
            };
            return [updated, ...rest].slice(0, DOWNLOAD_HISTORY_LIMIT);
          }
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

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    try {
      unsubscribe = window.desktop.accounts.subscribeImportProgress((event: AccountsImportProgressEvent) => {
        if (event.type === "start") {
          setImportProgress({
            total: Math.max(0, event.total),
            done: 0,
            imported: 0,
            failed: 0,
            creditsFailed: 0,
            currentFingerprint: null,
          });
          return;
        }

        if (event.type === "progress") {
          setImportProgress((prev) => {
            const total = Math.max(0, event.total);
            if (!prev && total === 0) return null;
            return {
              total,
              done: Math.max(0, event.done),
              imported: Math.max(0, event.imported),
              failed: Math.max(0, event.failed),
              creditsFailed: Math.max(0, event.creditsFailed),
              currentFingerprint: event.current?.fingerprint ?? prev?.currentFingerprint ?? null,
            };
          });
          return;
        }

        if (event.type === "end") {
          setImportProgress((prev) => {
            const total = Math.max(0, event.total);
            return {
              total,
              done: total,
              imported: Math.max(0, event.imported),
              failed: Math.max(0, event.failed),
              creditsFailed: Math.max(0, event.creditsFailed),
              currentFingerprint: prev?.currentFingerprint ?? null,
            };
          });
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
  }, []);

  useEffect(() => {
    if (importDialogOpen) return;
    setImportProgress(null);
  }, [importDialogOpen]);

  const dismissDownloadToast = useCallback((id: string) => {
    setDownloadToasts((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const setDownloadMode = useCallback(async (mode: DownloadSaveMode) => {
    setError(null);
    try {
      const next = await window.desktop.downloads.setMode(mode);
      setDownloadPrefs(next);
    } catch (e) {
      setError(formatErrorMessage(e));
    }
  }, [formatErrorMessage]);

  const pickDownloadDirectory = useCallback(async () => {
    setError(null);
    try {
      const next = await window.desktop.downloads.pickCustomDirectory();
      setDownloadPrefs(next);
    } catch (e) {
      setError(formatErrorMessage(e));
    }
  }, [formatErrorMessage]);

  const showDownloadInFolder = useCallback(async (id: string) => {
    setError(null);
    try {
      await window.desktop.downloads.showInFolder(id);
    } catch (e) {
      setError(formatErrorMessage(e));
    }
  }, [formatErrorMessage]);

  const openDownloadedFile = useCallback(async (id: string) => {
    setError(null);
    try {
      await window.desktop.downloads.open(id);
    } catch (e) {
      setError(formatErrorMessage(e));
    }
  }, [formatErrorMessage]);

  const cancelDownloadToast = useCallback(async (id: string) => {
    setError(null);
    try {
      await window.desktop.downloads.cancel(id);
    } catch (e) {
      setError(formatErrorMessage(e));
    }
  }, [formatErrorMessage]);

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
      setError(formatErrorMessage(e));
    }
  }, [formatErrorMessage]);

  const checkForUpdates = useCallback(async () => {
    setError(null);
    setUpdaterRunning(true);
    try {
      const next = await window.desktop.updater.check();
      setUpdaterStatus(next);
    } catch (e) {
      const message = formatErrorMessage(e);
      setError(message);
      pushUiToast("error", message);
    } finally {
      setUpdaterRunning(false);
    }
  }, [formatErrorMessage, pushUiToast]);

  const downloadAppUpdate = useCallback(async () => {
    setError(null);
    setUpdaterRunning(true);
    try {
      const next = await window.desktop.updater.download();
      setUpdaterStatus(next);
    } catch (e) {
      const message = formatErrorMessage(e);
      setError(message);
      pushUiToast("error", message);
    } finally {
      setUpdaterRunning(false);
    }
  }, [formatErrorMessage, pushUiToast]);

  const installUpdate = useCallback(async () => {
    setError(null);
    setUpdaterRunning(true);
    try {
      await window.desktop.updater.quitAndInstall();
    } catch (e) {
      const message = formatErrorMessage(e);
      setError(message);
      pushUiToast("error", message);
    } finally {
      setUpdaterRunning(false);
    }
  }, [formatErrorMessage, pushUiToast]);

  const runImport = useCallback(async () => {
    setImportProxyInlineError(null);
    setImportUaInlineError(null);

    const proxyError = validateProxyDraft(importProxyMode, importProxyRules);
    if (proxyError) {
      setImportProxyInlineError(humanizeErrorMessage(proxyError, t));
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
      if (result.creditsByAccountId || result.creditsErrorsByAccountId) {
        setAccountInfoById((prev) => {
          const next = { ...prev };
          for (const [accountId, info] of Object.entries(result.creditsByAccountId ?? {})) {
            const current = next[accountId] ?? DEFAULT_ACCOUNT_INFO;
            const remaining = Math.round(info.remainingCredits);
            const total = Math.round(info.totalCredits);
            next[accountId] = {
              ...current,
              status: "ready",
              subscription: info.subscriptionType,
              subscriptionExpiresAt: info.subscriptionExpiresAt,
              credits: `${remaining}/${total}`,
              updatedAt: info.fetchedAt,
              error: null,
            };
          }
          for (const [accountId, error] of Object.entries(result.creditsErrorsByAccountId ?? {})) {
            const current = next[accountId] ?? DEFAULT_ACCOUNT_INFO;
            next[accountId] = {
              ...current,
              status: "unavailable",
              error,
              updatedAt: Date.now(),
            };
          }
          return next;
        });
      }
      const summary = format(t("importResultChip"), { ok: result.imported, fail: result.failed });
      pushUiToast(result.failed > 0 ? "error" : "success", summary);
    } catch (e) {
      const message = formatErrorMessage(e);
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
    formatErrorMessage,
    pushUiToast,
    refreshAccounts,
    t,
  ]);

	  const runExport = useCallback(async () => {
	    const missingTabs = selected.filter((id) => !openTabIds.includes(id) && !sealedAccountIds.has(id));
	    if (missingTabs.length > 0) {
	      const message = format(t("exportRequiresOpenTab"), { count: missingTabs.length });
	      setError(message);
	      pushUiToast("error", message);
	      return;
	    }
	    setError(null);
	    setBusy(true);
	    try {
	      const text = await window.desktop.accounts.exportRefreshTokens(selected);
	      setExportCopied(false);
	      setExportDialog({ open: true, tokenText: text, selectedCount: selected.length, mode: "standard" });
	    } catch (e) {
	      setError(formatErrorMessage(e));
	    } finally {
	      setBusy(false);
	    }
	  }, [formatErrorMessage, openTabIds, pushUiToast, sealedAccountIds, selected, t]);

	  const copyExportTokens = useCallback(async () => {
	    if (!exportDialog.open) return;
	    try {
	      await window.desktop.clipboard.writeText(exportDialog.tokenText);
	      setExportCopied(true);
	      pushUiToast("success", t("toastCopiedToClipboard"));
	    } catch (e) {
	      const message = formatErrorMessage(e);
	      setError(message);
	      pushUiToast("error", message);
	    }
	  }, [exportDialog, formatErrorMessage, pushUiToast, t]);

	  const requestCloseExportDialog = useCallback(() => {
	    if (!exportDialog.open) {
	      setExportDialog({ open: false });
	      setExportCopied(false);
	      return;
	    }
	    if (exportDialog.mode === "migration" && !exportCopied) {
	      const ok = window.confirm(t("exportMigrationCloseConfirm"));
	      if (!ok) return;
	    }
	    setExportDialog({ open: false });
	    setExportCopied(false);
	  }, [exportCopied, exportDialog, t]);

	  const runMigrationExport = useCallback(async () => {
	    if (selected.some((id) => sealedAccountIds.has(id))) {
	      const message = t("errorMigrationExportSealed");
	      setError(message);
	      pushUiToast("error", message);
	      return;
	    }
	    const missingTabs = selected.filter((id) => !openTabIds.includes(id));
	    if (missingTabs.length > 0) {
	      const message = format(t("exportRequiresOpenTab"), { count: missingTabs.length });
	      setError(message);
      pushUiToast("error", message);
      return;
    }
    setError(null);
	    setBusy(true);
	    try {
	      const text = await window.desktop.accounts.exportMigrationRefreshTokens(selected);
	      setExportCopied(false);
	      setExportDialog({ open: true, tokenText: text, selectedCount: selected.length, mode: "migration" });
	      try {
	        await window.desktop.clipboard.writeText(text);
	        setExportCopied(true);
	        pushUiToast("success", t("toastCopiedToClipboard"));
	      } catch {
	        // ignore
	      }
	      await refreshAccounts();
	    } catch (e) {
	      const message = formatErrorMessage(e);
	      setError(message);
      pushUiToast("error", message);
	    } finally {
	      setBusy(false);
	    }
	  }, [formatErrorMessage, openTabIds, pushUiToast, refreshAccounts, sealedAccountIds, selected, t]);

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
      const message = formatErrorMessage(e);
      setError(message);
      pushUiToast("error", message);
    } finally {
      setBusy(false);
    }
  }, [activeTabId, deleteDialog, formatErrorMessage, openTabIds, pushUiToast, t]);

  const saveProxy = useCallback(async () => {
    if (!focusedAccountId) return;
    setProxyInlineError(null);
    const proxyError = validateProxyDraft(proxyMode, proxyRules);
    if (proxyError) {
      setProxyInlineError(humanizeErrorMessage(proxyError, t));
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
      const message = formatErrorMessage(e);
      setError(message);
      pushUiToast("error", message);
    } finally {
      setBusy(false);
    }
  }, [focusedAccountId, formatErrorMessage, proxyMode, proxyRules, pushUiToast, refreshAccounts, t]);

  const saveDisplayName = useCallback(async () => {
    if (!focusedAccountId) return;
    const nextName = displayNameDraft.trim();
    if (!nextName) {
      setDisplayNameInlineError(t("displayNameErrorRequired"));
      return;
    }
    setDisplayNameInlineError(null);
    setError(null);
    setBusy(true);
    try {
      const updated = await window.desktop.accounts.updateAccountMeta(focusedAccountId, {
        displayName: nextName,
      });
      setAccounts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      pushUiToast("success", t("toastDisplayNameSaved"));
    } catch (e) {
      const message = formatErrorMessage(e);
      setDisplayNameInlineError(message);
      pushUiToast("error", message);
    } finally {
      setBusy(false);
    }
  }, [displayNameDraft, focusedAccountId, formatErrorMessage, pushUiToast, t]);

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
      const message = formatErrorMessage(e);
      setError(message);
      pushUiToast("error", message);
    } finally {
      setBusy(false);
    }
  }, [focusedAccountId, formatErrorMessage, pushUiToast, refreshAccounts, t, tagsDraft]);

  const togglePinnedForAccount = useCallback(
    async (accountId: string, nextPinned: boolean) => {
      setError(null);
      setBusy(true);
      try {
        const updated = await window.desktop.accounts.updateAccountMeta(accountId, { pinned: nextPinned });
        setAccounts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      } catch (e) {
        const message = formatErrorMessage(e);
        setError(message);
        pushUiToast("error", message);
      } finally {
        setBusy(false);
      }
    },
    [formatErrorMessage, pushUiToast]
  );

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
      const message = formatErrorMessage(e);
      setUaInlineError(message);
      pushUiToast("error", message);
    } finally {
      setBusy(false);
    }
  }, [focusedAccountId, formatErrorMessage, pushUiToast, refreshAccounts, t, uaMode, uaValue]);

  const syncCreditsFromOpenTabForAccount = useCallback(async (accountId: string) => {
    try {
      const info = await window.desktop.accounts.syncCreditsFromOpenTab(accountId);
      if (!info) {
        const fallback = t("errorCreditsSyncUnavailable");
        setAccountInfoById((prev) => {
          const current = prev[accountId] ?? DEFAULT_ACCOUNT_INFO;
          if (current.status === "unavailable" && current.error === fallback) return prev;
          return {
            ...prev,
            [accountId]: {
              ...current,
              status: "unavailable",
              error: fallback,
              updatedAt: Date.now(),
            },
          };
        });
        return false;
      }

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

      return true;
    } catch (e) {
      const message = formatErrorMessage(e);
      setAccountInfoById((prev) => {
        const current = prev[accountId] ?? DEFAULT_ACCOUNT_INFO;
        if (current.status === "unavailable" && current.error === message) return prev;
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
      return false;
    }
  }, [formatErrorMessage, t]);

  const clearCreditsSyncTimers = useCallback((accountId: string) => {
    const handles = creditSyncTimersRef.current.get(accountId);
    if (!handles) return;
    for (const handle of handles) window.clearTimeout(handle);
    creditSyncTimersRef.current.delete(accountId);
  }, []);

  const scheduleCreditsSyncFromOpenTab = useCallback(
    (accountId: string) => {
      const normalized = accountId.trim();
      if (!normalized) return;
      clearCreditsSyncTimers(normalized);

      const delaysMs = [0, 1500, 4500, 9000, 30_000];
      const handles = delaysMs.map((delayMs, index) =>
        window.setTimeout(() => {
          void (async () => {
            const ok = await syncCreditsFromOpenTabForAccount(normalized);
            if (ok) {
              clearCreditsSyncTimers(normalized);
              return;
            }
            if (index === delaysMs.length - 1) creditSyncTimersRef.current.delete(normalized);
          })();
        }, delayMs)
      );

      creditSyncTimersRef.current.set(normalized, handles);
    },
    [clearCreditsSyncTimers, syncCreditsFromOpenTabForAccount]
  );

  const clearUiLog = useCallback(() => {
    setUiLog([]);
  }, []);

  const copyUiLog = useCallback(async () => {
    const text = uiLog
      .slice()
      .reverse()
      .map((entry) => {
        const time = formatUpdatedAt(entry.createdAt, uiPrefs.locale);
        return `[${time}] ${entry.kind.toUpperCase()} ${entry.message}`;
      })
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      pushUiToast("success", t("toastCopied"));
    } catch (e) {
      pushUiToast("error", formatErrorMessage(e));
    }
  }, [formatErrorMessage, pushUiToast, t, uiLog, uiPrefs.locale]);

  useEffect(() => {
    if (!activeTabId) return;
    scheduleCreditsSyncFromOpenTab(activeTabId);
    const interval = window.setInterval(() => {
      void syncCreditsFromOpenTabForAccount(activeTabId);
    }, 30_000);
    return () => {
      window.clearInterval(interval);
    };
  }, [activeTabId, scheduleCreditsSyncFromOpenTab, syncCreditsFromOpenTabForAccount]);

  useEffect(() => {
    if (openTabIds.length === 0) return;
    let index = 0;
    const interval = window.setInterval(() => {
      const ids = openTabIds;
      if (ids.length === 0) return;
      const target = ids[index % ids.length];
      index += 1;
      if (!target || target === activeTabId) return;
      void syncCreditsFromOpenTabForAccount(target);
    }, 20_000);
    return () => {
      window.clearInterval(interval);
    };
  }, [activeTabId, openTabIds, syncCreditsFromOpenTabForAccount]);

  useEffect(() => {
    if (!focusedAccountId || !inspectorOpen) return;
    const info = accountInfoById[focusedAccountId];
    if (info && info.status !== "idle") return;
    if (!openTabIds.includes(focusedAccountId)) return;
    scheduleCreditsSyncFromOpenTab(focusedAccountId);
  }, [accountInfoById, focusedAccountId, inspectorOpen, openTabIds, scheduleCreditsSyncFromOpenTab]);

  const runConnectivity = useCallback(async () => {
    if (!focusedAccountId) return;
    setProxyInlineError(null);
    const proxyError = validateProxyDraft(proxyMode, proxyRules);
    if (proxyError) {
      setProxyInlineError(humanizeErrorMessage(proxyError, t));
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
      setError(formatErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [focusedAccount, focusedAccountId, formatErrorMessage, proxyMode, proxyRules, t]);

	  const openTab = useCallback(
	    async (accountId: string): Promise<boolean> => {
	      const account = accounts.find((a) => a.id === accountId) ?? null;
	      if (account?.sealed) {
	        const message = t("errorAccountSealed");
	        setError(message);
	        pushUiToast("error", message);
	        return false;
	      }
	      setError(null);
	      setBusy(true);
	      try {
	        await pushViewportBounds();
	        await window.desktop.workspace.openTab(accountId);
        setOpenTabIds((prev) => (prev.includes(accountId) ? prev : [...prev, accountId]));
        setActiveTabId(accountId);
        recordAccountUsed(accountId);
        scheduleCreditsSyncFromOpenTab(accountId);
        pushUiToast("success", t("toastTabOpened"));
        return true;
      } catch (e) {
        const message = formatErrorMessage(e);
        setError(message);
        pushUiToast("error", message);
        return false;
      } finally {
        setBusy(false);
      }
	    },
	    [accounts, formatErrorMessage, pushUiToast, pushViewportBounds, recordAccountUsed, scheduleCreditsSyncFromOpenTab, t]
	  );

  const closeTab = useCallback(
    async (accountId: string) => {
      setError(null);
      setBusy(true);
      try {
        await window.desktop.workspace.closeTab(accountId);
        clearCreditsSyncTimers(accountId);
        setOpenTabIds((prev) => prev.filter((id) => id !== accountId));
        setActiveTabId((prev) => {
          if (prev !== accountId) return prev;
          const next = openTabIds.filter((id) => id !== accountId)[0] ?? null;
          if (next) void window.desktop.workspace.setActiveTab(next);
          return next;
        });
        pushUiToast("info", t("toastTabClosed"));
      } catch (e) {
        const message = formatErrorMessage(e);
        setError(message);
        pushUiToast("error", message);
      } finally {
        setBusy(false);
      }
    },
    [clearCreditsSyncTimers, formatErrorMessage, openTabIds, pushUiToast, t]
  );

  const activateTab = useCallback(async (accountId: string) => {
    setError(null);
    setBusy(true);
    try {
      await window.desktop.workspace.setActiveTab(accountId);
      setActiveTabId(accountId);
      recordAccountUsed(accountId);
      scheduleCreditsSyncFromOpenTab(accountId);
    } catch (e) {
      const message = formatErrorMessage(e);
      setError(message);
      pushUiToast("error", message);
    } finally {
      setBusy(false);
    }
  }, [formatErrorMessage, pushUiToast, recordAccountUsed, scheduleCreditsSyncFromOpenTab]);

  const reloadWorkspace = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      await window.desktop.workspace.reloadActive();
      pushUiToast("info", t("toastTabReloaded"));
    } catch (e) {
      const message = formatErrorMessage(e);
      setError(message);
      pushUiToast("error", message);
    } finally {
      setBusy(false);
    }
  }, [formatErrorMessage, pushUiToast, t]);

  const reloadTabForAccount = useCallback(
    async (accountId: string) => {
      setError(null);
      setBusy(true);
      try {
        await window.desktop.workspace.setActiveTab(accountId);
        setActiveTabId(accountId);
        recordAccountUsed(accountId);
        scheduleCreditsSyncFromOpenTab(accountId);
        await window.desktop.workspace.reloadActive();
        pushUiToast("info", t("toastTabReloaded"));
      } catch (e) {
        const message = formatErrorMessage(e);
        setError(message);
        pushUiToast("error", message);
      } finally {
        setBusy(false);
      }
    },
    [formatErrorMessage, pushUiToast, recordAccountUsed, scheduleCreditsSyncFromOpenTab, t]
  );

  const openLinkForAccount = useCallback(
    (accountId: string) => {
      const account = accounts.find((a) => a.id === accountId) ?? null;
      if (account?.sealed) {
        const message = t("errorAccountSealed");
        setError(message);
        pushUiToast("error", message);
        return;
      }
      setOpenLinkInlineError(null);
      setOpenLinkDialog({ open: true, accountId, url: "" });
    },
    [accounts, pushUiToast, t]
  );

  const confirmOpenLink = useCallback(async () => {
    if (!openLinkDialog.open) return;
    const accountId = openLinkDialog.accountId;
    const normalizedUrl = normalizeFlowithUrl(openLinkDialog.url);

    if (!normalizedUrl) {
      setOpenLinkInlineError(t("errorInvalidLink"));
      return;
    }

    const account = accounts.find((a) => a.id === accountId) ?? null;
    if (!account) {
      const message = t("errorAccountNotFound");
      setError(message);
      pushUiToast("error", message);
      return;
    }
    if (account.sealed) {
      const message = t("errorAccountSealed");
      setError(message);
      pushUiToast("error", message);
      return;
    }

    setError(null);
    setBusy(true);
    try {
      await pushViewportBounds();

      let ensuredOpen = openTabIds.includes(accountId);
      if (ensuredOpen) {
        try {
          await window.desktop.workspace.setActiveTab(accountId);
        } catch {
          ensuredOpen = false;
        }
      }

      if (!ensuredOpen) {
        await window.desktop.workspace.openTab(accountId);
        setOpenTabIds((prev) => (prev.includes(accountId) ? prev : [...prev, accountId]));
      }

      setActiveTabId(accountId);
      recordAccountUsed(accountId);
      scheduleCreditsSyncFromOpenTab(accountId);

      await window.desktop.workspace.navigate(accountId, normalizedUrl);
      setOpenLinkDialog({ open: false });
      pushUiToast("success", t("toastLinkOpened"));
    } catch (e) {
      const message = formatErrorMessage(e);
      setError(message);
      pushUiToast("error", message);
    } finally {
      setBusy(false);
    }
  }, [
    accounts,
    formatErrorMessage,
    openLinkDialog,
    openTabIds,
    pushUiToast,
    pushViewportBounds,
    recordAccountUsed,
    scheduleCreditsSyncFromOpenTab,
    t,
  ]);

  const runAuthDebug = useCallback(async () => {
    if (!focusedAccountId) return;
    setError(null);
    setBusy(true);
    try {
      const diag = await window.desktop.accounts.debugAuthSources(focusedAccountId);
      setAuthDebug(diag);
    } catch (e) {
      const message = formatErrorMessage(e);
      setError(message);
      pushUiToast("error", message);
    } finally {
      setBusy(false);
    }
  }, [focusedAccountId, formatErrorMessage, pushUiToast]);

	  const batchOpenTabs = useCallback(async () => {
	    const sealedCount = selected.filter((id) => sealedAccountIds.has(id)).length;
	    if (sealedCount > 0) {
	      pushUiToast("info", format(t("toastBatchOpenSkippedSealed"), { count: sealedCount }));
	    }
	    for (const id of selected) {
	      if (sealedAccountIds.has(id)) continue;
	      await openTab(id);
	    }
	  }, [openTab, pushUiToast, sealedAccountIds, selected, t]);

  const batchCloseTabs = useCallback(async () => {
    for (const id of selected) {
      await closeTab(id);
    }
  }, [closeTab, selected]);

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
      const message = formatErrorMessage(e);
      setError(message);
      pushUiToast("error", message);
    } finally {
      setBusy(false);
    }
  }, [batchTagsDialog, batchTagsDraft, formatErrorMessage, pushUiToast, refreshAccounts, t]);

  const openBatchProxyDialog = useCallback(() => {
    if (selected.length === 0) return;
    const first = accounts.find((a) => a.id === selected[0]);
    setBatchProxyMode(first?.net.proxy.mode ?? "system");
    setBatchProxyRules(first?.net.proxy.rules ?? "");
    setBatchProxyInlineError(null);
    setBatchProxyDialog({ open: true, accountIds: selected });
  }, [accounts, selected]);

  const runBatchProxy = useCallback(async () => {
    if (!batchProxyDialog.open) return;

    const proxyError = validateProxyDraft(batchProxyMode, batchProxyRules);
    if (proxyError) {
      setBatchProxyInlineError(humanizeErrorMessage(proxyError, t));
      return;
    }

    setError(null);
    setBusy(true);
    try {
      const proxy =
        batchProxyMode === "custom"
          ? { mode: "custom" as const, rules: batchProxyRules }
          : { mode: batchProxyMode };

      let ok = 0;
      let fail = 0;
      const updatedById = new Map<string, AccountSummary>();
      for (const accountId of batchProxyDialog.accountIds) {
        try {
          const updated = await window.desktop.accounts.updateAccountMeta(accountId, { net: { proxy } });
          updatedById.set(updated.id, updated);
          ok++;
        } catch {
          fail++;
        }
      }
      setAccounts((prev) => prev.map((a) => updatedById.get(a.id) ?? a));
      setBatchProxyDialog({ open: false });
      pushUiToast(
        fail > 0 ? "error" : "success",
        format(t("toastBatchProxyResult"), {
          ok,
          fail,
        })
      );
    } catch (e) {
      const message = formatErrorMessage(e);
      setError(message);
      pushUiToast("error", message);
    } finally {
      setBusy(false);
    }
  }, [batchProxyDialog, batchProxyMode, batchProxyRules, formatErrorMessage, pushUiToast, t]);

  const openBatchUserAgentDialog = useCallback(() => {
    if (selected.length === 0) return;
    const first = accounts.find((a) => a.id === selected[0]);
    setBatchUaMode(first?.ua.mode ?? "default");
    setBatchUaValue(first?.ua.value ?? "");
    setBatchUaInlineError(null);
    setBatchUserAgentDialog({ open: true, accountIds: selected });
  }, [accounts, selected]);

  const runBatchUserAgent = useCallback(async () => {
    if (!batchUserAgentDialog.open) return;
    setBatchUaInlineError(null);
    const trimmed = batchUaValue.trim();

    if (batchUaMode !== "default") {
      if (!trimmed) {
        setBatchUaInlineError(t("uaErrorRequired"));
        return;
      }
      if (trimmed.length > 512) {
        setBatchUaInlineError(t("uaErrorTooLong"));
        return;
      }
      if (/[\r\n]/.test(trimmed)) {
        setBatchUaInlineError(t("uaErrorSingleLine"));
        return;
      }
      if (batchUaMode === "preset" && !findUserAgentPreset(trimmed)) {
        setBatchUaInlineError(t("uaErrorPresetUnknown"));
        return;
      }
    }

    setError(null);
    setBusy(true);
    try {
      const ua =
        batchUaMode === "default"
          ? { mode: "default" as const }
          : { mode: batchUaMode, value: trimmed };

      let ok = 0;
      let fail = 0;
      const updatedById = new Map<string, AccountSummary>();
      for (const accountId of batchUserAgentDialog.accountIds) {
        try {
          const updated = await window.desktop.accounts.updateAccountMeta(accountId, { ua });
          updatedById.set(updated.id, updated);
          ok++;
        } catch {
          fail++;
        }
      }
      setAccounts((prev) => prev.map((a) => updatedById.get(a.id) ?? a));
      setBatchUserAgentDialog({ open: false });
      pushUiToast(
        fail > 0 ? "error" : "success",
        format(t("toastBatchUaResult"), {
          ok,
          fail,
        })
      );
    } catch (e) {
      const message = formatErrorMessage(e);
      setError(message);
      pushUiToast("error", message);
    } finally {
      setBusy(false);
    }
  }, [batchUaMode, batchUaValue, batchUserAgentDialog, formatErrorMessage, pushUiToast, t]);

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
      const message = formatErrorMessage(e);
      setError(message);
      pushUiToast("error", message);
    } finally {
      setBusy(false);
    }
  }, [batchDeleteDialog, formatErrorMessage, pushUiToast, refreshAccounts, t]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;

      const target = e.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (target.isContentEditable) return;
      }

      if (e.key === "Escape") {
        if (settingsPopoverOpen) setSettingsPopoverOpen(false);
        if (downloadsPopoverOpen) setDownloadsPopoverOpen(false);
        if (connectivityPopoverOpen) setConnectivityPopoverOpen(false);
        if (inspectorOpen && !settingsPopoverOpen && !downloadsPopoverOpen && !connectivityPopoverOpen) {
          setInspectorOpen(false);
        }
        return;
      }

      const ctrlOrMeta = e.ctrlKey || e.metaKey;
      if (!ctrlOrMeta) return;

      const key = e.key;

      if (key === "f" || key === "F") {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (key === "r" || key === "R") {
        e.preventDefault();
        void reloadWorkspace();
        return;
      }

      if (key === "w" || key === "W") {
        if (!activeTabId) return;
        e.preventDefault();
        void closeTab(activeTabId);
        return;
      }

      if (key === "t" || key === "T") {
        if (!focusedAccountId) return;
        e.preventDefault();
        if (openTabIds.includes(focusedAccountId)) void activateTab(focusedAccountId);
        else void openTab(focusedAccountId);
        return;
      }

      if (/^[1-9]$/.test(key)) {
        const index = Number(key) - 1;
        const accountId = openTabIds[index];
        if (!accountId) return;
        e.preventDefault();
        void activateTab(accountId);
      }
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [
    activeTabId,
    activateTab,
    closeTab,
    connectivityPopoverOpen,
    downloadsPopoverOpen,
    focusedAccountId,
    inspectorOpen,
    openTab,
    openTabIds,
    reloadWorkspace,
    settingsPopoverOpen,
  ]);

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
    const dlg = logDialogRef.current;
    if (!dlg) return;
    try {
      if (logDialogOpen) {
        if (!dlg.open) dlg.showModal();
      } else if (dlg.open) {
        dlg.close();
      }
    } catch {
      // ignore dialog show/close failures in non-standard runtimes
    }
  }, [logDialogOpen]);

  useEffect(() => {
    const dlg = downloadsDialogRef.current;
    if (!dlg) return;
    try {
      if (downloadsDialogOpen) {
        if (!dlg.open) dlg.showModal();
      } else if (dlg.open) {
        dlg.close();
      }
    } catch {
      // ignore dialog show/close failures in non-standard runtimes
    }
  }, [downloadsDialogOpen]);

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
    const dlg = openLinkDialogRef.current;
    if (!dlg) return;
    try {
      if (openLinkDialog.open) {
        if (!dlg.open) dlg.showModal();
      } else if (dlg.open) {
        dlg.close();
      }
    } catch {
      // ignore dialog show/close failures in non-standard runtimes
    }
  }, [openLinkDialog.open]);

  useEffect(() => {
    if (!openLinkDialog.open) return;
    setOpenLinkInlineError(null);
  }, [openLinkDialog.open]);

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
    const dlg = batchProxyDialogRef.current;
    if (!dlg) return;
    try {
      if (batchProxyDialog.open) {
        if (!dlg.open) dlg.showModal();
      } else if (dlg.open) {
        dlg.close();
      }
    } catch {
      // ignore dialog show/close failures in non-standard runtimes
    }
  }, [batchProxyDialog.open]);

  useEffect(() => {
    const dlg = batchUserAgentDialogRef.current;
    if (!dlg) return;
    try {
      if (batchUserAgentDialog.open) {
        if (!dlg.open) dlg.showModal();
      } else if (dlg.open) {
        dlg.close();
      }
    } catch {
      // ignore dialog show/close failures in non-standard runtimes
    }
  }, [batchUserAgentDialog.open]);

  useEffect(() => {
    if (!batchProxyDialog.open) return;
    setBatchProxyInlineError(null);
  }, [batchProxyDialog.open]);

  useEffect(() => {
    if (!batchUserAgentDialog.open) return;
    setBatchUaInlineError(null);
  }, [batchUserAgentDialog.open]);

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
  const downloadIndicatorNeedsAttention = latestDownloadToast?.state === "interrupted";
  const downloadIndicatorBadgeText =
    downloadToasts.length === 0
      ? null
      : downloadInProgressCount > 0
        ? downloadInProgressCount > 99
          ? "99+"
          : String(downloadInProgressCount)
        : downloadIndicatorNeedsAttention
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
		            src={resolvedTheme === "dark" ? logoOnDark : logoOnLight}
		            alt="Flowith"
		          />
          <div>
            <div className="brand-title">Flowith Web Account Manager</div>
            <div className="brand-subtitle">{t("subtitle")}</div>
          </div>
        </div>

	        <div className="topbar-group topbar-group-right" aria-label="Global actions">
	          <div className="topbar-actions">
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
            <button className="btn" onClick={runMigrationExport} disabled={busy || selected.length === 0}>
              {t("exportMigration")}
            </button>
            <button className="btn" onClick={refreshAccounts} disabled={busy}>
              {t("refresh")}
            </button>
          </div>
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
	                        downloadIndicatorNeedsAttention &&
	                        "download-indicator-badge-bad"
	                    )}
	                  >
	                    {downloadIndicatorBadgeText}
	                  </span>
	                ) : null}
	              </button>
	              {downloadsPopoverOpen ? (
	                <div className="popover popover-end downloads-popover" ref={downloadsPopoverRef}>
                    <div className="downloads-popover-header">
	                    <div className="popover-title">{t("downloadsSectionTitle")}</div>
                      {downloadToasts.length > 0 ? (
                        <button
                          className="btn btn-ghost downloads-viewall"
                          onClick={() => {
                            setDownloadsPopoverOpen(false);
                            setDownloadsDialogOpen(true);
                          }}
                          disabled={busy}
                        >
                          {t("downloadsViewAll")}
                        </button>
                      ) : null}
                    </div>
	                  <div className="downloads-popover-list">
	                    {downloadToasts.length === 0 ? (
	                      <div className="muted" style={{ fontSize: 12, padding: "6px 10px" }}>
	                        {t("downloadsEmpty")}
	                      </div>
	                    ) : null}
	                    {downloadToasts.slice(0, DOWNLOAD_POPOVER_LIMIT).map((d) => {
	                      const percent = d.totalBytes > 0 ? Math.min(1, d.receivedBytes / d.totalBytes) : null;
                        const progressText =
                          d.state === "progressing"
                            ? d.totalBytes > 0 && percent !== null
                              ? `${Math.round(percent * 100)}% · ${formatBytes(d.receivedBytes)} / ${formatBytes(d.totalBytes)}`
                              : formatBytes(d.receivedBytes)
                            : formatDownloadStateLabel(d.state, t);

                        const progressBg =
                          d.state === "progressing" && percent !== null
                            ? `linear-gradient(to right, rgba(59, 130, 246, 0.16) ${Math.round(percent * 100)}%, transparent ${Math.round(percent * 100)}%)`
                            : null;

                        const stateDotClass =
                          d.state === "completed"
                            ? "dot-ok"
                            : d.state === "progressing"
                              ? "dot-net"
                              : d.state === "cancelled"
                                ? "dot-idle"
                                : "dot-bad";

                      return (
                        <div
                          key={d.id}
                          className="download-item-compact"
                          style={progressBg ? { backgroundImage: progressBg } : undefined}
                          role={d.state === "completed" ? "button" : undefined}
                          tabIndex={d.state === "completed" ? 0 : undefined}
                          onClick={() => {
                            if (d.state !== "completed") return;
                            void openDownloadedFile(d.id);
                          }}
                          onKeyDown={(e) => {
                            if (d.state !== "completed") return;
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              void openDownloadedFile(d.id);
                            }
                          }}
                        >
                          <span className={clsx("dot", stateDotClass)} />
                          <div className="download-item-main">
                            <div className="download-item-title" title={d.filename}>
                              {d.filename}
                            </div>
                            <div className="download-item-sub muted">{progressText}</div>
                          </div>
	                          <div className="download-item-actions" onClick={(e) => e.stopPropagation()}>
	                            {d.state === "progressing" ? (
	                              <button
	                                className="btn btn-ghost btn-icon download-item-action"
	                                title={t("downloadCancelDownload")}
	                                aria-label={t("downloadCancelDownload")}
	                                onClick={() => cancelDownloadToast(d.id)}
	                                disabled={busy}
	                              >
	                                ×
	                              </button>
	                            ) : d.state === "completed" ? (
	                              <>
	                                <button
	                                  className="btn btn-ghost btn-icon download-item-action"
	                                  title={t("downloadShowInFolder")}
	                                  aria-label={t("downloadShowInFolder")}
	                                  onClick={() => void showDownloadInFolder(d.id)}
	                                  disabled={busy}
	                                >
	                                  📁
	                                </button>
	                                <button
	                                  className="btn btn-ghost btn-icon download-item-action"
	                                  title={t("downloadOpenFile")}
	                                  aria-label={t("downloadOpenFile")}
	                                  onClick={() => void openDownloadedFile(d.id)}
	                                  disabled={busy}
	                                >
	                                  ↗
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
	                      <option value="system">{t("themeSystem")}</option>
	                    </select>
	                  </div>
	                  <div className="setting-row">
	                    <div className="muted">{t("logPanel")}</div>
	                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
	                      <button className="btn" onClick={() => setLogDialogOpen(true)} disabled={busy}>
	                        {t("logPanel")}
	                      </button>
	                    </div>
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

	      {tokenEncryptionAvailable === false ? (
	        <div className="warning-banner" role="status">
	          <div className="warning-banner-title">{t("tokenEncryptionWarningTitle")}</div>
	          <div className="warning-banner-body">{t("tokenEncryptionWarningBody")}</div>
	        </div>
	      ) : null}

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
	                  <input
	                    ref={searchInputRef}
	                    className="input sidebar-search"
	                    type="text"
	                    placeholder={t("searchPlaceholder")}
	                    value={searchText}
	                    onChange={(e) => setSearchText(e.target.value)}
	                    disabled={busy}
	                  />
	                  <button
	                    className="btn btn-ghost btn-icon"
	                    title={viewMode === "cards" ? t("viewTable") : t("viewCards")}
	                    aria-label={viewMode === "cards" ? t("viewTable") : t("viewCards")}
	                    onClick={() =>
	                      updateUiPrefs({ accountListView: viewMode === "cards" ? "table" : "cards" })
	                    }
	                    disabled={busy}
	                  >
	                    {viewMode === "cards" ? "☰" : "▦"}
	                  </button>
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
	                </>
	              ) : null}
	            </div>
	          </div>

	          <div className="sidebar-subheader">
	            <label className="checkbox sidebar-select-all">
	              <input
	                ref={selectAllRef}
	                type="checkbox"
	                checked={allFilteredSelected}
	                onChange={toggleSelectAllFiltered}
	                disabled={busy || filteredAccounts.length === 0}
	              />
	              <span>{t("selectAll")}</span>
	            </label>

	            <select
	              className="sidebar-sort"
	              value={uiPrefs.accountSort}
	              onPointerDown={openSelectOverlay}
	              onBlur={closeSelectOverlay}
	              onKeyDown={(e) => {
	                if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") openSelectOverlay();
	              }}
	              onChange={(e) => {
	                closeSelectOverlay();
	                updateUiPrefs({ accountSort: e.target.value as AccountSortMode });
	              }}
	              aria-label={t("sortLabel")}
	              disabled={busy}
	            >
	              <option value="default">{t("sortDefault")}</option>
	              <option value="displayName">{t("sortDisplayName")}</option>
	              <option value="lastUsed">{t("sortLastUsed")}</option>
	              <option value="subscriptionExpiresAt">{t("sortSubscriptionExpiresAt")}</option>
	              <option value="creditsUpdatedAt">{t("sortCreditsUpdatedAt")}</option>
	            </select>

	            <div className="chip chip-compact sidebar-selected-chip" title={format(t("selectedCount"), { count: selected.length })}>
	              {format(t("selectedCountShort"), { count: selected.length })}
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
		                const credits = info.credits ? formatCreditsValue(info.credits) : "-";
		                const updatedAt = info.updatedAt ? formatUpdatedAt(info.updatedAt, uiPrefs.locale) : null;
	                  const updatedAge = info.updatedAt ? formatUpdatedAgeShort(info.updatedAt, uiPrefs.locale) : null;
		                const tabOpen = openTabIds.includes(a.id);
		                return (
		                  <div
		                    key={a.id}
		                    className={clsx("account", (selectedRow || focused) && "selected")}
                    role="button"
                    tabIndex={0}
                    onClick={() => focusAccount(a.id)}
                    onDoubleClick={(e) => {
                      if (e.target !== e.currentTarget) return;
                      void (tabOpen ? activateTab(a.id) : openTab(a.id));
                    }}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        focusAccount(a.id);
	                      }
	                    }}
	                  >
	                    <div className="account-header">
	                      <label className="checkbox" onClick={(e) => e.stopPropagation()}>
	                        <input
	                          type="checkbox"
	                          checked={selectedRow}
	                          onChange={() => toggleSelected(a.id)}
	                          disabled={busy}
	                        />
	                      </label>
	                      <div className="account-head-main">
		                        <div className="account-name-row">
		                          <div className="account-name" title={a.displayName}>
		                            {a.displayName}
		                          </div>
		                          {a.sealed ? (
		                            <span className="chip" title={t("sealedHint")}>
		                              <span className="dot dot-bad" />
		                              <span>{t("sealedBadge")}</span>
		                            </span>
		                          ) : null}
		                          {info.subscription ? (
		                            <span
		                              className="account-plan-badge"
		                              title={`${t("subscriptionLabel")}: ${info.subscription}`}
		                            >
	                              {info.subscription}
	                            </span>
	                          ) : null}
	                        </div>
	                      </div>
		                      <div className="account-header-actions" onClick={(e) => e.stopPropagation()}>
		                        <button
		                          className="btn btn-ghost btn-icon"
		                          title={a.sealed ? t("sealedHint") : (tabOpen ? t("activateTab") : t("openTab"))}
		                          onClick={() => void (tabOpen ? activateTab(a.id) : openTab(a.id))}
		                          disabled={busy || a.sealed}
		                        >
		                          ↗
		                        </button>
	                        <button
	                          className="btn btn-ghost btn-icon"
	                          title={a.pinned ? t("unpin") : t("pin")}
	                          onClick={() => void togglePinnedForAccount(a.id, !a.pinned)}
	                          disabled={busy}
	                        >
	                          {a.pinned ? "★" : "☆"}
	                        </button>
	                      </div>
	                    </div>

	                    <div className="account-footer">
	                      <div className="account-metrics">
	                        <div className="account-credits">
	                          <div className="account-credits-row">
	                            <div className="account-credits-label">{t("creditsLabel")}</div>
	                            <div
	                              className={clsx("account-credits-value", "mono", info.error && "is-bad")}
	                              title={`${t("creditsLabel")}: ${credits}${info.error ? `\n${info.error}` : ""}`}
	                            >
	                              {credits}
	                            </div>
	                          </div>
	                          {updatedAge && updatedAt ? (
	                            <div className="account-credits-meta muted mono" title={`${t("updatedAtLabel")}: ${updatedAt}`}>
	                              {updatedAge}
	                            </div>
	                          ) : (
	                            <div className="account-credits-meta muted mono">-</div>
	                          )}
	                        </div>

	                        <div className="account-badges">
	                          <span
	                            className={clsx("account-badge", tabOpen && "is-active")}
	                            title={tabOpen ? t("tabOpenTitle") : t("tabClosedTitle")}
	                          >
	                            <span className={clsx("dot", tabOpen ? "dot-ok" : "dot-idle")} />
	                            <span>{t("tabChip")}</span>
	                          </span>
	                          <span className="account-badge" title={`${t("proxyMode")}: ${formatProxyModeLabel(a.net.proxy.mode, t)}`}>
	                            <span className="dot dot-net" />
	                            <span>{formatProxyModeShort(a.net.proxy.mode)}</span>
	                          </span>
	                          <span className="account-badge" title={`UA: ${formatUaModeLabel(a.ua.mode, t)}`}>
	                            <span>UA</span>
	                            <span className="mono">{formatUaModeShort(a.ua.mode)}</span>
	                          </span>
	                          {info.error ? (
	                            <span className="account-badge is-bad" title={info.error}>
	                              !
	                            </span>
	                          ) : null}
	                        </div>
	                      </div>
	                    </div>
	
	                    {info.error && viewMode !== "table" ? (
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
	                        {a.tags.length > 3 ? (
	                          <button
	                            type="button"
	                            className="tag-chip"
	                            title={a.tags.slice(3).join(", ")}
	                            onClick={(e) => e.stopPropagation()}
	                            disabled={busy}
	                            style={{ cursor: "default" }}
	                          >
	                            +{a.tags.length - 3}
	                          </button>
	                        ) : null}
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
	                      <div className="account-table-identity">
	                        <div className="account-table-name" title={a.displayName}>
	                          {a.displayName}
	                        </div>
	                        {a.tags.length > 0 ? (
	                          <div className="account-table-sub">
	                            <div className="account-table-tags">
	                              {a.tags.slice(0, 2).map((t) => (
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
	                        ) : null}
	                      </div>
	                      <div className="account-table-metrics">
	                        <div className="account-table-metrics-top">
	                          <span
	                            className={clsx("dot", openTabIds.includes(a.id) ? "dot-ok" : "dot-idle")}
	                            title={openTabIds.includes(a.id) ? t("tabOpenTitle") : t("tabClosedTitle")}
	                          />
	                          <span
	                            className={clsx("account-table-credits", "mono", info.error && "is-bad")}
	                            title={`${t("creditsLabel")}: ${credits}${info.error ? `\n${info.error}` : ""}`}
	                          >
	                            {credits}
	                          </span>
	                          {info.error ? (
	                            <span className="account-table-error" title={info.error}>
	                              !
	                            </span>
	                          ) : null}
	                        </div>
	                        <div className="account-table-metrics-bottom">
	                          <span
	                            className="account-table-badge"
	                            title={`${t("proxyMode")}: ${formatProxyModeLabel(a.net.proxy.mode, t)}`}
	                          >
	                            {formatProxyModeShort(a.net.proxy.mode)}
	                          </span>
		                          <span className="account-table-badge" title={`UA: ${formatUaModeLabel(a.ua.mode, t)}`}>
		                            UA:{formatUaModeShort(a.ua.mode)}
		                          </span>
		                          {a.sealed ? (
		                            <span className="account-table-badge" title={t("sealedHint")}>
		                              {t("sealedBadge")}
		                            </span>
		                          ) : null}
		                          {updatedAt && updatedAge ? (
		                            <span
		                              className="account-table-metric muted mono"
	                              title={`${t("updatedAtLabel")}: ${updatedAt}`}
	                            >
	                              {updatedAge}
	                            </span>
	                          ) : null}
	                        </div>
	                      </div>
		                      <div className="account-table-actions" onClick={(e) => e.stopPropagation()}>
		                        <button
		                          className="btn btn-ghost btn-icon"
		                          title={
		                            a.sealed ? t("sealedHint") : (openTabIds.includes(a.id) ? t("activateTab") : t("openTab"))
		                          }
		                          onClick={() => void (openTabIds.includes(a.id) ? activateTab(a.id) : openTab(a.id))}
		                          disabled={busy || a.sealed}
		                        >
		                          ↗
		                        </button>
	                        <button
	                          className="btn btn-ghost btn-icon"
	                          title={a.pinned ? t("unpin") : t("pin")}
	                          onClick={() => void togglePinnedForAccount(a.id, !a.pinned)}
	                          disabled={busy}
	                        >
	                          {a.pinned ? "★" : "☆"}
	                        </button>
	                        <button
	                          className="btn btn-ghost btn-icon"
	                          title={t("openDetails")}
	                          onClick={() => focusAccount(a.id)}
	                          disabled={busy}
	                        >
	                          →
	                        </button>
	                      </div>
	                    </div>
	                  </div>
	                );
	              })
            )}
          </div>

			          {selected.length > 0 ? (
			            <div className="batchbar">
				              <div className="batchbar-left">
				                {format(t("selectedCount"), { count: selected.length })}
				              </div>
				              <div className="batchbar-actions">
				                <button className="btn btn-primary" onClick={batchOpenTabs} disabled={busy}>
				                  {t("openTab")}
				                </button>
				                <button className="btn" onClick={batchCloseTabs} disabled={busy}>
				                  {t("closeTab")}
				                </button>
				                <button className="btn" onClick={openBatchTagsDialog} disabled={busy}>
				                  {t("batchTags")}
				                </button>
				                <button className="btn" onClick={openBatchProxyDialog} disabled={busy}>
				                  {t("batchProxy")}
				                </button>
				                <button className="btn" onClick={openBatchUserAgentDialog} disabled={busy}>
				                  {t("batchUa")}
				                </button>
				                <button className="btn" onClick={runExport} disabled={busy}>
				                  {t("export")}
				                </button>
	                        <button
	                          className="btn"
	                          onClick={runMigrationExport}
	                          disabled={busy || selected.some((id) => sealedAccountIds.has(id))}
	                        >
	                          {t("exportMigration")}
	                        </button>
			                <button
	                      className="btn btn-danger"
	                      onClick={openBatchDeleteDialog}
	                      disabled={busy}
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
                  className={clsx("workspace-snapshot", snapshotVisible && "is-visible")}
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
              <div className="inspector-header-text">
                <div className="inspector-title">{focusedAccount ? focusedAccount.displayName : t("inspectorTitle")}</div>
                {focusedAccount ? (
                  <div className="inspector-subtitle muted">
                    {t("creditsLabel")}:{" "}
                    <span className="mono">
                      {focusedAccountInfo.credits ? formatCreditsValue(focusedAccountInfo.credits) : "-"}
                    </span>{" "}
                    · {focusedAccountId && openTabIds.includes(focusedAccountId) ? t("tabOpenTitle") : t("tabClosedTitle")}
                  </div>
                ) : null}
              </div>
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
		                  <div className="inspector-group">
		                    <div className="inspector-group-title">{t("accountInfoTitle")}</div>
		                    <div className="inspector-overview">
		                      <div className="overview-card glass">
		                        <div className="overview-label">{t("creditsLabel")}</div>
		                        <div className={clsx("overview-value", "mono", focusedAccountInfo.error && "is-bad")}>
		                          {focusedAccountInfo.credits ? formatCreditsValue(focusedAccountInfo.credits) : "-"}
		                        </div>
		                        <div className="overview-meta muted">
		                          {focusedAccountId && openTabIds.includes(focusedAccountId)
		                            ? t("creditsSyncHintOpenTab")
		                            : t("creditsSyncHintClosedTab")}
		                          {focusedAccountInfo.updatedAt ? (
		                            <>
		                              {" "}
		                              · {formatUpdatedAt(focusedAccountInfo.updatedAt, uiPrefs.locale)}
		                            </>
		                          ) : null}
		                        </div>
		                      </div>
		                      <div className="overview-card glass">
		                        <div className="overview-label">{t("subscriptionLabel")}</div>
		                        <div className="overview-value mono">{focusedAccountInfo.subscription ?? "-"}</div>
		                        <div className="overview-meta muted">
		                          {t("subscriptionExpiresAtLabel")}:{" "}
		                          <span className="mono">
		                            {focusedAccountInfo.subscriptionExpiresAt
		                              ? formatDate(focusedAccountInfo.subscriptionExpiresAt, uiPrefs.locale)
		                              : "-"}
		                          </span>
		                        </div>
		                      </div>
		                    </div>
		                    {focusedAccountInfo.error ? (
		                      <div className="muted" style={{ marginTop: 6, fontSize: 11, whiteSpace: "pre-wrap" }}>
		                        {focusedAccountInfo.error}
		                      </div>
		                    ) : null}
		                  </div>

		                  <div className="inspector-group">
		                    <div className="inspector-group-title">{t("identitySectionTitle")}</div>
		                    <div className="field">
		                      <div className="field-label">{t("displayNameLabel")}</div>
		                      <div className="field-value" style={{ display: "grid", gap: 6 }}>
		                        <input
		                          className="input"
		                          type="text"
		                          value={displayNameDraft}
		                          onChange={(e) => {
		                            setDisplayNameInlineError(null);
		                            setDisplayNameDraft(e.target.value);
		                          }}
		                          disabled={busy}
		                        />
		                        {displayNameInlineError ? (
		                          <div className="inline-error">{displayNameInlineError}</div>
		                        ) : null}
		                      </div>
		                    </div>
		                    <div className="field" style={{ marginBottom: 0 }}>
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
		                      </div>
		                    </div>
		                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
		                      <button className="btn" onClick={saveDisplayName} disabled={busy || !focusedAccountId}>
		                        {t("saveDisplayName")}
		                      </button>
		                      <button className="btn" onClick={saveTags} disabled={busy || !focusedAccountId}>
		                        {t("saveTags")}
		                      </button>
		                    </div>
		                  </div>

		                  <div className="inspector-group">
		                    <div className="inspector-group-title">{t("networkSectionTitle")}</div>
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
		                  </div>

		                  <div className="inspector-group">
		                    <div className="inspector-group-title">{t("uaSectionTitle")}</div>
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
                            setUaValue(preset?.id ?? USER_AGENT_PRESETS_VISIBLE[0]?.id ?? "");
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
                            {USER_AGENT_PRESETS_VISIBLE.map((preset) => (
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
		                  <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
		                    <button className="btn" onClick={saveUserAgent} disabled={busy || !focusedAccountId}>
		                      {t("saveUa")}
		                    </button>
		                  </div>
		                </div>

			                <details className="inspector-details">
			                  <summary>{t("advancedTechnicalIds")}</summary>
			                  <div className="field">
			                    <div className="field-label">{t("accountIdLabel")}</div>
			                    <div className="field-value mono">{focusedAccount.id}</div>
			                  </div>
			                  <div className="field" style={{ marginBottom: 0 }}>
			                    <div className="field-label">{t("fingerprintLabel")}</div>
			                    <div className="field-value mono">{maskFingerprint(focusedAccount.fingerprint)}</div>
			                  </div>
                        <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <div className="muted" style={{ fontSize: 12, lineHeight: 1.35 }}>
                            {t("authDebugHint")}
                          </div>
                          <button
                            className="btn"
                            onClick={runAuthDebug}
                            disabled={busy || !focusedAccountId || !openTabIds.includes(focusedAccountId)}
                          >
                            {t("authDebug")}
                          </button>
                        </div>
                        {authDebug ? (
                          <pre
                            className="mono"
                            style={{
                              marginTop: 10,
                              padding: 10,
                              borderRadius: 12,
                              border: "1px solid rgba(148, 163, 184, 0.18)",
                              background: "rgba(15, 23, 42, 0.35)",
                              fontSize: 11,
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                              maxHeight: 240,
                              overflow: "auto",
                            }}
                          >
                            {JSON.stringify(authDebug, null, 2)}
                          </pre>
                        ) : null}
			                </details>
		                </>
		              )}
            </div>

            <div className="inspector-actions">
              <button
                className="btn btn-primary"
                onClick={() => {
                  if (!focusedAccountId) return;
                  if (openTabIds.includes(focusedAccountId)) void activateTab(focusedAccountId);
                  else void openTab(focusedAccountId);
                }}
                disabled={busy || !focusedAccountId}
              >
                {focusedAccountId && openTabIds.includes(focusedAccountId) ? t("activateTab") : t("openTab")}
              </button>
              <button
                className="btn"
                onClick={() => focusedAccountId && closeTab(focusedAccountId)}
                disabled={busy || !focusedAccountId || !openTabIds.includes(focusedAccountId)}
              >
                {t("closeTab")}
              </button>
              <button
                className="btn"
                onClick={() => focusedAccountId && reloadTabForAccount(focusedAccountId)}
                disabled={busy || !focusedAccountId || !openTabIds.includes(focusedAccountId)}
              >
                {t("reload")}
              </button>
              <button
                className="btn"
                onClick={() => focusedAccountId && openLinkForAccount(focusedAccountId)}
                disabled={busy || !focusedAccountId || Boolean(focusedAccount?.sealed)}
              >
                {t("openLink")}
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

            {importProgress && busy ? (
              <div
                className="chip"
                style={{ alignSelf: "flex-start" }}
                title={importProgress.currentFingerprint ? `line: ${importProgress.done}, fp: ${importProgress.currentFingerprint}` : undefined}
              >
                <span className="dot dot-net" />
                {format(t("importProgressChip"), {
                  done: importProgress.done,
                  total: importProgress.total,
                  ok: importProgress.imported,
                  fail: importProgress.failed,
                })}
              </div>
            ) : null}

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
                      setImportUaValue(preset?.id ?? USER_AGENT_PRESETS_VISIBLE[0]?.id ?? "");
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
                    {USER_AGENT_PRESETS_VISIBLE.map((preset) => (
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
	        ref={logDialogRef}
	        onCancel={(e) => {
	          e.preventDefault();
	          setLogDialogOpen(false);
	        }}
	        onClose={() => setLogDialogOpen(false)}
	        aria-label={t("logPanel")}
	      >
	        <div className="modal">
	          <div className="modal-header">
	            <div>
	              <div className="modal-title">{t("logPanel")}</div>
	              <div className="modal-note">{t("logDangerNote")}</div>
	            </div>
	            <button
	              className="btn btn-icon"
	              title={t("close")}
	              onClick={() => setLogDialogOpen(false)}
	              disabled={busy}
	            >
	              ×
	            </button>
	          </div>

	          <div className="modal-grid">
	            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
	              <button className="btn" onClick={copyUiLog} disabled={busy || uiLog.length === 0}>
	                {t("copyLog")}
	              </button>
	              <button className="btn btn-danger" onClick={clearUiLog} disabled={busy || uiLog.length === 0}>
	                {t("clearLog")}
	              </button>
	            </div>
	            <div style={{ display: "grid", gap: 8 }}>
	              {uiLog.length === 0 ? (
	                <div className="muted" style={{ fontSize: 12 }}>
	                  {t("logEmpty")}
	                </div>
	              ) : (
	                uiLog.map((entry, index) => (
	                  <div key={`${entry.createdAt}-${index}`} className="chip" style={{ whiteSpace: "pre-wrap" }}>
	                    <span
	                      className={clsx(
	                        "dot",
	                        entry.kind === "error" && "dot-bad",
	                        entry.kind === "success" && "dot-ok",
	                        entry.kind === "info" && "dot-net"
	                      )}
	                    />
	                    <span className="mono" style={{ fontSize: 11 }}>
	                      {formatUpdatedAt(entry.createdAt, uiPrefs.locale)}
	                    </span>
	                    <span style={{ fontSize: 12 }}>{entry.message}</span>
	                  </div>
	                ))
	              )}
	            </div>
	          </div>

	          <div className="modal-actions">
	            <button className="btn btn-primary" onClick={() => setLogDialogOpen(false)} disabled={busy}>
	              {t("close")}
	            </button>
	          </div>
	        </div>
	      </dialog>

        <dialog
          ref={downloadsDialogRef}
          className="dialog-wide"
          onCancel={(e) => {
            e.preventDefault();
            setDownloadsDialogOpen(false);
          }}
          onClose={() => setDownloadsDialogOpen(false)}
          aria-label={t("downloadsHistoryTitle")}
        >
          {downloadsDialogOpen ? (
            <div className="modal">
              <div className="modal-header">
                <div>
                  <div className="modal-title">{t("downloadsHistoryTitle")}</div>
                  <div className="modal-note">{format(t("downloadsHistoryCount"), { count: downloadToasts.length })}</div>
                </div>
                <button
                  className="btn btn-icon"
                  title={t("close")}
                  onClick={() => setDownloadsDialogOpen(false)}
                  disabled={busy}
                >
                  ×
                </button>
              </div>

              <div className="modal-grid">
                <div className="download-history-list">
                  {downloadToasts.length === 0 ? (
                    <div className="muted" style={{ fontSize: 12 }}>
                      {t("downloadsEmpty")}
                    </div>
                  ) : (
                    downloadToasts.map((d) => {
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

                      const sizeBytes = Math.max(d.totalBytes, d.receivedBytes);
                      const sizeText = sizeBytes > 0 ? formatBytes(sizeBytes) : "-";
                      const timeText = formatUpdatedAt(d.updatedAt, uiPrefs.locale);

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
                              disabled={busy}
                            >
                              ×
                            </button>
                          </div>

                          <div className="download-toast-meta muted">
                            <div style={{ display: "flex", gap: 10, minWidth: 0, flexWrap: "wrap" }}>
                              <span>{progressText}</span>
                              <span className="mono">{sizeText}</span>
                              <span className="mono">{timeText}</span>
                              {d.copiedAt ? <span className="chip download-chip">{t("downloadCopied")}</span> : null}
                            </div>
                          </div>

                          <div className="download-progress">
                            <div className={barClass} style={{ width: barWidth }} />
                          </div>

                          <div className="download-actions">
                            {d.state === "progressing" ? (
                              <button className="btn" onClick={() => cancelDownloadToast(d.id)} disabled={busy}>
                                {t("downloadCancelDownload")}
                              </button>
                            ) : d.state === "completed" ? (
                              <>
                                <button className="btn" onClick={() => showDownloadInFolder(d.id)} disabled={busy}>
                                  {t("downloadShowInFolder")}
                                </button>
                                <button className="btn btn-primary" onClick={() => openDownloadedFile(d.id)} disabled={busy}>
                                  {t("downloadOpenFile")}
                                </button>
                                <button className="btn" onClick={() => copyDownloadPath(d.id)} disabled={busy}>
                                  {t("downloadCopyPath")}
                                </button>
                              </>
                            ) : null}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="modal-actions">
                <button className="btn btn-primary" onClick={() => setDownloadsDialogOpen(false)} disabled={busy}>
                  {t("close")}
                </button>
              </div>
            </div>
          ) : null}
        </dialog>

	      <dialog
		        ref={exportDialogRef}
		        onCancel={(e) => {
		          e.preventDefault();
	          requestCloseExportDialog();
	        }}
	        onClose={() => {
	          setExportDialog({ open: false });
	          setExportCopied(false);
	        }}
	        aria-label={exportDialog.open && exportDialog.mode === "migration" ? t("exportMigrationDialogTitle") : t("exportDialogTitle")}
	      >
	        {exportDialog.open ? (
	          <div className="modal">
            <div className="modal-header">
              <div>
                <div className="modal-title">
                  {exportDialog.mode === "migration" ? t("exportMigrationDialogTitle") : t("exportDialogTitle")}
                </div>
                <div className="modal-note">
                  {exportDialog.mode === "migration" ? t("exportMigrationDialogNote") : t("exportDialogNote")}
                </div>
              </div>
	              <button
	                className="btn btn-icon"
	                title={t("close")}
	                onClick={requestCloseExportDialog}
	                disabled={busy}
	              >
	                ×
	              </button>
            </div>

            <div className="danger-note">
              {exportDialog.mode === "migration"
                ? tokenEncryptionAvailable === false
                  ? t("exportMigrationDangerNoVault")
                  : t("exportMigrationDanger")
                : t("exportDanger")}
            </div>

            <div className="modal-grid">
              <textarea className="mono" readOnly value={exportDialog.tokenText} />
              <div className="muted" style={{ fontSize: 12 }}>
                {format(t("exportHint"), { count: exportDialog.selectedCount })}
              </div>
            </div>

	            <div className="modal-actions">
	              <button className="btn" onClick={() => void copyExportTokens()} disabled={busy || !exportDialog.tokenText.trim()}>
	                {t("copyToClipboard")}
	              </button>
	              <button className="btn btn-primary" onClick={requestCloseExportDialog} disabled={busy}>
	                {t("done")}
	              </button>
	            </div>
	          </div>
	        ) : null}
	      </dialog>

        <dialog
          ref={openLinkDialogRef}
          onCancel={(e) => {
            e.preventDefault();
            setOpenLinkDialog({ open: false });
            setOpenLinkInlineError(null);
          }}
          onClose={() => {
            setOpenLinkDialog({ open: false });
            setOpenLinkInlineError(null);
          }}
          aria-label={t("openLinkTitle")}
        >
          {openLinkDialog.open ? (
            <div className="modal">
              <div className="modal-header">
                <div>
                  <div className="modal-title">{t("openLinkTitle")}</div>
                  <div className="modal-note">{t("openLinkNote")}</div>
                </div>
                <button
                  className="btn btn-icon"
                  title={t("close")}
                  onClick={() => {
                    setOpenLinkDialog({ open: false });
                    setOpenLinkInlineError(null);
                  }}
                  disabled={busy}
                >
                  ×
                </button>
              </div>

              <div className="modal-grid">
                <input
                  className="input mono"
                  value={openLinkDialog.url}
                  onChange={(e) => {
                    setOpenLinkInlineError(null);
                    setOpenLinkDialog((prev) => (prev.open ? { ...prev, url: e.target.value } : prev));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void confirmOpenLink();
                    }
                  }}
                  placeholder={t("openLinkPlaceholder")}
                  disabled={busy}
                />
                {openLinkInlineError ? (
                  <div
                    className="muted"
                    style={{ marginTop: 8, fontSize: 11, color: "rgba(248, 113, 113, 1)", whiteSpace: "pre-wrap" }}
                  >
                    {openLinkInlineError}
                  </div>
                ) : null}
              </div>

              <div className="modal-actions">
                <button
                  className="btn"
                  onClick={() => {
                    setOpenLinkDialog({ open: false });
                    setOpenLinkInlineError(null);
                  }}
                  disabled={busy}
                >
                  {t("cancel")}
                </button>
                <button
                  className="btn btn-primary"
                  onClick={() => void confirmOpenLink()}
                  disabled={busy || !openLinkDialog.url.trim()}
                >
                  {t("openLink")}
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
	        ref={batchProxyDialogRef}
	        onCancel={(e) => {
	          e.preventDefault();
	          setBatchProxyDialog({ open: false });
	          setBatchProxyInlineError(null);
	        }}
	        onClose={() => setBatchProxyDialog({ open: false })}
	        aria-label={t("batchProxyTitle")}
	      >
	        {batchProxyDialog.open ? (
	          <div className="modal">
	            <div className="modal-header">
	              <div>
	                <div className="modal-title">{t("batchProxyTitle")}</div>
	                <div className="modal-note">
	                  {format(t("batchProxyNote"), { count: batchProxyDialog.accountIds.length })}
	                </div>
	              </div>
	              <button
	                className="btn btn-icon"
	                title={t("close")}
	                onClick={() => setBatchProxyDialog({ open: false })}
	                disabled={busy}
	              >
	                ×
	              </button>
	            </div>

	            <div className="modal-grid">
	              <div className="setting-grid">
	                <div className="setting-row">
	                  <div className="muted">{t("proxyMode")}</div>
	                  <select
	                    value={batchProxyMode}
	                    onPointerDown={openSelectOverlay}
	                    onBlur={closeSelectOverlay}
	                    onKeyDown={(e) => {
	                      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") openSelectOverlay();
	                    }}
	                    onChange={(e) => {
	                      closeSelectOverlay();
	                      setBatchProxyInlineError(null);
	                      setBatchProxyMode(e.target.value as ProxyMode);
	                    }}
	                    disabled={busy}
	                    aria-label={t("proxyMode")}
	                  >
	                    <option value="system">{t("proxySystem")}</option>
	                    <option value="custom">{t("proxyCustom")}</option>
	                    <option value="direct">{t("proxyDirect")}</option>
	                  </select>
	                </div>

	                {batchProxyMode === "custom" ? (
	                  <>
	                    {proxyPresets.length > 0 ? (
	                      <div className="setting-row">
	                        <div className="muted">{t("proxyPresetLabel")}</div>
	                        <select
	                          value={batchProxyRules.trim() && proxyPresets.includes(batchProxyRules.trim()) ? batchProxyRules.trim() : ""}
	                          onPointerDown={openSelectOverlay}
	                          onBlur={closeSelectOverlay}
	                          onKeyDown={(e) => {
	                            if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") openSelectOverlay();
	                          }}
	                          onChange={(e) => {
	                            closeSelectOverlay();
	                            setBatchProxyInlineError(null);
	                            const next = e.target.value;
	                            if (next) setBatchProxyRules(next);
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
	                        value={batchProxyRules}
	                        onChange={(e) => {
	                          setBatchProxyInlineError(null);
	                          setBatchProxyRules(e.target.value);
	                        }}
	                        disabled={busy}
	                      />
	                      {batchProxyInlineError ? (
	                        <div className="inline-error">{batchProxyInlineError}</div>
	                      ) : null}
	                    </div>
	                  </>
	                ) : null}
	              </div>
	            </div>

	            <div className="modal-actions">
	              <button className="btn" onClick={() => setBatchProxyDialog({ open: false })} disabled={busy}>
	                {t("cancel")}
	              </button>
	              <button className="btn btn-primary" onClick={runBatchProxy} disabled={busy}>
	                {t("confirmApply")}
	              </button>
	            </div>
	          </div>
	        ) : null}
	      </dialog>

	      <dialog
	        ref={batchUserAgentDialogRef}
	        onCancel={(e) => {
	          e.preventDefault();
	          setBatchUserAgentDialog({ open: false });
	          setBatchUaInlineError(null);
	        }}
	        onClose={() => setBatchUserAgentDialog({ open: false })}
	        aria-label={t("batchUaTitle")}
	      >
	        {batchUserAgentDialog.open ? (
	          <div className="modal">
	            <div className="modal-header">
	              <div>
	                <div className="modal-title">{t("batchUaTitle")}</div>
	                <div className="modal-note">
	                  {format(t("batchUaNote"), { count: batchUserAgentDialog.accountIds.length })}
	                </div>
	              </div>
	              <button
	                className="btn btn-icon"
	                title={t("close")}
	                onClick={() => setBatchUserAgentDialog({ open: false })}
	                disabled={busy}
	              >
	                ×
	              </button>
	            </div>

	            <div className="modal-grid">
	              <div className="setting-grid">
	                <div className="setting-row">
	                  <div className="muted">{t("uaModeLabel")}</div>
	                  <select
	                    value={batchUaMode}
	                    onPointerDown={openSelectOverlay}
	                    onBlur={closeSelectOverlay}
	                    onKeyDown={(e) => {
	                      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") openSelectOverlay();
	                    }}
	                    onChange={(e) => {
	                      closeSelectOverlay();
	                      setBatchUaInlineError(null);
	                      const nextMode = e.target.value as UaMode;
	                      if (nextMode === "preset") {
	                        const current = batchUaValue.trim();
	                        const preset = current ? findUserAgentPreset(current) : null;
	                        setBatchUaValue(preset?.id ?? USER_AGENT_PRESETS_VISIBLE[0]?.id ?? "");
	                      } else if (nextMode === "default") {
	                        setBatchUaValue("");
	                      } else if (batchUaMode === "preset") {
	                        const preset = findUserAgentPreset(batchUaValue);
	                        if (preset) setBatchUaValue(preset.value);
	                      }
	                      setBatchUaMode(nextMode);
	                    }}
	                    disabled={busy}
	                    aria-label={t("uaModeLabel")}
	                  >
	                    <option value="default">{t("uaDefault")}</option>
	                    <option value="preset">{t("uaPreset")}</option>
	                    <option value="custom">{t("uaCustom")}</option>
	                  </select>
	                </div>

	                {batchUaMode === "preset" ? (
	                  <div className="setting-row">
	                    <div className="muted">{t("uaValueLabel")}</div>
	                    <select
	                      value={batchUaValue}
	                      onPointerDown={openSelectOverlay}
	                      onBlur={closeSelectOverlay}
	                      onKeyDown={(e) => {
	                        if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") openSelectOverlay();
	                      }}
	                      onChange={(e) => {
	                        closeSelectOverlay();
	                        setBatchUaInlineError(null);
	                        setBatchUaValue(e.target.value);
	                      }}
	                      disabled={busy}
	                      aria-label={t("uaValueLabel")}
	                    >
	                      {USER_AGENT_PRESETS_VISIBLE.map((p) => (
	                        <option key={p.id} value={p.id}>
	                          {p.label}
	                        </option>
	                      ))}
	                    </select>
	                  </div>
	                ) : null}

	                {batchUaMode === "custom" ? (
	                  <div className="setting-row">
	                    <div className="muted">{t("uaValueLabel")}</div>
	                    <input
	                      className="input mono"
	                      type="text"
	                      value={batchUaValue}
	                      onChange={(e) => {
	                        setBatchUaInlineError(null);
	                        setBatchUaValue(e.target.value);
	                      }}
	                      disabled={busy}
	                      aria-label={t("uaValueLabel")}
	                    />
	                  </div>
	                ) : null}

	                {batchUaInlineError ? <div className="inline-error">{batchUaInlineError}</div> : null}
	              </div>
	            </div>

	            <div className="modal-actions">
	              <button className="btn" onClick={() => setBatchUserAgentDialog({ open: false })} disabled={busy}>
	                {t("cancel")}
	              </button>
	              <button className="btn btn-primary" onClick={runBatchUserAgent} disabled={busy}>
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
