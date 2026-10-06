---
name: rebuild-package-diagrams
description: Render a reverse-spec rebuild package as traced, script-checked visuals — a Mermaid ER diagram of model.md entities, capability use cases as BPMN processes, and one browsable HTML catalog. Use on "ER diagram from the entities", "draw the data model", "use cases as BPMN", "browsable HTML of the rebuild package", "ER diagram az entitásokból", "üzleti folyamat BPMN-ben".
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
`render-er`, `check-trace`, `check-use-cases`, `build-site` (Node ≥ 20, no deps; exit 2 =
bad usage/input). Parsers/gates live in `scripts/lib.mjs`, the catalog assembly in
`scripts/site.mjs`, the page in `templates/catalog.html`, `templates/catalog.css`,
`templates/catalog.js`.

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
   path. Pure data-shape, rendering and config requirements are not. Write them to
   `PKG/diagrams/use-cases.json` — `[{id, name, actor, trigger, requirements:
   ["spec:<cap>#<Requirement>"], refs: ["BR-…"], entities: ["<model entity>"], bpmn?:
   "bpmn/<uc>/<uc>.bpmn"}]` — and run `$D check-use-cases PKG` (exit 1 lists dangling
   requirements/refs, unknown entities, missing bpmn files, duplicate ids). Ask the user
   which to draw when there are more than ~8 candidates.
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

## One-command render

`scripts/render.sh PKG [APP]` runs every applicable gate and render step and stops at
the first failure: `check-use-cases` → `check-architecture` (`--app APP`) + `arch` when
`diagrams/architecture.json` exists → `ifml` + `check-ifml` + round-trip `ifml-diff`
(must print "no differences") when `ui/screens/` exists → `build-site` to
`PKG/diagrams/catalog.html` with every viewer found: bpmn-js (`BPMN_JS_DIR`, default the
sibling `bpmn-package-explorer` assets), Mermaid (`MERMAID_JS`, default next to `mmdc`),
IFML from the vendored `assets/ifml-js/` (ifml-js 0.3.0, bpmn.io licence: keep the
watermark; override `IFML_JS_DIR`). Ends with `RENDER OK`. The steps below are what it runs.

## Procedure — browsable catalog (one HTML file)

1. Prerequisites: ER files gated, `use-cases.json` passing `check-use-cases`, each drawn
   `.bpmn` laid out (the `bpmn-package-explorer` pipeline writes DI into the file).
   Optional question register `PKG/diagrams/questions.json` — `[{id, text, severity
   (key|high|medium|low), status?, source?, claim?, note?, codeCite?, refs: ["BR-…"],
   group?}]` (e.g. the open questions of a doc↔package comparison); `build-site` refuses
   dangling refs and duplicate ids.
   Optional UI model `PKG/ui/screens/*.json` (screen/dialog records: actions with trigger,
   handler, `guards`, `refs`, `effects[{kind, step, target, cite, refs}]`, dialogs,
   navigation, `forms[{form}]`) and `PKG/ui/forms/*.json` (form records: fields with labels,
   type, required, editable, computed, validations, views, `definedIn` cites). `build-site`
   refuses duplicate screen/action/dialog ids, dangling guard/ref/effect refs and screen form
   refs without a record. In `use-cases.json`, optional `screens: ["SCR-…"]` and
   `altFlows: [{label, bpmn}]` (e.g. a flow derived from code) are gated by
   `check-use-cases` and `build-site` (unknown screen, missing file).
   Alternate-flow nodes may document `ui: <screen>#<action>`; the catalog then lists those
   actions on the use case (`build-site` refuses unknown ones).
2. Build with the viewer libraries inlined (offline, single file, ~5 MB):
   `$D build-site PKG PKG/diagrams/catalog.html --bpmn-js <bpmn-navigated-viewer.production.min.js>
   --bpmn-css <diagram-js.css> --bpmn-css <bpmn.css> --bpmn-css <bpmn-font/css/bpmn-embedded.css>
   --mermaid <mermaid.min.js>`. The bpmn-js files ship in `bpmn-package-explorer`'s
   `assets/bpmn-js/`; `mermaid.min.js` sits inside the `mmdc` install
   (`…/@mermaid-js/mermaid-cli/node_modules/mermaid/dist/`). Without a library the page
   still builds and shows a notice in place of that diagram.
