## Why

The +Worktree dialog silently fails when spawning a pi session into a sibling worktree of the pi-dashboard repo itself. Two compounded bugs:

- **Bug A — bridge can't load in a fresh worktree.** The repo's `.pi/settings.json` points the bridge extension at `<cwd>/packages/extension/src/bridge.ts`. Fresh `git worktree` checkouts have source files but **no `node_modules/`** — so the bridge imports fail at load, `register_session` is never called, and the spawn-register-watchdog fires `REGISTER_TIMEOUT` 30 s later. Pi-dashboard-only because only this repo wires its own dev bridge through a worktree-local TS path. End users running the npm-installed dashboard are unaffected.
- **Bug B — spawn errors for off-screen cwds are invisible.** `spawnErrors: Map<cwd, …>` renders only under matching folder action bars. When `+Worktree` spawns into a cwd not in the current workspace view (every sibling-worktree spawn does this), the error has nowhere to render. The user sees nothing — no toast, no banner, no card.

Result: clicking `Spawn →` on any existing-worktree row that lacks `node_modules` looks identical to clicking on nothing. The session is silently dead. Devs have hit this repeatedly (see `~/.pi/dashboard/sessions/spawn-failures.log` — dozens of REGISTER_TIMEOUT entries for sibling worktree paths).

## What Changes

- **Auto-install deps after `Create + Spawn →` succeeds in `+Worktree` dialog.** Server runs `npm install` (or the repo's detected install command) in the new worktree directory before pi spawns, OR streams progress to a placeholder card and spawns once install succeeds. Failure surfaces as a structured error in the dialog with stderr tail.
- **Detect and warn for existing-worktree rows that have no `node_modules/`.** Each row in the "Existing worktrees of this repo" list probes `<worktreePath>/node_modules` existence (cheap stat). When absent, replace `Spawn →` with `⚠ Install deps first` (disabled or runs install on click — design decision).
- **Global app-level toast for `spawn_error` on any cwd without a visible folder group.** `useMessageHandler` already receives `spawn_error`; today it only updates `spawnErrors` map. Add a fallback: when the cwd is not present in the current `pinnedDirectories ∪ workspace.folders ∪ session.cwd` set, also enqueue a `Toast` with the cwd + error code + reason summary. Never silent again.
- **No change to end-user-facing spawn paths.** The dependency-install logic is gated to repos that already opt in to a worktree-local bridge (presence of `.pi/settings.json#packages[].source === ".."` is the proxy). Non-dashboard projects skip the install step entirely — their bridges come from the global pi extension registry.

## Capabilities

### New Capabilities

- `spawn-error-global-toast`: When a `spawn_error` arrives for a cwd that is not represented in the current folder/workspace view, the client surfaces it as a global toast (existing `Toast` channel) so every spawn failure is observable. Replaces today's silent drop.

### Modified Capabilities

- `git-operations-api`: `POST /api/git/worktree` gains an optional post-create bootstrap step that detects worktree-local-bridge repos (presence of `.pi/settings.json#packages[].source === ".."`) and runs the project's install command before responding. Progress streams to the requesting browser via new `bootstrap_progress` / `bootstrap_done` / `bootstrap_failed` events. Two new error codes: `bootstrap_failed`, `bootstrap_skipped`.
- `folder-action-bar`: The +Worktree dialog's "Existing worktrees of this repo" list learns to probe each row for `node_modules` presence (when the repo is worktree-local-bridge gated) and degrades the per-row `Spawn →` action to `⚠ Install deps first` when absent.

## Impact

**Code touched:**
- `packages/client/src/components/WorktreeSpawnDialog.tsx` — per-row `node_modules` probe, degraded action button, install-progress UI for the Create form.
- `packages/client/src/hooks/useMessageHandler.ts` — `spawn_error` case: detect off-screen cwd, dispatch global toast.
- `packages/server/src/git-operations.ts` (`addWorktree`) or new helper `bootstrap-worktree.ts` — optional post-add install step, gated by worktree-local-bridge detection.
- `packages/server/src/routes/git-routes.ts` (`POST /api/git/worktree`) — streams `bootstrap_progress` events to the requesting browser; final `bootstrap_done`/`bootstrap_failed` payloads.
- `packages/shared/src/protocol.ts` — new `bootstrap_progress` / `bootstrap_done` / `bootstrap_failed` browser-channel events.

**Not touched:**
- `handleSpawnSession`, `spawn-register-watchdog`, `spawnPiSession` — server-side spawn flow stays untouched; the bootstrap step runs strictly *before* `Create + Spawn →` triggers spawn.
- Bridge protocol, `register_session` semantics, `pi` extension loading — root cause is dev-environment-specific, not a protocol bug.

**End-user impact:** none. Bootstrap step is no-op on non-dashboard repos. Bug B (global toast) is additive — adds feedback where there was silence.

**Risk:** `npm install` can take 30 s – 5 min on first run. The progress UI must be honest about this (show install log tail), and the `Create + Spawn →` button must remain in a "Installing deps…" state so users don't double-click. Existing-row detection is a stat call — negligible.
