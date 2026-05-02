## Why

Multiple parallel pi sessions on the same machine can't safely edit the same project tree — they step on each other's files, bash state, and tool caches. Jujutsu's `jj workspace` mechanism gives every session its own working copy on top of a shared `.jj/` store, so parallel agents can diverge, converge, and share commits without filesystem conflicts. This is the closest thing to a "shadow filesystem" that works identically on Windows, macOS, and Linux without FUSE/WinFsp/macFUSE prerequisites.

The dashboard already has all the load-bearing primitives:

- **Plugin architecture** (`dashboard-plugin-architecture` + `add-dashboard-shell-slots-runtime`) — flows-plugin is the canonical example of a workspace package that registers via slot claims.
- **Tool registry** (`src/shared/tool-registry/`) — every external binary already routes through here; `jj` slots in as one definition entry.
- **Pending-attach + spawn-with-cwd** (`pending-attach-registry.ts` + `handleSpawnSession`) — the existing lever for "create resource → spawn session inside it" used by the OpenSpec attach-and-spawn flow.
- **Predicate-gated session-card slots** — flows-plugin's `session-card-badge` claim demonstrates per-session-state activation; we reuse the pattern to render only when the session's cwd is inside a jj repo.

The knoopx/pi project ships a TUI extension that already does jj-workspace-spawning for terminal users; this change brings the equivalent affordance into the dashboard's web UI as a properly-isolated plugin so it ships independently of the shell and can be enabled/disabled per install.

This change DEPENDS ON `dashboard-plugin-architecture` and `add-dashboard-shell-slots-runtime` being implemented first (same prereqs as `extract-flows-as-plugin`).

## What Changes

- **NEW**: `packages/jj-plugin/` — workspace package with `pi-dashboard-plugin` manifest, mirroring the `flows-plugin` layout (no bridge entry; the bridge already polls cwd state for git-info and is extended in-place to also detect jj).
  - `src/client/` — `JjWorkspaceBadge`, `JjActionBar`, `JjWorkspaceList`, `JjWorkspaceView`, `JjFoldBackDialog`, plus the `isInJjRepo` / `isInJjWorkspace` predicates.
  - `src/server/` — REST routes `/api/jj/workspace/list|add|forget|status|init`; thin wrappers around `jj` CLI invocations executed via the existing `platform/exec.ts` Recipe pattern (parity with `git-operations.ts`).