3. The page: catalog tabs (use cases, capabilities, rules, quirks, gaps, entities) with
   search; tick use cases → merged view (flows switchable, union of requirements with
   scenarios, rules/quirks/gaps with source `explicit` / `via requirement` / `in flow`,
   ER sub-diagram of their entities, items used by ≥2 selected marked `shared`, related use
   cases ranked by overlap); every item links back to the requirements and use cases that
   reference it. Parts are linked both ways: question ↔ rules/quirks/gaps ↔ requirements ↔
   use cases; rule/quirk/gap → capabilities (from `Capabilities:` / `Spec:` / `Affects:`),
   questions and the flow steps documenting it; capability → its items and questions;
   use-case and merged views list open questions (`shared` when ≥2 hit). State is in the URL hash (`#sel=UC-01,UC-03&view=merge`), so views are
   shareable links. Serve over HTTP (or open the file) and put it on the canvas.

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
- `use-cases.json` passes `check-use-cases`; nothing on a diagram lacks a package ref.
- `catalog.html` opens offline, a multi-select merge shows flows + ER + shared markers.

## Screen plans and style kit (optional)

Produced by the `reverse-spec-for-rebuild` frontend UI phase (its `ui-extract` programs
`style-kit.mjs` + `screen-plan.mjs` with a stack adapter): `PKG/ui/style-kit.json` (colour/font tokens with uses and cites, font-size and radius
scales, components = original selectors + declarations + cite) and `PKG/ui/plans/<screenId>.html`
(self-contained page: original template + toolbar flattened, styled with the kit, every control numbered
and linked to an action, field, unmapped reason or the app shell). `build-site` embeds both and refuses a
plan without a screen/dialog record. Catalog: screen page shows the plan in a sandboxed frame (open in new
tab; legend action links post `{type: "screen-plan-open", screen, action}` and open the action); header
**Style kit** button → `#view=kit:`.

## Use-case UI links (optional, after the UI model)

