# Design: polish-automation-board

## Context

See proposal.md (Why) for the motivation. Constraints that shape the approach:

- **Run state is split between memory and disk.**
  - The engine (`packages/automation-plugin/src/server/engine.ts`) keeps a `RunContext` per live run, plus a parent `remaining` counter (`engine.ts:600-650`), in memory.
  - `run.json` (`run-store.ts`) persists `status`, `sessionId`, `startedAt` and children. It does **not** persist the spawn token: `RunRecord` has no such field (`packages/automation-plugin/src/shared/automation-types.ts:164-202`).
  - After a server restart a record says `running` but `findByRunId()` (`engine.ts:451-457`) returns nothing, so `engine.stopRun()` returns `false` and `stopRunViaEngine` (`index.ts:687-693`) reports "not running".
- **Nothing partial is on disk.** `result.md` is written only by `finishRun` (`run-store.ts:224`). An empty result sets `archived: true, findings: 0` (`run-store.ts:226-233`), and the board hides archived runs by default (`AutomationBoard.tsx:112`). The live Stop avoids this by writing `"_(stopped by user)_"` (`engine.ts:643`). Both `finishRun` and `finishParentRun` prune old terminal records past retention (`run-store.ts:241, 267, 348-366`).
- **Termination.** `abortSpawnedRun({ sessionId, spawnToken, graceful })` (`packages/server/src/spawn-process/abort-spawned-run.ts:36-54`) is the trusted host capability, and its untrusted no-op is wired in `packages/server/src/server.ts:4413-4416`. Internally it gets a `TerminateOutcome` (`confirmed-dead | unconfirmed | refused-identity | no-identity | not-local`, `session-terminator.ts:50`) but returns only a boolean. It returns `false` early when neither id is given (`abort-spawned-run.ts:39`). `verifyIdentity` proves a pid belongs to the session; it does **not** prove the session belongs to a run. The goal, team and mcp-server plugins also call it.
- **Session stamps.** The host stamps a spawned session with `automationRun.runId` at `session_register` (`packages/shared/src/types.ts:588`), and the plugin reads it with `ctx.sessionManager.getSession(id)` (`index.ts:~470`). After a restart, the stamp is restored from the session's `.meta.json` sidecar (`session-scanner.ts:251`). The sidecar sits under the user's `~/.pi/agent/sessions` and is written only by the dashboard. It is not workspace content, so a cloned repo cannot plant it.
- **Connectivity is not exposed to plugins.** `PluginSessionManager` has only `listActive`, `listAll` and `getSession` (`dashboard-plugin-runtime/src/server/server-context.ts:42-46`). Session `status` restored from meta can be non-`ended` for a session that never reconnected (`session-scanner.ts:150, 422-423`). The gateway knows the open sockets and already offers `isSessionConnected(id)` (`packages/server/src/pi/pi-gateway.ts:191`; `getConnectedSessionIds()` at `:1633`). The bridge registers its physical `process.cwd()` (`packages/extension/src/bridge.ts:1689`), while route admission returns the raw cwd string (`packages/shared/src/plugin-route-cwd.ts:63`).
- **Entry points.**
  - REST `/stop` admits cwd through `withCwd(..., false, ...)` (`routes.ts:206-228`): the cwd is optional, and the route forwards scope and cwd to `hooks.stopRun`, which ignores them (`index.ts:154`).
  - The `plugin_action` `stop` handler takes `p.cwd` raw, without admission (`index.ts:170-189`).
  - Both call `stopRunViaEngine(runId)`, which ignores scope.
- **Navigation.**
  - Plugins navigate with wouter `useLocation` (`FolderAutomationSection.tsx:27`).
  - `/session/:id?archived=1` renders a read-only transcript and also works for a live-resident id (`client/src/App.tsx:691-698, 817-830`).
  - Ended `archiveOnEnd` sessions are archived after `SERVICE_ARCHIVE_GRACE_MS = 30_000` (`packages/server/src/session/archive-sweeper.ts:35`).
- **Board and editor.** The board is `AutomationBoard.tsx` (552 lines; it merges folder and global runs at `:92-94`, and the run-result panel is a raw `fixed inset-0 z-50` at `:346`). The card helpers are in `automation-card-visuals.ts` (stripe on the card root at `:89-90`). The editor is `CreateAutomationDialog.tsx` (1307 lines).
- **Look and feel** is fixed by the adopted mockup `mockups/automation-board-redesign/` (tabs A, E1, S1, P) and `mockups/ui-plan.md`.

## Goals / Non-Goals

