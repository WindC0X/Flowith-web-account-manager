import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AccountSummary, ConnectivityCheck } from "../../shared/ipc";

type ExportModalState =
  | { open: false }
  | { open: true; tokenText: string; selectedCount: number };

function maskFingerprint(fingerprint: string): string {
  if (!fingerprint) return "-";
  if (fingerprint.length <= 6) return fingerprint;
  return `${fingerprint.slice(0, 6)}…${fingerprint.slice(-4)}`;
}

export default function App() {
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return window.localStorage.getItem("fwd_sidebar_collapsed") === "1";
  });
  const [error, setError] = useState<string | null>(null);
  const [exportModal, setExportModal] = useState<ExportModalState>({ open: false });
  const [connectivity, setConnectivity] = useState<ConnectivityCheck[] | null>(null);
  const [proxyMode, setProxyMode] = useState<"system" | "direct" | "custom">("system");
  const [proxyRules, setProxyRules] = useState("");
  const [uaMode, setUaMode] = useState<"default" | "preset" | "custom">("default");
  const [uaValue, setUaValue] = useState("");
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(() => [...selectedIds], [selectedIds]);
  const selectedAccountId = useMemo(() => {
    if (selected.length !== 1) return null;
    return selected[0] ?? null;
  }, [selected]);

  const selectedAccount = useMemo(() => {
    if (!selectedAccountId) return null;
    return accounts.find((a) => a.id === selectedAccountId) ?? null;
  }, [accounts, selectedAccountId]);

  useEffect(() => {
    if (!selectedAccount) return;
    setProxyMode(selectedAccount.net.proxy.mode);
    setProxyRules(selectedAccount.net.proxy.rules ?? "");
    setUaMode(selectedAccount.ua.mode);
    setUaValue(selectedAccount.ua.value ?? "");
  }, [selectedAccount]);

  useEffect(() => {
    window.localStorage.setItem("fwd_sidebar_collapsed", sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);

  const refreshAccounts = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const list = await window.desktop.accounts.list();
      setAccounts(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const toggleSelected = useCallback((accountId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
  }, []);

  const runExport = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const text = await window.desktop.accounts.exportRefreshTokens(selected);
      setExportModal({ open: true, tokenText: text, selectedCount: selected.length });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [selected]);

  const saveProxy = useCallback(async () => {
    if (!selectedAccountId) return;
    setError(null);
    setBusy(true);
    try {
      const proxy =
        proxyMode === "custom"
          ? { mode: "custom" as const, rules: proxyRules }
          : { mode: proxyMode };
      await window.desktop.accounts.updateAccountMeta(selectedAccountId, {
        net: {
          proxy,
        },
      });
      await refreshAccounts();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [proxyMode, proxyRules, refreshAccounts, selectedAccountId]);

  const runConnectivity = useCallback(async () => {
    if (!selectedAccountId) return;
    setError(null);
    setBusy(true);
    try {
      const report = await window.desktop.accounts.testConnectivity(selectedAccountId);
      setConnectivity(report);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [selectedAccountId]);

  const saveUserAgent = useCallback(async () => {
    if (!selectedAccountId) return;
    setError(null);
    setBusy(true);
    try {
      const ua =
        uaMode === "default"
          ? { mode: "default" as const }
          : { mode: uaMode, value: uaValue };
      await window.desktop.accounts.updateAccountMeta(selectedAccountId, { ua });
      await refreshAccounts();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [refreshAccounts, selectedAccountId, uaMode, uaValue]);

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

  const openWorkspaceForSelected = useCallback(async () => {
    setError(null);
    if (selected.length !== 1) {
      setError("Select exactly 1 account to open a workspace tab.");
      return;
    }
    const accountId = selected[0];
    if (!accountId) return;
    setBusy(true);
    try {
      await pushViewportBounds();
      await window.desktop.workspace.openTab(accountId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [pushViewportBounds, selected]);

  const closeWorkspaceForSelected = useCallback(async () => {
    setError(null);
    if (selected.length !== 1) {
      setError("Select exactly 1 account to close a workspace tab.");
      return;
    }
    const accountId = selected[0];
    if (!accountId) return;
    setBusy(true);
    try {
      await window.desktop.workspace.closeTab(accountId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [selected]);

  const reloadWorkspace = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      await window.desktop.workspace.reloadActive();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
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

    schedule();
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [pushViewportBounds]);

  return (
    <main style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "10px 16px",
          borderBottom: "1px solid #2a2f3c",
          background: "#0f1320",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontWeight: 700 }}>Topbar</div>
          <div style={{ opacity: 0.75, fontSize: 12 }}>
            Flowith Web Account Manager (Desktop MVP)
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => setSidebarCollapsed((v) => !v)} disabled={busy}>
            {sidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
          </button>
          <button onClick={runExport} disabled={busy || selected.length === 0}>
            Export ({selected.length})
          </button>
          <button onClick={refreshAccounts} disabled={busy}>
            Refresh
          </button>
        </div>
      </header>

      <section
        style={{
          flex: 1,
          overflow: "auto",
          padding: 24,
          maxWidth: 1200,
          width: "100%",
          margin: "0 auto",
          display: "grid",
          gap: 12,
        }}
      >

        {error ? (
          <div style={{ padding: 12, border: "1px solid #ff5c5c", borderRadius: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Error</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{error}</div>
          </div>
        ) : null}

        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontWeight: 600 }}>Sidebar</div>
          {sidebarCollapsed ? (
            <div style={{ opacity: 0.7 }}>
              Sidebar is collapsed. Use the Topbar button to expand.
            </div>
          ) : accounts.length === 0 ? (
            <div style={{ opacity: 0.7 }}>
              No accounts yet. Import refresh_token to create accounts.
            </div>
          ) : (
            accounts.map((a) => (
              <label
                key={a.id}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  padding: 10,
                  border: "1px solid #2a2f3c",
                  borderRadius: 8,
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(a.id)}
                  onChange={() => toggleSelected(a.id)}
                  disabled={busy}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{a.displayName}</div>
                  <div style={{ opacity: 0.7, fontSize: 12 }}>
                    id: {a.id} | fp: {maskFingerprint(a.fingerprint)} | tags:{" "}
                    {a.tags.length ? a.tags.join(", ") : "-"}
                  </div>
                </div>
              </label>
            ))
          )}
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontWeight: 600 }}>Inspector</div>
          {selectedAccountId ? (
            <div
              style={{
                border: "1px solid #2a2f3c",
                borderRadius: 8,
                padding: 12,
                display: "grid",
                gap: 8,
              }}
            >
              <div style={{ opacity: 0.8, fontSize: 12 }}>
                Editing account: <span style={{ fontFamily: "ui-monospace, monospace" }}>{selectedAccountId}</span>
              </div>

              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ opacity: 0.8, fontSize: 12 }}>Mode</span>
                <select
                  value={proxyMode}
                  onChange={(e) => setProxyMode(e.target.value as "system" | "direct" | "custom")}
                  disabled={busy}
                  style={{
                    height: 34,
                    borderRadius: 8,
                    border: "1px solid #2a2f3c",
                    background: "#0f1320",
                    color: "inherit",
                    padding: "0 10px",
                  }}
                >
                  <option value="system">system</option>
                  <option value="direct">direct</option>
                  <option value="custom">custom</option>
                </select>
              </label>

              {proxyMode === "custom" ? (
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ opacity: 0.8, fontSize: 12 }}>Proxy rules</span>
                  <input
                    value={proxyRules}
                    onChange={(e) => setProxyRules(e.target.value)}
                    placeholder={"Example: http=127.0.0.1:7890;https=127.0.0.1:7890"}
                    disabled={busy}
                    style={{
                      height: 34,
                      borderRadius: 8,
                      border: "1px solid #2a2f3c",
                      background: "#0f1320",
                      color: "inherit",
                      padding: "0 10px",
                      fontFamily: "ui-monospace, monospace",
                    }}
                  />
                  <div style={{ opacity: 0.7, fontSize: 12 }}>
                    Credentials in proxy rules (username:password@host) will be rejected.
                  </div>
                </label>
              ) : null}

              <div style={{ display: "grid", gap: 8, marginTop: 4 }}>
                <div style={{ fontWeight: 600 }}>User-Agent</div>
                <label style={{ display: "grid", gap: 6 }}>
                  <span style={{ opacity: 0.8, fontSize: 12 }}>Mode</span>
                  <select
                    value={uaMode}
                    onChange={(e) => setUaMode(e.target.value as "default" | "preset" | "custom")}
                    disabled={busy}
                    style={{
                      height: 34,
                      borderRadius: 8,
                      border: "1px solid #2a2f3c",
                      background: "#0f1320",
                      color: "inherit",
                      padding: "0 10px",
                    }}
                  >
                    <option value="default">default</option>
                    <option value="preset">preset</option>
                    <option value="custom">custom</option>
                  </select>
                </label>

                {uaMode === "default" ? null : (
                  <label style={{ display: "grid", gap: 6 }}>
                    <span style={{ opacity: 0.8, fontSize: 12 }}>User-Agent value</span>
                    <input
                      value={uaValue}
                      onChange={(e) => setUaValue(e.target.value)}
                      placeholder={"Mozilla/5.0 ..."}
                      disabled={busy}
                      style={{
                        height: 34,
                        borderRadius: 8,
                        border: "1px solid #2a2f3c",
                        background: "#0f1320",
                        color: "inherit",
                        padding: "0 10px",
                        fontFamily: "ui-monospace, monospace",
                      }}
                    />
                    <div style={{ opacity: 0.7, fontSize: 12 }}>
                      Changing User-Agent usually requires reloading the tab to take effect.
                    </div>
                  </label>
                )}
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={saveProxy} disabled={busy}>
                  Save proxy
                </button>
                <button onClick={saveUserAgent} disabled={busy}>
                  Save User-Agent
                </button>
                <button onClick={runConnectivity} disabled={busy}>
                  Test connectivity
                </button>
              </div>

              {connectivity ? (
                <div style={{ display: "grid", gap: 6 }}>
                  {connectivity.map((c) => (
                    <div
                      key={c.name}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 10,
                        padding: "8px 10px",
                        border: "1px solid #2a2f3c",
                        borderRadius: 8,
                      }}
                    >
                      <div style={{ display: "grid", gap: 2 }}>
                        <div style={{ fontWeight: 600 }}>{c.name}</div>
                        <div style={{ opacity: 0.7, fontSize: 12 }}>{c.url}</div>
                        {c.error ? (
                          <div style={{ opacity: 0.85, fontSize: 12, whiteSpace: "pre-wrap" }}>
                            {c.error}
                          </div>
                        ) : null}
                      </div>
                      <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <div style={{ fontWeight: 700, color: c.ok ? "#52d38a" : "#ff5c5c" }}>
                          {c.ok ? "OK" : "FAIL"}
                        </div>
                        <div style={{ opacity: 0.8, fontSize: 12 }}>{c.latencyMs} ms</div>
                        {typeof c.status === "number" ? (
                          <div style={{ opacity: 0.7, fontSize: 12 }}>HTTP {c.status}</div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div style={{ opacity: 0.7 }}>Select exactly 1 account to edit proxy and run tests.</div>
          )}
        </div>

        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          <div style={{ fontWeight: 600 }}>Export refresh_token(s)</div>
          <button onClick={runExport} disabled={busy || selected.length === 0}>
            Export selected ({selected.length})
          </button>
          <div style={{ opacity: 0.7, fontSize: 12 }}>
            Sensitive: export returns plaintext refresh_token. Nothing is auto-copied.
          </div>
        </div>

        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          <div style={{ fontWeight: 600 }}>Tabs workspace</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={openWorkspaceForSelected} disabled={busy || selected.length !== 1}>
              Open tab for selected
            </button>
            <button onClick={closeWorkspaceForSelected} disabled={busy || selected.length !== 1}>
              Close tab for selected
            </button>
            <button onClick={reloadWorkspace} disabled={busy}>
              Reload active
            </button>
          </div>
          <div style={{ opacity: 0.7, fontSize: 12 }}>
            Web content is confined to the viewport below; resize should not block UI controls.
          </div>
          <div
            ref={viewportRef}
            style={{
              height: 360,
              borderRadius: 12,
              border: "1px solid #2a2f3c",
              background: "#0f1320",
              overflow: "hidden",
              position: "relative",
            }}
          >
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
              <div style={{ opacity: 0.7, fontSize: 12 }}>
                Viewport target (BrowserView overlays this area)
              </div>
            </div>
          </div>
        </div>
      </section>

      {exportModal.open ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.6)",
            display: "grid",
            placeItems: "center",
            padding: 24,
          }}
          onClick={() => setExportModal({ open: false })}
        >
          <div
            style={{
              width: "min(900px, 100%)",
              background: "#0b0d13",
              border: "1px solid #2a2f3c",
              borderRadius: 12,
              padding: 16,
              display: "grid",
              gap: 10,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 700 }}>Export refresh_token</div>
            <div style={{ padding: 10, border: "1px solid #caa53b", borderRadius: 8 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Sensitive</div>
              <div style={{ opacity: 0.9 }}>
                You are viewing plaintext refresh_token for {exportModal.selectedCount} selected
                account(s). Do not share or paste into logs.
              </div>
            </div>
            <textarea
              readOnly
              value={exportModal.tokenText}
              rows={10}
              style={{
                width: "100%",
                resize: "vertical",
                borderRadius: 8,
                border: "1px solid #2a2f3c",
                padding: 10,
                background: "#0f1320",
                color: "inherit",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setExportModal({ open: false })}>Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
