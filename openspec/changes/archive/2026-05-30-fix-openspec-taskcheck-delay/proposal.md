## Why

When the user ticks a checkbox in `openspec/changes/<change>/tasks.md` (from any editor: VS Code, vim, the dashboard's Monaco pane, an external pi session), the session card's `N/M tasks` counter and the OpenSpec stepper's "available actions" buttons take **up to ~30 s + jitter** to refresh.

Root cause:

- `packages/server/src/directory-service.ts` runs `setInterval(scheduleOpenSpecTick, cfg.pollIntervalSeconds * 1000)` with `DEFAULT_OPENSPEC_POLL.pollIntervalSeconds = 30`.
- The mtime-gate (`change: optimize-openspec-poll-burst`) correctly *skips* unchanged directories, but it only runs **when the timer fires**. So a fresh edit waits for the next tick (worst-case ~30 s + per-cwd jitter offset).
- Lowering `pollIntervalSeconds` globally is the wrong fix — it reintroduces the CPU burst that `optimize-openspec-poll-burst` solved (Node startup cost × N changes × all cwds).

Effect on the user:

- "I ticked the box, why is the counter still stale?"
- Workflows that branch on task completion (auto-archive on 100 %, stepper's *Archive* button enabling, spawn-with-attach showing fresh state) feel laggy.
- Manual `openspec_refresh` (folder card → refresh button) is the documented workaround, but defeats the point of automatic state.

## What Changes

User-facing:

- After ticking a task in `tasks.md`, the session card task counter and stepper actions SHALL update within **≤ 1 s** (debounce window) on every supported platform.
- No new config knobs. The existing `pollIntervalSeconds` / `maxConcurrentSpawns` / `changeDetection` / `jitterSeconds` semantics are preserved — the periodic poll remains as fallback for missed events (network FS, watcher EMFILE, etc.).

Internal (server):

- New module `packages/server/src/openspec-change-watcher.ts` — per-cwd `fs.watch(<cwd>/openspec/changes/, { recursive: true })` watcher. On a debounced (300 ms) event whose filename matches `tasks.md`, `proposal.md`, `design.md`, or `specs/**/*.md`, calls `pollOne(cwd, false)` on the existing `DirectoryService`. Mtime-gate handles dedup; concurrency cap (`maxConcurrentSpawns`) handles burst protection.
- `DirectoryService` exposes lifecycle hooks: `attachWatcher(cwd)` on `onDirectoryAdded`, `detachWatcher(cwd)` on `onDirectoryRemoved` (or session/cwd forget paths).
- Watcher failures (EMFILE, ENOENT on `openspec/changes/` not yet created) degrade silently — the periodic poll still runs.

Out of scope:

- Watching `openspec/specs/**` (top-level project specs). Counter staleness is about *changes*, not committed specs.
- Linux `inotify` fanout tuning. Node 22 `fs.watch({ recursive: true })` works on Linux/macOS/Windows uniformly; we rely on it as-is.
- Replacing the periodic poll. Push + poll-as-fallback is the design (handles missed events, network FS, watcher startup races).
- Bridge-side / extension-side notification. Server owns OpenSpec state; bridges already only render server broadcasts.

## Non-goals

- No change to `DashboardConfig` schema. Watcher is implicit, always-on (cost: one descriptor per known cwd, typically < 10).
- No change to the mtime-gate, the concurrency semaphore, or the broadcast contract. This change only adds a *faster trigger*.
