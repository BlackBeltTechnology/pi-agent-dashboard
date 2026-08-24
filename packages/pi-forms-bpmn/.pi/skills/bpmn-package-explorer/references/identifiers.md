# Element identifiers and naming rules

Bindings must survive editing. That is only possible if an element's identifier
is stable and meaningful, so the skill derives identifiers deterministically at
**authoring** time and treats them as **opaque** ever after.

## Prefix table (normative)

A named element's identifier is `<Prefix>_<slug(deburr(name))>`. The prefix comes
from the element type so that two elements of different types never collide even
when they share a name.

| element type | prefix |
|---|---|
| `startEvent` | `Start` |
| `endEvent` | `End` |
| `intermediateCatchEvent` | `CatchEvent` |
| `intermediateThrowEvent` | `ThrowEvent` |
| `boundaryEvent` | `Boundary` |
| `task` | `Activity` |
| `userTask` | `Task` |
| `serviceTask` | `Service` |
| `businessRuleTask` | `Rule` |
| `manualTask` | `Manual` |
| `scriptTask` | `Script` |
| `sendTask` | `Send` |
| `receiveTask` | `Receive` |
| `callActivity` | `Call` |
| `exclusiveGateway` | `Gateway` |
| `parallelGateway` | `Fork` |
| `sequenceFlow` | `Flow` |

The generic `task` prefix is **`Activity`**, distinct from `userTask`'s **`Task`**.
So `Task_rendeles_jovahagyasa` denotes a `userTask` unambiguously; a generic
`task` of the same name would be `Activity_rendeles_jovahagyasa` and does not
collide.

## Named elements — a pure function of type and name

`slug` = the name lower-cased, deburred to ASCII, with non-alphanumeric runs
collapsed to a single underscore. The derivation reads **no** position, counter,
sequence number or random source, so re-ordering the document leaves every id
byte-identical (verified as a property, not by pattern-matching the output).

- `Rendelés jóváhagyása` (userTask) → **`Task_rendeles_jovahagyasa`**
- `Approve 2` (userTask) → **`Task_approve_2`** — a digit in the name is legal
  and is *not* a positional counter.

**Hungarian deburring.** Names are normalised NFKD and combining marks removed;
`ő`→`o`, `ű`→`u`, `é`→`e`, `á`→`a`, `ó`→`o`. Deburring is lossy — `őrizet` and
`orizet` both slug to `orizet`.

## Unnamed elements — an ordinal discriminator, not bindable

An unnamed element (an unnamed gateway or intermediate event — ordinary BPMN)
gets `<Prefix>_<ordinal>`, e.g. `Gateway_1`, `Activity_1`, `Activity_2`. This is
safe **because an unnamed element is not bindable**: a manifest binding or role
targeting an ordinal identifier is rejected, since an ordinal is not stable
across regeneration. Authoring never rejects a process merely for containing
unnamed non-bindable elements.

## Uniqueness errors (hard, at authoring time)

1. **Duplicate name within a shared prefix** — two `userTask`s both named
   `Approve` is rejected; disambiguate to `Approve (manager)` / `Approve
   (finance)`. Scoped to a shared prefix because that is the only case a
   disambiguating counter would otherwise be needed, and a counter is what
   permits silent re-binding. A `userTask` and an `endEvent` sharing a name are
   accepted (different prefixes).
2. **Post-deburr identifier collision** — `őrizet` and `orizet` both derive
   `Activity_orizet`; rejected, naming the colliding id, because a duplicate
   `xsd:ID` is invalid XML. This check is forced by the schema and exists even
   though rule 1 would not catch it.
3. **Unnamed bindable element** — a `userTask`, `businessRuleTask` or
   `callActivity` with no name is rejected: a bindable element needs a name to
   derive a stable identifier.

## Authoring vs ingestion — the boundary

The rules above govern **authoring only**. Once a `.bpmn` exists:

- **Identifiers are opaque.** A diagram round-tripped through Camunda Modeler
  carries tool-generated ids such as `Activity_1a2b3c`; these are preserved and
  never re-derived, re-slugged or normalised. Rewriting them would break every
  binding.
- **Naming rules become warnings.** An operator-authored file with duplicate
  names or an unnamed bindable element is *rendered with a warning*, not refused
  — the envelope governs generation, not ingestion.
- **The file is the source of truth.** Prose seeds the *first* generation only.
  A request to regenerate an existing `.bpmn` from prose is refused, listing the
  bindings that regeneration would invalidate. Later changes are edits to the
  file.

## Reconciliation matches on `name`, not identifier

In a modeller a **rename** changes the label and leaves the id alone, so an
operator rename never dangles a binding — but the binding's recorded name goes
stale. The identity-changing event is **delete-and-re-add**, which yields a new
random id on an element that kept its name. Matching on ids would miss that, so
each binding and each role records its target's `name`, refreshed on every
successful validation, and reconciliation joins on names. See
`references/package-manifest.md`.
