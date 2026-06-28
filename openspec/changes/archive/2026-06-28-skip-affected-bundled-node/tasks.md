## Tasks

### 1. Picker change

- [x] 1.1 Add optional `bundledNodeVersion?: string` field to `PickNodeInput` in `packages/electron/src/lib/pick-node.ts`.
- [x] 1.2 Add exported pure predicate `isBundledNodeAffected(version: string): boolean` covering v22.0–v22.17 and v24.1–v24.2. Inline comment pointing to canonical `node-guard.ts#isAffectedNode`.
- [x] 1.3 Modify the bundled-branch in `pickNodeForServer` to skip when `bundledNodeVersion && isBundledNodeAffected(bundledNodeVersion)`, falling through to the system branch.

### 2. Wire bundled-version probe into both launch paths

- [x] 2.1 In `packages/electron/src/lib/launch-source.ts` (V2 path), import `execFileSync` from `node:child_process`; probe `<bundledNode> --version` with `{ encoding: "utf8", timeout: 5000 }`; swallow errors; pass result as `bundledNodeVersion` to `pickNodeForServer`.
- [x] 2.2 Mirror the same logic in `packages/electron/src/lib/server-lifecycle.ts` (legacy V1 path).

### 3. System-Node disk-scan fallback

- [x] 3.1 In `packages/electron/src/lib/dependency-detector.ts`, add `scanForUsableNodeOnDisk(): string | null` that enumerates `~/.nvm/versions/node/*/bin/node` (highest semver desc), `/opt/homebrew/bin/node`, `/usr/local/bin/node`, `~/.volta/bin/node`, `/usr/bin/node`. Skip Windows hosts. Probe each candidate's `--version` with 5 s timeout, skip if version < 20.6 or in affected range.
- [x] 3.2 Add pure helper `compareSemverDesc(a, b)` for ordering nvm versions.
- [x] 3.3 Add pure helper `isVersionAffected(version)` (mirror of `isBundledNodeAffected`, kept inline to avoid cross-module import inside this module).
- [x] 3.4 Modify `detectSystemNode()`: if PATH-based lookup returns nothing OR returns a version in the affected range, call `scanForUsableNodeOnDisk()` and return its result (wrapped in `DetectionResult`).

### 4. Tests

- [x] 4.1 Create `packages/electron/src/__tests__/pick-node.test.ts` covering: predicate range (5 cases including boundary), picker fall-through under each `bundledNodeVersion` shape (legacy, safe, affected+system, affected+no-system, Windows path layout).
- [x] 4.2 Verify all 10 new tests pass: `HOME=$(mktemp -d) npx vitest run packages/electron/src/__tests__/pick-node.test.ts`.
- [x] 4.3 Verify no regression in existing tests (`packages/electron/src/__tests__/dependency-detector.test.ts` baseline has 7 pre-existing failures; my changes neither add nor remove failures).

### 5. Documentation

- [ ] 5.1 Update `docs/file-index-electron.md` rows for `pick-node.ts`, `launch-source.ts`, `server-lifecycle.ts`, `dependency-detector.ts` with the new behavior tag `See change: skip-affected-bundled-node`.
- [ ] 5.2 Add a one-line `docs/faq.md` entry: "Electron app refuses to start with Node v22.12.0 error — what now?" → "Upgrade past 0.5.4 (the picker auto-falls-through). Workaround: install Node v22.18+ via nvm/brew."

### 6. Release

- [ ] 6.1 Stage the four-file diff + the new test file.
- [ ] 6.2 Add CHANGELOG entry under `## [Unreleased]` → `### Fixed`: "Electron: skip bundled Node when affected by nodejs/node#58515; scan nvm/brew/volta dirs when system Node is not on PATH (skip-affected-bundled-node)".
- [ ] 6.3 Cut a patch release.
