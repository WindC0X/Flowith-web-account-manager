import { useCallback, useMemo, useState } from "react";
import type { AccountSummary, ImportRefreshTokensResult } from "../../shared/ipc";

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
  const [importText, setImportText] = useState("");
  const [importResult, setImportResult] = useState<ImportRefreshTokensResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportModal, setExportModal] = useState<ExportModalState>({ open: false });

  const selected = useMemo(() => [...selectedIds], [selectedIds]);

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

  const runImport = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await window.desktop.accounts.importRefreshTokens(importText);
      setImportResult(result);
      setImportText("");
      await refreshAccounts();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [importText, refreshAccounts]);

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

  return (
    <main style={{ padding: 24, maxWidth: 960, margin: "0 auto" }}>
      <h1 style={{ margin: 0, fontSize: 20 }}>Workspace</h1>
      <p style={{ marginTop: 8, opacity: 0.75 }}>
        Minimal IPC demo panel for import/export. (No Node integration in renderer)
      </p>

      <section style={{ marginTop: 20, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={refreshAccounts} disabled={busy}>
            Refresh accounts
          </button>
          <span style={{ opacity: 0.8 }}>
            {accounts.length} account(s) | selected {selected.length}
          </span>
        </div>

        {error ? (
          <div style={{ padding: 12, border: "1px solid #ff5c5c", borderRadius: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Error</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{error}</div>
          </div>
        ) : null}

        <div style={{ display: "grid", gap: 8 }}>
          {accounts.length === 0 ? (
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

        <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
          <div style={{ fontWeight: 600 }}>Import refresh_token(s)</div>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={6}
            placeholder={"One refresh_token per line.\\n(No tokens will be logged.)"}
            style={{
              width: "100%",
              resize: "vertical",
              borderRadius: 8,
              border: "1px solid #2a2f3c",
              padding: 10,
              background: "#0f1320",
              color: "inherit",
            }}
            disabled={busy}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={runImport} disabled={busy || !importText.trim()}>
              Import
            </button>
            {importResult ? (
              <span style={{ opacity: 0.8 }}>
                imported {importResult.imported} | failed {importResult.failed}
              </span>
            ) : null}
          </div>

          {importResult?.warnings?.length ? (
            <div style={{ padding: 12, border: "1px solid #caa53b", borderRadius: 8 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Warnings</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {importResult.warnings.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {importResult?.errors?.length ? (
            <div style={{ padding: 12, border: "1px solid #ff5c5c", borderRadius: 8 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Import errors</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {importResult.errors.map((w, idx) => (
                  <li key={idx} style={{ whiteSpace: "pre-wrap" }}>
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
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
