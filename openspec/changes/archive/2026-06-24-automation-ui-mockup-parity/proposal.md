## Why

`redesign-automation-editor-and-board` (archived 2026-06-23) shipped the
**functional** plumbing — grouped editor, two-level trigger picker, `ModelSelector`,
edit/delete/update — but did **not** carry the mockups' visual design language into
the code, and left two mockup features entirely unbuilt. The mockups under
`design/mockup-create-dialog.html` + `design/mockup-content-view.html` were declared
the "source of truth for layout", and `design.md` promised the board would "reuse the
dashboard's session visual primitives so automation cards read as siblings of session
cards". None of that reached production.

1. **Board is a plain bordered list, not a session-card sibling.** `AutomationBoard.tsx`
   renders each automation as a flat `<li>` with a colored dot. The mockup + design.md
   called for: a status rail (green/amber/red/muted), the headless source icon
   (`mdiRobotOutline`), status **pill** badges, the animated barber-pole stripe overlay
   on a running card, and the neon rotating glow + rim on the selected card. The host's
   global FX classes (`.card-stripes-fx`/`.card-stripes-running`, `.card-glow-fx`,
   `.card-ring-fx`) already exist and are gated by `prefers-reduced-motion` — they are
   simply **unused** by the plugin.

2. **No per-card last-run summary.** The mockup shows each card's latest run inline
   ("✓ done · 2d ago — 3 findings · view result ▸"). The shipped card shows nothing;
   runs live only in the separate table.

3. **Runs table omits findings + contextual link.** The mockup runs table shows a
   findings summary and a status-specific link (running→watch, done→result, error→log).
   The shipped table shows status, runId, relative time, and a generic "view ▸" link.
   `RunRecord` carries **no findings count** today.

4. **Editor dropped its visual polish.** `CreateAutomationDialog.tsx` is functionally
   complete (it even improves on the mockup with an `@role`/specific-model toggle) but
   renders flat: no bordered group boxes, plain `<select>` for Scope and Action instead
   of segmented controls, no header scope/path subtitle or pill-styled "armed on save"
   chip, a single-column plain checklist instead of the styled grid, a locale-string
   next-run instead of a relative ("in 18h 12m") preview with a pulsing dot, and no
   footer caption.

5. **No way to Stop a running run.** The mockup card shows "⏹ Stop" on a running
   automation. There is **no abort path anywhere**: `ServerPluginContext` exposes no
   abort hook, the engine never kills a spawned run, and no `/stop` route exists. The
   host *does* support session abort (`POST /api/session/:id/abort` →
   `piGateway.sendToSession(id, { type: "abort" })`) and the engine already captures each
   run's `sessionId` — the seam just isn't wired through to plugins.

## What Changes

- **Board → session-card visual language.** Replace the flat `<li>` with a card that
  carries a status rail + status dot (shared palette: active/idle green, running amber +
  pulse, error red, disabled/ended muted), the headless source icon, status pill badges,
  the barber-pole stripe overlay on a running card (global `card-stripes-fx
  card-stripes-running`), and the neon glow + rim on the selected card (global
  `card-glow-fx`/`card-glow-fx-outer`/`card-ring-fx`). The plugin cannot import
  `packages/client/src/lib/session-status-visuals.ts` (no dependency on `@client`), so it
  **replicates the small status→class mapping locally** and applies the host's
  already-global CSS classes by name — the same approach the mockup used.
- **Per-card last-run summary.** Each card shows its latest run inline (status pill +
  relative time + findings + result/log link), derived from the runs already fetched.
- **Card meta + header.** Card meta adds `mode` (worktree/local); the board header adds
  the repo crumb.
- **Runs table → findings + contextual links.** Add a findings count column and a
  status-specific link label (watch/result/log); the running row gets the stripe overlay.
- **Editor visual polish.** Bordered group boxes (Identity/Trigger/Action/Advanced),
  segmented controls for Scope and Action, trigger category pills with icons + a styled
  event checklist grid, a relative next-run preview with a pulsing green dot, the header
  scope/path subtitle + pill-styled "armed on save" chip, and a footer caption. The
  existing `@role`/specific-model toggle is kept (it is better than the mockup's single
  select).