**Goals:**
- Stop has a defined, honest outcome for every `running` record, live or orphaned, and it can never be steered at a session that is not this run's.
- Every run with a session id is one click from its session and from its monitor.
- The board meets the `ui-contract` token, size and overlay-layer rules, and matches the mockup.

**Non-Goals:**
- Finalizing orphans automatically at boot, rebinding reconnected sessions, or stopping the server from un-archiving reconnected sessions (S2).
- A new editor UX (E2/E3).
- Changing the run-monitor route or its back-depth.

## Decisions

### D1. "Orphaned" is decided by server start, not just by tracking
Add `engine.bootedAt` (set once in `createEngine`) and `engine.isTracked(runId)`, which is true for a live child or flat `RunContext` or a live parent counter. A record is orphaned when `status === "running" && !isTracked(runId) && record.startedAt < engine.bootedAt`. A run started by this process is never orphaned, so the spawn-to-register gap (token known only in memory) can't take the disk path.
- *Alternative:* an age grace window. Rejected because a fixed window is a guess; boot time is exact.
- *Alternative:* persist a boot id in `run.json`. Rejected because it adds persisted state for the same answer.

### D2. Orphan target = connected, stamped, in-scope session only (security)
Add `PluginSessionManager.isConnected(id): boolean` on the host. It is backed by `piGateway.isSessionConnected(id)` (open socket only), additive, and the untrusted context returns `false`. The plugin also adds `scope: "folder" | "global"` to its own spawn stamp (`pluginRef.automationRun`, `engine.ts:~771`), which the host merges verbatim. Before any kill, with `s = ctx.sessionManager.getSession(rec.sessionId)`, all of these must hold:
1. `rec.sessionId` is set;
2. `ctx.sessionManager.isConnected(rec.sessionId)`;
3. `s.automationRun?.runId === runId`;
4. `s.automationRun.scope` equals the request's scope, **and** `realpathSync(s.cwd) === realpathSync(scopeBase)` (wrapped in try/catch; any error refuses). For global scope `scopeBase` is the home directory. A stamp without `scope` (runs spawned before this change) is refused.

Anything else signals nothing: `not-found` without a `sessionId`, `unconfirmed` otherwise. The trust argument is that a workspace file (`run.json`) can name any session id, but rules 3–4 need the dashboard's own stamp (a live register, or the home-dir sidecar) and a matching cwd. A record in folder B therefore can't reach folder A's session.
- *Alternative:* trust `run.json` plus `verifyIdentity`. Rejected because `verifyIdentity` binds pid to session, not session to run.
- *Alternative:* a host-side "spawned by this plugin" check in `abortSpawnedRun`. Rejected for now because it widens the generic API; the plugin-side stamp check is sufficient and local.

### D3. One stop pipeline with scope admission on both entry points
`stopRun({ scope, scopeBase, runId }) → { ok, outcome?, alreadyFinalized?, error? }` replaces `stopRunViaEngine(runId)`.
- REST `/stop` requires a cwd only for folder scope: `withCwd(reply, body.cwd, scope !== "global", …)`, the same pattern as `/runs`. It answers 400 without one.
- **Accepted** Stops (a tracked run, or an orphan whose kill was attempted or refused by D2) return `ok: true` plus an `outcome`. A refused orphan is still accepted: `unconfirmed`, record finalized.
- **Rejected** requests (bad scope or cwd, finished run, untracked non-orphan) return `ok: false` with an `error` and signal nothing.
- The route forwards `outcome` and `alreadyFinalized` on every 200 body, and `api.ts` returns them.
- Scope comparisons use `realpathSync` on both sides. `plugin_action stop` runs its `cwd` through the same admission helper the routes use and rejects an unadmitted cwd. The pipeline:
1. **Tracked**: the context's `scopeBase` must equal the admitted `scopeBase`, otherwise reject. Then call `engine.stopRun(runId)`, which now returns `StopOutcome` (D4).
2. **Not tracked**: `resolveRunDir(scopeBase, runId)` (`isSafeRunId`-guarded). Not `running` → reject. `running` but not orphaned (started by this process, D1) → reject with "not tracked by this server; the stale-run reaper will finalize it".
3. **In-flight dedupe**: a module-level `Map<key, Promise<StopResult>>` with `key = realpath(scopeBase) + "\0" + runId`. An entry is inserted only after admission and record resolution, and deleted when it settles. A second Stop for the same orphan in the same scope awaits the first and returns its result. The parent cascade (step 5) routes each child through the same map, so there is at most one kill per run.
4. **Orphan child/flat**: apply the D2 checks, then `abortSpawnedRun({ sessionId, onResult })`, then `finishRunIfRunning(scopeBase, runId, { status: "stopped", error: reasonFor(outcome), result: "_(stopped by user after the server lost track of this run)_" }, { prune: false })`. A lost compare-and-set → `alreadyFinalized: true`.
5. **Parent**: parents have no `result.md` (`run-store.ts:243`). Tracked children go through `engine.stopRun` and orphaned children through step 4. Then `finishParentRunIfRunning` (combined status, summed findings, `prune: false`) once all children are terminal. Stopping an orphaned **child** by its own id also finalizes its parent when it was the last non-terminal child. A parent with no non-terminal child → `not-found`, and the parent is finalized.

