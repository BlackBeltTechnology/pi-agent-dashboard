## Why

The project contains a full Jujutsu (jj) workspace plugin, platform wrappers, skills, and integrations that the user does not use. The user works exclusively with git. All jj-related code, configuration, documentation, and tooling is dead weight — it increases maintenance burden, adds unnecessary dependencies, clutters the codebase with conditional paths (`vcsKind === "jj"`, `jjState?.workspaceRoot`), and complicates onboarding for new contributors who only need git.

## What Changes

- **Remove** the entire `packages/jj-plugin/` package (plugin manifest, client UI components, server routes, config schema, tests)
- **Remove** `packages/shared/src/platform/jj.ts` — all jj command recipe wrappers
- **Remove** `packages/shared/src/__tests__/platform-jj.test.ts` — jj platform tests
- **Remove** `packages/server/src/routes/jj-routes.ts` — `/api/jj/*` REST endpoints; also unregistered from `packages/server/src/server.ts`
- **Remove** `.pi/skills/jj-workspace/` and `.pi/skills/jj-workspace-fold-back/` — agent skills
- **Remove** `jj` from the `ToolRegistry` definitions (`packages/shared/src/tool-registry/definitions.ts`)
- **Remove** `JjState` type from `packages/shared/src/types.ts` and all `jjState` references from `DashboardSession`
- **Remove** `jj_state_update` message type from `packages/shared/src/protocol.ts`
- **Remove** `vcsKind: "jj"`, `diffBase`, `baseLabel` from `packages/shared/src/diff-types.ts`
- **Remove** `gatherJjInfo()` from `packages/extension/src/vcs-info.ts` and all bridge-side jj state tracking (`sendJjStateIfChanged`, `lastJjStateJson`) from `packages/extension/src/bridge.ts`
- **Remove** jj workspace-root clustering logic from `packages/client/src/lib/session-grouping.ts` — simplify group-key resolution to `pin > cwd` (remove `jjState.workspaceRoot` priority)
- **Remove** `clusterByWorkspaceName` — dead code after jjState removal
- **Remove** jj-aware diff dispatch from `packages/server/src/session-diff.ts` — always use git diff
- **Remove** `@blackbelt-technology/pi-dashboard-jj-plugin` dependency from `packages/client/package.json`
- **Remove** jj-plugin workspace from root `package.json` and `package-lock.json`
- **Remove** jj-plugin from `.github/workflows/publish.yml` publish matrix
- **Remove** jj-plugin exclusion from `vitest.config.ts`
- **Remove** jj references from `seed/` test data
- **Remove** jj sections from `README.md` and all `docs/` files
- **Remove** `docs/plans/openspec-jj-bridge.md`
- **Update** `openspec/specs/repo-hygiene/spec.md` — remove jj-specific `.shadow/` requirement. Default: remove `.shadow/` from `.gitignore` (the entry existed only for jj workspace clones). If the user has other tooling that uses `.shadow/`, the requirement can be re-added under a generic "local working directories" rationale.
- **Regenerate** `packages/client/src/generated/plugin-registry.tsx` by removing the jj-plugin manifest (the Vite plugin will do this automatically when the manifest disappears)

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `repo-hygiene`: Remove jj workspace directory references. `.shadow/` entry in `.gitignore` is re-evaluated — if no other system uses `.shadow/`, the entry is removed. If `.shadow/` is retained as a generic convention, the spec is updated to remove jj-specific language.
- `jj-workspace-plugin`: **Removed entirely.** The spec file is deleted.

## Impact

- **`packages/jj-plugin/`** — deleted in its entirety (~15 source files, tests, config)
- **`packages/shared/src/platform/jj.ts`** — deleted (~430 lines)
- **`packages/shared/src/types.ts`** — `JjState` interface and `DashboardSession.jjState` field removed
- **`packages/shared/src/protocol.ts`** — `jj_state_update` message removed
- **`packages/shared/src/diff-types.ts`** — `vcsKind`, `diffBase`, `baseLabel` removed
- **`packages/shared/src/tool-registry/definitions.ts`** — `jj` binary definition removed
- **`packages/extension/src/vcs-info.ts`** — `gatherJjInfo()` removed; simplified to git-only `gatherVcsInfo()` (or renamed back to `gatherGitInfo`)
- **`packages/extension/src/bridge.ts`** — jj state polling and `sendJjStateIfChanged` removed
- **`packages/extension/src/bridge-context.ts`** — `JjState` import removed
- **`packages/extension/src/model-tracker.ts`** — jj state update logic removed
- **`packages/client/src/lib/session-grouping.ts`** — `resolveSessionGroupPath` simplified; `clusterByWorkspaceName` removed
- **`packages/client/src/generated/plugin-registry.tsx`** — auto-regenerated (jj imports removed)
- **`packages/server/src/session-diff.ts`** — `enrichWithJjDiff` removed; always use git
- **`packages/server/src/event-wiring.ts`** — `jj_state_update` handler removed
- **`packages/server/src/routes/session-routes.ts`** — `jjState`/`vcsKind` destructuring removed
- **`packages/client/src/components/FileDiffView.tsx`** — `vcsKind`/`baseLabel` conditional rendering removed
- **`packages/server/src/routes/jj-routes.ts`** — deleted
- **Skills** `.pi/skills/jj-workspace/`, `.pi/skills/jj-workspace-fold-back/` — deleted
- **Docs** — jj sections removed from `README.md`, `docs/file-index-*.md`, `docs/architecture.md`, `docs/publishing-plugins.md`; `docs/plans/openspec-jj-bridge.md` deleted
- **CI** `.github/workflows/publish.yml` — jj-plugin removed from publish order
- **`vitest.config.ts`** — jj-plugin exclusion removed
- **`seed/`** — jj data removed from seed `.meta.json` files
- **OpenSpec specs** — `openspec/specs/jj-workspace-plugin/` deleted; `openspec/specs/repo-hygiene/` updated
