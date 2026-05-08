## Context

The project shipped a full Jujutsu (jj) workspace plugin (`add-jj-workspace-plugin`) that added:
- A `packages/jj-plugin/` package with slot claims (badge, action bar, sidebar, command-route, settings)
- `packages/shared/src/platform/jj.ts` — recipe wrappers for every jj subcommand
- Bridge-side jj state probing (`gatherJjInfo` in `vcs-info.ts`)
- Server-side `/api/jj/*` REST routes
- Client-side session grouping that collapses `.shadow/<name>/` workspace sessions under their parent repo
- jj-aware session diffs (`enrichWithJjDiff`)
- Two agent skills (`.pi/skills/jj-workspace/`, `.pi/skills/jj-workspace-fold-back/`)
- Tool registry registration of the `jj` binary

The user does not use jj. All this code is dead weight. The removal is a pure subtraction — no new behavior, no replacement.

## Goals / Non-Goals

**Goals:**
- Delete every jj-related file, import, type, test, route, skill, config, and doc reference
- Simplify `session-grouping.ts` group-key resolution to `pin > cwd` (remove the `jjState.workspaceRoot` middle tier)
- Simplify `session-diff.ts` to git-only (remove `enrichWithJjDiff` dispatch)
- Remove `JjState` from `DashboardSession` type — no bridge ever populates it
- Remove `vcsKind`, `diffBase`, `baseLabel` from `SessionDiffResponse`
- Remove `jj_state_update` from the protocol
- Remove jj from the ToolRegistry
- Rebuild plugin registry (auto-generated from remaining manifests)

**Non-Goals:**
- No replacement functionality — pure deletion
- No migration of existing jj data — the user has none
- No preservation of the `jj-workspace-plugin` spec — it is removed entirely
- No changes to OpenSpec core, dashboard plugin runtime, or any other plugin

## Decisions

### D1: Delete the jj-plugin package entirely

**Decision**: Remove `packages/jj-plugin/` from the workspace. Remove the dependency from `packages/client/package.json`. Remove from publish matrix.

**Alternatives considered**:
- Keep the package but disable it via config — adds ongoing maintenance burden for unused code.
- Extract to a separate repo — the user has no use for it.

**Rationale**: Pure subtraction. No other code depends on the jj-plugin as a library (it's only loaded as a dashboard plugin via manifest discovery).

### D2: Remove JjState from DashboardSession

**Decision**: Delete the `JjState` interface and the `jjState?: JjState` field from `DashboardSession`. All predicates (`isInJjRepo`, `isInJjWorkspace`, `isInGitRepoButNotJj`) become dead code and are removed with the plugin.

**Rationale**: Without a bridge that populates it and a plugin that reads it, `JjState` serves no purpose. Removing it simplifies the type and eliminates a conditional field that every session-listing consumer had to handle.

### D3: Simplify session grouping to pin > cwd

**Decision**: Change `resolveSessionGroupPath` from `pin > jjState.workspaceRoot > cwd` to `pin > cwd`. Remove `clusterByWorkspaceName`.

**Rationale**: The workspace-root collapse was the sole consumer of `jjState.workspaceRoot` in session grouping. After removing `JjState`, the middle tier disappears naturally. The `pin > cwd` logic is the original pre-jj behavior.

### D4: Remove vcsKind from SessionDiffResponse

**Decision**: Delete `vcsKind`, `diffBase`, `baseLabel` from `SessionDiffResponse`. Always use git diff.

**Rationale**: These fields were added exclusively for the jj-aware diff path. With jj removed, the diff is always git. The fields were optional (clients gracefully handled absence), so removing them is backwards-compatible within this repo (no other clients consume this API).

### D5: Delete jj platform wrappers

**Decision**: Remove `packages/shared/src/platform/jj.ts` and its test file. Remove the `jj` entry from `ToolRegistry` definitions.

**Rationale**: These wrappers had two consumers: the server jj-routes and the bridge vcs-info probe. Both are removed. The bridge's `bridge-context.ts` no longer needs the `JjState` import, and `model-tracker.ts` no longer emits `jj_state_update`. No other code imports `platform/jj.js`.

### D6: Delete jj skills

**Decision**: Remove `.pi/skills/jj-workspace/` and `.pi/skills/jj-workspace-fold-back/`.

**Rationale**: Skills that teach agents how to operate in jj repos are meaningless without jj. No other skill references them as dependencies.

### D7: Update repo-hygiene spec

**Decision**: Remove the jj-specific requirement from `openspec/specs/repo-hygiene/spec.md` that mandates `.shadow/` in `.gitignore` for jj workspace clones. Re-evaluate whether `.shadow/` should stay in `.gitignore`.

**Rationale**: The `.shadow/` entry was added solely for jj workspace clones. Without jj, the entry may or may not be useful — if other systems use `.shadow/`, keep it; if not, remove it. The spec update removes the jj rationale and replaces it with a generic "local working directories" rationale if `.shadow/` is retained, or removes the requirement entirely if `.shadow/` is dropped from `.gitignore`.

## Risks / Trade-offs

- **[Risk]** The generated `plugin-registry.tsx` references jj-plugin components. → **Mitigation**: The Vite plugin that generates `plugin-registry.tsx` watches `packages/*/package.json` manifests. When `packages/jj-plugin/` is deleted, the next Vite build regenerates the registry. **Fallback**: if regeneration fails (e.g., dev watcher doesn't trigger on directory deletion), manually delete the jj imports from `packages/client/src/generated/plugin-registry.tsx` and run `npm run build`.
- **[Risk]** `seed/` test data contains `worktree` and `.jj/` paths in `.meta.json` files. → **Mitigation**: Remove or rewrite those seed entries to use plain git-only paths.
- **[Risk]** TypeScript compilation may break if any file still references the removed `JjState` type or `jj` platform module. → **Mitigation**: After deletion, run `npx tsc --noEmit` across all packages and fix any remaining imports.
- **[Risk]** Archived OpenSpec changes and specs reference jj. → **Non-goal**: Archived changes are historical record; they are not modified. Only the active `openspec/specs/jj-workspace-plugin/` spec is removed.

## Migration Plan

1. Delete all jj files and dependencies
2. Edit all files that reference jj (types, protocol, bridge, session-grouping, session-diff, etc.)
3. **Gate 1 — source grep**: run cross-package grep to catch remaining `jj` references in source:
   ```bash
   grep -rn '\bjj\b' packages/ --include='*.ts' --include='*.tsx' \
     | grep -v node_modules | grep -v '.jj/' | grep -v 'jj-plugin/' \
     | grep -v '.test.ts' | grep -v '__tests__'
   ```
4. **Gate 2 — full-tree grep**: extend to docs, configs, manifests, seed:
   ```bash
   grep -rn '\bjj\b' docs/ seed/ .github/ vitest.config.ts README.md \
     --include='*.md' --include='*.json' --include='*.yml' --include='*.ts' \
     | grep -v node_modules | grep -v openspec/
   ```
   Both gates must return empty before proceeding.
5. Run `npm install` to update `package-lock.json`
6. Run `npx tsc --noEmit` across all packages to catch type errors
7. Run `npm test` to verify no regressions
8. Run `npm run build` to regenerate `plugin-registry.tsx`
9. Restart dashboard server + reload bridge sessions

No data migration needed — the user has no jj data.

## Open Questions

None. `.shadow/` is removed from `.gitignore` per D7 and the repo-hygiene spec delta. If the user later needs `.shadow/` for other tooling, it can be added back under a generic rationale.
