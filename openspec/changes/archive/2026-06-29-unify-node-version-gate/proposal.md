## Why

The nodejs/node#58515 affected-version range and the engines-cap range are encoded **three times** across the repo, and the copies have already drifted:

- `packages/server/src/node-guard.ts` — canonical. `isAffectedNode` = v22.0–v22.18 (`minor < 19`); `isOutOfEnginesRange` = `<22.19.0` OR `>=26`.
- `packages/electron/src/lib/dependency-detector.ts::isVersionAffected` — **drifted**. Uses `minor < 18` (v22.0–v22.17), so it treats **v22.18 as safe** while the server refuses to start on it.
- `pick-node.ts::isBundledNodeAffected` — a third copy, since deleted by the immutable-bundle redesign (`eliminate-electron-runtime-install`).

Consequences of the drift, all in the Electron doctor's `detectSystemNode()` (which feeds the `System Node.js` runtime check and the on-disk scan fallback):

- A system **v22.18.x** Node is reported *usable* but the server guard rejects it (`ERR_INTERNAL_ASSERTION` / EBADENGINE).
- The floor check is `major > 20`, so **v21.x** is reported usable — the server refuses it (`<22.19.0`).
- There is **no upper cap**, so **v26+** is reported usable — the server refuses it (`>=26`).

Net: the doctor's notion of "a usable system Node" does not match what the server will actually run on. The fix is to make the Electron detection use the *same* accept-set as the server, sourced from *one* predicate, with Node 24 and 25 kept first-class (they are the in-range LTS/current majors the CI smoke matrix already covers: `[22, 24, 25]`).

## What Changes

- New `packages/shared/src/node-version.ts` exports the canonical predicates `isAffectedNode`, `isOutOfEnginesRange`, and a combined `isUsableNodeVersion(version)` = `!isOutOfEnginesRange(version) && !isAffectedNode(version)`. Accept-set: Node `>=22.19.0 <26` AND not Fastify-affected → **22.19+, 24.0, 24.3–24.x, 25.x** usable; **22.0–22.18, 24.1–24.2, 21.x, 26+** rejected.
- `packages/server/src/node-guard.ts` imports `isAffectedNode` and `isOutOfEnginesRange` from shared and re-exports them. Message builders and `assertNodeVersionSupported()` unchanged. Server behavior identical — same accept-set, single source.
- `packages/electron/src/lib/dependency-detector.ts` deletes the drifted inline `isVersionAffected` and the ad-hoc floor checks; `detectSystemNode()` and `scanForUsableNodeOnDisk()` both gate on the shared `isUsableNodeVersion`. Result: the doctor reports a system Node as usable iff the server would actually run on it.
- New unit tests pin the shared predicate's boundaries (22.18/22.19, 24.0/24.1/24.2/24.3, 25.x, 26.0, 21.x) and assert `node-guard` re-exports are reference-identical to the shared source.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `server-startup-node-version-guard`: adds a single-source requirement — the affected/engines predicates live in `packages/shared` and are reused by both the server guard and the Electron doctor; no package keeps a private copy.
- `doctor-diagnostic`: adds a requirement — `detectSystemNode()` reports a Node usable iff it passes the shared `isUsableNodeVersion` gate (Node 22.19+, 24, 25 accepted; 22.18, 24.1–24.2, 21.x, 26+ rejected), applied identically to PATH-based detection and the on-disk scan fallback.

## Impact

- **Code**: `packages/shared/src/node-version.ts` (new), `packages/shared/src/index.ts` (re-export), `packages/server/src/node-guard.ts`, `packages/electron/src/lib/dependency-detector.ts`.
- **Tests**: new `packages/shared/src/__tests__/node-version.test.ts`; update `packages/electron/src/__tests__/dependency-detector*.test.ts` expectations for the tightened gate.
- **Migration / compat**: server runtime behavior unchanged (same accept-set, predicates just relocated). The Electron doctor's `System Node.js` check changes: it now reports 21.x / 22.0–22.18 / 26+ as **not usable** (previously usable) and keeps 24.x / 25.x usable. The doctor is diagnostic only — under the immutable-bundle architecture the server always runs the bundled Node, so no spawn path changes.
- **Rollback**: revert the four files + new test. No persisted state.
- **Risk**: low. Pure predicate consolidation; the only user-visible change is a more accurate doctor verdict for out-of-range system Node.
- **Drift risk**: eliminated for the affected/engines range — one definition in `shared`, imported everywhere. Lockstep contract with `package.json#engines.node` now lives at a single site.
