## Context

`setupAppMenu()` in `packages/electron/src/lib/app-menu.ts` builds the template inline per platform; Win/Linux is flat (`:238-278`).

## Decisions

### D1 — Top-level label for server/connection group (confirmed — owner, 2026-11-20)
Options: **Dashboard** | File. Chosen: **Dashboard** — Servers/Connect/Runtime/Browser relay are not file operations; the `quit` role (Exit on Windows / Quit on Linux) sits at the bottom per Windows convention. Issue permits either. See `/tmp/issue-batch/electron-menu-submenus-DECISIONS.md`.

### D2 — Exported pure builder
`buildWinLinuxMenuTemplate(opts?: { isDev?: boolean })` returns `MenuItemConstructorOptions[]`; `setupAppMenu()` calls it. Lets tests assert structure without a live Electron `Menu`; the test mocks `electron` itself (`vi.mock("electron")` as in `zombie-adoption.test.ts` / `doctor-window.test.ts`; `servers-menu.test.ts` does not mock it) plus the side-effect imports of `app-menu.ts` (app-updater, doctor-window, remote-connect-window, runtime-overlay, runtime-overlay-main, shared runtime-overlay/state). `serversMenuItem()` and `buildBrowserRelayMenuItem()` are pure enough to run for real (drive Servers via `setServersMenuHooks`). The test runs under the package-local vitest only (`packages/electron/vitest.config.ts`); root `vitest.config.ts` excludes `packages/electron`, so it is not CI-gated. Rejected: testing via `Menu.buildFromTemplate` spy only (still works but couples to full setup incl. `onServersMenuChanged`).

### D3 — Add Edit menu on Win/Linux
Standard roles; requested in #1121 and matches desktop convention (not a functional fix — Chromium already handles clipboard accelerators). Low risk.

### D4 — Doctor label
Keep "Doctor" (current Win/Linux) — no relabel to "Doctor..." (macOS) to keep diff minimal.
