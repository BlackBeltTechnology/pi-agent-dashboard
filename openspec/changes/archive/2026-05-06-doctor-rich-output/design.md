## Context

The Electron app's Doctor diagnostic is implemented in `packages/electron/src/lib/doctor.ts` (`runDoctor()` returns `DoctorReport { checks, summary }`) and rendered through Electron's `dialog.showMessageBox` from `app-menu.ts`. The native dialog cannot style anything: it shows the report as a plain `detail` blob, with no per-section grouping, no actionable rows, no row hover, no copyable Markdown export, and no way to surface a remediation suggestion next to the failing check. The dialog is also Electron-only — phone / browser users running against a remote dashboard can't reach it at all.

The doctor logic itself is healthy: `runDoctor()` is a pure synchronous (mostly) function that produces a fixed taxonomy of checks (Electron version, system/bundled Node, bundled npm, pi CLI, openspec CLI, server code, offline-packages bundle, tsx, dashboard server, setup wizard, API key, server log, server launch test, managed install). What's missing is (a) section metadata so a renderer can group, (b) a `suggestion` field so failing rows can surface one-click next steps, (c) a renderer that isn't a native dialog, (d) a server endpoint so the web UI can render the same report, and (e) systematic fault tolerance so the doctor itself never breaks while diagnosing a broken installation.

Stakeholders: Electron desktop users (primary — they hit the diagnostic when wizard / install fails), web/PWA users connected to a remote dashboard (secondary — currently blind), maintainers triaging GitHub issues (the Markdown export reduces back-and-forth).

## Goals / Non-Goals

**Goals:**
- One source of truth for the check taxonomy (`section`, `name`, `status`, `message`, `detail?`, `suggestion?`, `fixable?`) shared by Electron and web renderers.
- Replace the native Doctor dialog with a styled Electron BrowserWindow that matches the existing wizard's visual language (no React, no extra build step — hand-rolled HTML/CSS like `wizard.html`).
- Add a `GET /api/doctor` route + a `<DiagnosticsSection />` in Settings so web users get the same diagnostic data, gated behind the existing auth pipeline.
- Markdown export (`Copy as Markdown`) usable for GitHub issue paste, available on both surfaces.
- Backfill `suggestion` text for every existing error/warning case so the user never sees a red row without a "what to do next" line.
- Fault-tolerance everywhere: every spawn bounded + classified, every "mandatory" op logged + surfaced, renderer never blank.

**Non-Goals:**
- No new check types in this change — the taxonomy stays exactly as today, only metadata and rendering change. Adding new checks is a follow-up.
- No live polling / auto-refresh — the user clicks `[Re-run]` manually.
- No anonymous web access — the route reuses the standard `localhost-guard` / OAuth gate. We do not add a public diagnostic endpoint.
- No structured `[Fix]` action automation — clicking `[Run setup wizard]` opens the existing wizard window; we don't auto-install missing pieces from the doctor view.
- No Markdown rendering library on the Electron side. The Electron `doctor.html` keeps suggestions as plain inline text. Only the web side uses `MarkdownContent.tsx` (already in the bundle) for the suggestion field.

## Decisions

### Decision 1: Move detection to `packages/shared/src/doctor-core.ts`, keep Electron-only checks in `doctor.ts`

`doctor-core.ts` (new, in `@blackbelt-technology/pi-dashboard-shared`) hosts:
- The `DoctorCheck` / `DoctorReport` types with the new `section` + `suggestion` fields.
- `SECTION_OF: Record<CheckName, DoctorSection>` — pure mapping from canonical check name to section.
- `SUGGESTIONS: Record<CheckName, (status, detail, kind?) => string | undefined>` — pure mapping from `(checkName, status, failureKind)` to a remediation suggestion (returns `undefined` when `status === "ok"`).
- `runSharedChecks(deps)` — runs every check that does NOT require `electron` runtime APIs. `deps` is an injectable shape so the server route can pass non-Electron implementations of "where does the user's home live", "which managed dir to inspect", etc.
- `formatDoctorReportMarkdown(report)` — pure formatter that produces one Markdown table per section + a summary header + a "Remediation" bullet list of suggestions for non-ok rows.

