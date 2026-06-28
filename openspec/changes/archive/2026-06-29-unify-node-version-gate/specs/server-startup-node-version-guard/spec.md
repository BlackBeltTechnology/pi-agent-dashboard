## ADDED Requirements

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
