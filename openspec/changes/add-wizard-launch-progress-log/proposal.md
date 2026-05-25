# Stream bootstrap progress to a log pane in the first-run wizard

## Why

The wizard window today shows a static spinner labelled "Preparing first launch…" while the Electron main process walks the 6-state startup machine (`check-health → attach | wizard → spawn → health-wait → done`). The user sees no indication of:

- which step is running (mDNS discovery? bundled-server spawn? `/api/health` poll?)
- what command was invoked (the exact `node --import … cli.ts` argv)
- whether progress is being made (server stdout lines, install steps, native-module rebuilds on first launch)
- estimated time to first usable window

On Windows installs, where first-launch latency can exceed 5 minutes due to Defender real-time scanning the unpacked `resources/server/node_modules/` (~30k files), the spinner-only UI is functionally indistinguishable from a hang. Users report:

> *"No window handle created, several minutes executing"*

even though the process is actively running. They reach for Process Explorer to confirm liveness. This is a poor first impression and a support-channel hot-spot.

## What Changes

- **New IPC channel `wizard:bootstrap-log`** (main → renderer, one-way). Streams structured events of shape:
  ```ts
  type BootstrapLogEvent =
    | { kind: "step";    step: BootstrapStep; status: "started" | "ok" | "error"; elapsedMs: number; detail?: string }
    | { kind: "argv";    step: BootstrapStep; argv: string[] }    // command being invoked
    | { kind: "line";    step: BootstrapStep; stream: "stdout" | "stderr"; text: string; truncated?: boolean }
    | { kind: "summary"; totalMs: number; ok: boolean };
  ```
  where `BootstrapStep` is the existing enum from `main.ts` (`check-health`, `wizard`, `spawn`, `health-wait`, `done`, `loading-page-error`).
- **Main-process emitter**: a tiny `BootstrapLogEmitter` in `packages/electron/src/lib/bootstrap-log-emitter.ts` with `start(step)`, `argv(step, argv)`, `line(step, stream, text)`, `done(step)`, `error(step, err)`, `summary(ok)`. Each call enqueues an event and broadcasts via `webContents.send`. Throttle line events at 50/s per stream to prevent renderer flood on chatty servers.
- **Hook into the startup machine** in `main.ts`: each state transition calls `emitter.start(step)` / `emitter.done(step)`. The `spawn` step also calls `emitter.argv(...)` with the resolved `node --import … cli.ts` argv. Server stdout/stderr is piped through `emitter.line(...)`.
- **Privacy filter**: lines containing strings matching `/key=|token=|secret=|password=|authorization:/i` are redacted to `[redacted]`. `argv` events strip `process.env`-derived values; only the argv array itself is shown.
- **Renderer UI** in `packages/electron/src/renderer/wizard.html` (or split into a new `loading.html` if too tangled): a fixed-height log pane (16 lines, monospace, dark surface, auto-scroll-to-bottom) appears below the spinner when the first `bootstrap-log` event arrives. Step transitions render as bold lines (`▶ spawn`, `✓ spawn (1.2s)`); argv events render as a wrapped grey line; stdout/stderr lines render as plain. The pane is collapsible via a "Show details ▼ / Hide details ▲" toggle, with the collapse preference persisted to disk (so subsequent launches respect the user's choice).
- **Accessibility**: the log pane is a `role="log"` live region with `aria-live="polite"` and `aria-atomic="false"`, so screen readers announce new entries without overwhelming.
- **Persistent log file**: the same events are appended to `<userData>/wizard-bootstrap.jsonl` (max 1 MB, rotated). Doctor's existing log surfaces a "View bootstrap log" link to this file.

## Capabilities

### Modified Capabilities

- `first-run-wizard`: adds two new Requirements — one for the bootstrap-log IPC contract + renderer pane, one for the redaction + rotation guarantees.

## Impact

- **Scope**: 3 new files (`bootstrap-log-emitter.ts`, `bootstrap-log-renderer.tsx` or vanilla JS in `loading.html`, the IPC type-shared header) + edits to `main.ts` (hook points) + edits to `wizard.html` (host the pane). Estimated ~250 LOC + tests.
- **User-visible**: spinner stays as the primary signal; details pane is collapsed by default so first-time users get the same "clean" surface. Power users / debuggers open it once and it stays open. On true hangs, the last few lines tell the support channel exactly where things stalled.
- **Performance**: throttled line events keep IPC traffic bounded; renderer scrolls a 16-line ring buffer (no DOM growth). Persistent log capped at 1 MB with rotation.
- **Privacy**: redaction regex covers common credential patterns; argv strip removes env-derived values. Acknowledged limitation: a malicious server log line could embed a credential outside the regex patterns. The persistent log is local-only; never uploaded.
- **Risk**: low. Strictly additive to the wizard surface — no production launch path changes.
- **Out of scope**: telemetry, remote log upload, redaction tuning beyond the initial regex set, replacing the wizard with a different UX, doctor integration beyond the "View log" link.
- **Sequencing**: depends on neither doctor fix; can land independently. Highest value when combined with the doctor fixes (so Doctor's "Server launch test" passing AND the wizard log are both informative when triaging Windows-specific issues).
