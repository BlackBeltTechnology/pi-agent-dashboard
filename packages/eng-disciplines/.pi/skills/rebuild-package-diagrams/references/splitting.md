# Diagram size budget and splitting

Every generated diagram is measured against a budget and, when over it, split into an overview
plus parts along the structure its model already has. No generic graph clustering, no LLM step:
the same package and budget give byte-identical output. Code: `scripts/split.mjs`.

## Budget (parameters)

| Where | Nodes | Edges |
|---|---|---|
| `diagrams.mjs build-site / behaviour / ifml-parts / check-size` | `--max-nodes n` (default 30) | `--max-edges n` (default 40) |
| `render.sh` | `MAX_NODES` | `MAX_EDGES` (`STRICT_SIZE=1` → fail when a part stays over) |

IFML size: nodes = elements except done ports (`ActionEvent`), edges = flows. State machine:
nodes = states, edges = transitions. Sequence: edges = messages. ER: nodes = entities.

## IFML

1. **Areas** — each route record plus the non-route records nearest to it by navigation
   (`navigation[].to`, dialogs that are records, record ids named in effect targets), walking
   only through non-route records; ties go to the alphabetically first route; records no route
   reaches form `AREA-shared`.
2. **Parts** — an area within budget is one part `P-AREA-<route>`. Otherwise screens are packed
   in area order into parts `P-<first screen>`; a screen over budget is split into action groups
   by `trigger.kind` (first appearance), each group chunked to the budget (`-1`, `-2`), and
   adjacent unchunked groups packed while they fit (`P-<screen>-<kind>-<kind>`, more than 3 kinds
   → `<k1>-<k2>-plus<n>`). The screen's forms/fields go with its first part; when they do not fit beside
   its first action they lead as their own parts `P-<screen>-forms[-n]`, packed field by field
   (a form's field list cut per part, element ids unchanged).
3. Each part is a reduced UI model → `buildIfml` → laid-out XMI (passes `check-ifml`); element
   ids equal the whole model's, so click-through and backlinks still resolve. Flows to records
   outside the part are dropped from the part (the screen pages list them).
4. **Overview** — one node per area (screens, parts), edges = cross-area link counts, Mermaid
   `flowchart TB`.

## Behaviour

- **State machine** over the edge budget: transitions between the same two states become one
  edge `N transitions`; the transitions table and SCXML keep every transition.
- **Sequence** over the edge budget: consecutive top-level steps chunked to the budget; a
  fragment is cut only when it alone is over, into balanced pieces that keep the frame
  (`alt <label> (i/n)`, else branch as `else <label>`). Main diagram: participants plus one
  `Note over first,last: ref part n · <first> … <last>` per part. Exports
  `<id>.part-<n>.mmd`. The collaboration diagram stays whole.

## ER

An entity set over the node budget (merged use-case view, capability ER, entity neighbourhood)
is drawn per authored cluster (`diagrams/er/*.json` except `overview.json`, file order), then the
rest in chunks; adjacent pieces that fit together share a diagram (`orders + plan`).
`erChunks` is self-contained and injected into the catalog by source, so the page runs the
tested function.

## Catalog and exports

- IFML header button → overview (areas map + part chips with size `nodes/edges`); `ifml:part:<id>`
  renders the part XMI with breadcrumb and previous/next; `ifml:full` keeps the whole model; a
  split screen's IFML link opens its first part with chips to the others.
- `render.sh` writes `ui/ifml-parts/overview.mmd` + `<part>.xmi` and prints the `check-size`
  summary.
