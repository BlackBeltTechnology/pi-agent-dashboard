# Tasks

## 1. Shared event-shape contract

- [ ] 1.1 Add `packages/shared/src/wizard-bootstrap-log.ts` exporting the `BootstrapLogEvent` discriminated union, the `BootstrapStep` enum (mirrored from `main.ts`'s state machine), and the redaction-regex constant. Pure module, no runtime deps.
- [ ] 1.2 Unit test the redaction helper in `packages/shared/src/__tests__/wizard-bootstrap-log.test.ts`: input lines with `key=…`, `Authorization: Bearer …`, `password=…`, `token=…`, `secret=…` are all rewritten to `[redacted]`. Negative case: a line containing `keyword` (substring with no `=`) is NOT redacted.

## 2. Main-process emitter

- [ ] 2.1 Add `packages/electron/src/lib/bootstrap-log-emitter.ts` exporting class `BootstrapLogEmitter` with methods: `attach(webContents)`, `detach()`, `start(step, detail?)`, `done(step)`, `error(step, err)`, `argv(step, argv)`, `line(step, stream, text)`, `summary(ok)`. Internally maintains a ring buffer of the last 256 events for late-attaching renderers (e.g. wizard window opened after `check-health` already ran).
- [ ] 2.2 Throttle: `line(...)` events are coalesced to max 50/sec per `(step, stream)` tuple. Excess lines drop with a `truncated: true` marker on the next emitted line. Test the throttle with a synthetic 1000-line firehose, assert ≤ 60 events delivered over a 1 s window.
- [ ] 2.3 Persistent log: every event also appends to `<app.getPath('userData')>/wizard-bootstrap.jsonl`. Rotation when the file exceeds 1 MB → rename to `wizard-bootstrap.1.jsonl` (single backup; older overwritten). Use `fs.appendFile` + size check via `fs.stat`, not a heavier rotation lib.
- [ ] 2.4 Unit tests for the emitter in `packages/electron/src/lib/__tests__/bootstrap-log-emitter.test.ts`:
  - Events flow through `attach`d webContents.send mock.
  - Pre-attach events stored in ring buffer; on `attach`, the buffer replays in order.
  - `detach` stops sending but keeps writing to the file.
  - Throttle behaves as specified.

## 3. Hook into the startup machine

- [ ] 3.1 Instantiate one `BootstrapLogEmitter` at top of `main.ts`. Pass it to the state-machine functions.
- [ ] 3.2 Each state transition calls `emitter.start(...)` on entry and `emitter.done(...)` on exit. `error` paths call `emitter.error(...)`.
- [ ] 3.3 In the `spawn` step, before `spawnFromSource`, call `emitter.argv(step, [nodeBin, ...argv])`. Strip env-derived values; argv array only.
- [ ] 3.4 Pipe spawned server's `stdout`/`stderr` through `emitter.line(step, "stdout|stderr", line)`. Keep the existing log-to-disk side-effect; this is in addition.
- [ ] 3.5 When the wizard window is created, call `emitter.attach(window.webContents)`. When it closes, `detach`.
- [ ] 3.6 On `done` state, call `emitter.summary({ totalMs, ok: true })`. On `loading-page-error`, `summary({ totalMs, ok: false })`.

## 4. Renderer pane

- [ ] 4.1 In `packages/electron/src/renderer/wizard.html` (or a new `loading.html` if cleaner), add a collapsible details pane below the spinner. Default: collapsed. Toggle persists to `localStorage`.
- [ ] 4.2 Receive events via `window.electron.bootstrap.onLogEvent(handler)` (preload bridge). Render into a 16-line ring buffer with monospace font.
- [ ] 4.3 Visual treatment:
  - `step started` → bold line prefixed with `▶ `, light blue
  - `step ok` → bold line prefixed with `✓ `, green, includes elapsed
  - `step error` → bold line prefixed with `✗ `, red
  - `argv` → indented grey wrap (`  $ node --import …`)
  - `line stdout` → plain text
  - `line stderr` → red text
  - `summary` → centered bold green ✓ or red ✗
- [ ] 4.4 Accessibility: pane has `role="log" aria-live="polite" aria-atomic="false"`. Toggle button has `aria-expanded`.
- [ ] 4.5 "View full log" link below the pane opens `<userData>/wizard-bootstrap.jsonl` in the OS default text editor via `shell.openPath`.

## 5. Preload bridge

- [ ] 5.1 Add `packages/electron/src/preload/wizard-bootstrap-preload.ts` exposing `window.electron.bootstrap = { onLogEvent(handler), openLogFile() }`. Reuse the existing preload contract pattern from `doctor-preload.ts`.
- [ ] 5.2 Wire the preload into the wizard window's `webPreferences.preload` in `wizard-window.ts`.

## 6. Tests

- [ ] 6.1 Integration test (Vitest + happy-dom): mount the renderer in isolation, feed a sequence of `BootstrapLogEvent`s through the IPC handler, assert DOM contents match the visual treatment in § 4.3.
- [ ] 6.2 Smoke test on a clean Electron build: launch on macOS, confirm pane appears on first launch, toggles collapsed/expanded, persists choice across restarts. Confirm argv line shows the bundled-server invocation.
- [ ] 6.3 Smoke test on Windows VM with the spike artifact: launch, confirm the pane shows the slow Defender-scan period as a series of unchanged stdout lines (or no lines, in which case the spinner is honest about "still working").

## 7. Documentation

- [ ] 7.1 Delegate `docs/file-index-electron.md` updates to a general-purpose subagent: new rows for `bootstrap-log-emitter.ts`, `wizard-bootstrap-preload.ts`, `wizard-bootstrap-log.ts` (shared), and an updated row for `main.ts` noting the bootstrap-log hook points.
- [ ] 7.2 Delegate `docs/architecture.md` update for the wizard-bootstrap log: a one-paragraph addition under "Bootstrap flow" naming the new IPC channel + persistence file.
