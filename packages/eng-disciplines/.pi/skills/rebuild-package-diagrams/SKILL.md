---
name: rebuild-package-diagrams
description: Draw a reverse-spec rebuild package as pictures — an ER diagram (Mermaid erDiagram) of the domain entities in model.md, and the use cases of capabilities/*/spec.md as BPMN business processes — with every box, edge and task traced to the package and checked by a script. Use on "make an ER diagram from the entities", "draw the data model", "show the use cases as BPMN", "business process diagram from the spec", "ER diagram from model.md", or in Hungarian "ER diagram az entitásokból", "üzleti folyamat BPMN-ben", "esetek folyamatábraként".
---

# Rebuild package diagrams

Turn the text of a `reverse-spec-for-rebuild` package into two visual views without
inventing anything:

- **ER view** — domain entities of `model.md` with keys and cardinality.
- **Process view** — actor-triggered use cases of `capabilities/<cap>/spec.md` as BPMN 2.0.

The agent does the judgement (which entities are domain, which cardinality, which
requirements form a use case). A deterministic script is the gate: it refuses any
entity, field or rule id that is not in the package, any relation without evidence and
any BPMN node without a resolvable ref.

## Inputs

`PKG` = a rebuild package directory holding `model.md`, `rules.md`, `quirks.md`,
`gaps.md`, `capabilities/<cap>/spec.md` (the `reverse-spec-for-rebuild` layout). Output
goes to `PKG/diagrams/` unless the user names another place. The source package is never
edited.

`D = node <this skill dir>/scripts/diagrams.mjs` — subcommands `extract-model`,
`render-er`, `check-trace` (Node ≥ 20, no deps; exit 2 = bad usage/input).

Optional peers: `mmdc` (Mermaid CLI) for PNG/SVG; the `bpmn-package-explorer` skill for
BPMN layout, validation and the canvas viewer. Without them the `.mmd`/`.bpmn` sources are
still produced and checked.

## Procedure — ER view

1. `$D extract-model PKG/model.md > PKG/diagrams/model.json`. Each entity carries
   `capabilities`, `identity`, `persistence`, `persistent` (heuristic: persistence line
   names a table/row/collection/DB), `fields[]` and `relationships` text.
2. Classify every entity (read identity + persistence, not only the flag) per
   `references/er-mapping.md`: **domain** (persisted business data or the in-memory
   aggregate that owns it), **config**, **ui**, **test**, **technical**. Only domain goes
   on the main diagram. Write the classification table to `PKG/diagrams/er-scope.md`
   (entity · class · one-line reason) so the user can overrule it.
3. Group domain entities into 4–8 clusters (one per subject area; capabilities are a good
   first cut). Clusters keep each diagram readable (≤ ~15 entities).
4. Author `PKG/diagrams/er/<cluster>.json` and one `overview.json` (≤ ~25 hub entities,
   no attributes — a 40-box overview with attributes is unreadable) in the `er.json` schema of `references/er-mapping.md`: keys (`PK`/`FK`/`UK`)
   and a few business-defining fields per entity; relations with `cardinality`, `label`,
   `confidence`, `evidence`. Evidence = a verbatim substring of either endpoint's
   `Relationships:` text, or the exact name of a field on either endpoint.
5. `$D render-er PKG/diagrams/er/<x>.json PKG/diagrams/model.json > PKG/diagrams/er/<x>.mmd`
   for each file. Exit 1 lists every violation — fix the JSON, never the check. Relations
   not `confirmed` render dashed.
6. Render images when `mmdc` exists: `mmdc -i x.mmd -o x.png -b white -s 2` (see Pitfalls
   for the Chrome path).

## Procedure — process (BPMN) view

1. Inventory use cases per `references/bpmn-mapping.md`: a `### Requirement:` (or a
   chain of them across capabilities) is a **use case** when an actor (user role, ERP,
   scheduler/timer) triggers a multi-step outcome with at least one decision or failure
   path. Pure data-shape, rendering and config requirements are not. Write the list to
   `PKG/diagrams/use-cases.md`: id · name · actor · trigger · requirements used · rule ids.
   Ask the user which to draw when there are more than ~8 candidates.
2. For each chosen use case author a **semantics-only** `.bpmn` (no DI) in
   `PKG/diagrams/bpmn/<use-case>/`: scenario WHEN → trigger/start or gateway condition,
   THEN → task(s), failure scenarios → error branches, actors → `roles` in `package.yaml`
   (lanes are not used). Every node except start/end carries a
   `<bpmn:documentation>` with refs: `BR-NNN`, `QUIRK-NNN`, `GAP-NNN` and/or
   `spec:<cap>#<Requirement name>` (exact heading text).
3. `$D check-trace <file.bpmn> PKG` — exit 1 lists undocumented nodes and dangling refs.
4. If `bpmn-package-explorer` is installed, follow its generation workflow on the
   use-case folder (envelope check, auto-layout + layout guard, viewer on the canvas). Its
   authoring envelope applies: allow-listed elements only, `incoming`/`outgoing` on every
   flow node, `callActivity` instead of inline sub-processes.
5. Quirks are drawn as the code behaves (they are real behavior); mark the node name with
   `(quirk)`. A `GAP-` on a node means the step depends on unknown config/data — keep it,
   do not guess the branch.

## Pitfalls

- The `persistent` flag is a hint: in-memory aggregates (e.g. a plan/production object)
  can be the core domain, and config tables mention "table" too. Classify by reading.
- Do not invent foreign keys from naming alone; a `*_id` field is evidence only for a
  relation the `Relationships:` text or the target's identity supports. Unknown
  cardinality → choose the weaker one and `confidence: inferred`.
- Polymorphic / config-driven links (e.g. "type references X names or Users.nuser") are
  drawn once per real target with `inferred`, and named in the label.
- Mermaid `erDiagram` entity names must be identifiers; the script replaces other
  characters with `_`, so prefer entities whose names are already clean on the diagram.
- Homebrew `mmdc` may fail "Could not find Chrome": pass `-p cfg.json` with
  `{"executablePath": "<Chrome binary>", "args": ["--no-sandbox"]}`.
- A use case that spans capabilities uses `spec:` refs from each; do not merge two use
  cases just because they share a screen.
- `spec:` refs end at `;` or newline — `spec:cap#Name (note)` is a dangling ref.
- When the package says a step's algorithm is unspecified, keep the step and say so in its
  documentation; never draw the missing internals.
- `bpmn-package-explorer`: pass the package dir as an **absolute** path to
  `generate-cli.mjs` (a relative `.` yields self-referencing symlinks → viewer 404). It
  writes `diagnostics.json` into the package dir. `UNBOUND` warnings are expected when the
  use case has no forms/decisions.

## Verification

- Every `er/*.json` passes `render-er` (exit 0); `er-scope.md` lists every entity of
  `model.json` exactly once.
- Every `.bpmn` passes `check-trace` (exit 0) and, when available, the
  `bpmn-package-explorer` generation pipeline.
- `use-cases.md` maps each drawn process to its requirements; nothing on a diagram lacks a
  package ref.
