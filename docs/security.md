# Security Guide

This document defines the security baseline and operational rules for **Flowith Web Account Manager (Desktop)**.

## Core Principles

- **Never log secrets**: `refresh_token`, `access_token`, or any full session payload MUST NOT appear in logs or error messages.
- **No Node.js in renderer**: the embedded web and renderer UI run with `nodeIntegration=false` and `contextIsolation=true`.
- **Least-privilege IPC**: renderer communicates with main via a minimal, typed IPC surface. Sensitive operations (token storage / web session injection) are main-only.

## Token Handling Policy

### What is considered sensitive

- Any `refresh_token` text (even if user-provided).
- Any `access_token` (JWT-like strings).
- Full Supabase session objects.

### Redaction rules

When showing errors to users or writing logs:

- Do not include raw token strings.
- Prefer **line number + masked fingerprint** (e.g. `abcd12…9f0a`) for identifying a token entry.
- Truncate messages to a reasonable length.

## Import (refresh_token)

- Import supports **one token per line**.
- Import MUST validate tokens by refreshing a Supabase session.
- Import MUST NOT echo back plaintext token content in UI or logs.

### Supabase configuration

Token validation and login bootstrap require:

- `FLOWITH_SUPABASE_URL`
- `FLOWITH_SUPABASE_ANON_KEY`

Do not hardcode secrets. The anon key is public by design, but keep configuration explicit.

## Export (refresh_token)

Export is a **high-risk operation**.

- Export MUST happen only after **explicit user action**.
- The app MUST NOT automatically copy exported tokens to the clipboard.
- The UI MUST show a clear warning that the output is plaintext `refresh_token`.

Operational guidance:

- Treat exported output as a secret.
- Do not paste the output into terminals, issue trackers, or logs.

## Linux / safeStorage Degradation

`electron.safeStorage` may be unavailable on some Linux environments.

When `safeStorage.isEncryptionAvailable()` is **false**:

- The app MUST NOT persist plaintext `refresh_token` to disk.
- Accounts MAY still be created, but tokens MUST be treated as **runtime-only**.
- The UI MUST inform the user that tokens will be lost on restart and must be re-imported.

## Proxy Safety

Proxy configuration MUST NOT accept credentials in proxy rules, such as:

- `username:password@host`

If credentials are detected, the input MUST be rejected with a user-safe error message.

## Reporting & Verification Checklist

Before shipping or sharing builds:

- Confirm `npm run lint` and `npm run typecheck` pass.
- Verify no logs contain token-like strings.
- Verify export is gated by explicit user action and shows a warning.
- Verify Linux without `safeStorage` does not persist tokens after restart.