### D4. Outcome reporting via an additive `onResult` (live and orphan paths)
- `AbortSpawnedRunArgs` gains an optional `onResult?(r: { outcome: TerminateOutcome; pid?: number })`. `createAbortSpawnedRun` calls it on **every** path, including the early return with `outcome: "no-identity"`. If `terminate` throws, it calls it with `"unconfirmed"` and rethrows.
- The `ServerPluginContext` type (`dashboard-plugin-runtime/src/server/server-context.ts`) and `EngineDeps.abortSpawnedRun` (`engine.ts:219-223`) gain the same optional arg. The boolean return is unchanged, so other plugins are untouched.
- In the plugin, a missing callback (the untrusted no-op at `server.ts:4413`) counts as `unconfirmed`.
- Mapping: `confirmed-dead` → `killed`; every other `TerminateOutcome` → `unconfirmed`. `not-found` is produced only by the plugin: for an orphan record without a `sessionId`, and for a parent with no non-terminal child left (D3 step 5).
- `engine.stopRun` → `StopOutcome`. `stopChild` (`engine.ts:629-648`) collects the outcome and passes `reasonFor(outcome)` into its finalize, replacing the fixed `"stopped by user"` (`engine.ts:643`). The spawn-window deferred finalize (`engine.ts:817-821`) also writes the `unconfirmed` reason ("stop requested before the session registered; process may still be running"). A deferred stop returns `unconfirmed`.
- Parent: `killed` only if every stopped child was `killed`; `not-found` only if every child was `not-found`; otherwise `unconfirmed`.

### D5. Runs listing fields (computed, never persisted)
`/runs` sets these per record and per child:
- `orphaned` (D1);
- `tracked` (`engine.isTracked(runId)`), which drives the live-vs-archived session link (D7);
- `sessionConnected` (`ctx.sessionManager.isConnected(sessionId)`, D2), the data source for the orphan notice;
- `scope` (`"folder" | "global"`, from which listing it came).

These are client-facing optional fields on `RunRecord`, documented as not persisted. The listing **always overwrites** them, so values stored in a crafted `run.json` (spread at `routes.ts:296`) never reach the UI.

### D6. Exactly-once finalization: in-flight dedupe + compare-and-set + no prune
- **Dedupe (D3 step 3)** removes the Stop-vs-Stop race that would otherwise straddle the `await abortSpawnedRun`.
- **`finishRunIfRunning` / `finishParentRunIfRunning`** in `run-store.ts` do a synchronous read → check `status === "running"` → write, with no `await` in between, so they are atomic within the server's event loop. They return `false` when another writer won. The reaper's on-disk orphan branch (`engine.ts:505-511`) uses them too, which resolves Stop-vs-reaper.
- An optional `{ prune: false }` skips `pruneRuns`, so a freshly stopped old orphan is not deleted by retention as it finalizes.
- **Scope of the guarantee**: one server process per home, which `server.lock` enforces. Writes from another process are out of scope (trade-off below).

### D7. Link targets
- Open session: a `running` run with `tracked: true` → `/session/:sid`. Everything else (done / error / stopped / orphaned) → `/session/:sid?archived=1`, which renders whether the session is live, restored or archived (App.tsx:691-698, 817-830).
- Monitor (running or orphaned): `/folder/:encodedCwd/automations/run/:sid` via `encodeFolderPath`.
- Result (done/stopped) and Log (error): `getRunResult`, rendered through the host `markdownContent` primitive inside the `ui:dialog` primitive. This replaces the raw `z-50` panel, which the overlay-layering ratchet requires.

### D8. History grouped by (scope, name)
Group the loaded runs by `${scope}:${name}` (using the D5 `scope` tag), newest first. The card shows the latest 3 plus a "Show all (N)" toggle. Parent/child expansion moves into the card. Keep `automation-run-<runId>`, `automation-child-run-<runId>`, `run-expand-*` and `run-result-*`. Retire `automation-triage` and `automation-triage-empty`. The repo-wide grep is a task; the one known doc hit (`docs/qa/distilled-current-test-cases.md:268`) is delegated to DocScribe.

