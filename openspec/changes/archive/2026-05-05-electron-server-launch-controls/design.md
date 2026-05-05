## Context

The Electron app today launches the dashboard server through `ensureServer()` (`packages/electron/src/lib/server-lifecycle.ts:206`) called once during `app.whenReady` (`packages/electron/src/main.ts:528`). The startup sequence retries up to 2 times and shows a "Run Setup / Retry / Quit" dialog (`main.ts:551`). After that loop exhausts, the app falls back to a passive **loading page** built as an inline `data:text/html` blob (`main.ts:158-198`) that:

- Polls `${serverUrl}/api/health` every 1.5 s.
- After ~15 s of failure, shows static install instructions and (optionally) a list of known remote servers.
- Never re-attempts a local launch — the only escape hatch is "quit and relaunch".

The system tray (`packages/electron/src/lib/tray.ts`) only exposes `Show` / `Quit`. It also lacks any view into *why* the launch failed — `~/.pi/dashboard/server.log` is reachable but not surfaced.

This design adds **user-initiated launch controls** without disturbing the existing auto-launch path or the bridge-side auto-start (`packages/extension/src/server-auto-start.ts`).

## Goals / Non-Goals

**Goals:**
- One-click "Start server" / "Retry launch" from the loading-page error state.
- Tray menu items `Start server` (when not running) and `Restart server` (when running).
- "Open Doctor" link from the loading page so users can self-diagnose.
- Last ~20 lines of `server.log` in a collapsible panel on the error state.
- A single **idempotent** `requestServerLaunch()` routine reused by all entry points.
- Real-time status feedback to the loading page (`Launching… / Failed: <reason> / Connected`).

**Non-Goals:**
- No change to bridge auto-start behaviour or the wizard.
- No new persisted config; behaviour is pure runtime.
- No public REST/WebSocket surface change — only internal Electron IPC.
- No redesign of the existing "Run Setup / Retry / Quit" startup dialog.
- No new logging framework — reuse existing `~/.pi/dashboard/server.log` written by `spawnDetached`.

## Decisions

### D1 — Single idempotent `requestServerLaunch()` in main process

Extract a new exported function in `server-lifecycle.ts`:

```ts
type LaunchOutcome =
  | { kind: "already-running"; url: string }
  | { kind: "started"; url: string }
  | { kind: "failed"; reason: string; logTail: string };

export async function requestServerLaunch(opts?: { force?: boolean }): Promise<LaunchOutcome>;
```

Behaviour:
- Probes `isDashboardRunning(port)` first.
- If running and `!force` → returns `already-running`.
- If running and `force` → POSTs `/api/shutdown` (existing endpoint), waits for the port to close (poll `isDashboardRunning` with 5 s timeout), then spawns fresh.
- If not running → reuses `ensureServer()` body.
- Holds an in-module `Promise` so concurrent callers (button + tray + IPC) **share one launch attempt** instead of spawning twice.
- Returns structured outcome (no thrown errors) so the renderer can update UI deterministically.

**Alternatives considered:**
- *Re-call `ensureServer()` directly from each entry point.* Rejected — `ensureServer()` is currently coupled to the startup path's retry loop and dialog. Adding a parallel idempotent wrapper avoids regressing startup behaviour.
- *Use the existing `/api/restart` for everything.* Rejected on two grounds: (a) only works when the server is already up — the button's primary use case is "server is down"; (b) introduces an extra HTTP round-trip from main process to localhost when a plain shutdown-then-spawn is sufficient and uses the same code path as the cold-start case.

### D2 — Loading page becomes a real HTML resource with preload bridge

