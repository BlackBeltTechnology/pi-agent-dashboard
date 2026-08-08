## ADDED Requirements

### Requirement: An import cycle is broken only by removing an edge

For the `suspicious/noImportCycles` rule, a cycle SHALL be considered broken only
when a static import edge is genuinely removed from the graph — by extracting the
shared value into a third module, inverting the dependency, or merging two modules
that are one unit.

Converting a static import to a dynamic `import()` (including `React.lazy`) SHALL
NOT be treated as breaking a cycle. Biome traverses dynamic import edges: the rule
skips only `node_modules` and `JsImportPhase::Type`, and a dynamic specifier is
registered as `JsImportPhase::Default`, so the `ignoreTypes` filter cannot skip it.
A `lazy()` edge therefore still closes the cycle and still reports a diagnostic.

This is recorded because the technique is superficially convincing — a lazy import
defers *evaluation*, which is the intuition the rule appears to encode — and
because two independent designs for this rule's cleanup selected it before the
mechanism was checked. A code-split may still be desirable on its own merits; it is
simply not a cycle fix.

Type-only edges ARE ignored, so a cycle composed entirely of `import type` edges
produces no diagnostic and is out of scope for the ratchet.

#### Scenario: Dynamic import does not clear the diagnostic

- **WHEN** a two-module cycle is closed by `() => import("./b.js")` rather than a static import
- **THEN** `biome lint --only=lint/suspicious/noImportCycles` SHALL still report the cycle
- **AND** the change SHALL be treated as not having broken that cycle

#### Scenario: Edge removal clears the diagnostic

- **WHEN** the value that closes a cycle is extracted into a third module that both former participants import
- **THEN** every diagnostic belonging to that cycle SHALL clear
- **AND** the reported count SHALL drop by the number of edges the cycle contained

#### Scenario: Type-only cycle is not claimed

- **WHEN** a cycle consists solely of `import type` edges
- **THEN** the rule SHALL report no diagnostic for it
- **AND** it SHALL NOT be counted against the rule's graduation

### Requirement: A cycle fix preserves import-time evaluation semantics

Breaking a cycle changes module evaluation order. A change that removes a cycle
edge SHALL establish, before editing, whether any module in the affected cycle
reads an imported binding from another module in that same cycle **at import
time** — that is, at module scope rather than inside a function, component, or
hook body.

The relevant property is this cross-edge import-time read, NOT the mere presence
of module-scope side effects. Module-scope work that closes only over literals or
external packages (a `createContext(null)`, a `new Set([...])` of constants) is
not order-sensitive across a cycle edge and SHALL NOT by itself require a
test-first obligation.

Where a cross-edge import-time read does exist, the change SHALL characterise the
existing behaviour with a test before altering the edge, because reordering is
observable only in that case.

A cycle fix SHALL be verified against a production bundle build, not `tsc --noEmit`
or the unit-test entry point alone: neither fails on a cycle, and neither exercises
the production module-evaluation order in which such a defect surfaces.

#### Scenario: Cross-edge import-time read is characterised first

- **WHEN** a module in a cycle reads a binding imported from another module in the same cycle at module scope
- **THEN** the change SHALL add a test capturing the current behaviour before the edge is altered

#### Scenario: Order-insensitive module-scope work needs no test-first step

- **WHEN** the only module-scope work in a cycle closes over literals or external packages
- **THEN** the change SHALL record that no cross-edge import-time read exists
- **AND** it SHALL NOT be required to add a per-module characterisation test on that basis

#### Scenario: Bundle build is part of the oracle

- **WHEN** a change removes one or more import-cycle edges
- **THEN** verification SHALL include a production bundle build that exits zero
- **AND** `tsc --noEmit` passing alone SHALL NOT be accepted as evidence the fix is safe

### Requirement: This change claims every `noImportCycles` site

Per the site-ownership ledger, this change SHALL claim all 17 `noImportCycles`
diagnostics reported by `biome lint .` at repository root, leaving none for a
sibling change. The 17 diagnostics are edges — the rule emits one per participating
import, not one per cycle — and they decompose into four disjoint strongly-connected
components:

| SCC | Package | Modules | Diagnostics |
|---|---|---|---|
| editor-pane/diff | `packages/client` | 5 | 5 |
| preview/tool-renderers | `packages/client` | 6 | 8 |
| flows-plugin agent card/detail | `packages/flows-plugin` | 2 | 2 |
| server auth/tunnel | `packages/server` | 2 | 2 |

Because this change claims the full repo-root total, `noImportCycles` becomes
eligible for `warn → error` graduation on its completion, with no handoff to record.

#### Scenario: Claimed count equals the repo-root total

- **WHEN** the sites claimed by this change are counted
- **THEN** the total SHALL equal the 17 diagnostics reported by `biome lint .` at repository root
- **AND** no `noImportCycles` site SHALL remain unclaimed by any change

#### Scenario: Completion leaves the rule at zero

- **WHEN** this change is complete
- **THEN** `biome lint --only=lint/suspicious/noImportCycles . --max-diagnostics=20000` SHALL report zero warnings
- **AND** a reduced-but-nonzero count SHALL be treated as incomplete, not as partial progress

#### Scenario: Per-cut count movement is verified

- **WHEN** an individual cycle fix within this change is applied
- **THEN** the reported diagnostic count SHALL drop by that cycle's edge count
- **AND** a cut whose count movement differs from its prediction SHALL be re-diagnosed rather than followed by a further cut
