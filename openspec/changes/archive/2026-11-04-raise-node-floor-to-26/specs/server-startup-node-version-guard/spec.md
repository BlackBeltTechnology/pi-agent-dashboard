## REMOVED Requirements

### Requirement: Refuse server start on Node outside engines range
**Reason**: The supported range moves from `>=22.19.0 <27` to `>=26.0.0 <27`; most of its scenarios (allow 22.19+, 24 LTS, 25) now describe refused versions, and the separate nodejs/node#58515 startup check is subsumed by the new floor.
**Migration**: Replaced by "Refuse server start on Node outside the Node 26 engines range". Users on Node 22/24/25 install Node 26 or use the desktop app (bundled Node).

## ADDED Requirements

### Requirement: Refuse server start on Node outside the Node 26 engines range

`packages/server/src/auth/node-guard.ts` SHALL expose a pure predicate `isOutOfEnginesRange(version: string): boolean` returning `true` when the running Node falls outside the cap declared in root `package.json#engines.node` (`>=26.0.0 <27`). `assertNodeVersionSupported()` — called at the top of every server entry point (`cmdStart`, `runForeground`) — SHALL write `buildEnginesRangeMessage(version)` to stderr and exit with code `1` when the predicate is true. The engines-range check is the only startup Node-version check; the nodejs/node#58515 affected ranges (v22.0–v22.18, v24.1–v24.2) lie entirely below the floor and SHALL NOT be checked separately at server start.

Lockstep contract: both bounds MUST track `package.json#engines.node`. When the range moves, the predicate moves with it.

CI lockstep contract: the `.github/workflows/_smoke.yml` `standalone-install-smoke-linux` matrix SHALL include every SUPPORTED Node major and no unsupported one. Today that set is `[26]`. The `standalone-install-smoke-windows` leg SHALL be pinned to `[26]`, and every `ci.yml` `setup-node` step SHALL use `node-version: 26`.

#### Scenario: Refuse Node 27 at startup

- **WHEN** the server entry point runs under `node v27.x.x` or newer
- **THEN** `assertNodeVersionSupported()` SHALL write a message containing `❌  pi-dashboard cannot start on Node v27.` and `Required: >=26.0.0 <27` to stderr
- **AND** SHALL call `process.exit(1)` before any Fastify route is registered

#### Scenario: Allow Node 26

- **WHEN** the server entry point runs under `node v26.0.0` or any later `26.x.x`
- **THEN** `assertNodeVersionSupported()` SHALL return normally
- **AND** the server SHALL proceed to start Fastify

#### Scenario: Refuse Node 24 LTS at startup

- **WHEN** the server entry point runs under any `node v24.x.x`
- **THEN** `assertNodeVersionSupported()` SHALL write the engines-range message naming `Required: >=26.0.0 <27` to stderr
- **AND** SHALL exit with code `1`

#### Scenario: Refuse Node 25 at startup

- **WHEN** the server entry point runs under any `node v25.x.x`
- **THEN** `assertNodeVersionSupported()` SHALL exit with code `1` after writing the engines-range message

#### Scenario: Refuse Node 22 at startup

- **WHEN** the server entry point runs under any `node v22.x.x`, including the formerly supported `v22.19.0+`
- **THEN** `assertNodeVersionSupported()` SHALL exit with code `1` after writing the engines-range message
- **AND** no separate nodejs/node#58515 message SHALL be written

#### Scenario: Smoke matrix covers exactly the supported set

- **WHEN** the repo-lint reads the `standalone-install-smoke-linux` matrix in `.github/workflows/_smoke.yml`
- **THEN** the set of Node majors SHALL equal `[26]`

## MODIFIED Requirements

### Requirement: Engines-range message references bundled-Node remediation

`buildEnginesRangeMessage(version: string): string` SHALL always include the nvm and brew
remediation hints. The managed-Node hint (`PATH="$HOME/.pi-dashboard/node/bin` prepend) SHALL be
included only when a managed Node runtime is installed under `<managedDir>/node/` AND the version
recorded in its `<managedDir>/node/.version` marker satisfies the engines range (read from the
marker, never by spawning Node; a missing or unreadable marker omits the hint) — a missing or below-floor managed runtime makes the hint dead advice,
so it SHALL be omitted. The nvm hint SHALL name Node 26 (`nvm install 26`), and the brew hint SHALL
NOT name a Node line outside the engines range. The managed-dir mention remains
advisory text plus an existence probe, not a write; the file stays allowlisted in
`packages/shared/src/__tests__/no-managed-dir-reference.test.ts` under change
`eliminate-electron-runtime-install` (R3), with the allowlist rationale updated to cover the
existence probe.

