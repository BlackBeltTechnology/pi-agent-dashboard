## Tasks

### 1. Shared canonical predicates

- [x] 1.1 Create `packages/shared/src/node-version.ts` exporting `isAffectedNode(version)` (v22.0–v22.18, v24.1–v24.2), `isOutOfEnginesRange(version)` (`<22.19.0` OR `>=26`), and `isUsableNodeVersion(version)` = `!isOutOfEnginesRange(v) && !isAffectedNode(v)`. Port the doc comments + lockstep notes verbatim from `node-guard.ts`.
- [x] 1.2 Re-export the three predicates from `packages/shared/src/index.ts`.

### 2. Rewire server guard to the shared source

- [x] 2.1 In `packages/server/src/node-guard.ts`, delete the inline `isAffectedNode` / `isOutOfEnginesRange` bodies; import both from `@blackbelt-technology/pi-dashboard-shared` and re-export them (preserve the public API). Keep `buildEnginesRangeMessage`, `buildNodeUpgradeMessage`, `assertNodeVersionSupported` unchanged.
- [x] 2.2 Run server node-guard tests: behavior identical, all green.

### 3. Rewire Electron doctor detection to the shared gate

- [x] 3.1 In `packages/electron/src/lib/dependency-detector.ts`, delete the drifted inline `isVersionAffected`. Import `isUsableNodeVersion` from shared.
- [x] 3.2 `detectSystemNode()`: replace the `major > 20 && !isVersionAffected(...)` check with `isUsableNodeVersion(version)`.
- [x] 3.3 `scanForUsableNodeOnDisk()`: replace the `>= 20.6` floor + `isVersionAffected` skip with a single `isUsableNodeVersion(v)` gate. Keep `compareSemverDesc` + the candidate-path ordering.
- [x] 3.4 Update the `See change:` annotation on the touched functions to `unify-node-version-gate`.

### 4. Tests

- [x] 4.1 Create `packages/shared/src/__tests__/node-version.test.ts` covering the accept-set table: 21.x→false, 22.18→false, 22.19→true, 24.0→true, 24.1→false, 24.2→false, 24.3→true, 25.x→true, 26.0→false.
- [x] 4.2 Add a re-export-identity assertion (server test): `nodeGuard.isAffectedNode === shared.isAffectedNode` and same for `isOutOfEnginesRange`.
- [x] 4.3 Update `packages/electron/src/__tests__/dependency-detector*.test.ts` expectations for the tightened gate (22.18 / 21.x / 26+ now report not-found; 24.x / 25.x still usable).
- [x] 4.4 Run `npx vitest run packages/shared packages/server packages/electron` (worktree: aliased shared to worktree-local src; 49 server+shared, 26 electron — all green) — new + existing tests green (modulo the documented pre-existing dependency-detector baseline failures, if any remain unrelated).

### 5. Documentation

- [x] 5.1 Update `docs/file-index-shared.md` (new `node-version.ts` row), `docs/file-index-server.md` (`node-guard.ts` now re-exports from shared), `docs/file-index-electron.md` (`dependency-detector.ts` gates on shared `isUsableNodeVersion`). Tag `See change: unify-node-version-gate`. Caveman style.

### 6. Release

- [x] 6.1 CHANGELOG `### Fixed`: "Unify Node-version predicates in shared; Electron doctor now reports system Node usable iff the server accepts it (Node 22.19+, 24, 25); fixes v22.18 false-positive drift (unify-node-version-gate)".
