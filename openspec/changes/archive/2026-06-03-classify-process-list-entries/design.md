## Context

The PROCESS subcard (`ProcessList.tsx`, repurposed as the background-processes drawer) surfaces child processes scanned by the bridge. The intent is to show *user-spawned* long-running background tasks (dev servers, watchers, test runners) so they can be killed. Instead it leaks pi's own runtime plumbing.

Confirmed live process tree (macOS, `ps -eo pid=,ppid=,pgid=,args=`):

```
PI pid=40286 pgid=40131
    child pid=10010 pgid=10010 :: /bin/bash -c …            ← user task, OWN pgid
    child pid=41431 pgid=40131 :: bun …/context-mode/server.bundle.mjs  ← pi plumbing, SAME pgid

PI pid=14505 pgid=14479
    child pid=15296 pgid=14479 :: bun …/context-mode/server.bundle.mjs  ← SAME pgid as pi
```

The discriminator is unambiguous in the data: **pi's own plumbing shares pi's PGID; detached user/subagent work gets its own PGID.**

Two relevant existing mechanisms:
- `excludedPgids: Set<number>` (in `ScanOptions`) — already refuses PGIDs at capture (`captureChildPgids`) AND filters them at scan (`scanTrackedProcesses`), AND self-reaps dead PGIDs each tick. Today seeded only with the auto-spawned dashboard-server PID via `onServerSpawned`.
- `DashboardSession.pid` — the server stores `session_register.pid` for every connected session (`memory-session-manager.ts:108`). The `process_list` message already flows bridge → server (`event-wiring.ts:992`) → client, so the server is the natural enrichment point.

## Goals / Non-Goals

**Goals:**
- pi's own process (self) and same-group plugin/MCP sidecars never appear in the PROCESS drawer.
- Genuine user background tasks remain visible (unchanged).
- Subagent / nested-pi processes remain visible AND are named meaningfully when the server can identify them.
- Each row carries a type so the client can show an icon and a friendly label instead of a raw command string.

**Non-Goals:**
- No change to PGID tracking, leaf-only filtering, min-elapsed filtering, or the Windows scan path.
- No attempt to surface in-memory Agent-tool subagents (they are not OS processes; out of scope by definition).
- No new process-introspection of foreign processes' env/cwd in this change (deferred; see Decision 4).
- No change to the kill path.

## Decisions

### Decision 1: Hide by excluding pi's own PGID, not by command-pattern denylist

Seed the bridge's `excludedPgids` with pi's own PGID at init. Because `captureChildPgids` would otherwise add pi's pgid (via the context-mode child that shares it), excluding it stops the entire same-group set — pi self, context-mode, same-group node — from ever entering `trackedPgids`. The filter-time skip in `scanTrackedProcesses` is defense-in-depth for the same set.

**Why pgid, not command match:** A command denylist (`pi`, `.pi/agent/`, `node …`) is brittle, hardcodes paths, and would wrongly hide subagent `pi` workers the user wants to see. The pgid rule is structural: it follows from how the bash tool detaches commands, so it cannot drift with plugin renames.

**Resolving pi's own PGID:** Node core exposes no `process.getpgid(self)`. Resolve once via `ps -o pgid= -p <process.pid>` and cache; seed into `selfSpawnedPgids` right after the `onServerSpawned` wiring in `bridge.ts`. On Windows the scan path is PID-based and this exclusion is a no-op (acceptable; the leak is a Unix-process-group artifact).

**Alternative considered — filter pi-self only (`pid === process.pid`):** Insufficient. It would hide pi but not context-mode (different pid, same pgid). The pgid rule is required to catch the sidecars.

### Decision 2: Classify server-side, not in the scanner or client

The scanner stays dumb (raw `ChildProcessInfo`). The **server** classifies because it is the only component holding the global `pid → session` index needed to name `sub-session` rows. Classification is a pure function `(processes, pidIndex) => EnrichedProcess[]` in a new `process-classifier.ts`, called from the `process_list` handler before `sendToSubscribers`.

**Why not the client:** the client would need the cross-session pid index mirrored to it; the server already has it for free.

**Why not the bridge:** a bridge only knows its own session, not sibling sessions' pids, so it cannot resolve `sub-session` labels.

### Decision 3: Taxonomy and label sources

| kind          | detection                                                        | label source              | icon |
|---------------|------------------------------------------------------------------|---------------------------|------|
| `sub-session` | `command` basename is `pi` AND `pid` ∈ pidIndex                  | session name + model      | 🤖   |
| `pi-worker`   | `command` basename is `pi` AND `pid` ∉ pidIndex                  | `"pi worker"`             | 🤖   |
| `plugin`      | `command` matches `…/.pi/agent/.../<name>/(server\|index)\.…`     | `<name>` (path segment)   | 🔌   |
| `task`        | none of the above                                                | the command (as today)    | ⚙    |

`sub-session` carries `sessionRef = <that sessionId>` so the client can link the row. Most `plugin` rows are already suppressed by the Decision 1 pgid filter; the `plugin` kind exists for any that surface in their own group (e.g. a detached MCP server) so they still read as infrastructure rather than a raw `bun …` string.

### Decision 4 (OPEN): Naming fallback for headless `pi-worker`

A headless `pi` worker not in the registry gets the generic `"pi worker"` label. Optionally enrich with its cwd (cheap on Linux `/proc/<pid>/cwd`, awkward on macOS via `lsof`). **Recommendation: ship generic label first; defer cwd enrichment.** Decision needed before tasks 4.x.

### Decision 5 (OPEN): Clickable `sub-session` rows

`sessionRef` makes it possible to focus/scroll to the referenced session card on click. Nice payoff, small client wiring. **Recommendation: yes, link it** — but flag as a decision since it adds a client interaction. Decision needed before task 5.x.

### Decision 6 (OPEN): Icon system

Emoji (🔌🤖⚙) is zero-dependency and matches the current `⚠ N background processes` summary glyph. The project also has `mdi-icon-system`. **Recommendation: emoji for parity with existing drawer glyphs**, unless the card design mandates mdi. Decision needed before task 5.x.

## Risks / Trade-offs

- **Foreground non-detached user command in pi's own group** would be hidden by the pgid filter. The bash tool always detaches, so this does not occur via normal tool calls; accepted.
- **Stale pid index** — a subagent could exit between scan and classify; the row then falls back to `pi-worker`/`task`. Harmless (label only).
- **pid reuse** — a recycled pid could mis-link a `sub-session`. Mitigate by requiring the candidate session to be currently connected (present in the live index), not merely historically known.

## Migration / Compatibility

Protocol fields are optional and additive. Older clients ignore `kind`/`label`/`sessionRef` and render `command` as before. Older bridges send no extra fields; the server classifies from `command` + pidIndex regardless. No persistence migration (processes are ephemeral, re-sent on next scan).
