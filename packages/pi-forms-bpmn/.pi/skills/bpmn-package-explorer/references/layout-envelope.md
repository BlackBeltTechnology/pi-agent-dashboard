# Measured layout envelope

`bpmn-auto-layout@1.3.0` is the only tool that turns semantics-only BPMN into a
readable coordinate set, but it **fails silently** on three constructs — every
output parses cleanly through `bpmn-moddle`, so a corrupt diagram looks
plausible. This envelope is *measured*, not assumed: every supported construct
has a passing fixture, and the layout guard (`scripts/guard.mjs`) is the
regression detector for upstream drift.

Run the evidence yourself, headless, from any directory (no `node_modules`, no
network):

```
node scripts/fixtures.mjs
```

## The eight measured fixtures

| fixture | outcome | evidence |
|---|---|---|
| `measured/1-linear` | **pass** | start → userTask → serviceTask → end; 4 shapes / 3 edges, no overlap |
| `measured/2-gateway` | **pass** | exclusive split + join; 7 shapes / 7 edges, no overlap |
| `measured/3-boundary` | **pass** | single timer `boundaryEvent` placed on the host border (`y=92` against host bottom `y=110`) |
| `measured/7-loop` | **pass** | gateway routes a `sequenceFlow` back to an earlier task; no tangle |
| `measured/8-long-chain` | **pass** | 12-task chain; 14 shapes / 13 edges, single row ≈2043 px wide (fit-to-viewport on load) |
| `measured/4-subprocess` | **fail (G1+G3)** | inline `subProcess` corruption — see below |
| `measured/5-pools` | **fail (P1)** | `collaboration`: only the first `<process>` gets a plane; the second participant, its flow nodes and the message flow receive no DI |
| `measured/6-lanes-only` | **fail (P1)** | `laneSet`: flow nodes lay out, lane shapes are never emitted |

### The inline sub-process signature (why P1 alone is not enough)

The corruption is **not** a missing shape — the correct *number* of shapes is
emitted, so a presence check (P1) passes. The failure is geometric:

- the sub-process keeps its collapsed `100×80` bounds while its children are
  laid out across `x=57` to `x=393` — children land **outside** the container
  (**G3**);
- child shapes receive coordinates **exactly equal** to unrelated parent-level
  shapes (e.g. an inner start event at the same bounds as the outer start
  event) (**G1**).

G1 (identical bounds) and G3 (child containment) together are what catch it.
An earlier "no shape may appear outside its container's plane" rule would have
been **wrong** — the children of an *expanded* sub-process legitimately occupy
the parent plane — and would have false-fired on correct input while missing
this corruption, which places children in the correct plane.

## Provisional constructs — each confirmed by its own fixture

Confirmed **pass** (`provisional/*.bpmn`): `businessRuleTask`, `manualTask`,
`scriptTask`, `sendTask`, `receiveTask`, `callActivity`, `parallelGateway`,
`intermediateCatchEvent`, `intermediateThrowEvent`.

Confirmed **fail → rejected**: **multiple boundary events on one activity**.
The layout step places two boundary events on one activity at overlapping
positions (`Boundary_timer` x 190.33–226.33 vs `Boundary_error` x 223.66–259.66,
both y=92 — a ~2.7 px collision failing **G5**). A **single** boundary event per
activity is supported; a second on the same host is rejected at authoring time.

## Supported vs rejected

**Supported (generated):** start / end / intermediate catch & throw events;
`task`, `userTask`, `serviceTask`, `businessRuleTask`, `manualTask`,
`scriptTask`, `sendTask`, `receiveTask`, `callActivity`; `exclusiveGateway`,
`parallelGateway`; a single `boundaryEvent` per activity; `sequenceFlow`
including loops. Chain length is unrestricted.

**Rejected (with a manifest substitution):**

| rejected | substitution |
|---|---|
| inline `subProcess` | `callActivity` + separate `.bpmn` + `kind: process` binding (click-to-drill-down) |
| `collaboration` / `participant` | one `.bpmn` per participant + `kind: participant` bindings (pool switcher) |
| `laneSet` / `lane` | manifest `roles` entries (CSS markers + legend) |
| `messageFlow` | unrepresentable after pool decomposition — rejected with a diagnostic |
| ≥2 boundary events on one activity | split interruptions across separate activities |

## The guard invariants

**Presence** — P1: every flow node / participant / lane owns exactly one
`BPMNShape`. P2: every sequence/message flow owns one `BPMNEdge` with ≥2
waypoints. P3: no shape/edge references an element absent from the semantics.

**Geometry** — G1: no two shapes in a plane share identical bounds. G2: every
shape has non-zero size. G3: a child of an *expanded* container lies within its
bounds. G4: no negative coordinate (**strict mode only**). G5: no overlap
between *flow-node* shapes not in a host/boundary or container/child
relationship (artifacts excluded).

**Correct nesting is never a failure:** expanded sub-process children in the
parent plane, a collapsed sub-process owning a separate plane, a boundary event
straddling its host border, and artifact shapes (`textAnnotation`, `group`,
`dataObjectReference`, `dataStoreReference`) overlapping flow nodes.

## Two modes

- **strict** — geometry produced by *this* layout run. Any violation aborts;
  no file is written. This is where "no corrupt diagram is ever written" holds.
- **advisory** — geometry already on disk when read. Every violation is a
  warning and the document still renders (a conformant modeller legitimately
  emits negative coordinates and overlapping annotations). G4 is not evaluated.

A DI-less file read from disk is laid out and then verified **strict**, because
the geometry about to exist is this run's own; if it contains a rejected
construct it is refused rather than laid out.
