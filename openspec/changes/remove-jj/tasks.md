## 1. Remove jj-plugin package

- [x] 1.1 Delete `packages/jj-plugin/` directory entirely
- [x] 1.2 Remove `@blackbelt-technology/pi-dashboard-jj-plugin` dependency from `packages/client/package.json`
- [x] 1.3 Remove jj-plugin workspace entry from root `package.json` (`workspaces` array)
- [x] 1.4 Remove jj-plugin from `.github/workflows/publish.yml` publish order matrix
- [x] 1.5 Remove jj-plugin exclusion from `vitest.config.ts`

## 2. Remove shared types and platform code

- [x] 2.1 Delete `packages/shared/src/platform/jj.ts`
- [x] 2.2 Delete `packages/shared/src/__tests__/platform-jj.test.ts`
- [x] 2.3 Remove `JjState` interface and `DashboardSession.jjState` field from `packages/shared/src/types.ts`
- [x] 2.4 Remove `jj_state_update` message type from `packages/shared/src/protocol.ts`
- [x] 2.5 Remove `vcsKind`, `diffBase`, `baseLabel` from `SessionDiffResponse` in `packages/shared/src/diff-types.ts`
- [x] 2.6 Remove `jj` binary registration from `packages/shared/src/tool-registry/definitions.ts`
- [x] 2.7 Remove jj-related test cases from `packages/shared/src/__tests__/tool-registry-definitions.test.ts`

## 3. Clean up extension (bridge)

- [x] 3.1 Remove `gatherJjInfo()` and all jj imports from `packages/extension/src/vcs-info.ts`
- [x] 3.2 Rename `gatherVcsInfo` back to `gatherGitInfo` or simplify to git-only
- [x] 3.3 Remove `lastJjStateJson`, `sendJjStateIfChanged`, and all jj-related polling from `packages/extension/src/bridge.ts`
- [x] 3.4 Remove `JjState` import from `packages/extension/src/bridge-context.ts`
- [x] 3.5 Remove jj state update logic from `packages/extension/src/model-tracker.ts`

## 4. Clean up server

- [x] 4.1 Delete `packages/server/src/routes/jj-routes.ts`
- [x] 4.2 Remove jj-route registration from `packages/server/src/server.ts`
- [x] 4.3 Remove `enrichWithJjDiff` and jj-aware dispatch from `packages/server/src/session-diff.ts`
- [x] 4.4 Remove `jj_state_update` handler from `packages/server/src/event-wiring.ts`
- [x] 4.5 Remove `jjState`/`vcsKind` destructuring from `packages/server/src/routes/session-routes.ts`

## 5. Clean up client

- [x] 5.1 Simplify `resolveSessionGroupPath` in `packages/client/src/lib/session-grouping.ts` from `pin > jjState.workspaceRoot > cwd` to `pin > cwd`
- [x] 5.2 Remove `clusterByWorkspaceName` from `packages/client/src/lib/session-grouping.ts`
- [x] 5.3 Update tests in `packages/client/src/lib/__tests__/session-grouping.test.ts` — remove jj-workspace-root scenarios
- [x] 5.4 Remove `vcsKind`/`baseLabel` conditional rendering from `packages/client/src/components/FileDiffView.tsx`
- [x] 5.5 Delete generated jj-plugin imports from `packages/client/src/generated/plugin-registry.tsx` (auto-regenerated on next build)

## 6. Remove jj skills

- [x] 6.1 Delete `.pi/skills/jj-workspace/` directory
- [x] 6.2 Delete `.pi/skills/jj-workspace-fold-back/` directory

## 7. Update OpenSpec specs

- [x] 7.1 Delete `openspec/specs/jj-workspace-plugin/` directory
- [x] 7.2 Apply `specs/repo-hygiene/spec.md` delta: remove jj-specific `.shadow/` requirement
- [x] 7.3 Remove `.shadow/` from repo-root `.gitignore` (if no other tooling uses it)

## 8. Update documentation

- [x] 8.1 Remove jj section from `README.md`
- [x] 8.2 Remove jj-specific rows from `docs/file-index.md`, `docs/file-index-extension.md`, `docs/file-index-client.md`, `docs/file-index-server.md`, `docs/file-index-shared.md`, `docs/file-index-plugins.md`, `docs/file-index-skills-misc.md`
- [x] 8.3 Remove jj sections from `docs/architecture.md`
- [x] 8.4 Remove jj-plugin from `docs/publishing-plugins.md`
- [x] 8.5 Delete `docs/plans/openspec-jj-bridge.md`

## 9. Update seed data

- [x] 9.1 Remove `worktree` and `.jj/` paths from `seed/` `.meta.json` files

## 10. Rebuild and verify

- [x] 10.1 Run `npm install` to update `package-lock.json`
- [x] 10.2 Run `npx tsc --noEmit` across all packages to catch type errors
- [x] 10.3 Run `npm test` — all tests pass (jj-related tests removed)
- [x] 10.4 Run `npm run build` — client builds without jj-plugin imports
- [x] 10.5 Restart dashboard server via `curl -X POST http://localhost:8000/api/restart`
- [x] 10.6 Run `npm run reload` to reload all bridge sessions
- [x] 10.7 Verify dashboard health: `curl -s http://localhost:8000/api/health | jq .mode`
- [x] 10.8 Run source grep gate: `grep -rn '\bjj\b' packages/ --include='*.ts' --include='*.tsx' | grep -v node_modules | grep -v '.jj/' | grep -v 'jj-plugin/' | grep -v '.test.ts' | grep -v '__tests__'` — must be empty
- [x] 10.9 Run full-tree grep gate: `grep -rn '\bjj\b' docs/ seed/ .github/ vitest.config.ts README.md --include='*.md' --include='*.json' --include='*.yml' --include='*.ts' | grep -v node_modules | grep -v openspec/` — must be empty
