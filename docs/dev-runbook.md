# Dev Runbook (Desktop MVP)

This document describes how to start the app in development mode and how to perform the minimum smoke validation.

## Prerequisites

```bash
npm install
```

Required env vars for token validation + login bootstrap:

- `FLOWITH_SUPABASE_URL`
- `FLOWITH_SUPABASE_ANON_KEY`

## Start (dev)

```bash
npm run dev
```

## Quality gates

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Packaging (dir)

This repo provides a lightweight directory packager (no installers) via `scripts/package-dir.mjs`.

### Linux (build + package)

```bash
npm run dist:linux
```

Expected output:
- A folder under `dist/` named like `linux-unpacked*`
- An executable at `dist/linux-unpacked*/flowith-web-account-manager`

### Windows (build + package)

Run on a Windows host:

```powershell
npm run dist:win
```

Expected output:
- A folder under `dist/` named like `win-unpacked*`
- An executable at `dist/win-unpacked*/flowith-web-account-manager.exe`

## Smoke checklist (manual)

Follow:

- `docs/smoke-checklist.md`

## Common issues

### Import fails immediately

- Check `FLOWITH_SUPABASE_URL` / `FLOWITH_SUPABASE_ANON_KEY` are set.
- The UI must not display plaintext tokens; errors should be redacted.

### Tokens are not persisted after restart

On some hosts (commonly Linux), `electron.safeStorage` encryption may be unavailable.

Expected behavior:
- Tokens are runtime-only (must re-import after restart).
- Token export for runtime-only tokens after restart will fail with a user-safe message.

### Proxy URL with credentials is rejected

Proxy rules must not contain `username:password@host`.

Use a credential-free proxy URL, for example:

```text
http://127.0.0.1:7890
socks5://127.0.0.1:7891
```
