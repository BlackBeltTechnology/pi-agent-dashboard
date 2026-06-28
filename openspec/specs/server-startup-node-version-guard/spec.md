# server-startup-node-version-guard

## Purpose

Preflight refuse-to-start guard that prevents the dashboard server from booting on Node versions outside `package.json#engines.node`. Surfaces what would otherwise be a confusing first-use failure (the worktree-spawn dialog's `npm ci` bootstrap throwing EBADENGINE with no link to the running Node version) as an actionable startup-time error, with three remediation hints.

Complements (does NOT replace) the existing Fastify-bug guard `isAffectedNode` — the two predicates target overlapping but distinct version ranges:

- `isAffectedNode` — Node v22.0–v22.18 and v24.1–v24.2 (Fastify ajv-compiler `ERR_INTERNAL_ASSERTION`, nodejs/node#58515).
- `isOutOfEnginesRange` — Node `<22.19.0` OR `>=26` (engines-cap mirror).
## Requirements
### Requirement: Refuse server start on Node outside engines range

`packages/server/src/node-guard.ts` SHALL expose a pure predicate `isOutOfEnginesRange(version: string): boolean` returning `true` when the running Node falls outside the cap declared in root `package.json#engines.node` (`>=22.19.0 <26`). `assertNodeVersionSupported()` — called at the top of every server entry point (`cmdStart`, `runForeground`) — SHALL write `buildEnginesRangeMessage(version)` to stderr and exit with code `1` when the predicate is true. The check fires AFTER the existing `isAffectedNode` Fastify-bug guard so both messages remain distinguishable.

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

### Requirement: Single-source Node-version predicates

The nodejs/node#58515 affected-range predicate and the engines-cap predicate SHALL be defined once, in `packages/shared/src/node-version.ts`, and exported as `isAffectedNode(version)`, `isOutOfEnginesRange(version)`, and the combined `isUsableNodeVersion(version)` = `!isOutOfEnginesRange(version) && !isAffectedNode(version)`. No package SHALL maintain a private inline copy of either range.

`packages/server/src/node-guard.ts` SHALL import `isAffectedNode` and `isOutOfEnginesRange` from `@blackbelt-technology/pi-dashboard-shared` and re-export them, preserving its existing public API and `assertNodeVersionSupported()` behavior. `packages/electron/src/lib/dependency-detector.ts` SHALL import `isUsableNodeVersion` from the same source.

Lockstep contract: when `package.json#engines.node` or the Fastify-affected range changes, only `packages/shared/src/node-version.ts` changes; every consumer tracks it automatically.

#### Scenario: Server guard re-exports the shared predicate

- **WHEN** `node-guard.ts`'s exported `isAffectedNode` and `isOutOfEnginesRange` are compared by reference to the exports of `packages/shared/src/node-version.ts`
- **THEN** each pair SHALL be the same function reference
- **AND** `assertNodeVersionSupported()` SHALL produce the same exit code and message as before this change for every version

#### Scenario: Electron doctor consumes the shared predicate

- **WHEN** the Electron `dependency-detector.ts` evaluates a candidate Node version
- **THEN** it SHALL call the shared `isUsableNodeVersion` and SHALL NOT define a private affected-range or engines-range predicate

#### Scenario: Range is defined in exactly one place

- **WHEN** the repository is scanned for the literal affected-range arithmetic (`major === 22 && minor < 19`, `major === 24 && minor >= 1 && minor < 3`) and the engines-cap arithmetic (`major >= 26`)
- **THEN** the only defining occurrence SHALL be `packages/shared/src/node-version.ts` (consumers reference the exported predicates)

