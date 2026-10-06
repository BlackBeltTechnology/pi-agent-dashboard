# Behaviour models — sequence, collaboration, state machine, object

Optional records in a rebuild package. Each is gated by `scripts/diagrams.mjs` and by
`build-site` (a failing record refuses the whole catalog). Cites are `file:line` or
`file:a-b` relative to the application root; `--app <appDir>` also checks that the file
exists and the line range is inside it. Refs are `BR-`/`QUIRK-`/`GAP-` ids, `spec:<cap>#<Requirement>`,
`cap:<cap>`, screen/dialog ids or use-case ids — the same resolver as the architecture model.

## Sequence — `diagrams/sequences/<id>.json`

```jsonc
{ "id": "SEQ-order-add-line", "title": "…", "useCase": "UC-01", "action": "SCR-order#ACT-order-add-line",
  "source": "ui-draft | authored", "entities": ["Order"],
  "participants": [ { "id": "user", "kind": "actor", "label": "Planner" },
                    { "id": "SCR-order", "kind": "screen", "ref": "SCR-order" },
                    { "id": "c_data", "kind": "element", "ref": "c_data" } ],
  "messages": [ { "from": "user", "to": "SCR-order", "label": "Add", "kind": "sync|reply|async", "cite": "…", "refs": [] },
                { "fragment": "alt|opt|loop|par", "label": "allowed (BR-244)", "refs": ["BR-244"],
                  "messages": [ … ], "else": { "label": "refused", "messages": [ … ] } } ] }
```

Gate (`check-sequences [--app]`): unique record and participant ids; `element` participants
name an architecture element, `screen` participants a screen/dialog; `useCase` and `action`
(`SCR#ACT`) exist; every message endpoint is a declared participant; fragment kinds valid;
refs resolve; cites well-formed (in range with `--app`).

`sequence-from-ui <pkg> <SCR#ACT> <out>` writes a deterministic draft: user → screen (trigger
label + cite), the action's guards as an `alt` (else: refused, back to the user), one message per
UI effect. An effect's lifeline is the architecture component whose cites name the effect's
cite file (the component of the action's own handler file is the screen itself); `notify`
effects go back to the user; a multi-location cite (`a.js:1; b.js:2`) uses its first location.
The draft stops where the UI model stops (data-layer boundary); `reverse-spec-for-rebuild`
`prompts/sequence-generator.md` deepens it.

**Collaboration** (UML communication diagram) is a projection, never authored: participants
are the nodes, every ordered pair that exchanges messages is one link, labelled with the
messages' sequence numbers (`3: Store order`) in document order, fragments flattened and
`else` branches included.

## State machine — `diagrams/state-machines/<id>.json`

```jsonc
{ "id": "SM-task-status", "entity": "Task", "field": "status", "title": "…",
  "states": [ { "id": "todo", "value": "todo", "label": "To do", "initial": true, "final": false, "cite": "…" } ],
  "transitions": [ { "from": "todo", "to": "done", "trigger": "set done (OK)", "guard": "…",
                     "effects": ["…"], "refs": ["BR-489"], "cite": "js/tasks.js:842-865" } ] }
```

Gate (`check-states [--app]`): entity and field exist in `model.md`; a state `value` appears in
the field's `allowed:` clause (quoted or as a word; no clause = unchecked; derived states omit
`value`); exactly one initial state; transitions name known states, have a trigger and a cite;
refs resolve; every state is reachable from the initial state.

Exports: Mermaid `stateDiagram-v2` (labels `trigger [guard]`, each clipped to 40 characters,
`:` replaced by `꞉` because Mermaid's state grammar reads `:` as a description start) and W3C
SCXML 1.0 (`<state>`/`<final>`, `<transition event target cond>` with the full text).

## Object diagram — `diagrams/objects/<id>.json` (shared) or `_local/objects/<id>.json` (real data)

```jsonc
{ "id": "OBJ-order-synthetic", "title": "…", "source": "synthetic | <db file name>", "masked": false, "keep": [],
  "objects": [ { "id": "order1", "entity": "Order", "attrs": { "status": "open" } } ],
  "links": [ { "from": "order1", "to": "process1", "relation": "planned as" } ] }
```

Gate (`check-objects [--local]`): objects name `model.md` entities; attribute names are fields of
their entity; each link joins two objects whose entities have an ER relation in
`diagrams/er/*.json`; multiplicity — an object links to at most one object across a
single-valued side (`1`, `0..1`) of a relation.

- `objects-synth <pkg> <Entity> <out> [--depth 2] [--fanout 2]` — breadth-first over ER
  relations from the seed, each entity once; `fanout` instances on a many side, one on a single
  side; values: first `allowed:` value, else a typed placeholder (`<field>-<n>`, `n`, `true`,
  `2026-01-0n`); a child copies a same-named field from its parent (keys stay consistent).
- `objects-from-db <pkg> <job.json> <out>` — JSON database snapshot (tables of row objects,
  UTF-8 or windows-1250). Job: `{title, source (relative to the job file), tables: {Entity: table},
  columns?: {Entity: {field: column}}, joins: [{from, fk, to, key}], seed: {entity, index | match},
  depth, limit, keep: [field]}`. Every join must match an ER relation (else exit 1, no data
  read into messages). Every value of a field not in `keep` is pseudonymized as `<field>~<k>`,
  equal source values sharing `k`, so joins stay visible and no source value is written.
  Write the output under `PKG/_local/objects/`; exclude `_local/` from version control.

## Catalog and exports

`build-site` embeds all records (`--local` adds `_local/objects`, marked local; `render.sh` with
`LOCAL=1` writes `_local/catalog.local.html`). Views: **Behaviour** header button (`#view=beh:`),
`seq:<id>` (sequence + collaboration, participants linked to architecture/screens, message table
with cites and refs), `sm:<id>` (diagram, states and transitions tables, SCXML download),
`obj:<id>` (diagram, values table, masked/local badges). Backlinks: rule/quirk/gap pages list
sequences and state machines that reference them; entity pages list state machines and object
diagrams; use-case pages list sequences with that `useCase`; screen pages list sequences on
their actions. `behaviour <pkg> <outDir>` writes `<id>.mmd` (+ `<id>.collab.mmd`) and
`<id>.scxml`.
