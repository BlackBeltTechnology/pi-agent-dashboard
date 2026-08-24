# Authoring envelope

Generated BPMN is **plain, vendor-neutral BPMN 2.0 semantics with no geometry**.
The layout step produces geometry; the authoring step must not. Generation is
confined to the constructs the layout step demonstrably handles (see
`references/layout-envelope.md` for the measured evidence).

## Hard rules (authoring aborts on any violation)

1. **Semantics only.** No `bpmndi:` element, no `dc:Bounds`, no `di:waypoint`.
   Coordinates come exclusively from the layout step.
2. **Plain BPMN 2.0.** No `camunda:`, `zeebe:`, `activiti:` or `flowable:`
   namespace, element or attribute. Link information lives in `package.yaml`.
3. **Allow-listed constructs only** (each has a passing layout fixture):
   start / end / intermediate catch & throw events; `task`, `userTask`,
   `serviceTask`, `businessRuleTask`, `manualTask`, `scriptTask`, `sendTask`,
   `receiveTask`, `callActivity`; `exclusiveGateway`, `parallelGateway`; a
   **single** `boundaryEvent` per activity; `sequenceFlow` including loops.
4. **Flow nodes must declare `<bpmn:incoming>` / `<bpmn:outgoing>`.**
   `bpmn-auto-layout` builds the edge graph from these child references; a
   `sequenceFlow` with `sourceRef`/`targetRef` alone lays out the nodes but emits
   **no edges**, which the guard then rejects under P2. Always emit the
   incoming/outgoing children on every connected flow node.

## Rejected constructs and their substitutions

| rejected | why | substitution |
|---|---|---|
| inline `subProcess` | layout gives children coordinates identical to parent-level shapes (G1) and outside the collapsed container (G3) | `callActivity` + a separate `.bpmn` + `kind: process` binding → click-to-drill-down |
| `collaboration` / `participant` | layout lays out only the first process; further pools, lanes and message flows lose geometry | one `.bpmn` per participant + `kind: participant` bindings → pool switcher |
| `laneSet` / `lane` | lane shapes are never emitted | manifest `roles` → CSS markers + legend |
| `messageFlow` | unrepresentable after pool decomposition | rejected; `sendTask`/`receiveTask` are allowed but their counterpart link is not drawn (a warning says so) |
| ≥2 `boundaryEvent` on one activity | layout overlaps them (measured ~2.7 px collision, G5) | split the interruptions across separate activities |

Every rejection names the measured failure mode and the substitution — no
element is ever dropped silently.

## Identifiers

Identifiers are derived deterministically from element type + name; see
`references/identifiers.md`. In short: `<Prefix>_<slug(deburr(name))>` for named
elements, an ordinal for unnamed non-bindable elements, duplicate names within a
prefix are a hard error, and once a file exists its identifiers are opaque.

## The file is the source of truth

Prose seeds the **first** generation only. After that the `.bpmn` is edited, not
regenerated — a request to regenerate an existing file is refused, listing the
bindings it would invalidate. A file already carrying DI (e.g. from Camunda
Modeler) is rendered as authored and is **not** re-laid out; the envelope and
naming rules are not enforced on it (they become warnings), because the envelope
governs generation, not ingestion.