- **NEW**: `Session.jjState?: { isJjRepo: boolean; isColocated: boolean; workspaceName?: string; workspaceRoot?: string; bookmarks?: string[]; lastError?: string }` field on `DashboardSession`. Populated by the bridge's existing per-session 30 s git-info poll (extended to also probe `jj st` when the `jj` tool resolves), broadcast via the existing `session_updated` message. NOT persisted to `.meta.json` — this is live tool state, refreshed on every poll.
- **NEW**: Tool registry definition for `jj` in `src/shared/tool-registry/definitions.ts` (kind: "binary", standard `override → bare-import → npm-global → where` chain, classifier the same as `git`).
- **NEW**: `.pi/skills/jj-workspace/SKILL.md` — operating instructions for agents working inside a jj workspace. Copies the safety language from knoopx's `jujutsu` skill verbatim ("NEVER USE `git` FOR MUTATIONS IN A JJ REPO").
- **NEW**: `.pi/skills/jj-workspace-fold-back/SKILL.md` — the fold-back operation. Default flavor: **preserve agent commit history, rebase onto trunk, push via `jj git push`**. Squash and PR-only flavors are documented variants behind a `mode` argument. Refuses to run if the repo isn't jj-colocated, if there are unresolved conflicts, or if the working copy is empty.
- **NEW**: Plugin `configSchema` (JSON Schema 7) exposing per-repo settings: `defaultPushTarget` (`"trunk" | "bookmark"`, default `"bookmark"`), `workspaceRoot` (default `".shadow"`), `allowDirectTrunkPush` (default `false`).
- **MANIFEST CLAIMS**:
  - `session-card-badge` → `JjWorkspaceBadge` (predicate `isInJjWorkspace` — only shown for sessions whose cwd is a jj workspace, displays the workspace name).
  - `session-card-action-bar` → `JjActionBar` (predicate `isInJjRepo` — Add Workspace / Fold Back buttons).
  - `sidebar-folder-section` → `JjWorkspaceList` (lists the folder's jj workspaces alongside its sessions).
  - `command-route` `/jj` → `JjWorkspaceView` (full status / log / op log view in the content area).
  - `settings-section` → plugin config form, tab `general`.
- **NEW**: `pi-dashboard-jj-workspace-add`, `-fold-back`, `-init-colocated` REST endpoints wired through the same auth+queue gates as the existing OpenSpec routes.
- **REUSE**: When the user clicks "+ Workspace" on a session card, the server runs `jj workspace add <root>/<name>`, enqueues the workspace name into `pending-attach-registry` keyed by the new cwd, then calls `spawnPiSession({ cwd: newCwd })`. This is the exact lever already used by `add-folder-task-checker-and-spawn-attach`.
- **EXTEND `session-diff` enrichment**: `packages/server/src/session-diff.ts` becomes regime-aware. Plain-git repos keep the existing `git diff HEAD` path; sessions whose `jjState.isJjRepo` is true route through a new `enrichWithJjDiff(cwd, files, baseRev)` that runs `jj diff --from <baseRev> --to @ -- <path>` per file. The base revision is `@-` for the default workspace (equivalent to `git diff HEAD`) and `fork_point(@, trunk())` for non-default workspaces — so the diff view in a workspace shows EVERY commit the agent produced, not just the last one. The `SessionDiffResponse` gains optional `vcsKind: "git" | "jj"`, `diffBase: string`, and `baseLabel: string` fields so the client can render "Diffing against develop" headers; older clients ignore the new fields. Untracked-file synthetic-diff fallback becomes unnecessary in the jj path — `jj diff` reports new files in unified format natively.

## Out of Scope

- **rclone / FUSE / WinFsp / macFUSE overlay shadowing** — explicitly dropped. `jj workspace` provides the isolation we need without kernel extensions or per-OS install pain. If a user wants a true overlay they can mount it outside the dashboard.
- **Distributed parallel agents on a network drive** — `jj`'s store is single-host. This change targets same-machine parallelism only. A separate proposal is required if multi-host is ever needed.
- **Blocking guardrails for `git commit` / `git rebase` inside jj-colocated cwds** — desirable safety net but a separate concern; the knoopx `guardrails` extension covers this and can be installed independently. The fold-back skill carries the warning loudly.
- **Auto-renaming spawned sessions to the workspace name** — possible via `proposal-attach-naming.ts` precedent, deferred to a follow-up if users ask.
- **Migrating the bridge's git-info poll to a generic VCS-info poll** — refactoring opportunity; for this change we add jj probing alongside the existing git probe and leave the unification for later.

## Capabilities

### New Capabilities

- `jj-workspace-plugin` — registers the plugin manifest, exposes `Session.jjState`, mounts `JjWorkspaceBadge` and `JjActionBar` via slot claims, gates rendering on the `jj` tool being resolved AND `.jj/` existing in the session cwd.
- `jj-workspace-rest-api` — REST endpoints for workspace list/add/forget/status and the colocated-init step.
- `jj-workspace-fold-back-skill` — agent-facing skill that performs the rebase-and-push operation safely.
- `jj-aware-session-diff` — the `/api/session-diff` route is regime-aware: plain-git uses the existing path; jj sessions diff via `jj diff` against a regime-appropriate base revision.

### Modified Capabilities

- `tool-registry-resolution` — adds `jj` to the standard tool definitions.
- `session-state` — adds the optional `jjState` field to `DashboardSession`. Backwards-compatible (absent field reads as undefined, all existing predicates continue to work).
- `bridge-cwd-probes` — extends the per-session 30 s poll to also run `jj st --no-pager` when `jj` resolves; folded into the same `session_updated` broadcast.

## Impact

- **NEW** package `packages/jj-plugin/` (~600 LOC client + ~200 LOC server estimated, including the two skill markdown files).
- **MODIFIED** `packages/shared/src/types.ts` — adds `jjState?: ...` to `DashboardSession`.
- **MODIFIED** `packages/shared/src/tool-registry/definitions.ts` — adds the `jj` definition.
- **MODIFIED** `packages/extension/src/git-info.ts` (or a new `vcs-info.ts` sibling) — adds the jj probe.
- **MODIFIED** `packages/server/src/event-wiring.ts` — forwards the new `jjState` field through `extractSessionUpdates` (if it doesn't already passthrough unknown session fields, which it largely does).
- **NO CHANGES** to flows-plugin, openspec wiring, or existing slot infrastructure.
- **PUBLISH** — `packages/jj-plugin/` ships as a public workspace package alongside `flows-plugin` and `dashboard-plugin-runtime`. Same `npm publish` gates apply (publish-workflow-contract test pinning the matrix).
