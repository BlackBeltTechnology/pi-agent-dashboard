## ADDED Requirements

### Requirement: Refuse server start on Node outside engines range

`packages/server/src/node-guard.ts` SHALL expose a pure predicate `isOutOfEnginesRange(version: string): boolean` returning `true` when the running Node falls outside the cap declared in root `package.json#engines.node` (`>=22.19.0 <25`). `assertNodeVersionSupported()` — called at the top of every server entry point (`cmdStart`, `runForeground`) — SHALL write `buildEnginesRangeMessage(version)` to stderr and exit with code `1` when the predicate is true. The check fires AFTER the existing `isAffectedNode` Fastify-bug guard so both messages remain distinguishable.

Rationale: the worktree-spawn dialog's bootstrap step shells out to `npm ci`, which refuses with `EBADENGINE` when Node falls outside the engines cap. Without this guard the server would boot on Node 25 and the first worktree spawn would silently die with `bootstrap_failed: node engine mismatch`, with no obvious link between the running Node version and the dialog error. Refusing at startup surfaces the same constraint early, with an actionable message.

Lockstep contract: the `<25` upper bound MUST track `package.json#engines.node`. If the cap ever bumps to `<26`, the `>=25` arm of `isOutOfEnginesRange` MUST be dropped in the same change.

CI lockstep contract: the `.github/workflows/ci.yml` `standalone-install-smoke-linux` and `standalone-install-smoke-windows` matrices MUST NOT include Node major versions that this predicate refuses. When the cap moves, the matrices move with it.

#### Scenario: Refuse Node 25 at startup

- **WHEN** the server entry point runs under `node v25.x.x`
- **THEN** `assertNodeVersionSupported()` SHALL write a message containing `❌  pi-dashboard cannot start on Node v25.` and `Required: >=22.19.0 <25` to stderr
- **AND** SHALL call `process.exit(1)` before any Fastify route is registered

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

- **WHEN** `buildEnginesRangeMessage("v25.0.0")` is called
- **THEN** the returned string SHALL contain the substrings `nvm install`, `PATH="$HOME/.pi-dashboard/node/bin`, and `brew install node`