### D9. Humanised schedule: a small local formatter, raw cron as fallback
`client/schedule-format.ts: humanizeCron(expr) → string | null` handles: every N minutes, hourly at :MM, daily at HH:MM, weekdays at HH:MM, a single weekday at HH:MM, and monthly on day D. `null` means show the raw cron. The next fire reuses `nextFire()` (`shared/cron.ts:108`) with a relative formatter. No new dependency.

**Label formats (decided):**
- Run start: "Today <t>" / "Yesterday <t>" by calendar day in local time; anything older is a short date plus `<t>`, with no weekday.
- `<t>` is `toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })`.
- Next fire: "today <t>" / "tomorrow <t>" / short date plus `<t>`.
- Duration: `<60s` → "Ns", `<1h` → "Nm Ss", `>=1h` → "Hh MMm" with seconds dropped; running runs append " so far".
- All helpers take `now` as a parameter so tests are deterministic.

### D10. Tokens and visuals follow the mockup and ui-plan (spec: MODIFIED visual-language requirement)
- `automation-card-visuals.ts` maps states to the severity tint tokens, with a new `orphaned` → warning state.
- The stripe FX class moves from the card root to the rail and running pill; the selected-card neon glow stays.
- `CardBtn` adopts the button recipe.
- The orphan notice uses the runtime `SettingsNotice` (warning), and the stop confirm uses `ui:popover`.
- Preserve-list labels stay: "+ Create Automation" is kept, and the mockup's "+ New automation" is not adopted.

### D11. Editor opening (E1)
`CreateAutomationDialog` gains `initialSection?: "identity" | "trigger" | "action" | "advanced"` (it opens the group and focuses its first field) and a footer dirty count computed from a draft-vs-initial diff. Edit opens on `identity`; clicking the schedule text opens on `trigger`.

## Risks / Trade-offs

- [The stamp, connectivity and scope checks refuse a legitimate orphan whose session has not reconnected] → it reports `unconfirmed` honestly, and the record is finalized `stopped`, so the reaper no longer sees it. The process, if still alive somewhere, is left. Accepted: a refused kill is safer than a misdirected one. S2 rebinds reconnecting sessions.
- [Trade-off: spawn-window orphans] An orphaned child that never registered has no `sessionId` and its spawn token died with the old server. It is finalized `not-found`; if that pi registers later, nothing kills it. S2 follow-up: terminate a session that registers with the stamp of an already-finalized run.
- [The boot-time rule misses a run lost without a restart (an engine bug)] → Stop rejects it with an explicit "the reaper will finalize it" reason, and the reaper remains the backstop.
- [Trade-off: multi-process writers] Exactly-once holds per server process. A second process writing `run.json` (manual edits, a second dashboard bypassing `server.lock`) is out of scope.
- [Stamp survival on reconnect, verified] The restored `automationRun` stamp (`runId` + `scope`) survives a reattaching bridge's `session_register` after a server restart; the L3 spec `tests/e2e/automation-orphan-stop.spec.ts` (X10) asserts it. Were it ever cleared, rule 3 would refuse every orphan (safe, `unconfirmed`).
- [Trade-off: ACP-agent runs] Runs started through an ACP agent may never hold a `piGateway` socket; their orphans then report `unconfirmed` and are left to the reaper.
- [Sidecar trust] The restored stamp is only as trustworthy as `~/.pi/agent/sessions`. A local attacker with write access to the user's home already has the user's privileges.
- [Retiring the `automation-triage` hooks breaks a dependent] → repo-wide grep task; DocScribe updates the docs.
- [Trade-off: route spec drift] The current `automation-content-view` "overlay routes … back-navigation depth" requirement still names `/automation/run/:sid`, while the code uses `/folder/:encodedCwd/automations/run/:sid` (`packages/automation-plugin/package.json:56-70`). This change links to the route the code serves and leaves that requirement untouched. Fixing the drift belongs in a separate spec-hygiene change.
- [`humanizeCron` gets an edge case wrong] → it returns null rather than guessing, and the raw cron is always shown on hover.

## Migration Plan

- No persisted format change: the new `run.json` fields are computed in the listing, and `finishRunIfRunning` only adds a guard.
- Additive host changes: `abort-spawned-run.ts` (`onResult`), the `ServerPluginContext` / `PluginSessionManager` types (`dashboard-plugin-runtime/src/server/server-context.ts`), and their wiring in `server.ts` (`isConnected` from `piGateway`, plus the untrusted no-op). Also the plugin's `EngineDeps` type.
- Rollback means reverting the plugin and those host files. Older clients ignore the new response fields.
