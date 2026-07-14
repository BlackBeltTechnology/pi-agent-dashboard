## Why

The dashboard has ~1700 LOC of git-specific code spread across bridge (poller, link builder), server (operations, REST routes), and client (BranchPicker, BranchSwitchDialog, GitInfo display). Like OpenSpec, Flows, and Subagents, git is a coherent feature embedded in the dashboard's core that fits the plugin architecture cleanly.

Unlike the previous extractions, git is **universally relevant** — most workspaces are git repos — so the plugin must ship in the standard distribution by default. Without it, sessions show no branch / PR, the branch-switch UI is gone, and `GroupGitInfo` in the folder header disappears. This is acceptable as a *technical* degradation when explicitly disabled, but the default user experience must include git-plugin out of the box.

There is **no upstream npm package** to PR this plugin into (unlike `subagents-plugin` → `@tintinweb/pi-subagents`). Git-plugin lives in this monorepo permanently as a first-party plugin. The extraction is purely about architectural cleanliness: removing git knowledge from `App.tsx`, `SessionCard.tsx`, `SessionList.tsx`, `MobileActionMenu.tsx`, and centralizing git concerns in one package.

This change DEPENDS ON `dashboard-plugin-architecture` and `add-dashboard-shell-slots-runtime` being implemented first. Optionally consumes the reducer-slice mechanism from `extract-flows-as-plugin` if any git state ends up living in the per-session reducer (today it doesn't — git data is on the `Session` record itself, not in the reducer).

## What Changes

- **NEW**: `packages/git-plugin/` package with `pi-dashboard-plugin` manifest:
  - `bridge/` — `git-info.ts` (poller), `git-link-builder.ts` (URL parsing for GitHub, GitLab, Bitbucket, etc.)
  - `server/` — `git-operations.ts` (branch listing, checkout, init, stash pop), `routes/git-routes.ts`
  - `client/` — `BranchPicker.tsx`, `BranchSwitchDialog.tsx`, `GitInfo.tsx` (extracted from `SessionCard.tsx`), `GroupGitInfo.tsx` (extracted from `SessionCard.tsx`), `branchCache.ts` (extracted), `git-api.ts`
- **MOVE** (not copy): every git-specific file from `packages/{client,server,extension}/` into `packages/git-plugin/`. Use `git mv` for history preservation.
- **NEW**: Slot claims in the manifest:
  - `session-card-badge` → `GitInfo` (predicate: session has `gitBranch`)
  - `sidebar-folder-section` → `GroupGitInfo` (predicate: any session in folder has `gitBranch`)
  - `session-card-action-bar` → branch-switch trigger button (opens BranchSwitchDialog)
  - `anchored-popover` `branch-switch-trigger` → `BranchSwitchDialog`
- **UNCHANGED**, stays in core:
  - `packages/shared/src/platform/git.ts` — cross-platform git Recipe, used by both the plugin and `session-diff.ts`.
  - `gitBranch`, `gitBranchUrl`, `gitPrNumber`, `gitPrUrl` fields on the `Session` type. Bridge polling (in the plugin) populates them; plugin's UI reads them. No plugin-contributed session state mechanism introduced (defer that step).
  - `git_info_update` protocol message — unchanged.
  - `packages/server/src/session-diff.ts` (session-event-based file change extraction). FileDiffView stays in core because it's primarily session-driven, not git-driven; git-diff enrichment is plugin-provided when present.
- **REMOVE** from `packages/client/src/components/SessionCard.tsx`: the inline `GitInfo` and `GroupGitInfo` exports; the `branchCache` map. ~80 LOC.
- **REMOVE** from `packages/client/src/components/MobileActionMenu.tsx`: the git block that renders branch + PR. ~20 LOC.
- **REMOVE** from `packages/client/src/components/SessionList.tsx`: the direct `BranchSwitchDialog` mount and `GroupGitInfo` import. Replaced by slot consumers.
- **REMOVE** from `packages/extension/src/bridge.ts`: the `GIT_POLL_INTERVAL` and `sendGitInfoIfChanged` integration. The plugin's bridge entry runs the poller.
- **REMOVE** from `packages/server/src/event-wiring.ts`: nothing — `git_info_update` handling stays in core (it just updates `Session.gitBranch` etc.).
- **NEW**: `git-plugin` is included in the standard distribution's `packages/` set. The build pipeline already discovers all `pi-dashboard-plugin` manifests; nothing extra needed. Disable via `plugins.git.enabled = false` for users who really want a git-less dashboard.

## Capabilities

### New Capabilities

None. This change is a refactor that uses `dashboard-shell-slots` and `dashboard-plugin-loader` already established by the umbrella.

### Modified Capabilities

- Existing git capability specs (e.g. `git-branch-selector`, `git-info-display`, `git-platform-detection` if they exist; final list confirmed during implementation) — their main spec files in `openspec/specs/` move under `packages/git-plugin/specs/` and become plugin-internal documentation.

## Coordination with `add-session-uncommitted-indicator-and-commit`

`add-session-uncommitted-indicator-and-commit` (implemented in core) lands the uncommitted-indicator + commit-from-card feature on exactly the files this extraction moves. **The git-plugin extraction MUST carry the commit feature along** — move these self-contained, plugin-ready artifacts into `packages/git-plugin/`:

- Client: `packages/client/src/components/GitDirtyPill.tsx`, `CommitDialog.tsx` (+ `CommitDialogProvider`/`useCommitDialog`), `packages/client/src/lib/git-status-cache.ts`, and the `fetchGitStatus`/`fetchChangedFiles`/`commitFiles`/`draftCommitMessage` helpers in `git-api.ts`.
- Server: `getGitStatus`/`getChangedFiles`/`commitFiles`/`assertPathsInside`/`GitCommitError` in `git-operations.ts`, the `/api/git/{status,changed-files,commit,commit-draft}` routes in `git-routes.ts`, and `commit-draft-relay.ts`.
- Bridge: `commit-draft.ts` + `commit-draft-agent.ts`, the `git_commit_draft` case in `command-handler.ts`, and the `gitStatus` half of `sendGitInfoIfChanged`/`gatherGitStatus`.
- Shared: `GitStatus` (`types.ts`), the commit/status/draft response types (`rest-api.ts`), the `git_commit_draft`/`git_commit_draft_result` protocol messages, and `parseGitStatusV2`/`GIT_STATUS_V2` (`platform/git.ts`).

The `GitDirtyPill` mounts on both the per-card `GitInfo` slot and the folder-header `GroupGitInfo` slot; the extraction's slot wiring must preserve both mount points and the placement-agnostic `CommitDialog`.

## Impact

- `packages/client/src/components/SessionCard.tsx` — `GitInfo` + `GroupGitInfo` + `branchCache` removed (~80 LOC); replaced by slot consumers `<SessionCardBadgeSlot/>` and `<SidebarFolderSectionSlot/>`. Carries the `GitDirtyPill` + Commit button (see coordination note above).
- `packages/client/src/components/SessionList.tsx` — `GroupGitInfo` import + `BranchSwitchDialog` mount removed; replaced by slot consumers.
- `packages/client/src/components/MobileActionMenu.tsx` — git block removed (~20 LOC).
- `packages/client/src/components/FileDiffView.tsx` — unchanged; continues to consume session-diff.ts output and renders without git-plugin in degraded mode (no syntax highlighting from git diff).
- `packages/extension/src/bridge.ts` — git polling integration removed; plugin's bridge entry takes over.
- `packages/server/src/server.ts` — git route registration removed (now done by plugin's server entry).
- `packages/git-plugin/` — NEW package with all moved files.
- ~10 test files — paths in import statements update; behavioral assertions unchanged.
- `AGENTS.md` Key Files — replace internal git entries with the plugin package and its manifest.
- `docs/architecture.md` — update Git Polling section to reference the plugin package.

## Why git-plugin is bundled by default

Unlike `subagents-plugin` / `flows-plugin` / `openspec-plugin` (which are useful but optional for many workflows), git is the assumed default for almost every workspace. A dashboard release that boots without git-plugin would feel broken to most users. The release pipeline therefore includes `git-plugin` in the default `packages/` set; the plugin loader discovers and loads it like any other.

The `enabled` flag remains for users with a deliberate reason to skip git (perhaps they only work in non-git directories). Default is `true`. No special-case logic in the loader — git-plugin is just a plugin that happens to ship by default.

## Why no PR-back upstream path

Git is the operating-system tool, not a vendored npm package. There is no `@vendor/pi-git-extension` to upstream this plugin into. Git-plugin therefore lives in this monorepo permanently. (Contrast: `subagents-plugin` exists pending PR to `@tintinweb/pi-subagents`.)

If, in the future, a third party ships a competing pi-extension implementing alternative git workflows (e.g. `pi-jujutsu-extension` for the Jujutsu VCS), they could ship their own dashboard plugin via the future `node_modules/` discovery path. The slot taxonomy already supports concurrent plugins claiming distinct, non-conflicting slots.

## Migration Risks

- **`platform/git.ts` shared between plugin and core.** The cross-platform git Recipe stays in `packages/shared/`; both `git-plugin/server/` and the core `session-diff.ts` import it. Validation: confirm Recipe call sites still work after the plugin extraction; no behavior change expected.
- **`branchCache` is module-level in SessionCard.tsx.** Currently exported and used cross-module. After extraction, the cache lives in `git-plugin/client/branchCache.ts` and is accessed only within the plugin. Confirm no external code expects to import `branchCache` from `SessionCard.tsx`.
- **Bridge polling hand-off.** The current bridge has `GIT_POLL_INTERVAL = 30000` and a `sendGitInfoIfChanged` call in `model-tracker.ts` and elsewhere. The plugin's bridge entry takes over; verify the same poll cadence and idempotency. Test: a session that opens, changes branches three times, closes — git_info_update messages identical pre- and post-extraction.
- **`MobileActionMenu` ordering.** The current mobile menu has git info inline. After extraction, the slot consumer for `session-card-badge` renders multiple badges; the git badge needs a deterministic position relative to other badges (priority: 100, alphabetical). Validate visual parity on mobile.
- **No auto-mounted dialog.** Currently `BranchSwitchDialog` is mounted at the SessionList level. After extraction, the plugin owns the dialog and triggers it via `anchored-popover`. The trigger element is a button rendered by the plugin's `session-card-action-bar` claim; the popover follows. Confirm focus management, escape-to-close, and mobile-touch behaviors work identically.
- **Disabled-state UX.** When `plugins.git.enabled = false`, sessions show no branch info, the branch-switch action is gone, and `GroupGitInfo` is missing. Document this in release notes; surface a Settings hint if the user disables git-plugin: "Git integration disabled — run in non-git directories or re-enable."

## References

- Umbrella (archived; design implemented): `openspec/changes/archive/2026-04-26-dashboard-plugin-architecture/`
- Canonical specs: `openspec/specs/dashboard-shell-slots/spec.md`, `openspec/specs/dashboard-plugin-loader/spec.md`
- Sibling extractions:
  - `openspec/changes/extract-openspec-as-plugin/`
  - `openspec/changes/extract-flows-as-plugin/`
  - `openspec/changes/extract-subagents-as-plugin/`
- Layout scan: `openspec/changes/archive/2026-04-26-dashboard-plugin-architecture/design.md` §"Current dashboard layout"
- Git's role in the dashboard: see `docs/architecture.md` §"Git Polling".

## Slot wiring guardrail

When this change wires new slot consumers into `App.tsx` (or any other shell file) inside a `??` fallback chain, the JSX element MUST be gated on a `getClaims(...).length > 0` check **before** construction. See `fix-slot-fallback-masks-content` for the rationale, the lint test that enforces the convention, and the exact production-bug shape that motivated it. Add the shell file path to `SCAN_FILES` in `packages/client/src/__tests__/no-jsx-slot-nullish-fallback.test.ts` if this change touches a file outside `App.tsx`.
