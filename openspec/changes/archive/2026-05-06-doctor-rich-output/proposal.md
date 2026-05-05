## Why

The Doctor diagnostic (App menu → Doctor) currently renders as Electron's native `dialog.showMessageBox` with a plain-text `detail` field. That field is unstyled system-font text — no tables, no colors, no per-section grouping, no copy-by-row, no actionable buttons next to errors. The user explicitly flagged it as "very ugly and hard to read." Worse, the doctor is **only reachable from the Electron menu**, so phone / remote-browser users running against a remote dashboard server have no way to diagnose installation problems.

This change replaces the native dialog with a rich, styled diagnostic experience available in **both surfaces**: a dedicated Doctor BrowserWindow in the Electron app and a Settings → Diagnostics page in the web UI. Both share the same data shape and rendering logic where possible.

## What Changes

- **Doctor data model upgrade**: extend `DoctorCheck` with `section: "runtime" | "pi-tooling" | "server" | "setup" | "diagnostics"` and `suggestion?: string` (markdown-friendly) fields. Backfill suggestions for every existing error / warning case so each problem comes with a one-click or one-paste-able next step.
- **New shared core** `packages/shared/src/doctor-core.ts`: pure detection helpers usable from both the Electron main process and the dashboard server. Existing electron-only `doctor.ts` keeps its Electron-specific checks (Electron version, `resourcesPath` offline-packages bundle, server-launch sanity test) but delegates to the shared core for runtime / tooling / managed-install detection.
- **New server route** `GET /api/doctor` returning `{ checks: DoctorCheck[], summary }`. Auth-gated through the existing `localhost-guard` / OAuth pipeline (admin-only — same gate as `/api/config`).
- **Electron Doctor window**: new `packages/electron/src/lib/doctor-window.ts` + `packages/electron/src/renderer/doctor.html` (hand-rolled HTML+CSS matching the wizard's visual language — no React, no extra build pipeline). Replaces the `dialog.showMessageBox` call in `app-menu.ts`. Renders checks grouped by `section`, each as a table row with status pill, version, source, truncated path (hover-full), and per-error `[Fix]` / `[Open log]` / `[Run setup]` buttons. Top toolbar: `[Re-run]`, `[Copy as Markdown]`, `[Copy as Plain]`, `[Open server.log]`, `[Open doctor.log]`, `[Run setup wizard]`.
- **Web Diagnostics page**: new `packages/client/src/components/DiagnosticsSection.tsx` mounted in the Settings panel as a new section between "General" and "Tools". Fetches `/api/doctor`, renders the same grouped sections + suggestion callouts using existing Tailwind components (`StatusPill`, `MarkdownContent` for the suggestion field). Includes the same `[Copy as Markdown]` action; omits Electron-only actions (`[Open server.log]`, `[Run setup wizard]`) since the web UI can't reach the local Electron app.
- **Markdown formatter**: new `formatDoctorReportMarkdown(report)` in `doctor-core.ts`, producing a GitHub-issue-paste-friendly table (one table per section + a summary line + an "Open issues" bullet list of suggestions for failing checks). Existing `formatDoctorReport` (plain) kept for terminal/CLI scenarios.
- **Fault-tolerance core**: three new helpers in `doctor-core.ts` — `safeCheck` (per-check isolation), `safeExec` (bounded + classified spawn outcomes), `assumedMandatory` (logs to `~/.pi-dashboard/doctor.log` and surfaces a diagnostics row when "should-never-fail" operations fail). Every spawn / mandatory operation is wrapped. Error messages follow the contract: `message` (what) + `detail` (why/where) + `suggestion` (next step).
- **Tests**:
  - `doctor-format.test.ts` (shared) — locks the markdown table structure + column order + section headers + suggestion ordering across snapshot cases (all-ok, mixed warnings, hard errors with suggestions, empty optional bundle).
  - `doctor-core.test.ts` (shared) — covers section assignment for every check name + suggestion presence for every error/warning case + Markdown subset lint.
  - `doctor-fault-tolerance.test.ts` (shared) — `safeCheck` swallows throws; `safeExec` classifies ENOENT / EACCES / timeout / non-zero exit; `assumedMandatory` logs + tolerates unwriteable log; ring rotation at 1 MB; `stripAnsi`.
  - `doctor-route.test.ts` (server) — auth gate + JSON shape contract + fault-tolerance arm.
- **Doc updates**: AGENTS.md key files entries for `doctor-core.ts`, `doctor-window.ts`, `doctor.html`, `DiagnosticsSection.tsx`, `/api/doctor` route. README screenshot of the new doctor view (replaces the existing native-dialog one if any).

## Capabilities

### New Capabilities
- `doctor-diagnostic`: A user-facing diagnostic surface that detects every required dependency (runtime, pi tooling, server, setup state, managed install), groups results into sections, attaches actionable suggestions to errors / warnings, and exports both a styled rendering (Electron window + web Settings page) and a Markdown report suitable for issue paste. Reachable from the Electron menu AND the web UI; same data backbone. Fault-tolerant by construction — per-check isolation, bounded + classified spawns, mandatory-operation logging, graceful renderer fallback.

### Modified Capabilities
- `electron-shell`: replace the native Doctor dialog with a dedicated BrowserWindow opened from the App menu.
- `first-run-wizard` (light touch): add a `[Run Doctor]` link under the "Skip" affordance so users who hit a wizard error can pivot to the diagnostic view without restarting.

## Impact

**New files**
- `packages/shared/src/doctor-core.ts` — pure detection + section assignment + suggestion mapping + markdown formatter + fault-tolerance helpers (`safeCheck`, `safeExec`, `assumedMandatory`, `stripAnsi`)
- `packages/shared/src/__tests__/doctor-core.test.ts`, `doctor-format.test.ts`, `doctor-fault-tolerance.test.ts`
- `packages/electron/src/lib/doctor-bridge-contract.ts` — typed `DoctorBridge` interface shared by preload + renderer
- `packages/electron/src/lib/doctor-window.ts` — BrowserWindow factory
- `packages/electron/src/renderer/doctor.html` — hand-rolled renderer (matches wizard.html style)
- `packages/electron/src/preload/doctor-preload.ts` — IPC bridge
- `packages/electron/src/__tests__/doctor-window.test.ts` — channel-name-drift lint
- `packages/server/src/routes/doctor-routes.ts` — `GET /api/doctor`
- `packages/server/src/__tests__/doctor-route.test.ts`
- `packages/client/src/components/DiagnosticsSection.tsx` — Settings panel section
- `packages/client/src/lib/doctor-api.ts` — typed fetch helper

**Modified files**
- `packages/electron/src/lib/doctor.ts` — delegate to `doctor-core.ts`; add `section` + `suggestion` fields; route every spawn through `safeExec` and every mandatory op through `assumedMandatory`; export new markdown formatter
- `packages/electron/src/lib/app-menu.ts` — open the new window instead of native dialog
- `packages/electron/src/lib/wizard-window.ts` / `wizard.html` — `[Run Doctor]` footer link
- `packages/server/src/server.ts` — register the doctor route module
- `packages/client/src/components/SettingsPanel.tsx` — mount `<DiagnosticsSection />`
- `AGENTS.md`, `README.md`, `docs/architecture.md` — see What Changes

**APIs / dependencies**
- New REST: `GET /api/doctor` (auth-gated, JSON `{ checks, summary, generatedAt }`)
- New IPC: `doctor:run`, `doctor:open-log`, `doctor:open-doctor-log`, `doctor:run-setup`, `doctor:copy`, `doctor:open-managed-dir`; plus `wizard:open-doctor`
- No new runtime npm dependencies. Reuses existing `MarkdownContent.tsx` for the web suggestion callouts and existing wizard CSS tokens for the Electron renderer.

**User-facing behavior change**
- The Electron App menu → Doctor entry no longer opens a native modal; it opens a resizable window. Buttons / clipboard behaviour preserved (Copy + Run Setup). Existing keyboard shortcuts unaffected.
- Web users gain a new Settings → Diagnostics section. Hidden behind the same auth gate as the rest of Settings; no anonymous access.
- Plain-text `formatDoctorReport` output unchanged so any scripted callers (none currently in repo) keep working.

**Phasing**
The change ships as a single OpenSpec unit but the tasks file orders implementation so the Electron window can land first (Phase A) and the web counterpart second (Phase B). Phase B reuses the shared core landed in Phase A; if the web counterpart is descoped later, the Electron win is independently shippable.