`packages/electron/src/lib/doctor.ts` keeps:
- Electron-only checks: Electron version, bundled Node, bundled npm, server-code path under `resourcesPath`, offline-packages bundle, server-launch sanity test, setup wizard state file (already Electron-only).
- Imports `runSharedChecks`, `SECTION_OF`, `SUGGESTIONS`, `formatDoctorReportMarkdown` from the shared core.
- Stamps `section` + `suggestion` on every check it pushes by looking up `SECTION_OF[name]` / `SUGGESTIONS[name](status, detail, kind)` once at the end of `runDoctor()`.

**Why this split:** the offline-packages bundle, bundled-node lookup, and `app.getVersion()` all require `electron` APIs or `process.resourcesPath`. We don't want `pi-dashboard-shared` to import `electron`. Keeping the Electron-only arm in `doctor.ts` and delegating the portable arm to shared is the cleanest cleavage and matches how the rest of the repo handles Electron / shared / server separation (e.g., `tool-registry`, `platform/`).

**Alternative considered:** put everything in `doctor-core.ts` with conditional imports / `process.versions.electron` guards. Rejected — `pi-dashboard-shared` is consumed by the server (no Electron at all), and a dynamic `await import("electron")` would explode the bundle at type-check time.

### Decision 2: Hand-rolled HTML for the Electron Doctor window (no React)

Match the existing `packages/electron/src/renderer/wizard.html` pattern — single HTML file with a `<style>` block reusing the same CSS tokens. The renderer fetches the report via `window.electron.doctor.run()` (preload IPC), renders it as one `<table>` per section, and wires the toolbar buttons to preload methods.

**Why no React:** wizard.html proves the convention works; pulling in React/Vite for one diagnostic window doubles the package size and introduces a build pipeline gap (today wizard.html ships as a static asset, no esbuild step). The doctor view is read-mostly — no complex state, no reducer needed.

**Alternative considered:** reuse the dashboard's existing React bundle inside the Electron window via a `file://` load of `dist/client/index.html` with a router param `?view=doctor`. Rejected — the dashboard React app needs a live WebSocket connection to the server, and the doctor must work even when the server is dead (its primary failure mode).

### Decision 3: `GET /api/doctor` is auth-gated identically to `/api/config`

The route handler:
1. Calls `runSharedChecks(...)` (no Electron-specific arm). The result is missing the Electron / bundled-Node / offline-packages rows; that's correct — the web client is talking to a server that may or may not be running inside Electron, and even when it is, the user opening Settings/Diagnostics is interested in *this server's* health, not the client app's.
2. Stamps `section` + `suggestion` via the shared maps.
3. Returns `{ checks, summary, generatedAt: Date.now() }`.

The route is registered in `server.ts` alongside the other `/api/*` routes and inherits the global auth guard. No anonymous access, no per-route override. Same surface area as `/api/config`.

**Alternative considered:** expose Electron-specific checks too via an IPC bridge from the running Electron app to its embedded server. Rejected as scope creep; the web client should not pretend to know about a remote machine's Electron internals.

### Decision 4: `section` taxonomy is fixed and minimal — five buckets

`type DoctorSection = "runtime" | "pi-tooling" | "server" | "setup" | "diagnostics"`.

| Section | Checks |
|---|---|
| `runtime` | Electron, System Node.js, Bundled Node.js, Bundled npm |
| `pi-tooling` | pi CLI, openspec CLI |
| `server` | Dashboard server code, Offline packages bundle, TypeScript loader (tsx), Dashboard server, Server log, Server launch test |
| `setup` | Setup wizard, API key |
| `diagnostics` | Managed install (~/.pi-dashboard) |

Five buckets is enough to give the eye useful chunking without over-categorizing. `diagnostics` is also where `assumedMandatory` surfaces its "Doctor internal: <label>" rows.

**Alternative considered:** seven buckets splitting tooling further. Rejected — fewer chunks render better at narrow widths (mobile web view).

### Decision 5: `suggestion` strings are plain text (Electron) / Markdown-rendered (web)

Same string for both surfaces. Electron renders it inline in a `<div class="suggestion">`; web renders it through the existing `<MarkdownContent>` component. We constrain suggestion content to a small subset of Markdown (`**bold**`, single-backtick code, `[link text](url)`) so the plain-text rendering on Electron remains readable even without a markdown parser. This subset is lint-enforced in `doctor-core.test.ts`. `detail` text is free-form (not subset-constrained) but always escaped at format time (Decision 8).

