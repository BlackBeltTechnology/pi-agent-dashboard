## Context

The Electron app ships a bundled Node.js v22 LTS binary as `extraResources` (capability: `bundled-node-runtime`) and `pickNodeForServer` (in `packages/electron/src/lib/pick-node.ts`) selects between three candidates: bundled → system → `process.execPath` fallback. The dashboard server's own `assertNodeVersionSupported()` guard (`packages/server/src/node-guard.ts`) refuses to start on Node versions affected by `nodejs/node#58515` (v22.0–v22.17 and v24.1–v24.2). When the bundled Node falls in that range the picker still selects it, the spawned server immediately exits with the upgrade banner, and the Electron app has no fall-through path. The `execpath-fallback` is equally broken because Electron's embedded Node is in the same family.

A real production user hit this with a bundled v22.12.0: pi sessions registered briefly then exited (separate bug fixed in `~/.pi-dashboard/` peer-dep recovery), and the dashboard server itself refused to start on every relaunch. The user's nvm-managed v22.22.0 was unreachable from the GUI launch because the macOS Finder-launched Electron app does not inherit the user's shell PATH, and the login-shell `which node` fallback (`whichViaLoginShell` in `packages/shared/src/platform/binary-lookup.ts`) is not always reliable in that context.

## Goals / Non-Goals

**Goals:**
- The Electron app never selects a Node binary that the dashboard server will reject.
- System Node detection works in macOS GUI launch contexts where PATH lacks nvm/volta/brew dirs.
- The change is purely additive — no signature breakage for `pickNodeForServer`, no behavior change when the bundled Node is version-safe.
- Tests cover the new branches without depending on real disk state.

**Non-Goals:**
- Replacing the bundled Node binary with a newer version (separate concern: bumping the build-time pin lives in `bundled-node-runtime` not here).
- Windows GUI launch coverage (different path resolution semantics, no user report).
- Eliminating the duplicated affected-version predicate. Cross-package import would add a dependency edge from electron → server that's currently absent; the predicate is 7 lines and changes rarely.

## Decisions

### D1. Pass version into `pickNodeForServer` as an injected input, not read inside the function

`pickNodeForServer` is documented as a **pure** function (`packages/electron/src/lib/pick-node.ts` header comment): every external dependency arrives via `PickNodeInput`. The function MUST NOT spawn child processes itself. Therefore the caller (`launch-source.ts` or `server-lifecycle.ts`) probes `<bundled> --version` via `execFileSync` and passes the result as `bundledNodeVersion?: string`. Optional so legacy callers stay valid; absent → no version gate (matches current behavior).

**Alternatives considered:**
- *Inline `execFileSync` inside the picker* — rejected: breaks purity invariant and the `no-electron-execpath-spawn` lint family.
- *Make `bundledNodeVersion` required* — rejected: forces a coordinated edit across every test fixture and any future caller.

### D2. Duplicate `isBundledNodeAffected` in `pick-node.ts` rather than import from `packages/server`

`packages/electron` does NOT depend on `@blackbelt-technology/pi-dashboard-server` (only on `pi-dashboard-shared`). Adding a server dep purely to import a 7-line predicate is a heavy edge. The predicate is inlined with a comment pointing to `node-guard.ts#isAffectedNode` as the canonical source.

**Drift mitigation:** repo-lint test (future, out of scope) could assert the two predicates produce identical output across a fixed version corpus. For now, manual review when ranges change.

### D3. Disk-scan fallback ordered by likely-correctness, not by speed

`scanForUsableNodeOnDisk()` iterates candidates in this fixed order:
1. `~/.nvm/versions/node/<each>/bin/node` (highest semver desc first)
2. `/opt/homebrew/bin/node` (Apple Silicon Homebrew)
3. `/usr/local/bin/node` (Intel Homebrew / classic /usr/local)
4. `~/.volta/bin/node`
5. `/usr/bin/node`

Rationale: macOS users with nvm almost always want their nvm-selected Node (it's the one matching their development workflow); Homebrew comes next because it's the default for non-nvm users; volta is rare; `/usr/bin/node` is essentially always missing on macOS but cheap to check.

**Each candidate** is probed with `execFileSync(cand, ["--version"], { timeout: 5000 })`. Candidates returning a version below 20.6 or in the affected range are skipped. First success wins.

**Alternatives considered:**
- *Use `which -a node` to enumerate* — rejected: same PATH-inheritance problem we are trying to work around.
- *Parse `~/.nvmrc` / `~/.tool-versions`* — rejected: complicates the scan and doesn't help when those files are absent.
- *Spawn a login shell* — rejected: already done by `whichViaLoginShell` and demonstrably unreliable from GUI launches.

### D4. Windows is excluded from the disk-scan

Windows has different idiomatic install paths (`C:\Program Files\nodejs\`, `%LOCALAPPDATA%\fnm\`, etc.) and no user report. Keeping the change Unix-only minimizes blast radius. A future change can extend it if needed; documented in proposal.

### D5. Probe timeout: 5 seconds per candidate

Long enough to cover slow filesystems (network home dirs); short enough that a stuck binary cannot brick the launch. Worst case (5 candidates all stuck) is 25 s, which still surfaces a clean `{ found: false }` result rather than hanging the Electron main process indefinitely.

## Risks / Trade-offs

- **Predicate drift** → Mitigated by inline comment + manual review on range edits. Acceptable because the range derives from upstream Node release notes and changes rarely.
- **Disk-scan picks a Node the user didn't intend** → Lowest risk: the scan only runs when system Node is not found, and the candidates are ordered by user-expectation precedence. The picked Node passes version-safety AND >=20.6 gates.
- **Probe latency** → Bounded to 25 s worst case; typical first-success path is <100 ms.
- **Cross-package edge avoided** → Electron stays decoupled from server internals (good); pays a small duplication cost (acceptable).

## Migration Plan

1. Land the four-file code change + the new test file.
2. Cut a patch Electron release.
3. Users on a working bundled Node (v22.18+) see zero change.
4. Users on the affected bundled Node v22.12.0 (the production user) see the picker fall through to system Node automatically on next launch.

**Rollback:** revert the four files. No persisted state, no schema migration, no API change.

## Open Questions

None. Code is implemented and tests pass.
