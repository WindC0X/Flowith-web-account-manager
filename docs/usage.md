# Usage Guide

This document describes how to use **Flowith Web Account Manager (Desktop)**.

> 中文小白版：`docs/usage.zh-CN.md`

## Run (Dev)

```bash
npm install
npm run dev
```

Runbook:

- `docs/dev-runbook.md`

Quality checks:

```bash
npm run lint
npm run typecheck
npm test
```

## Configure Supabase (required for token validation / login bootstrap)

Set the following environment variables before import / opening tabs:

- `FLOWITH_SUPABASE_URL`
- `FLOWITH_SUPABASE_ANON_KEY`

## Import Accounts (refresh_token)

- Paste **one `refresh_token` per line**.
- The app validates each line by refreshing a Supabase session.
- The UI does not display plaintext tokens; errors are shown as redacted messages.

If `safeStorage` encryption is unavailable (common on some Linux environments), imported tokens are **runtime-only** and must be re-imported after restart.

## Open Workspace Tabs

- Select an account and click **Open tab for selected**.
- Each account runs in an isolated Electron `partition` so cookies/localStorage do not leak across accounts.

## Export Tokens

Export is **sensitive**:

- Select accounts and click **Export selected**.
- Output contains exactly one `refresh_token` per line for the selected accounts.
- Tokens are not auto-copied; treat the output as a secret.

## Proxy Modes (per-account)

Each account can be configured with a proxy mode:

- `system`: follow system proxy / PAC
- `direct`: force direct connection (useful for debugging)
- `custom`: apply user-provided `proxyRules`

Rules containing credentials (e.g. `username:password@host`) are rejected.

## Connectivity Test

For a selected account, click **Test connectivity** to obtain:

- OK / FAIL per endpoint
- latency in milliseconds

Endpoints include:

- Flowith Web (`https://flowith.io`)
- Flowith edge (`https://edge.flowith.net`)
- Supabase (from `FLOWITH_SUPABASE_URL`, when configured)

## Account Info (Credits / Subscription)

The Inspector includes a **Credits / Subscription** section. If the backend API is not integrated/available, clicking **Refresh credits** shows a placeholder message and does not crash the UI.

## Updates

Auto-updates are available in **packaged** builds only:

- Open **Settings (⚙)** → **Updates** → **Check updates**.
- When an update is downloaded, click **Restart & install**.
- Dev mode / unpackaged builds show an “only available in packaged builds” hint.

## Smoke Checklist

Run the end-to-end manual checklist before release:

- `docs/smoke-checklist.md`