We backfill suggestions only for `status: "warning" | "error"`. `ok` rows show no suggestion column.

### Decision 6: Phasing — Electron window first, web Diagnostics second

The proposal already calls this out. The tasks file orders the Electron arm (Phase A: shared core + doctor-core tests + Electron window + IPC) before the web arm (Phase B: server route + DiagnosticsSection + tests). This way, if Phase B is descoped, Phase A stands alone as a complete shippable improvement.

### Decision 7: Every check is fault-isolated; the Doctor never crashes the renderer

The doctor's whole job is to diagnose a broken installation. It MUST itself be the most fault-tolerant code in the repo. The design encodes this as four overlapping rules:

**Rule A — Per-check isolation.** Every check is produced inside a `safeCheck(name, fn)` wrapper that catches *any* throw / rejection from `fn` and converts it into a `status: "error"` row with `message: "Check failed to run"`, `detail: <error.message + stack-head>`, and a `suggestion` pointing at "This is a doctor-internal failure — please file an issue with the Markdown export." A bug in one check (or a thrown deps function) cannot disable the rest of the report.

**Rule B — Every external invocation is bounded and classified.** A new shared helper `safeExec(cmd, opts)` in `doctor-core.ts` wraps `execSync` with:
- A configurable timeout (default 5000 ms; cold-start probes pass `timeoutMs: 15000`); classified as `"timeout"` not generic "error".
- Distinct error classifications: `not-found` (ENOENT), `permission-denied` (EACCES/EPERM), `timeout`, `non-zero-exit` (capturing exit code + last 500 chars of stderr, ANSI-stripped), `unknown`.
- A `windowsHide: true` default to prevent flashing console windows that could be mistaken for a hang.
Every classification produces a different, actionable `suggestion` (e.g., `not-found` → "Run setup wizard"; `permission-denied` → "chmod +x <path> or reinstall"; `timeout` → "did not respond within Ns — antivirus or credential prompts may be blocking it"). The actual deadline appears in the suggestion text so users see the real number.

**Rule C — Mandatory operations log loudly.** A second new helper `assumedMandatory(label, fn, deps)` wraps any operation we'd normally consider safe (bundled-Node existence, `app.getVersion()`, `process.resourcesPath` access, reading the offline-packages manifest — note: `mode.json` removed by `simplify-electron-bootstrap-derived-state`; use `health.starter` instead, the server-launch sanity test). When `fn` throws, `assumedMandatory` writes a single-line structured log entry to `<deps.managedDir>/doctor.log` (append mode, timestamped, JSON-per-line) AND surfaces a high-visibility row in the report's `diagnostics` section labelled "Doctor internal: <label>" with the captured error. Before each append, ring rotation is performed: if the file exceeds 1 MB, `doctor.log` is renamed to `doctor.log.1` (replacing any existing `.1`) and a fresh file is created. The log path itself is shown in the Doctor window toolbar (`[Open doctor.log]`) next to `[Open server.log]` so users can paste it into issues. Logging failure is always silently swallowed — a broken log file MUST never cascade into the report.

**Rule D — The renderer degrades gracefully.** The Electron window's `doctor.html` JS handler for `window.electron.doctor.run()` is wrapped in `try/catch`; on rejection it shows a single-row fallback table ("Doctor failed to produce a report — see ~/.pi-dashboard/doctor.log") with the raw error and an `[Open doctor.log]` button. The web `<DiagnosticsSection />` mirrors this: if `/api/doctor` returns non-200 or the response shape is invalid, the component renders an inline error block with the HTTP status, the last 500 chars of the response body, and a `[Re-run]` button — never an empty page.

### Decision 8: Error messages follow a fixed shape — what + why + next-step

Every non-ok `message` and `suggestion` SHALL conform to:
- `message` answers **what** is wrong in ≤ 80 chars (e.g., `"pi CLI not found on PATH"` — not `"error"` or `"failed"`).
- `detail` answers **why / where** in any length (the path searched, the exit code, the stderr tail, the timeout duration).
- `suggestion` answers **what to do next** with a concrete command, menu path, or doc link.

The shared `doctor-core.test.ts` lint enforces all three fields are non-empty for every non-ok status across every check name in `SECTION_OF`. A new check added without fault classification fails the lint.

