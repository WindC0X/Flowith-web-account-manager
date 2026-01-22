# Smoke Checklist (Manual)

This checklist is the **minimum end-to-end validation** to run before release.

It aligns with the validation plan in `openspec/changes/add-flowith-web-desktop-mvp/design.md`.

## Prerequisites

- Install dependencies:

```bash
npm install
```

- Set Supabase env vars (required for import + login bootstrap):
  - `FLOWITH_SUPABASE_URL`
  - `FLOWITH_SUPABASE_ANON_KEY`

- Prepare at least **two** valid `refresh_token` values for parallel tabs testing.
  - Do not paste tokens into logs/tickets.
  - Do not commit tokens into git.

## Steps

### 1) Start the app (dev)

```bash
npm run dev
```

Expected:
- The Workspace UI shows **Topbar / Sidebar / Tabs workspace / Inspector**.

### 2) Import accounts (refresh_token)

1. Click **Import**.
2. Paste **one `refresh_token` per line** (no extra commas/quotes needed).
3. Click **Import** to submit.

Expected:
- Account list appears; no plaintext token is shown in the UI.
- Errors are user-safe and redacted (no token strings).

### 3) Open tabs and switch

1. Pick account A (focus it in sidebar).
2. Click **Open (Focused)** (or **Open tab** from Inspector).
3. Repeat for account B.
4. Switch tabs between A and B.

Expected:
- A and B keep isolated session state (no cross-account leakage).

### 4) Proxy + User-Agent effect

For one focused account:
1. Change **Proxy mode** (system/custom/direct).
2. For **custom**: input a proxy URL **without credentials** (no `username:password@`).
3. Click **Save proxy**.
4. Adjust **User-Agent** in Inspector and click **Save UA**.
5. Click **Reload active**.
6. Click **Connectivity** to verify key endpoints are reachable.

Expected:
- Connectivity popover shows OK/FAIL with latency.
- Changing UA requires reload to take effect.

### 5) Export tokens

1. Select one or more accounts via checkboxes.
2. Click **Export**.

Expected:
- Export dialog shows plaintext tokens (**sensitive**).
- Default behavior does not auto-copy; user explicitly copies if needed.

### 6) Restart preferences (persistence)

1. Switch **Theme** (Dark/Light).
2. Switch **Language** (zh-CN/en).
3. Collapse sidebar and switch account list view (cards/table).
4. Quit the app and start it again (`npm run dev`).

Expected:
- Theme, language, sidebar collapse, and view mode persist after restart.

### 7) Security spot-check

Expected:
- No plaintext token appears in terminal output, app UI (except export dialog), or saved logs.
- `localStorage` keys only store UI preferences; no `refresh_token` persisted in renderer storage.

## Recording template

- Date:
- Version: `cat package.json | rg 'version'` (or git commit hash)
- OS / Desktop environment:
- `safeStorage` available? (Windows/macOS usually yes; some Linux hosts no)
- Supabase env configured? (`FLOWITH_SUPABASE_URL` / `FLOWITH_SUPABASE_ANON_KEY`)

Results (PASS/FAIL):
- Import:
- Open tabs:
- Switch tabs:
- Proxy + connectivity:
- UA + reload:
- Export:
- Restart preferences:

Artifacts:
- Screenshots:
- Notes:

