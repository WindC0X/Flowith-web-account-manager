import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AccountSummary,
  ConnectivityCheck,
  ImportRefreshTokensResult,
  ProxyMode,
  UaMode,
} from "../../shared/ipc";

type ExportDialogState =
  | { open: false }
  | { open: true; tokenText: string; selectedCount: number };

function clsx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function maskFingerprint(fingerprint: string): string {
  if (!fingerprint) return "-";
  if (fingerprint.length <= 6) return fingerprint;
  return `${fingerprint.slice(0, 6)}…${fingerprint.slice(-4)}`;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === "string") return error.message;
  return String(error);
}

export default function WorkspaceShell() {
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusedAccountId, setFocusedAccountId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return window.localStorage.getItem("fwd_sidebar_collapsed") === "1";
  });

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

  const [openTabIds, setOpenTabIds] = useState<string[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const importDialogRef = useRef<HTMLDialogElement | null>(null);
  const exportDialogRef = useRef<HTMLDialogElement | null>(null);
  const connectivityPopoverRef = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(() => [...selectedIds], [selectedIds]);

  const focusedAccount = useMemo(() => {
    if (!focusedAccountId) return null;
    return accounts.find((a) => a.id === focusedAccountId) ?? null;
  }, [accounts, focusedAccountId]);

  useEffect(() => {
    if (!focusedAccount) return;
    setProxyMode(focusedAccount.net.proxy.mode);
    setProxyRules(focusedAccount.net.proxy.rules ?? "");
    setUaMode(focusedAccount.ua.mode);
    setUaValue(focusedAccount.ua.value ?? "");
  }, [focusedAccount]);

  useEffect(() => {
    window.localStorage.setItem("fwd_sidebar_collapsed", sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);

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
          <div className="brand-dot" />
          <div>
            <div className="brand-title">Flowith Web Account Manager</div>
            <div className="brand-subtitle">Desktop MVP · Workspace UI Shell</div>
          </div>
        </div>

        <button
          className="btn btn-ghost btn-icon"
          title="展开账号面板"
          aria-label="展开账号面板"
          style={{ display: sidebarCollapsed ? "inline-flex" : "none" }}
          onClick={() => setSidebarCollapsed(false)}
          disabled={busy}
        >
          ☰
        </button>

        <div className="divider" />

        <div className="topbar-group" aria-label="Proxy and connectivity">
          <select
            value={proxyMode}
            onChange={(e) => setProxyMode(e.target.value as ProxyMode)}
            disabled={busy || !focusedAccountId}
            aria-label="代理模式"
          >
            <option value="system">System</option>
            <option value="custom">Custom</option>
            <option value="direct">Direct</option>
          </select>

          <input
            className="input"
            type="text"
            placeholder="http://127.0.0.1:7890 或 socks5://127.0.0.1:7891"
            value={proxyRules}
            onChange={(e) => setProxyRules(e.target.value)}
            style={{ display: proxyMode === "custom" ? "inline-flex" : "none", width: 260 }}
            disabled={busy || !focusedAccountId}
          />

          <button className="btn" onClick={saveProxy} disabled={busy || !focusedAccountId}>
            保存代理
          </button>

          <div style={{ position: "relative" }}>
            <button className="btn" onClick={runConnectivity} disabled={busy || !focusedAccountId}>
              连通性测试
            </button>
            {connectivityPopoverOpen && connectivity ? (
              <div className="popover" ref={connectivityPopoverRef}>
                <div className="popover-title">Connectivity</div>
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
                        <div style={{ fontWeight: 750 }}>{c.ok ? "OK" : "FAIL"}</div>
                        <div className="muted" style={{ fontSize: 11 }}>
                          {c.latencyMs} ms{typeof c.status === "number" ? ` · HTTP ${c.status}` : ""}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="spacer" />

        <div className="topbar-group" aria-label="Global actions">
          <input
            className="input"
            type="text"
            placeholder="搜索：displayName / id / tag"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ width: 220 }}
            disabled={busy}
          />
          <button className="btn" onClick={() => setImportDialogOpen(true)} disabled={busy}>
            导入
          </button>
          <button className="btn" onClick={runExport} disabled={busy || selected.length === 0}>
            导出
          </button>
          <button
            className="btn btn-primary"
            onClick={batchOpenTabs}
            disabled={busy || selected.length === 0}
          >
            批量打开（Tab）
          </button>
          <button className="btn" onClick={refreshAccounts} disabled={busy}>
            刷新
          </button>
        </div>
      </header>

      {error ? (
        <div className="error-banner" role="status">
          <div className="error-banner-title">Error</div>
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
            <div className="sidebar-title">账号</div>
            <div className="sidebar-header-right">
              <button
                className="btn btn-ghost btn-icon"
                title={sidebarCollapsed ? "展开账号面板" : "折叠账号面板"}
                aria-label={sidebarCollapsed ? "展开账号面板" : "折叠账号面板"}
                onClick={() => setSidebarCollapsed((v) => !v)}
                disabled={busy}
              >
                {sidebarCollapsed ? "»" : "«"}
              </button>
              <button
                className="btn btn-ghost btn-icon"
                title="卡片视图"
                onClick={() => setViewMode("cards")}
                disabled={busy}
              >
                ▦
              </button>
              <button
                className="btn btn-ghost btn-icon"
                title="表格视图"
                onClick={() => setViewMode("table")}
                disabled={busy}
              >
                ☰
              </button>
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
              <span>全选</span>
            </label>
            <div className="muted">已选择 {selected.length} 个</div>
          </div>

          <div className={clsx("account-list", viewMode === "table" && "view-table")}>
            {filteredAccounts.length === 0 ? (
              <div className="muted" style={{ padding: 10, fontSize: 12 }}>
                {accounts.length === 0 ? "暂无账号。请先导入 refresh_token。" : "无匹配结果。"}
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
                      if (e.key === "Enter" || e.key === " ") focusAccount(a.id);
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
                      <div className="chip" title={`Proxy: ${a.net.proxy.mode}`}>
                        <span className="dot dot-net" />
                        <span>{a.net.proxy.mode}</span>
                      </div>
                    </div>

                    <div className="account-meta">
                      <span className="chip">UA: {a.ua.mode}</span>
                      {focused ? <span className="chip">Focused</span> : null}
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
                      <span className="mono">{a.net.proxy.mode}</span>
                      <span className="mono">{a.ua.mode}</span>
                      <button
                        className="btn btn-ghost btn-icon"
                        title="打开详情"
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
              <div className="batchbar-left">已选择 {selected.length} 个</div>
              <div className="batchbar-actions">
                <button className="btn btn-primary" onClick={batchOpenTabs} disabled={busy}>
                  打开 Tab
                </button>
                <button className="btn" onClick={batchCloseTabs} disabled={busy}>
                  关闭 Tab
                </button>
                <button className="btn" onClick={runExport} disabled={busy}>
                  导出
                </button>
              </div>
            </div>
          ) : null}
        </aside>

        <main className="workspace">
          <div className="tabs" role="tablist" aria-label="账号标签页">
            {openTabIds.length === 0 ? (
              <div className="tab active" role="tab" aria-selected="true">
                <span className="tab-title">No tabs</span>
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
                      if (e.key === "Enter" || e.key === " ") void activateTab(id);
                    }}
                  >
                    <span className="tab-title">{label}</span>
                    <button
                      className="tab-close"
                      title="关闭 Tab"
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
                <div className="content-title">Flowith Web 工作区</div>
                <div className="content-subtitle">
                  BrowserView 将覆盖此区域。折叠侧边栏 / 调整窗口尺寸不应遮挡顶栏与侧边栏控件。
                </div>
                <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {focusedAccountId ? (
                    <>
                      <button
                        className="btn btn-primary"
                        onClick={() => openTab(focusedAccountId)}
                        disabled={busy}
                      >
                        打开（Focused）
                      </button>
                      <button className="btn" onClick={() => closeTab(focusedAccountId)} disabled={busy}>
                        关闭（Focused）
                      </button>
                    </>
                  ) : (
                    <div className="muted" style={{ fontSize: 12 }}>
                      选择一个账号以打开/关闭 Tab。
                    </div>
                  )}
                  <button className="btn" onClick={reloadWorkspace} disabled={busy}>
                    Reload active
                  </button>
                </div>

                {importResult ? (
                  <div style={{ marginTop: 12 }}>
                    <div className="chip">
                      导入结果：成功 {importResult.imported} · 失败 {importResult.failed}
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
              <div className="inspector-title">账号详情</div>
              <button
                className="btn btn-icon"
                title="关闭"
                onClick={() => setInspectorOpen(false)}
                disabled={busy}
              >
                ×
              </button>
            </div>

            <div className="inspector-body">
              {!focusedAccount ? (
                <div className="muted" style={{ fontSize: 12 }}>
                  选择一个账号以查看详情。
                </div>
              ) : (
                <>
                  <div className="field">
                    <div className="field-label">Display name</div>
                    <div className="field-value">{focusedAccount.displayName}</div>
                  </div>
                  <div className="field">
                    <div className="field-label">Account id</div>
                    <div className="field-value mono">{focusedAccount.id}</div>
                  </div>
                  <div className="field">
                    <div className="field-label">Fingerprint</div>
                    <div className="field-value mono">{maskFingerprint(focusedAccount.fingerprint)}</div>
                  </div>
                  <div className="field">
                    <div className="field-label">Tags</div>
                    <div className="field-value">
                      {focusedAccount.tags.length ? focusedAccount.tags.join(", ") : <span className="muted">-</span>}
                    </div>
                  </div>

                  <div className="section-divider" />
                  <div className="section-title">User-Agent</div>
                  <div className="setting-grid">
                    <div className="setting-row">
                      <div className="muted">Mode</div>
                      <select
                        value={uaMode}
                        onChange={(e) => setUaMode(e.target.value as UaMode)}
                        disabled={busy}
                        aria-label="User-Agent mode"
                      >
                        <option value="default">default</option>
                        <option value="preset">preset</option>
                        <option value="custom">custom</option>
                      </select>
                    </div>

                    {uaMode === "default" ? null : (
                      <div className="setting-row">
                        <div className="muted">Value</div>
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
                    修改 User-Agent 通常需要 reload 当前 Tab 生效。
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
                打开 Tab
              </button>
              <button
                className="btn"
                onClick={() => focusedAccountId && closeTab(focusedAccountId)}
                disabled={busy || !focusedAccountId}
              >
                关闭 Tab
              </button>
              <button className="btn" onClick={saveUserAgent} disabled={busy || !focusedAccountId}>
                保存 UA
              </button>
              <button className="btn" onClick={reloadWorkspace} disabled={busy}>
                Reload
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
        }}
        onClose={() => setImportDialogOpen(false)}
        aria-label="导入 refresh_token"
      >
        <div className="modal">
          <div className="modal-header">
            <div>
              <div className="modal-title">导入 refresh_token</div>
              <div className="modal-note">
                每行一个 <span className="mono">refresh_token</span>。导入后账号状态为“未校验”。
              </div>
            </div>
            <button
              className="btn btn-icon"
              title="关闭"
              onClick={() => setImportDialogOpen(false)}
              disabled={busy}
            >
              ×
            </button>
          </div>

          <div className="modal-grid">
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder="每行一个 refresh_token"
              disabled={busy}
            />
            <div className="muted" style={{ fontSize: 12 }}>
              UI 中只显示 token 指纹/掩码；导出才会输出明文。
            </div>
          </div>

          <div className="modal-actions">
            <button className="btn" onClick={() => setImportDialogOpen(false)} disabled={busy}>
              取消
            </button>
            <button
              className="btn btn-primary"
              onClick={runImport}
              disabled={busy || importText.trim().length === 0}
            >
              导入
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
        aria-label="导出 refresh_token"
      >
        {exportDialog.open ? (
          <div className="modal">
            <div className="modal-header">
              <div>
                <div className="modal-title">导出 refresh_token</div>
                <div className="modal-note">
                  将导出当前勾选账号的 <span className="mono">refresh_token</span>（每行一个）。
                </div>
              </div>
              <button
                className="btn btn-icon"
                title="关闭"
                onClick={() => setExportDialog({ open: false })}
                disabled={busy}
              >
                ×
              </button>
            </div>

            <div className="danger-note">
              注意：导出内容属于敏感凭据。UI 与日志中必须始终脱敏；请勿分享或粘贴到日志/工单中。
            </div>

            <div className="modal-grid">
              <textarea className="mono" readOnly value={exportDialog.tokenText} />
              <div className="muted" style={{ fontSize: 12 }}>
                已导出 {exportDialog.selectedCount} 个账号的 token。默认不自动复制。
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => setExportDialog({ open: false })}>
                完成
              </button>
            </div>
          </div>
        ) : null}
      </dialog>
    </div>
  );
}