- **Stop a running run (cross-package).**
  - **Host:** add `abortSession(sessionId): boolean` to `ServerPluginContext` (+
    `ServerContextDeps` wiring) that calls the existing gateway abort
    (`sendToSession(id, { type: "abort", sessionId: id })`). Gated like `spawnSession`
    (first-party/trusted plugins only).
  - **Plugin server:** add `POST /api/plugins/automation/stop` (scope + cwd + runId) and
    an engine `stopRun(runId)` that aborts the run's session and finalizes the run record
    **idempotently** vs the `agent_end` capture path (a stopped run does not double-finish).
  - **Plugin client:** a "Stop" action on running cards (and a `⋯` overflow that holds
    Delete) wired to the new route.
- **Findings count (server).** When finishing a run, `run-store` computes a findings
  count from `result.md` (heuristic: count of top-level markdown bullet lines; `0` when
  the run auto-archives empty). Add `findings?: number` to `RunRecord`; the client renders
  it in the per-card summary and the runs table.

## Capabilities

### Modified Capabilities

- `automation-content-view`: board adopts the session-card status visual language;
  per-automation cards gain a last-run summary, a `mode` meta field, and a Stop action on
  running cards; the runs table surfaces a findings count + status-specific links; the
  editor gains grouped boxes, segmented Scope/Action controls, a relative next-run
  preview, the header subtitle/armed chip, and a footer caption.
- `automation-run-lifecycle`: a running run CAN be stopped by the user (aborts the run
  session and finalizes the record); a finished run's record carries a findings count
  derived from `result.md`.

## Impact

- **Code**:
  - `packages/dashboard-plugin-runtime/src/server/server-context.ts` — add
    `AbortSessionFn` type, `abortSession` field on `ServerPluginContext` +
    `ServerContextDeps`, wire it in `createServerPluginContext`.
  - `packages/server/src/*` — supply `abortSession` when constructing the plugin context
    (route to `piGateway.sendToSession(id, { type: "abort", sessionId: id })`), gated to
    trusted plugins.
  - `packages/automation-plugin/src/server/engine.ts` — `stopRun(runId)` (abort session +
    finalize idempotently); track abort so `agent_end` does not double-finish.
  - `packages/automation-plugin/src/server/index.ts` — pass `abortSession` into the
    engine; mount the `/stop` route handler.
  - `packages/automation-plugin/src/server/routes.ts` — `POST /stop`.
  - `packages/automation-plugin/src/server/run-store.ts` — compute + persist `findings`
    count on finish.
  - `packages/automation-plugin/src/shared/automation-types.ts` — add `findings?: number`
    to `RunRecord`.
  - `packages/automation-plugin/src/client/api.ts` — `stopAutomationRun(...)`.
  - `packages/automation-plugin/src/client/AutomationBoard.tsx` — session-card visuals,
    per-card last-run, runs-table findings + links, Stop + `⋯` overflow.
  - `packages/automation-plugin/src/client/CreateAutomationDialog.tsx` — group boxes,
    segmented controls, trigger pills + checklist grid, relative next-run + pulsing dot,
    header subtitle/chip, footer caption.
  - `packages/automation-plugin/src/client/automation-card-visuals.ts` (new) — local
    replica of the status→class mapping (palette, rail, dot, source icon, stripe/glow
    class selection).
- **Tests**: `AutomationBoard.test.tsx` (rail/pill/stripe classes, last-run summary,
  findings column, Stop action), `CreateAutomationDialog.test.tsx` (group boxes,
  segmented controls, relative next-run), engine stop test (abort + idempotent finalize),
  `run-store` findings-count test, plugin-context `abortSession` gating test.
- **Docs**: `docs/file-index-plugins.md` + `docs/file-index-server.md` rows for touched +
  new files (delegated, caveman style).
- **UX**: the board and editor read as siblings of the session UI; runs are stoppable and
  show findings at a glance.
- **Migration / compatibility / rollback**: `findings?: number` is additive on
  `RunRecord` — old records without it render as no-count. `abortSession` is additive on
  the plugin context. No `automation.yaml` format change. Rollback = revert the client
  components, the `/stop` route + engine `stopRun`, the context `abortSession` hook, and
  the run-store findings computation; existing run records keep working.