Today the loading page is `data:text/html;charset=utf-8,${encodeURIComponent(html)}` (`main.ts:198`), which **cannot use a preload script** (Electron's `webPreferences.preload` only attaches to file/http URLs, and `data:` URLs run in a sandboxed origin without `nodeIntegration`). To call IPC channels we need a real preload script.

**Decision:** Move the loading HTML to `packages/electron/resources/loading.html` and load it via `loadFile()`. Add `packages/electron/src/preload-loading.ts` exposing a minimal contextBridge:

```ts
window.piDashboard = {
  requestLaunch(force?: boolean): Promise<LaunchOutcome>,
  openDoctor(): void,
  readServerLog(lines?: number): Promise<string>,
  onStatus(cb: (status: LaunchStatus) => void): () => void,  // unsubscribe
}
```

**Alternatives:**
- *Inline HTML + `nodeIntegration: true`.* Rejected — security regression; Electron docs strongly discourage it for any URL the user might be redirected to.
- *Keep `data:` URL and use postMessage to main window.* Rejected — main window doesn't exist yet at loading-page time.

### D3 — Tray dynamic menu rebuilds on probe

Tray menu rebuilt every ~3 s via `setInterval` calling `isDashboardRunning(port)`. Cheap (single TCP connect to localhost) and matches existing health-probe cadence elsewhere in the app.

**Alternatives:**
- *Event-driven (server emits status to tray).* Rejected — would require a long-lived IPC subscription or shared in-process state; overkill for a 2-item menu.

### D4 — `server.log` tail via `fs.readFile` slice, no streaming

Read the last 8 KiB of `~/.pi/dashboard/server.log` via `fs.read` with a tail offset, split on `\n`, return last 20 lines. Renderer displays in a `<details>` panel.

**Alternatives:**
- *`tail -f` style streaming.* Rejected — out of scope; the user only needs to see *why* the last attempt failed.
- *Show full log.* Rejected — log can grow unbounded; 8 KiB tail is enough for a stack trace.

### D5 — IPC channel naming

All channels prefixed `dashboard:` (matches existing convention in main.ts). Three channels:

| Channel | Direction | Payload |
|---|---|---|
| `dashboard:request-launch` | renderer → main (invoke) | `{ force?: boolean }` → `LaunchOutcome` |
| `dashboard:open-doctor` | renderer → main (send) | none |
| `dashboard:read-server-log` | renderer → main (invoke) | `{ lines?: number }` → `string` |
| `dashboard:launch-status` | main → renderer (send) | `LaunchStatus` push during launch |

### D6 — Error surfacing rule: never crash the loading page

If `requestServerLaunch()` throws unexpectedly (which it shouldn't — it returns `{kind:"failed"}`), the renderer logs to console and falls back to the existing 1.5 s polling loop. The error state never blocks the auto-redirect when the server eventually comes up.

## Risks / Trade-offs

- **[Risk]** Refactoring the inline loading page to a real HTML file changes packaging — `loading.html` must be added to Forge's `extraResource` list. → *Mitigation:* mirror the existing `resources/icon.png` pattern; covered by an automated test that asserts the file is present in the packaged bundle (extend `test-electron-install.sh`).
- **[Risk]** Concurrent button + tray clicks could double-spawn. → *Mitigation:* in-module shared `Promise<LaunchOutcome>` in `requestServerLaunch()` (D1). Unit-tested with a fake spawner.
- **[Risk]** Reading `server.log` while the server is actively writing to it on Windows could race. → *Mitigation:* open with `r` mode + `O_NONBLOCK`-equivalent (`fs.read` is fine; we already write to the same file via `openSync`); failure is non-fatal — return empty string.
- **[Trade-off]** `loadFile()` instead of `data:` URL means Electron Forge must include the new resource in builds for all 6 platforms (matrix in `.github/workflows/publish.yml`). One-time config change, no runtime cost.
- **[Trade-off]** Tray polling adds one TCP connect every 3 s. Negligible (< 0.01% CPU) — same probe used elsewhere.

## Migration Plan

**Compatibility:** Pure additive. No config schema, no persisted state, no public API change.

**Deploy:**
1. Land the change behind no flag — UI is purely additive.
2. Verify on all three OS via `qa/Makefile` `test-linux-x86`, `test-windows`, `test-macos` (manual screenshots required for tray + loading page).
3. Cut a patch release (`release-cut` skill) — bumps `packages/electron/package.json`.

**Rollback:** Revert PR. No data migration. Old loading page (data: URL) returns. No user-facing breakage.

## Open Questions

- Q1: Should the `Restart server` tray item also be available **inside the main dashboard window** (e.g. in Settings → Server)? → *Defer.* Out of scope for this change; the loading page + tray cover the "server-down" case. A follow-up can add an in-app control once this lands.
- Q2: Should `Open Doctor` be reachable when the main window is loaded (not just on the loading page)? → *Defer to Q1's follow-up.* Doctor is already reachable from the existing app menu (`packages/electron/src/lib/app-menu.ts`).
- Q3: Localization — strings on the loading page are currently hard-coded English. → *Out of scope.* Match existing style; no app-wide i18n exists yet.
