## REMOVED Requirements

### Requirement: Plugin manifest and slot claims

**Reason**: The `@blackbelt-technology/pi-dashboard-jj-plugin` package, all its slot claims (`session-card-badge`, `session-card-action-bar`, `sidebar-folder-section`, `command-route /jj`, `settings-section`), and all UI components (`JjWorkspaceBadge`, `JjActionBar`, `JjWorkspaceList`, `JjWorkspaceView`, `JjPluginSettings`, `JjInitAffordance`, `JjFoldBackDialog`, `JjForgetConfirmDialog`) are removed. The user does not use Jujutsu.

**Migration**: No migration. All plugin UI disappears automatically when the package is removed from the workspace.

### Requirement: Activation gate via tool registry + filesystem

**Reason**: The `jj` binary is removed from `ToolRegistry` definitions. The bridge-side `gatherJjInfo()` probe and `sendJjStateIfChanged()` are removed. `Session.jjState` is removed from the `DashboardSession` type.

**Migration**: No migration. Sessions without `jjState` are the default state.

### Requirement: Workspace add via existing pending-attach lever

**Reason**: The `POST /api/jj/workspace/add` endpoint and all workspace-creation logic (`jj.workspaceAdd`, bookmark resolution, `pendingAttachRegistry` integration, `spawnPiSession`) are removed.

**Migration**: Use `git worktree add` for parallel workspace creation.

### Requirement: Workspace forget refuses on unfolded commits

**Reason**: The `POST /api/jj/workspace/forget` endpoint and all forget/cleanup logic (`jj.workspaceForget`, `fs.rm` of workspace dir) are removed.

**Migration**: Use `git worktree remove` for workspace cleanup.

### Requirement: Fold-back skill is jj-native and never invokes mutating git

**Reason**: The `.pi/skills/jj-workspace-fold-back/` skill is removed. The `.pi/skills/jj-workspace/` skill is also removed.

**Migration**: Use standard git operations (`git add`, `git commit`, `git push`) for shipping work.

### Requirement: Plain-git repos receive an opt-in colocated-init affordance

**Reason**: The `POST /api/jj/init-colocated` endpoint, the "Enable jj workspaces" button, and the `showInitColocatedSuggestion` config are removed.

**Migration**: Not applicable — the user does not want jj-colocated repos.

### Requirement: Plugin configuration via JSON Schema 7

**Reason**: The jj-plugin `configSchema.json` and all configuration fields (`defaultPushTarget`, `workspaceRoot`, `allowDirectTrunkPush`, `showInitColocatedSuggestion`) are removed with the package.

**Migration**: No migration. Plugin config is removed with the package.

### Requirement: Session diff is jj-aware in jj regimes

**Reason**: The `enrichWithJjDiff` path in `session-diff.ts` is removed. Session diff always uses `git diff`. The optional response fields `vcsKind`, `diffBase`, `baseLabel` are removed from `SessionDiffResponse`.

**Migration**: Clients that consumed `vcsKind` to show "Diffing against \<baseLabel\>" revert to showing nothing (the fields were optional).

### Requirement: jj-aware bridge probe is gated by `.jj/` existence

**Reason**: The bridge-side `gatherJjInfo()` function and `sendJjStateIfChanged()` in `bridge.ts` are removed. The `jj_state_update` protocol message is removed. `JjState` type and `DashboardSession.jjState` field are removed.

**Migration**: No migration. The bridge never sends `jj_state_update`.

### Requirement: Workspace sessions group under their parent repo

**Reason**: `resolveSessionGroupPath` simplifies from `pin > jjState.workspaceRoot > cwd` to `pin > cwd`. `clusterByWorkspaceName` is removed. Sessions group by their actual cwd, as they did before the jj plugin was introduced.

**Migration**: Sessions in `.shadow/<name>/` directories (if any remain from manual worktree setups) will appear in their own folder group instead of collapsing under the parent repo. Pin the parent repo directory to restore grouping if needed.
