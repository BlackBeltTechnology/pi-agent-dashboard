## ADDED Requirements

### Requirement: Refuse server start on Node outside engines range

`packages/server/src/node-guard.ts` SHALL expose a pure predicate `isOutOfEnginesRange(version: string): boolean` returning `true` when the running Node falls outside the cap declared in root `package.json#engines.node` (`>=22.19.0 <26`). `assertNodeVersionSupported()` — called at the top of every server entry point (`cmdStart`, `runForeground`) — SHALL write `buildEnginesRangeMessage(version)` to stderr and exit with code `1` when the predicate is true. The check fires AFTER the existing `isAffectedNode` Fastify-bug guard so both messages remain distinguishable.

Rationale: the predicate gives a single, actionable startup-time error when the running Node falls outside the cap. The cap is permissive enough to cover Node 22.19+, 24, and 25 (the three lines CI smoke matrices test) while catching configurations that are genuinely out of support (below the pi 0.75 floor, or speculative future majors).

History: the cap was briefly `<25` in commit 63a8d531 on the theory that subprocess `npm ci` (worktree-spawn bootstrap) would EBADENGINE on Node 25. CI smoke matrices had been running Node 25 cleanly the whole time (because they pass `--engine-strict=false`); the dev-reported EBADENGINE was almost certainly an nvm subprocess-PATH artifact, not a real engines failure. Bumping engines to `<26` removes the npm-side trigger at the source and restores Node 25 as a first-class target.

Lockstep contract: the upper bound MUST track `package.json#engines.node`. When the cap moves, the predicate moves with it.

CI lockstep contract: `.github/workflows/ci.yml` `standalone-install-smoke-linux` and `standalone-install-smoke-windows` matrices SHALL include every Node major in the engines range. Today that is `[22, 24, 25]`.

#### Scenario: Refuse Node 26 at startup

- **WHEN** the server entry point runs under `node v26.x.x` or newer
- **THEN** `assertNodeVersionSupported()` SHALL write a message containing `❌  pi-dashboard cannot start on Node v26.` and `Required: >=22.19.0 <26` to stderr
- **AND** SHALL call `process.exit(1)` before any Fastify route is registered

#### Scenario: Allow Node 25

- **WHEN** the server entry point runs under `node v25.x.x`
- **THEN** `assertNodeVersionSupported()` SHALL return normally
- **AND** the server SHALL proceed to start Fastify

#### Scenario: Refuse Node below floor at startup

- **WHEN** the server entry point runs under `node v22.18.x` or older
- **THEN** `assertNodeVersionSupported()` SHALL exit with code `1` after writing the engines-range message
- **AND** the existing `isAffectedNode` Fastify-bug message MAY take precedence when the same version is also in the Fastify-affected range (caller-order, not behavior-changing)

#### Scenario: Allow Node 24 LTS

- **WHEN** the server entry point runs under `node v24.3.0` through `node v24.x.x`
- **THEN** `assertNodeVersionSupported()` SHALL return normally
- **AND** the server SHALL proceed to start Fastify

#### Scenario: Allow Node 22.19+

- **WHEN** the server entry point runs under `node v22.19.0` or any later `22.x.x`
- **THEN** `assertNodeVersionSupported()` SHALL return normally

### Requirement: Engines-range message references bundled-Node remediation

`buildEnginesRangeMessage(version: string): string` SHALL include three remediation hints (nvm, bundled, brew). The bundled hint SHALL reference `$HOME/.pi-dashboard/node/bin` as a PATH prepend — read-only advisory text, NOT a runtime read or write of that directory. This file is therefore allowlisted in `packages/shared/src/__tests__/no-managed-dir-reference.test.ts` under change `eliminate-electron-runtime-install` (R3).

#### Scenario: Message lists three install paths

- **WHEN** `buildEnginesRangeMessage("v26.0.0")` is called
- **THEN** the returned string SHALL contain the substrings `nvm install`, `PATH="$HOME/.pi-dashboard/node/bin`, and `brew install node`
