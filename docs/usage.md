# Usage Guide

This document describes how to use **Flowith Web Account Manager (Desktop)**.

## Run (Dev)

```bash
npm install
npm run dev
```

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

## Smoke Checklist

Run the end-to-end manual checklist before release:

- `docs/smoke-checklist.md`
