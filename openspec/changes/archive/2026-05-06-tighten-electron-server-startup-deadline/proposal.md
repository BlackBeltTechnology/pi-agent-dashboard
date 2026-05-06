# Tighten Electron server-startup deadline and drop double-retry

## Why

On the current release, when the Electron app launches and the dashboard
server is slow or fails to come up, the user sees a frozen splash window
("Launching dashboard server…") for **up to 120 seconds** before any
actionable UI appears.

Two stacked deadlines cause this:

1. `SERVER_READY_DEADLINE_MS = 60_000` in
   `packages/electron/src/lib/server-lifecycle.ts` — every `waitForReady`
   callsite blocks for 60 s.
2. `main.ts` retries `ensureServer()` **twice** on failure
   (`for (let attempt = 0; attempt < 2; attempt++)`), so a failed launch
   blocks the splash for 60 s × 2 = 120 s before the error dialog appears.

During this window the splash shows only a static status string and offers
no Start / Doctor / log controls. The app already ships an interactive
loading page (`resources/loading.html`) that handles exactly this case —
it polls every 1.5 s and exposes Start server / Open Doctor / log-tail
buttons after ~15 s — but startup never reaches it on the slow path.

Real-world cold-start measurements:

- Dev machine, warm disk: 3–8 s.
- Slow path (Windows first run, AV scanning, cold disk, jiti/tsx warmup):
  10–20 s.
- Beyond ~20 s, the failure mode is almost always terminal (port conflict,
  missing loader, bad Node) — extra waiting produces no useful signal.

## What Changes

- Cut `SERVER_READY_DEADLINE_MS` from `60_000` to `15_000`. Update the
  cause-aware error wording from "60 seconds" to "15 seconds".
- Drop the double retry loop in `packages/electron/src/main.ts`. A single
  `ensureServer()` attempt is enough; on failure, fall through to the
  loading page (`showLoadingPage`) which already polls indefinitely and
  exposes Start server / Doctor / log controls.
- Keep the existing error dialog (`Run Setup / Retry / Quit`) only for the
  case where `ensureServer()` throws a *terminal* error before the
  deadline (e.g. "No TypeScript loader found", "CLI not found",
  "Port in use") — these are configuration failures the loading page
  cannot recover. Deadline-elapsed and child-exit failures SHALL skip the
  dialog and route directly to the loading page.
- Update the contract test in
  `packages/electron/src/__tests__/server-lifecycle-spawn-options.test.ts`
  that currently pins `SERVER_READY_DEADLINE_MS` to `60_000`.
- Update the OpenSpec requirement
  *"Server-startup deadline is 60 seconds with cause-aware error wording"*
  → *"Server-startup deadline is 15 seconds…"*.

## Impact

- **Affected specs**: `electron-shell` (Server-startup deadline +
  Electron main process lifecycle requirements).
- **Affected code**:
  - `packages/electron/src/lib/server-lifecycle.ts` (constant + error
    wording in `buildServerStartupError`).
  - `packages/electron/src/main.ts` (retry loop + dialog routing).
  - `packages/electron/src/__tests__/server-lifecycle-spawn-options.test.ts`
    (pinned constant value).
- **User-visible behaviour**: worst-case time on splash before the user
  gets actionable UI drops from ~120 s to ~15 s. The interactive loading
  page picks up where the splash leaves off and continues retrying in
  the background, so a slow-but-eventually-successful server launch is
  still handled — the user just sees the loading page instead of a
  frozen splash during the wait.
