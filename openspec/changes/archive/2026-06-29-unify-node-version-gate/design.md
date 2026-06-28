## Context

Three predicates encoded the nodejs/node#58515 affected range and the engines cap independently. The archived change `skip-affected-bundled-node` flagged this drift as a known risk ("If the affected range is ever revised, both copies must move together") and it then materialized: `bump-pi-compat-to-0-75` widened the canonical 22.x cutoff from `< 18` to `< 19`, `node-guard.ts` followed, but the Electron `dependency-detector.ts` copy stayed at `< 18`. The `pick-node.ts` third copy was deleted when `eliminate-electron-runtime-install` collapsed the picker to bundled-only, so two live copies remain — and they disagree on v22.18.

`detectSystemNode()` (electron) feeds only the **doctor** (`doctor-core.ts`, `doctor-routes.ts`, electron `doctor.ts`) — it is a diagnostic surface, not a server-spawn path. Under the immutable-bundle architecture the server always runs the bundled Node. So the blast radius of changing the Electron gate is limited to the accuracy of the `System Node.js` doctor verdict.

## Goals / Non-Goals

**Goals:**
- One definition of the affected range and the engines cap, imported everywhere.
- The Electron doctor reports a system Node usable iff the server would actually run on it.
- Node 24 and 25 stay first-class usable (in-range majors the CI smoke matrix already covers).
- Server runtime behavior byte-for-byte unchanged.

**Non-Goals:**
- Changing the engines range or the affected range values themselves.
- Re-introducing system-Node selection into the server-spawn picker (removed by `eliminate-electron-runtime-install`; out of scope).
- Windows on-disk scan coverage (still Unix-only; unchanged).

## Decisions

### D1. Hoist the canonical predicates into `packages/shared`, not import electron→server

Both `packages/server` and `packages/electron` already depend on `@blackbelt-technology/pi-dashboard-shared`; neither depends on the other in the needed direction (electron does NOT depend on server). `node-guard.ts` is currently self-contained (no imports). Moving the two pure predicates to `packages/shared/src/node-version.ts` gives a single source both packages legitimately import, with no new dependency edge.

`node-guard.ts` re-exports `isAffectedNode` and `isOutOfEnginesRange` from shared so its existing public API and the `server-startup-node-version-guard` spec wording ("`node-guard.ts` SHALL expose …") stay literally true. Its message builders (`buildEnginesRangeMessage`, `buildNodeUpgradeMessage`) and `assertNodeVersionSupported()` stay put.

**Alternatives considered:**
- *Keep two inline copies, just fix the `< 18` → `< 19` drift* — rejected: leaves the structural drift hazard. The next range edit re-opens the same bug. AGENTS.md "DRY: extract a shared helper" applies directly — the pattern is in multiple places.
- *Import the predicate from `packages/server` into electron* — rejected: adds an electron→server dependency edge that is currently absent and architecturally undesirable (electron is a launcher, server is a spawned subprocess).

### D2. Introduce a combined `isUsableNodeVersion(version)` for consumers that need the full accept-set

Server-guard logic checks the two predicates separately (to emit two distinguishable messages, caller-ordered). The Electron doctor only needs the boolean union: "is this Node something the server will accept?" Exposing `isUsableNodeVersion(v) = !isOutOfEnginesRange(v) && !isAffectedNode(v)` keeps the doctor call sites one-liners and guarantees they track the server's accept-set automatically.

Accept-set derivation:

| Version | `isOutOfEnginesRange` | `isAffectedNode` | `isUsableNodeVersion` |
|---|---|---|---|
| v21.x | true (`<22`) | false | **false** |
| v22.18.x | true (`<22.19`) | true | **false** |
| v22.19.x+ | false | false | **true** |
| v24.0.x | false | false | **true** |
| v24.1–24.2 | false | true | **false** |
| v24.3.x+ | false | false | **true** |
| v25.x | false | false | **true** |
| v26.x+ | true (`>=26`) | false | **false** |

### D3. Replace the Electron ad-hoc floor checks with `isUsableNodeVersion`

`detectSystemNode()` floor was `major > 20` (accepted 21.x); `scanForUsableNodeOnDisk()` floor was `>= 20.6`. Both are replaced by `isUsableNodeVersion`. This tightens both gates to the server's true accept-set in one move and removes the duplicated minor/major arithmetic.

This is the only user-visible behavior change: the doctor now reports 21.x / 22.0–22.18 / 26+ system Node as **not usable** (previously usable). Correct — the server cannot run on them.

### D4. Pin the boundaries with a shared test + a re-export-identity assertion

`packages/shared/src/__tests__/node-version.test.ts` asserts the accept-set table above. A separate assertion in the server test imports both `node-guard`'s re-export and the shared source and checks they are the same function reference — a cheap, durable anti-drift guard that fails loudly if anyone re-inlines a copy.

## Risks / Trade-offs

- **Doctor verdict change for out-of-range system Node** → intended; the new verdict matches reality. Diagnostic-only, no spawn-path impact.
- **`node-guard.ts` gains an import** (was self-contained) → minimal; it imports two pure functions from a package it already depends on transitively. Worth it to kill the drift.
- **Touches the canonical guard module** → mitigated by keeping message builders + assert logic in place and re-exporting, so the public surface and spec wording are preserved.

## Migration Plan

1. Add `packages/shared/src/node-version.ts` + re-export from `shared/src/index.ts`.
2. Rewire `node-guard.ts` to import + re-export; verify server tests green (behavior identical).
3. Rewire `dependency-detector.ts` to gate on `isUsableNodeVersion`; update doctor tests for the tightened gate.
4. Land shared boundary test + re-export-identity assertion.

**Rollback:** revert the four files + new test. No persisted state, no schema migration, no API change.

## Open Questions

None.