`detail` text is escaped at format time: every `detail` string emitted into the Markdown table is wrapped in a fenced ` ```text ... ``` ` block inside the table cell using HTML line-break encoding (`<br>`) so embedded pipe characters cannot break the table column count. Stderr tails are run through a pure `stripAnsi(input)` helper before storage in `detail`.

### Decision 9: Bootstrap-node execution fault path is first-class

The Electron app's bundled-Node and server-launch checks are the most brittle (cross-platform spawn, signed-binary issues, SmartScreen, Gatekeeper, AppArmor). For the bundled-Node check specifically:
- `safeExec("<bundledNode> --version", { timeoutMs: 15000 })` is wrapped to capture **both** the spawn-level error (Node binary missing / quarantined / ABI-mismatched) and the runtime error (Node spawned but immediately exited).
- A non-zero exit produces `message: "Bundled Node executed but reported failure"`, `detail` containing the exit code + stderr tail, and `suggestion: "Reinstall PI Dashboard — the bundled Node binary is corrupt."`.
- A spawn ENOENT produces `message: "Bundled Node binary missing from app resources"`, `detail` listing the searched path, `suggestion: "This is a packaging defect — reinstall PI Dashboard or report at <issue url>."`.
- A spawn EACCES produces `message: "Bundled Node binary not executable"`, `detail` showing the file mode, `suggestion: "On Linux, run chmod +x <path>; on macOS, run xattr -cr <Resources path> to clear quarantine."`.
- A timeout produces `message: "Bundled Node hung during version probe (15s deadline exceeded)"`, `suggestion: "Antivirus or endpoint security is likely scanning the binary on first launch — wait 30s and re-run, or whitelist the app."`.

The server-launch sanity test (existing in `doctor.ts`) gets the same treatment: spawn errors, non-zero exit, and timeouts each produce distinct messages + suggestions. Output (stderr tail, ANSI-stripped) is **always** included in `detail` so users can paste it into issues.

## Risks / Trade-offs

- **Risk:** Adding `section`/`suggestion` to `DoctorCheck` is a backwards-incompatible change for anyone importing the type from the Electron package. **Mitigation:** the type only has one importer in-tree (`app-menu.ts`), and we make both new fields **required** at the type level but **optional in practice** by stamping them in a single post-pass at the end of `runDoctor()`. External callers don't exist (verified by `git grep "DoctorCheck"` — only `doctor.ts` + `app-menu.ts`).
- **Risk:** The plain-text formatter (`formatDoctorReport`) may have downstream callers we miss. **Mitigation:** keep its signature & output bytes identical; the new Markdown formatter is a NEW function (`formatDoctorReportMarkdown`), not a rewrite. Lint/test asserts the plain-text output stays stable on a snapshot fixture.
- **Risk:** The Electron BrowserWindow opens slowly the first time. **Mitigation:** lazy-load (created on menu click, not on app boot) and reuse the existing window if already open (focus instead of recreate).
- **Risk:** The web `/api/doctor` exposes filesystem paths to authenticated users. **Mitigation:** path-redaction is **not** added. The route is admin-only (same gate as `/api/config`, which already exposes far more sensitive data — secrets, OAuth tokens). Documented in `docs/architecture.md`.
- **Risk:** The shared core's `runSharedChecks` needs to call `execSync` for `node --version` etc. **Mitigation:** reuse `@blackbelt-technology/pi-dashboard-shared/platform/exec.js` (already imported by `doctor.ts`); no new shell handling.
- **Risk:** The Doctor window leaks if `openDoctorWindow()` retains a reference to a destroyed window. **Mitigation:** wire `window.on("closed", () => doctorWindow = null)`.
- **Risk:** Preload IPC channel name drift breaks every toolbar button silently. **Mitigation:** define `DoctorBridge` TypeScript interface in `packages/electron/src/lib/doctor-bridge-contract.ts` imported by BOTH `doctor-preload.ts` and the type-checked renderer entry; channel-name-drift lint test asserts every IPC handle name registered in `doctor-window.ts` is present in `DoctorBridge`.
- **Risk:** A hung `execSync` (Windows GCM prompt, antivirus scan, hung helper) freezes the entire report indefinitely. **Mitigation:** Decision 7 Rule B — every probe goes through `safeExec` with a hard timeout classified as `"timeout"` rather than "error".
- **Risk:** A throw inside a single check discards the whole report. **Mitigation:** Decision 7 Rule A — `safeCheck(name, fn)` per-check isolation.
- **Risk:** `~/.pi-dashboard/doctor.log` itself becomes unwriteable. **Mitigation:** the `assumedMandatory` helper's logging arm is itself wrapped in `try/catch`; logging failure must NEVER cascade into the report.
- **Risk:** A contributor adds a new check name without registering it in `SECTION_OF` / `SUGGESTIONS`. **Mitigation:** the shared `doctor-core.test.ts` lint iterates every push site, asserts each name is keyed in both maps, and asserts every non-ok branch has a non-empty `message` + `detail` + `suggestion` per Decision 8.