#### Scenario: Message lists three install paths

- **WHEN** the engines-range message is built on a machine where `<managedDir>/node/` contains a
  managed runtime
- **THEN** the returned string SHALL contain the substrings `nvm install`,
  `PATH="$HOME/.pi-dashboard/node/bin`, and `brew install node`

#### Scenario: Message omits managed hint without a managed Node

- **WHEN** the engines-range message is built on a machine with no managed runtime under
  `<managedDir>/node/`
- **THEN** the returned string SHALL contain `nvm install` and `brew install node`
- **AND** SHALL NOT contain the substring `.pi-dashboard`

#### Scenario: Message omits managed hint for a below-floor managed Node

- **WHEN** the engines-range message is built and `<managedDir>/node/.version` contains `v24.15.0`
- **THEN** the returned string SHALL NOT contain `.pi-dashboard`
- **AND** SHALL contain `nvm install 26`

### Requirement: Single-source Node-version predicates

The engines-cap predicate and both Node floors SHALL be defined once, in `packages/shared/src/node-version.ts`. That module SHALL export two distinct floor constants: the dashboard server floor (`26.0.0`, the lower bound of `package.json#engines.node`) and the pi spawn floor (`22.19.0`, pi's own `engines.node` minimum, used by the spawn-runtime ladder as its fallback floor). It SHALL export `isOutOfEnginesRange(version)` and `isUsableNodeVersion(version)` = `!isOutOfEnginesRange(version)`. The nodejs/node#58515 affected-range predicate `isAffectedNode(version)` SHALL remain exported from the same module solely for the pi-session spawn-runtime ladder gate. No package SHALL maintain a private inline copy of any range or floor.

`packages/server/src/auth/node-guard.ts` SHALL import `isOutOfEnginesRange` from `@blackbelt-technology/pi-dashboard-shared` and re-export it. `packages/electron/src/lib/dependency-detector.ts` SHALL import `isUsableNodeVersion` from the same source.

Lockstep contract: when `package.json#engines.node` changes, only `packages/shared/src/node-version.ts` changes; every consumer tracks it automatically. Raising the dashboard server floor SHALL NOT change the pi spawn floor.

#### Scenario: Server guard re-exports the shared predicate

- **WHEN** `node-guard.ts`'s exported `isOutOfEnginesRange` is compared by reference to the export of `packages/shared/src/node-version.ts`
- **THEN** they SHALL be the same function reference

#### Scenario: Electron doctor consumes the shared predicate

- **WHEN** the Electron `dependency-detector.ts` evaluates a candidate Node version
- **THEN** it SHALL call the shared `isUsableNodeVersion` and SHALL NOT define a private engines-range predicate

#### Scenario: Dashboard floor and pi floor are distinct

- **WHEN** the two floor constants exported by `node-version.ts` are read
- **THEN** the dashboard server floor SHALL be `26.0.0`
- **AND** the pi spawn floor SHALL be `22.19.0`

#### Scenario: Range is defined in exactly one place

- **WHEN** TypeScript sources under `packages/*/src` are scanned for the engines-cap arithmetic (`major >= 27`) and the floor literals `26.0.0` and `22.19.0` used as version comparisons
- **THEN** the only defining occurrence SHALL be `packages/shared/src/node-version.ts` (consumers reference the exported predicates and constants)
- **AND** non-TypeScript mirrors of the range (`package.json#engines.node`, the Claude-plugin `ensure-dashboard.sh` constants, `BUNDLED_NODE_VERSION`, workflow `node-version` pins, Docker base images) SHALL each be pinned to it by a repo-lint test
- **AND** the range SHALL additionally be asserted to match the `Required: …` string literal emitted by `buildEnginesRangeMessage`, which is a defining occurrence the arithmetic scan cannot detect
