## Context

`setupAppMenu()` in `packages/electron/src/lib/app-menu.ts` builds the template inline per platform; Win/Linux is flat (`:238-278`).

## Decisions

### D1 — Top-level label for server/connection group (confirmed — owner, 2026-11-20)
Options: **Dashboard** | File. Chosen: **Dashboard** — Servers/Connect/Runtime/Browser relay are not file operations; Exit sits at the bottom per Windows convention. Issue permits either. See `/tmp/issue-batch/electron-menu-submenus-DECISIONS.md`.

### D2 — Exported pure builder
`buildWinLinuxMenuTemplate(opts?: { isDev?: boolean })` returns `MenuItemConstructorOptions[]`; `setupAppMenu()` calls it. Lets tests assert structure without a live Electron `Menu`; `electron` is already mocked in sibling tests (`servers-menu.test.ts`). Rejected: testing via `Menu.buildFromTemplate` spy only (still works but couples to full setup incl. `onServersMenuChanged`).

### D3 — Add Edit menu on Win/Linux
Standard roles; needed so clipboard shortcuts work consistently and matches issue proposal. Low risk.

### D4 — Doctor label
Keep "Doctor" (current Win/Linux) — no relabel to "Doctor..." (macOS) to keep diff minimal.
