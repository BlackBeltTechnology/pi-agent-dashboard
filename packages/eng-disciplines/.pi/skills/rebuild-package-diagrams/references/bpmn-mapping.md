# BPMN mapping — capability specs → use-case processes

## What is a use case

A use case has all of: an **actor** (user role, external system such as an ERP, or a
timer/scheduler), a **trigger** (button, import, startup, schedule), **≥ 2 steps** with an
observable business outcome, and **≥ 1 decision or failure path**. Typical sources:
requirements named "Add …", "Import …", "Export …", "Save …", "Set … done", "Approve …".
Not use cases: field shapes, rendering/layout, config loading, pure calculations (those
become `businessRuleTask` steps inside a use case).

## Spec → BPMN

| spec element | BPMN element |
|---|---|
| actor-initiated trigger (first WHEN) | `startEvent` (timer start for schedules) |
| user action in a scenario | `userTask` |
| system computation / persistence | `serviceTask` |
| rule evaluation, a `BR-` with a decision table | `businessRuleTask` |
| WHEN branches of one requirement | `exclusiveGateway` with named outgoing flows |
| independent concurrent steps | `parallelGateway` |
| failure / exception scenario | branch to an error `endEvent` (or one `boundaryEvent`) |
| another use case reused | `callActivity` + separate `.bpmn` |
| actor of a step | `package.yaml` `roles` entry (no lanes) |

## Documentation refs

Each flow node except start/end events carries one `<bpmn:documentation>`:

```xml
<bpmn:serviceTask id="Task_create_order" name="Create order">
  <bpmn:documentation>spec:order-and-erp-integration#Add single and unique orders; BR-223</bpmn:documentation>
  ...
</bpmn:serviceTask>
```

- `BR-NNN` / `QUIRK-NNN` / `GAP-NNN` must exist as a `## <id>` heading in the catalogs.
- `spec:<cap>#<name>` must match a `### Requirement: <name>` heading exactly.
- Separate refs with `;`. A `spec:` ref runs to the next `;` or newline, so put `;` before
  any prose that follows it (`spec:cap#Name; note`, not `spec:cap#Name (note)`).

## Naming

Tasks: verb + object ("Validate order line"). Gateways: question ("Line valid?").
Flows out of a gateway: the answer ("yes" / "no" / condition). Quirk-driven steps end with
`(quirk)`. Keep business words; code identifiers belong in the documentation, not the name.
