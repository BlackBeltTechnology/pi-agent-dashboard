# Proposal: polish-automation-board

## Why

The Automations board looks finished but fails at three everyday jobs. Stop does nothing on a run the engine lost track of: a server restart leaves `run.json` at `running`, and `engine.stopRun()` returns `false` for runs it doesn't know. Nothing on the board links to the run's session. `watch`, `result` and `log` all open a raw `<pre>` modal, although `RunRecord.sessionId` and the run-monitor route already exist. Edit is hidden behind `⋯`.

The surface also bypasses theme tokens (`#fcd34d`, `rgba(...)` literals), uses 10px buttons, prints raw cron strings and run ids, and repeats "0 findings" on every row. The daily `update-dashboard` automation triggered all of these on 2026-11-05 and 2026-11-06.

## What Changes

- **Navigation (option A).** Every run (the card's last-run line, each history row, each child row) gets **Open session ↗**, linking to `/session/:sessionId` (or `?archived=1` once the session is archived), and **Monitor**, linking to the existing `/folder/:encodedCwd/automations/run/:sid` route. The result/log view renders markdown instead of a `<pre>` dump.
- **Runs grouped per automation.** Each card carries a collapsible run history (latest 3 runs, "show all" expands). Rows show a human time ("Today 09:20") plus duration or error reason, and keep the full run id in a tooltip. The detached global "Recent runs" table is removed. **BREAKING (UI test hooks):** `automation-triage` / `automation-triage-empty` go away; the row hooks `automation-run-<runId>` / `automation-child-run-<runId>` are kept.
- **Editing (option E1).** **Edit** becomes a visible card button next to Run now and Stop. Clicking the automation name also opens the editor. Only Delete stays under `⋯`. The editor stays the existing modal; it opens on the section you clicked and shows an unsaved-change count in its footer.
- **Stop always works (option S1).**
  - The runs API flags as `orphaned` a `running` record the engine isn't tracking whose run started before the current server process. It also reports whether the run's session is connected and which scope the run belongs to. The card shows an **orphaned** pill and a warning that explains why and links to the session.
  - Stop on an orphan asks for confirmation. It kills only a session whose **bridge socket is open**, that **carries the dashboard's stamp for this run id**, and whose **cwd is inside the admitted scope**. A session id written in `run.json` alone is never trusted. Concurrent Stops for the same run collapse into one kill. The record is finalized `stopped` exactly once, with a visible "stopped after losing track" result. The ended session is then archived by the existing archive-on-end lifecycle.
  - Both stop entry points (REST and plugin action) admit the cwd and only act inside that scope.
  - The UI reports one outcome: `killed`, `not-found`, or `unconfirmed` ("process may still be running"). It never claims success it cannot verify.
- **Polish (P).**
  - Theme tokens only: status pills use the severity tint tokens, with no raw colour literals.
  - Buttons at the contract floor instead of 10px.
  - Humanised schedules ("Daily at 09:20"; cron on hover) and next-fire time ("tomorrow 09:20").
  - The findings chip appears only when the count is above 0.
  - `action: flows.run` reads as "flow `custom:x`".
  - The running stripe moves to the rail and pill instead of the whole card.
  - The empty state explains what an automation is and offers "+ Create Automation".
- Labels, routes and the remaining `data-testid`s are preserved (anti-slop-redesign *preserve* mode).
- Mockup: mockups/automation-board-redesign (in this change). Tabs A, E1, S1 and P are the chosen options; B, E2, E3 and S2 are explored and out of scope. Plan: `mockups/ui-plan.md`.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `automation-content-view`: The Triage run-list requirement becomes per-automation run history with session/monitor links and readable labels. The card last-run summary adds the session link, a visible Edit button and an orphaned state. New requirement for theme-token and readability polish.
- `automation-run-lifecycle`: The user Stop requirement gains scope admission. New requirements cover:
  - the orphaned-run definition;
  - a stamped-session-only orphan Stop target;
  - exactly-once, visible orphan finalization (including the parent);
  - honest Stop outcomes;
  - runs-listing fields (`orphaned`, session connectivity, scope).

  "Parent and child runs are visible in the UI" changes so that each child shows a findings chip when the count is above 0, plus session/monitor links.
- `automation-content-view` additionally modifies "Board adopts the session-card status visual language": the stripe moves to the rail and pill, and colours come from tokens.

## Impact

- **Client** (`packages/automation-plugin/src/client/`): `AutomationBoard.tsx` (card, run history, links, orphan banner, stop confirm), `automation-card-visuals.ts` (token classes), `CreateAutomationDialog.tsx` (open on a section, dirty count), `api.ts` (stop result shape), and a new small `schedule-format.ts` (cron → human text). `AutomationRunMonitor.tsx` is reused unchanged.
- **Server** (`packages/automation-plugin/src/server/`):
  - `engine.ts`: `bootedAt`, `isTracked`, `stopRun` returns an outcome, and the reaper uses compare-and-set.
  - `index.ts`: one `stopRun({ scopeBase, runId })` pipeline, cwd admission on `plugin_action`, and the stamp check.
  - `routes.ts`: `/runs` adds `orphaned`, `sessionConnected` and `scope`; `/stop` requires a folder cwd and returns `{ ok, outcome }`.
  - `run-store.ts`: `finishRunIfRunning` / `finishParentRunIfRunning`.
- **Shared**: `RunRecord` gains optional client-facing `orphaned`, `sessionConnected` and `scope` fields (not persisted).
- **Host** (additive, small): `abortSpawnedRun` args gain an optional `onResult({ outcome, pid })` callback, invoked on every path (including the early return and a throw), so the caller can tell a verified kill from anything else. The boolean return is unchanged, so the goal, team and mcp-server callers are unaffected. `PluginSessionManager` gains `isConnected(id)`, backed by the gateway's open sockets. Files: `packages/server/src/spawn-process/abort-spawned-run.ts`, `packages/dashboard-plugin-runtime/src/server/server-context.ts` (types), and `packages/server/src/server.ts` (wiring). The links use the existing `/session/:id` route.
- **Tests**: vitest for the engine/route fallback and schedule formatting; component tests for links, orphan state, and Edit visibility. The Playwright hooks `automation-triage*` are retired.
- **Out of scope**: master-detail (B), inline/YAML editing (E2/E3), and restart survival / reconnect rebinding (S2, the engine's in-memory loss and the server un-archiving reconnected sessions). S2 is a candidate follow-up change.

## Discipline Skills

- `security-hardening`: Stop on an orphan kills a process named by an on-disk record that workspace content could forge. The kill requires an open bridge socket, the dashboard's own run stamp, a cwd inside the admitted scope, cwd admission on both entry points, and the trusted `abortSpawnedRun` gate with identity verification.
- `doubt-driven-review`: retiring the `automation-triage` test hooks and the global runs table is a visible removal. Confirm nothing else (Playwright, docs) depends on them before it lands.
- `review-code`: before commit.