## Migration Plan

1. Land `doctor-core.ts` (with fault-tolerance helpers) + tests in `pi-dashboard-shared` (Phase A1).
2. Refactor `doctor.ts` to import from shared, route every spawn / mandatory op through the helpers, add the post-pass section/suggestion stamping (Phase A2).
3. Add `doctor-window.ts` + `doctor.html` + preload bridge with typed contract; replace `dialog.showMessageBox` call in `app-menu.ts` (Phase A3). Rollback path is `git revert`.
4. Land `/api/doctor` route + tests with fault-tolerance arm (Phase B1).
5. Add `<DiagnosticsSection />` + `doctor-api.ts` + mount in `SettingsPanel.tsx` with clipboard textarea fallback (Phase B2).
6. Update AGENTS.md, README.md, docs/architecture.md, `electron-shell` & `first-run-wizard` specs.

No DB migration. No persisted state. No flag rollout.

## Resolved Clarifications

All open questions have been answered (clarification round 2026-05-03):

1. **`[Run setup wizard]` semantics** — restarts the wizard from step 1 (re-evaluates state). The Doctor button is a "re-trigger first run flow" affordance, not a "resume" affordance.
2. **Web rendering of Electron-only rows** — omit. The server route doesn't return them; the client doesn't render rows it doesn't have.
3. **Doctor log rotation** — ring rotation, cap at 1 MB. `doctor.log` rotates to `doctor.log.1` (single back-up file). Performed lazily at the start of each `assumedMandatory` log append. Rotation itself is wrapped in `try/catch` and never propagates.
4. **`[Open doctor.log]` when the file does not exist** — surface a toast / inline status "No doctor log yet — the doctor has not encountered internal failures." The button stays visible but does not create an empty file. Same behaviour on the Electron and web sides.
5. **Clipboard rejection on web** — fall back to a textarea modal. When `navigator.clipboard.writeText` rejects, the web component opens a `<DialogPortal>`-rendered modal containing a `<textarea>` pre-filled with the Markdown report and pre-selected, plus a brief instruction "Your browser blocked clipboard access — press Ctrl/Cmd+C to copy." The modal closes on Escape or backdrop click.
6. **Auth gate parity with `/api/config`** — confirmed. The auth-gate test asserts byte-identical status codes for unauthenticated-from-non-bypass-network requests rather than hardcoding a status.
7. **`safeExec` timeout override** — `safeExec(cmd, opts)` accepts an optional `timeoutMs` parameter; default 5000 ms. The bundled-Node version probe and the server-launch sanity test both pass `timeoutMs: 15000`. Each timeout is reflected in the suggestion text ("did not respond within 5s" vs. "within 15s").
8. **`detail` escaping for the Markdown formatter + ANSI stripping** — every `detail` string emitted into the Markdown table is wrapped in a fenced ` ```text ` block with `<br>` line breaks. Before storage in `detail`, stderr tails are run through `stripAnsi(input)` (regex-based, no dependency). The Markdown subset lint applies only to `suggestion`; `detail` is free-form but always escaped at format time.
9. **Doctor log path follows `MANAGED_DIR`** — confirmed. `assumedMandatory` derives the log path from the same `MANAGED_DIR` constant `doctor.ts` already uses; for the shared core, `MANAGED_DIR` is passed in via `deps`.
10. **Re-run button is disabled while a run is in flight** — the Electron renderer and the web `<DiagnosticsSection />` both track an `isRunning` boolean. While true, the `[Re-run]` button is `disabled` and shows a "Running…" label / spinner. Concurrent menu-click invocations are similarly serialized inside `doctor-window.ts`.

## Open Questions

None outstanding.