BPMN step → UI action links per use case, each with evidence (a ref shared by use case and
action, or a cite inside the action's handler/effect cites), or a `noUi` reason. `uc-link-draft
PKG <UC>` lists steps and ref-sharing candidates; `reverse-spec-for-rebuild`'s linker writes
`PKG/diagrams/uc-links/<UC>.json`; gate `check-uc-links PKG --complete` (also in `render.sh`
and `build-site`). Links extend each use case's `screens` / `uiActions` (CRUD columns, IFML
scope, flows) and show as a step → action table on the use-case page. Rules:
`references/uc-links.md`.

## Customer variability (optional, configurable apps)

Which behaviour each customer's configuration switches on. Inputs from `reverse-spec-for-rebuild`:
`ui/_config-reads.json` (`config-reads.mjs`: paths read by code + variants with customer/env) and
`ui/_effective/`. `variability-draft PKG out.json` → path × variant values; its classifier writes
`diagrams/variability/features.json`; gate `check-variability PKG APP --complete` (`render.sh` with
APP; `build-site` structural). `variability PKG outDir` → `variability.csv` (feature × variant),
`variability-customers.csv`, `variability-findings.md` (dead everywhere, single-customer,
constant, customers without own feature, unreachable UI per customer), `feature-model.xml`
(FeatureIDE). Catalog: **Variability** view (by customer / by variant, customer pages with
unreachable UI), feature table on affected screens. Rules: `references/variability.md`.

## Usage evidence (optional, local counts)

What customers actually do, from the application's own logs. A project job lists the log sources
per customer (`{sources: [{customer, file, encoding?, format: json|csv, table?, columns: {type,
user?, time?, object?}, kind}]}`). `usage-draft PKG APP JOB out.json` → types with counts and code
candidates; `reverse-spec-for-rebuild`'s mapper writes `diagrams/usage/mapping.json` (shared, no
customer data); gate `check-usage PKG APP JOB --complete`. `usage PKG JOB PKG/_local/usage` →
`usage.json`, `usage-findings.md`, `usage-by-usecase.csv` (users pseudonymized), then the privacy
gate `check-usage-output PKG/_local/usage JOB`. `render.sh` does both with `USAGE_JOB` (+`LOCAL=1`
for counts). Shared catalog: **Usage** view with the mapping only; local catalog adds counts.
Rules: `references/usage.md`.

## CRUD matrix (optional, after the UI model)

Entity × use case / screen C/R/U/D matrix with findings (never written, never read, created but
never deleted, untouched). `crud-draft PKG <SCR>` drafts each screen's data effects with entity
candidates; `reverse-spec-for-rebuild`'s CRUD classifier writes `PKG/diagrams/crud/<SCR>.json`;
gate `check-crud PKG --complete`; `crud PKG <outDir>` exports CSV + findings; `render.sh` does both
and the catalog gets a **CRUD** view. Rules: `references/crud-matrix.md`.

## Diagram size budget (split large diagrams)

Diagrams over a size budget are split deterministically into an overview plus parts:
IFML by area (route + its dialogs) and by trigger-kind action groups, state machines by
merging parallel transitions, sequences into `ref` parts, ER sets by authored cluster.
Parameters: `--max-nodes` / `--max-edges` (default 30 / 40) on `build-site`, `behaviour`,
`ifml-parts`, `check-size`; `render.sh` reads `MAX_NODES` / `MAX_EDGES` (`STRICT_SIZE=1`
fails on a part still over). `diagrams.mjs check-size PKG [--strict]` lists every diagram and
its split. Rules: `references/splitting.md`.

## Behaviour diagrams (sequence, collaboration, state machine, object)

Records, gates, generators and masking: `references/behaviour-mapping.md`.

1. **Sequences**: `diagrams.mjs sequence-from-ui PKG <SCR#ACT> PKG/diagrams/sequences/<SEQ-id>.json`
   drafts one per user action from the UI model (guards → `alt`, effects → messages, lifelines
   by architecture component). Deepen past the data layer with `reverse-spec-for-rebuild`'s
   sequence generator. Gate: `check-sequences PKG --app APP`. Collaboration diagrams are
   projected automatically.
2. **State machines**: one per stateful entity field, written by `reverse-spec-for-rebuild`'s
   state-machine generator into `PKG/diagrams/state-machines/`. Gate: `check-states PKG --app APP`.
3. **Object diagrams**: `objects-synth PKG <Entity> PKG/diagrams/objects/<OBJ-id>.json` (shared);
   real data only with `objects-from-db PKG <job.json> PKG/_local/objects/<OBJ-id>.json` (masked
   unless `keep`; `_local/` stays out of version control and out of the shared catalog).
   Gate: `check-objects PKG [--local]`.
4. `render.sh` gates them, exports `PKG/diagrams/behaviour/` (`.mmd`, `.collab.mmd`, `.scxml`)
   and embeds them; `LOCAL=1 render.sh …` writes `PKG/_local/catalog.local.html` with real data.
   Catalog: **Behaviour** button, sequence/state-machine/object pages, backlinks.

## Architecture (C4 and C5)

Optional `PKG/diagrams/architecture.json` (people, systems, containers, components, deployment
nodes, relations; each with `cites` and `refs`; mapping: `references/architecture-mapping.md`):

1. `$D check-architecture PKG --app <appDir>` — nesting, hosts, relation ends, refs; with `--app`
   every cite must exist in the code (file and line range). `build-site` refuses a broken model.
2. `$D arch PKG PKG/diagrams/architecture` — `workspace.dsl` (Structurizr) + `c4.md` (Mermaid C4).
3. Catalog: Architecture button; views `#view=arch:c4-context|c4-container|c4-component:<id>|c4-deployment|c5`;
   element pages `#view=archel:<id>`; rules, requirements, capabilities, screens and use cases
   link back to the elements that reference them.

## IFML (OMG Interaction Flow Modeling Language 1.0)

With a UI model (`PKG/ui/screens/*.json`):

1. `$D ifml PKG PKG/ui/ifml.xmi` — projects the UI model to IFML 1.0 XMI with IFML-DI geometry
   (mapping and layout: `references/ifml-mapping.md`); trace is in the dot-separated ids;
   refuses to write a non-conforming file (exit 1); exit 2 without a UI model.
2. `$D check-ifml <file.xmi>` — validates any IFML XMI against `references/ifml-metamodel.json`
   (from the normative OMG metamodel); DI elements only need a resolvable `modelElement`.
3. `build-site … --ifml-js <ifml-navigated-viewer.production.min.js> --ifml-css <diagram-js.css>
   --ifml-css <ifml-font-embedded.css>` — catalog view `#view=ifml:all|sel|<UC>|<SCR>` rendered
   with `ifml-js` (npm `ifml-js`, bpmn.io license: keep the watermark visible): zoom to scope,
   out-of-scope dimmed, use-case actions highlighted, click opens screen/action/form; without
   these flags a Mermaid approximation is drawn. XMI download button either way.

Reverse and round-trip (edit in ifml.io / VS Code ifml-io, both on `ifml-js`):

4. `$D ifml-to-ui <file.xmi> <outDir>` — UI-model records from any IFML XMI (`source: "ifml"`).
5. `$D ifml-diff PKG <edited.xmi>` — element diff vs the package UI model (exit 1 if different).
   `--apply` merges additions, renames, guard and validation changes into `PKG/ui/`, keeps every
   cite/effect, never deletes (removals stay reported). Review the diff before `--apply`.
   Pitfall: an editor rename of the Action (not the event) lands in `ifmlActionName`, the
   action label follows the event name.
