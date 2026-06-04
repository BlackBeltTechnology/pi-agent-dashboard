## Why

The session card's PROCESS drawer leaks pi's own process group. The screenshot that triggered this shows three rows — `node v25.8…`, `pi`, `bun …/.pi/agent/npm/node_modules/context-mode/server.bundle.mjs` — none of which is a user-spawned background task.

Root cause (confirmed against the live process tree on macOS):

- The bridge scans children of `process.pid` every 5 s via `scanChildProcesses`. `captureChildPgids` records each child's **PGID** into `trackedPgids`, then `scanTrackedProcesses` reports every live process belonging to a tracked PGID.
- pi's plugin/MCP sidecars (e.g. context-mode's `server.bundle.mjs`) are spawned **directly by pi and share pi's own PGID**:

  ```
  pi (pid 40286, pgid 40131)
  ├── /bin/bash -c …      pid 10010  pgid 10010   ← user task: OWN detached pgid ✅
  └── bun context-mode    pid 41431  pgid 40131   ← pi plumbing: SAME pgid as pi ❌
  ```

- So `captureChildPgids` records **pi's own pgid** into `trackedPgids`. Once that happens, `scanTrackedProcesses` reports the *entire pi process group* — pi itself, the context-mode sidecar, and any same-group `node` helper. That is exactly the three leaked rows.
- The existing `selfSpawnedPgids` exclusion only catches the dashboard server the bridge auto-spawns (via `onServerSpawned`). It never excludes pi's own PGID, so the plumbing slips through.

User bash-tool commands are *detached into their own process group* (the whole reason PGID tracking exists), so `pgid === pi.pgid` is a clean, non-brittle discriminator between "pi's own plumbing" and "real user/subagent work".

Second half of the request: rather than hiding everything, **subagents should stay visible with meaningful names and type icons**. Two facts constrain naming:

- Nested `pi` processes carry **zero identifying argv** (bare `pi`); Agent-tool subagents run **in-memory** (no separate process). So a subagent's name cannot come from its command line.
- The dashboard server already records `pid` for **every** connected session (`session_register.pid` → `DashboardSession.pid`). A `pid → session` reverse index lets the server name a subagent process by cross-referencing it against known sessions. Plugin sidecars are named by command-pattern (`.pi/agent/.../<name>/server.bundle.mjs` → `<name>`).

## What Changes

- **Hide pi's own process group, not the subagents.** Seed the bridge's existing `excludedPgids` set with pi's own PGID (one cached `ps -o pgid= -p <process.pid>` at bridge init, beside `onServerSpawned`). This drops pi-self + context-mode + any same-group node helper in one move. Processes with their own PGID (user tasks, subagent pis) survive.
- **Classify every surviving process server-side.** The server (the only component with a global `pid → session` index) enriches each `process_list` entry with a `kind`, a human `label`, and an optional `sessionRef`:
  - `sub-session` — `command` is `pi` AND `pid` matches another connected session → label = that session's name + model; `sessionRef` = that sessionId. 🤖
  - `plugin` — `command` matches `.pi/agent/.../<name>/server.bundle.mjs` → label = `<name>` (e.g. `context-mode`). 🔌 (these are normally hidden by the pgid filter, but classification is defined for any that surface, e.g. detached MCP servers)
  - `pi-worker` — `command` is `pi`, own pgid, NOT in the session registry (headless worker) → label = `pi worker`. 🤖
  - `task` — anything else → label = the command (today's behavior). ⚙
- **Protocol carries the classification.** Extend the per-process shape in `process_list` / `process_list_update` from `{ pid, pgid, command, elapsedMs }` to add `kind`, `label`, and optional `sessionRef`. Fields are optional/back-compatible; absent `kind` renders as `task`.
- **Client renders icon + friendly label.** `ProcessList.tsx` shows the type icon and `label` instead of the raw command; `sub-session` rows link to the referenced session's card.

## Capabilities

### New Capabilities

- `process-list-classification`: The dashboard server enriches each forwarded `process_list` entry with `{ kind, label, sessionRef? }` by cross-referencing process PIDs against the live `pid → session` registry and matching command patterns for plugin sidecars. Replaces today's pass-through forward that surfaces raw command strings.

### Modified Capabilities

- `session-process-tracking`: The bridge seeds `excludedPgids` with pi's own PGID so the session's own process group (pi self + same-group plugin/MCP sidecars) never enters `trackedPgids`. Subagent and user processes (own PGID) remain visible. The client `ProcessList` renders the server-supplied `kind` icon + `label` and links `sub-session` rows to their session card.
- `shared-protocol`: The `process_list` and `process_list_update` per-process entry gains optional `kind` (`"task" | "sub-session" | "pi-worker" | "plugin"`), `label` (string), and `sessionRef` (string sessionId) fields.

## Impact

**Code touched:**
- `packages/extension/src/bridge.ts` — resolve pi's own PGID once (cached) at bridge init; add it to `selfSpawnedPgids` alongside the `onServerSpawned` registration.
- `packages/extension/src/process-scanner.ts` — no logic change required (already honors `excludedPgids` at capture + filter); optionally a small helper `getOwnPgid()`.
- `packages/server/src/event-wiring.ts` — `process_list` handler enriches `msg.processes` via a new classifier before `sendToSubscribers`.
- `packages/server/src/process-classifier.ts` (new) — pure classification: `(processes, pidIndex) => EnrichedProcess[]`; command-pattern plugin-name extraction.
- `packages/shared/src/browser-protocol.ts` — extend the two process-entry shapes (lines ~864, ~876) with `kind`, `label`, `sessionRef?`.
- `packages/client/src/components/ProcessList.tsx` — render icon + label; make `sub-session` rows clickable to focus the referenced session.

**Not touched:**
- PGID tracking mechanics, leaf-only filtering, min-elapsed filtering, Windows scan path — unchanged.
- `session_register` semantics, `DashboardSession.pid` storage — read-only consumers.
- Kill path (`force_kill` / PGID kill) — unchanged.

**Risk:**
- Resolving pi's own PGID adds one `ps` call at bridge init (cached, never repeated). Negligible.
- The pgid filter could hide a genuine user process *if* a user deliberately ran a foreground command in pi's own group (no `&`, no detachment) — but the bash tool always detaches, so this does not occur in practice.
- Subagent `pi` processes that run in their *own* PGID (headless workers / `exec`-spawned child sessions) stay visible by design; only same-group plumbing is hidden.

**Open design decisions** (see design.md):
1. Should `sub-session` rows be clickable to focus/scroll to the referenced session card?
2. Icon source — emoji (🔌🤖⚙, matches current `⚠`) vs the project's `mdi-icon-system`.
3. Classify on server (global pid index, chosen here) vs client (would need the index mirrored).
4. Naming fallback for headless `pi-worker` — generic `"pi worker"` vs enriching with cwd.
