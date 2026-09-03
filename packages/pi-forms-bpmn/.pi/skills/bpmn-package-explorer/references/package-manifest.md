# The `package.yaml` manifest

A **package** is a process plus the decisions its rule tasks evaluate, the forms
its user tasks present, and other processes it calls — bound together by a single
`package.yaml` in the package root. The `.bpmn`, `.dmn` and `.form` files stay
plain and vendor-neutral; **all** links live in the manifest, so validation is a
manifest-to-artifact join independent of any BPMN dialect.

## Contract

```yaml
name: Order handling
entry: main.bpmn            # top-level .bpmn, relative to the package root

bindings:
  - kind: decision          # ref is a .dmn; element MUST be a businessRuleTask
    ref: decisions/pricing.dmn
    element: Rule_pricing
    in: main.bpmn           # optional; the .bpmn that owns `element`; defaults to entry
    name: Pricing           # recorded target name (auto-managed, see reconciliation)

  - kind: form              # ref is a .form (JSON); element MUST be a userTask
    ref: forms/details.form
    element: Task_capture_details

  - kind: process           # ref is a .bpmn; element MUST be a callActivity → drill-down
    ref: subprocesses/refund.bpmn
    element: Call_refund

  - kind: participant       # ref is a .bpmn pool; NO element, NO in; name is the switcher label
    ref: pools/shop.bpmn
    name: Shop

roles:
  - element: Task_quote     # replaces laneSet; may declare `in`; defaults to entry
    role: Sales
    name: Quote             # recorded target name (auto-managed)
```

## Rules

- **Every path is relative to the package root.** Absolute paths are rejected.
  Containment is enforced **after** physical resolution: a symlink whose target
  escapes the root is rejected (a lexical check alone is insufficient).
- **Duplicate keys are an error**, not last-value-wins (parsed with
  `uniqueKeys`).
- **Four binding kinds**, each with its required element type:
  `decision`→`businessRuleTask`, `form`→`userTask`, `process`→`callActivity`,
  `participant`→file-scoped (no `element`/`in`, requires `name`). An unrecognised
  kind is rejected, listing the four.
- **`ref` is checked for kind-appropriate content before serving**, not merely
  for existence:
  - a `decision` ref must parse as XML in a DMN namespace; a **multi-decision**
    DRD must carry DRD DI, or it fails **at validation** (there is no
    `dmn-auto-layout`);
  - a `process`/`participant` ref must parse as BPMN;
  - a `form` ref must parse as a JSON object. Only **structural** validity is
    checked while the OpenForms schema contract is unavailable; a diagnostic
    records that.
  - `decisions.xlsx` bound as `kind: decision` fails before the package is served.
- **Vendor attributes** (`camunda:decisionRef`, `zeebe:formDefinition`, …): in a
  **generated** file that duplicates a binding they are rejected; in an
  **ingested** file they are tolerated with a warning.
- **Roles:** at most one role per element; multiple elements may share a role.
- **Dangling** `element` or missing `ref` file → **error**. **Orphan** artifact
  files and **unbound** `userTask`/`businessRuleTask`/`callActivity` → **warning**
  (the package stays renderable).
- **Nested packages are rejected:** a `package.yaml` beside a referenced `.bpmn`
  is not loaded. A **binding-graph cycle** (recursive `callActivity`) is a
  **warning**, not an error — the package is still served and the viewer bounds
  navigation.

## Reconciliation — bindings survive editing

Each binding and each role records its target element's **`name`**, refreshed on
**every** successful validation. Reconciliation joins on names, not identifiers:

- **Modeller rename** (id unchanged): the binding keeps resolving; the recorded
  name is reported **stale** and refreshed.
- **Delete-and-re-add** (new tool id such as `Activity_1a2b3c`, same name): the
  element resolves as *dangling by id* but is **matched by name** and offered as
  an interactive suggestion (normalised Levenshtein over deburred names,
  threshold 0.6; ties reported as ambiguous).
- Reconciliation **never** re-points, drops or rewrites a binding without
  confirmation, and **never writes in a non-interactive context** — except the
  recorded-name refresh on a *still-resolving* binding, which is mechanical
  bookkeeping and is exempt (without it, rename-then-recreate would compare
  survivors against a stale name and match nothing).

## Worked multi-file example

```
order-handling/
  package.yaml
  main.bpmn                 # entry: userTask Task_capture, businessRuleTask Rule_pricing, callActivity Call_refund
  decisions/pricing.dmn
  forms/details.form
  subprocesses/refund.bpmn
  pools/shop.bpmn           # a second participant; the switcher lists "Order handling" (entry) + "Shop"
```

`in: pools/shop.bpmn` on a binding addresses an element **inside the shop pool**,
which the pool decomposition requires — without `in`, only entry-process elements
are addressable.
