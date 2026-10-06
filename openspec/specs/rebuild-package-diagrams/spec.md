# rebuild-package-diagrams Specification

## Purpose
Define the contract of the `rebuild-package-diagrams` skill: visual and browsable views over a `reverse-spec-for-rebuild` package — an evidence-gated ER diagram of its entities, use cases as traceable BPMN flows, and one self-contained HTML catalog that merges selected use cases — where every drawn element is checked against the package by a deterministic script.

## Requirements

### Requirement: Skill registration

The `packages/eng-disciplines` package SHALL register the `rebuild-package-diagrams` skill in `package.json` `pi.skills[]`. The skill SHALL NOT reference files outside its own directory; an optional peer skill (`bpmn-package-explorer`) is named, not path-referenced.

#### Scenario: Skill is discoverable
- **WHEN** pi loads the `eng-disciplines` package
- **THEN** `rebuild-package-diagrams` is available with a description naming ER-diagram and BPMN triggers

#### Scenario: Self-contained skill
- **WHEN** every relative `references/` or `scripts/` path in the skill's SKILL.md and references is resolved
- **THEN** each resolves to a file inside the skill directory

### Requirement: Deterministic model extraction

`diagrams.mjs extract-model <model.md>` SHALL parse a reverse-spec `model.md` into JSON listing each `## <Entity>` with its capabilities, identity, persistence, fields (name, type text, required, nullable, confidence) and relationships text, and SHALL flag an entity `persistent` when its persistence line names a table, row, collection or database.

#### Scenario: Entities and fields parsed
- **WHEN** `extract-model` runs on a model with two entities, one carrying a `Persistence: row of table ...` line
- **THEN** the JSON lists both entities with their fields and relationships text
- **AND** only the table-backed entity has `persistent: true`

#### Scenario: Missing file
- **WHEN** the model path does not exist
- **THEN** the command exits 2 and names the path on stderr

### Requirement: Evidence-gated ER rendering

`diagrams.mjs render-er <er.json> <model.json>` SHALL print a Mermaid `erDiagram` for the entities and relations in `er.json`. It SHALL exit 1, listing every violation, when an entity or field is not in the extracted model, or when a relation lacks an `evidence` string found verbatim in the relationships text or field names of either endpoint. Relations with `confidence` other than `confirmed` SHALL render with the dashed (non-identifying) connector.

#### Scenario: Valid ER rendered
- **WHEN** `er.json` names two model entities, a model field, and a `1:N` relation whose evidence occurs in the source entity's relationships text
- **THEN** the output starts with `erDiagram` and contains the relation with a `||--o{` or `||..o{` connector

#### Scenario: Hallucinated entity refused
- **WHEN** `er.json` names an entity absent from the model
- **THEN** the command exits 1 naming the entity

#### Scenario: Unevidenced relation refused
- **WHEN** a relation's evidence text occurs in neither endpoint
- **THEN** the command exits 1 naming the relation

#### Scenario: Inferred relation dashed
- **WHEN** a relation has `confidence: inferred`
- **THEN** its connector uses `..` instead of `--`

### Requirement: Traceable BPMN use cases

Each generated BPMN flow node other than start/end events SHALL carry a `bpmn:documentation` holding at least one package ref (`BR-NNN`, `QUIRK-NNN`, `GAP-NNN` or `spec:<capability>#<Requirement name>`). `diagrams.mjs check-trace <file.bpmn> <packageDir>` SHALL exit 1 listing every undocumented node and every ref that does not resolve in `rules.md`, `quirks.md`, `gaps.md` or the named capability spec's `### Requirement:` headings.

#### Scenario: Fully traced process passes
- **WHEN** every task and gateway documents a ref that exists in the package
- **THEN** `check-trace` exits 0

#### Scenario: Dangling ref refused
- **WHEN** a task documents `BR-999` absent from `rules.md`
- **THEN** `check-trace` exits 1 naming the element id and `BR-999`

#### Scenario: Undocumented node refused
- **WHEN** a gateway has no documentation
- **THEN** `check-trace` exits 1 naming the gateway id

### Requirement: Gated use-case catalog

Use cases SHALL be recorded in `diagrams/use-cases.json` (`id`, `name`, `actor`, `trigger`, `requirements[]` as `spec:<cap>#<Requirement>`, `refs[]`, `entities[]`, optional `bpmn` path relative to the diagrams dir). `diagrams.mjs check-use-cases <packageDir>` SHALL exit 1 listing every requirement or ref that does not resolve in the package, every entity absent from `model.md`, every missing `bpmn` file and every duplicate use-case id.

#### Scenario: Valid catalog passes
- **WHEN** every requirement, ref, entity and bpmn path of `use-cases.json` resolves
- **THEN** `check-use-cases` exits 0

#### Scenario: Unknown entity refused
- **WHEN** a use case lists an entity absent from `model.md`
- **THEN** `check-use-cases` exits 1 naming the use case and the entity

### Requirement: Single-file browsable catalog

`diagrams.mjs build-site <packageDir> <out.html> [--bpmn-js <file>] [--bpmn-css <file>]... [--mermaid <file>]` SHALL write one self-contained HTML file embedding the package (capability requirements with scenarios and cites, rules, quirks, gaps, entities with fields, ER relations, use cases, laid-out BPMN XML and roles) as JSON plus the given viewer libraries inline. The page SHALL let the user select several use cases and show their merged view: flows, the union of requirements, rules/quirks/gaps and an ER sub-diagram of their entities, items shared by two or more selected use cases marked, and related use cases ranked by overlap. Every catalog item SHALL link to the items and use cases that reference it. Without a viewer library the page SHALL still build and SHALL show a notice where the diagram would be.

#### Scenario: Catalog embeds package content
- **WHEN** `build-site` runs on a package with one use case, one requirement and one rule
- **THEN** the HTML contains an embedded JSON block holding the use case, the requirement's scenarios and the rule statement
- **AND** no `</script` sequence from package text breaks the JSON block

#### Scenario: Viewer libraries inlined
- **WHEN** `--bpmn-js` and `--mermaid` files are given
- **THEN** their contents appear inline in the HTML and the page references no external URL for them

#### Scenario: Missing viewer degrades
- **WHEN** no viewer library is given
- **THEN** the HTML is still written and records that the BPMN and ER viewers are unavailable

### Requirement: Gated question register

When `diagrams/questions.json` exists, `build-site` SHALL embed its questions (`id`, `text`, `severity`, optional `status`, `source`, `claim`, `note`, `codeCite`, `group`, and `refs[]` of `BR-`/`QUIRK-`/`GAP-` ids) and SHALL exit 1, naming the question, when a ref does not resolve in the package catalogs or an id is duplicated. Without the file the catalog builds with an empty register.

#### Scenario: Questions embedded with their refs
- **WHEN** `questions.json` holds a question referencing an existing rule
- **THEN** the embedded catalog data contains the question with that ref

#### Scenario: Dangling question ref refused
- **WHEN** a question references `BR-999` absent from `rules.md`
- **THEN** `build-site` exits 1 naming the question id and `BR-999` and writes no HTML

#### Scenario: Duplicate question id refused
- **WHEN** two questions share an id
- **THEN** `build-site` exits 1 naming the duplicated id

### Requirement: Cross-linked catalog parts

The catalog page SHALL link every part both ways: a question to its rules/quirks/gaps and, through them, to the requirements and use cases that reference those items; a rule/quirk/gap to its capabilities, its questions and the flow steps whose documentation references it; a capability to its rules/quirks/gaps and questions; a requirement and a use case to the questions reached through their refs. The merged view SHALL list the open questions of the selected use cases and mark those reached by two or more of them as shared.

#### Scenario: Question reaches use case through a rule
- **WHEN** a question references a rule that a selected use case uses
- **THEN** the merged view lists the question under open questions with that use case

#### Scenario: Rule shows its flow steps
- **WHEN** a flow step's documentation references a rule
- **THEN** the rule's page lists that flow step with its use case

### Requirement: Gated UI model in the catalog

When `ui/screens/*.json` exist, `build-site` SHALL embed the screen and dialog records and the form records from `ui/forms/*.json`, and SHALL exit 1 without writing HTML, naming the record, when a screen, action or dialog id is duplicated, a `guards`, `refs` or effect `refs` entry is not a resolvable `BR-`/`QUIRK-`/`GAP-` id or `spec:<cap>#<Requirement>`, or a screen's `forms[].form` has no form record. Without `ui/` the catalog builds with an empty UI model.

#### Scenario: UI model embedded
- **WHEN** the package holds a screen whose action guards an existing rule and uses an existing form record
- **THEN** the embedded catalog data contains the screen, its action and the form

#### Scenario: Dangling UI ref refused
- **WHEN** a screen action references `BR-999` absent from `rules.md`, or names a form without a record
- **THEN** `build-site` exits 1 naming the screen, `BR-999` and the missing form, and writes no HTML

### Requirement: Use-case screens and alternate flows

`use-cases.json` entries MAY list `screens[]` (screen record ids) and `altFlows[]` (`{label, bpmn}` paths under `diagrams/`). `check-use-cases` and `build-site` SHALL report an unknown screen id or a missing alternate flow file. The catalog SHALL offer every alternate flow next to the main flow and SHALL link use cases and screens in both directions.

#### Scenario: Unknown screen and missing alternate flow refused
- **WHEN** a use case lists screen `SCR-nope` and an alternate flow file that does not exist
- **THEN** `check-use-cases` exits 1 naming `SCR-nope` and the missing file

#### Scenario: Alternate flow embedded
- **WHEN** a use case lists an existing alternate flow labelled "from code"
- **THEN** the embedded use case carries the alternate flow's label and BPMN XML

### Requirement: UI cross-links

The catalog SHALL show a Screens tab, a page per screen or dialog (actions with trigger, handler, guards, effects, dialogs, navigation, forms) and a page per form (fields with labels, type, required, editable, computed, validations, views and cites), and SHALL link: rule/quirk/gap → UI actions that guard, reference or have an effect citing it; requirement → UI actions referencing it; form → screens using it; use case and merged view → their screens and forms.

#### Scenario: Rule page lists the UI actions it guards
- **WHEN** an action of a screen lists `BR-001` as a guard
- **THEN** the page of `BR-001` lists that screen and action

### Requirement: IFML projection and XMI export

`diagrams.mjs ifml <packageDir> <out.xmi>` SHALL project the package UI model into IFML 1.0 and write an XMI file in namespace `http://www.omg.org/spec/IFML/20140301`: one `Window` per screen or dialog record (`isModal` for dialogs and modal records), one `Form` per referenced form record and per screen with template fields, `SimpleField`/`SelectionField` parts with `ValidationRule` constraints, one event per action (`OnSubmitEvent` when the action validates a form, else `ViewElementEvent`) with a `NavigationFlow` to an `Action` that has a normal `ActionEvent`, an `ActivationExpression` nested in the event for actions with guards, and `NavigationFlow`s for recorded navigation and dialogs opened from actions. Element ids SHALL encode the trace as dot-separated parts (`W.<screen>`, `F.<screen>.<form>`, `P.<screen>.<form>.<field>`, `E.<screen>.<action>`, `A.<screen>.<action>`, `AE.<screen>.<action>`, `X.<screen>.<action>`, `VR.<screen>.<form>.<field>.<n>`). The file SHALL carry IFML-DI geometry (`IFMLDiagram`, `IFMLNode` bounds, `IFMLConnection` waypoints) for every window, form, field, event, guard, action and flow, from a deterministic layout. The command SHALL exit 2 when the package has no UI model and 1 when its own output fails the conformance check.

#### Scenario: Screen projected to IFML XMI
- **WHEN** the package holds a screen with a form and an action that validates the form, is guarded by a rule and opens a dialog
- **THEN** the XMI contains a `Window` for the screen and a modal `Window` for the dialog, a `Form` with its fields, an `OnSubmitEvent` containing an `ActivationExpression`, an `Action` with an `ActionEvent`, `NavigationFlow`s from event to action and from action event to the dialog, and an `IFMLNode` or `IFMLConnection` for each of them

#### Scenario: No UI model
- **WHEN** the package has no `ui/screens`
- **THEN** `ifml` exits 2 and writes nothing

### Requirement: IFML conformance check

`diagrams.mjs check-ifml <file.xmi>` SHALL validate the file against the IFML 1.0 metamodel reference shipped with the skill and exit 1 listing every element whose `xmi:type` is unknown or abstract, every attribute or child feature not declared on the class or a superclass, every id reference that does not resolve, and every repeated single-valued feature.

#### Scenario: Non-conforming XMI refused
- **WHEN** an XMI uses an unknown metaclass, an undeclared feature and a dangling flow target
- **THEN** `check-ifml` exits 1 naming the metaclass, the feature and the dangling id

### Requirement: IFML catalog view

`build-site` SHALL embed the IFML projection and its XMI when the package has a UI model. The catalog SHALL draw the IFML model (windows as containers holding their forms, events, actions and navigation flows), restricted to the screens of the selected use cases when any are selected; clicking an element SHALL open its screen, form or action; screen, use-case and merged views SHALL link to the IFML view; and the page SHALL offer the XMI for download. A use case SHALL list the actions named by `ui: <screen>#<action>` lines in its alternate flows, and `build-site` SHALL exit 1 naming any such line whose screen or action does not exist.

#### Scenario: IFML view filtered to selected use cases
- **WHEN** use cases UC-01 and UC-09 are selected and the IFML view is opened
- **THEN** only the windows of their screens and the dialogs those screens open are drawn, and each element links to its screen or action

#### Scenario: Dangling ui line refused
- **WHEN** an alternate flow documents `ui: SCR-order#ACT-nope` and the screen has no such action
- **THEN** `build-site` exits 1 naming `ACT-nope`

### Requirement: IFML rendering with an IFML viewer

`build-site` SHALL accept `--ifml-js <file>` and `--ifml-css <file>` (repeatable) and inline them. When present, the catalog IFML view SHALL render the embedded XMI with that viewer, zoom to the in-scope windows, dim out-of-scope elements, highlight actions named by the shown use cases, and open the screen, form or action of a clicked element; without them the existing diagram fallback SHALL be used.

#### Scenario: IFML viewer inlined
- **WHEN** `build-site` is given `--ifml-js` and `--ifml-css` files
- **THEN** the HTML contains both files inline and the embedded data reports the IFML viewer as available

### Requirement: IFML import to a UI model

`diagrams.mjs ifml-to-ui <file.xmi> <outDir>` SHALL write `ui/screens/*.json` and `ui/forms/*.json` from any IFML XMI: windows to screen records (dialog windows reached only from action events to the dialogs of the source screen), forms and fields to form records or template fields, events to actions (label, guards from the nested activation expression), actions to an effect step, navigation flows between windows to navigation. Record and action ids SHALL come from dot-separated trace ids when present, else from the element names; every record SHALL carry `source: "ifml"`.

#### Scenario: Export then import preserves the IFML model
- **WHEN** a package UI model is exported with `ifml` and the file is imported with `ifml-to-ui`
- **THEN** exporting the imported UI model yields the same IFML elements (ids, types, names, owners) and flows

### Requirement: IFML round-trip diff and apply

`diagrams.mjs ifml-diff <packageDir> <file.xmi>` SHALL compare the IFML file with the package UI model element by element and list added, removed and changed elements (name, guard body, validation body) and added or removed flows, exiting 1 when they differ and 0 when equal. With `--apply` it SHALL merge additions, renames, guard and validation changes into the package `ui/` records, keep every existing cite and effect, mark added items `source: "ifml"`, never apply removals (only report them), and leave a UI model that passes the UI gate.

#### Scenario: Edited IFML diffed and applied
- **WHEN** an exported IFML file is edited to rename an action, add a new event with an action on a screen, change a guard and delete an event
- **THEN** `ifml-diff` exits 1 listing the rename, the added elements, the guard change and the removal; with `--apply` the package action carries the new label and guard, the new action exists with `source: "ifml"`, the deleted action is still present, and a second `ifml-diff` reports only the removal

### Requirement: Gated architecture model

A package MAY hold `diagrams/architecture.json` = `{elements: [...], relations: [...]}`. An element SHALL have `id`, `kind` (`person`, `system`, `container`, `component`, `node`), `name`, and MAY have `tech`, `description`, `parent`, `external` (systems), `store` (containers drawn as data stores), `hosts` (nodes: container ids), `cites` (`file:line` or `file:a-b`) and `refs` (`BR-`/`QUIRK-`/`GAP-` ids, `spec:<cap>#<Requirement>`, `cap:<cap>`, screen or dialog ids, use-case ids). A relation SHALL have `from`, `to`, `label` and MAY have `tech`, `cites`, `refs`. `diagrams.mjs check-architecture <packageDir> [--app <appDir>]` and `build-site` SHALL exit 1 naming the element or relation on: a duplicate id, an unknown kind, an unknown parent, a container whose parent is not a system, a component whose parent is not a container, a node whose parent is not a node, a person or system with a parent, a hosted id that is not a container, a relation end that is not an element, a malformed cite, or an unresolvable ref. With `--app`, each cite SHALL resolve to an existing file whose line count covers the cited range.

#### Scenario: Valid model passes
- **WHEN** the model nests containers in the in-scope system, components in containers and hosts containers on nodes, and every ref resolves
- **THEN** `check-architecture` exits 0

#### Scenario: Broken model refused
- **WHEN** a component's parent is a system, a node hosts a component, a relation points at an unknown id, a ref names an unknown rule or a cite points past the end of its file under `--app`
- **THEN** `check-architecture` exits 1 naming each offending element or relation, and `build-site` writes no HTML

### Requirement: C4 and C5 projections

The skill SHALL project one architecture model into C4 views (system context: people, in-scope and external systems; containers of each in-scope system; components of each container with the containers, people and systems they relate to; deployment: nodes with hosted containers) and one C5 view (System → Component → Element with Deployment Nodes and deployed-on edges; a C4 container is a C5 component, a C4 component is a C5 element). A relation between nested elements SHALL be shown between the nearest ancestors visible in the view, once per pair, never as a self-loop. `diagrams.mjs arch <packageDir> <outDir>` SHALL write `workspace.dsl` (Structurizr DSL with model, deployment environment and views) and `c4.md` (Mermaid `C4Context` and `C4Container`).

#### Scenario: Relation lifted to the context level
- **WHEN** a component of the in-scope system relates to an external system
- **THEN** the context view draws one edge from the in-scope system to the external system and the component view of that component's container draws it from the component

#### Scenario: Exports written
- **WHEN** `arch` runs on a package with an architecture model
- **THEN** `workspace.dsl` declares every person, system, container, component and deployment node, and `c4.md` holds a `C4Context` and a `C4Container` block

### Requirement: Architecture catalog view

When the package has an architecture model, the catalog SHALL show an Architecture button opening the C4 context view, chips switching between all C4 views and the C5 view, Structurizr DSL and Mermaid C4 downloads, a page per element (kind in C4 and C5 terms, tech, description, parent, children, relations, cites, refs) reached by clicking a diagram node, and on rule/quirk/gap, requirement, capability, screen and use-case pages links to the architecture elements that reference them.

#### Scenario: Architecture embedded
- **WHEN** `build-site` runs on a package with `diagrams/architecture.json`
- **THEN** the embedded data holds the model, a Mermaid text per view and the Structurizr DSL, and a package without the file embeds no architecture

### Requirement: Screen plans and style kit in the catalog

`build-site` SHALL embed every `ui/plans/<screenId>.html` as the screen plan of that screen and `ui/style-kit.json` as the package style kit, and SHALL exit 1 writing no HTML when a plan file names no screen or dialog record. The catalog SHALL show a screen's plan on its screen page inside a sandboxed frame (scripts allowed, no same-origin access) with an action to open it in a new tab, SHALL open the named action on the screen page when the plan posts `{type: "screen-plan-open", screen, action}` for a known screen, and SHALL offer a Style kit page listing colour tokens with swatch, value, uses and cites, font tokens, font-size and radius scales, and components with selectors, declarations and cites.

#### Scenario: Plan and kit embedded
- **WHEN** the package holds `ui/plans/SCR-order.html` for screen `SCR-order` and `ui/style-kit.json`
- **THEN** the embedded UI model holds the plan HTML under `SCR-order` and the style kit tokens and components

#### Scenario: Orphan plan refused
- **WHEN** the package holds `ui/plans/SCR-ghost.html` and no screen `SCR-ghost`
- **THEN** `build-site` exits 1 naming `SCR-ghost` and writes no HTML

### Requirement: One-command package render

The skill SHALL ship `scripts/render.sh <packageDir> [appDir]` that runs every applicable gate and render step in order and stops at the first failure: `check-use-cases`; `check-architecture` (with `--app` when given) and `arch` when `diagrams/architecture.json` exists; `ifml`, `check-ifml` and a round-trip `ifml-diff` that must report no differences when `ui/` exists; and `build-site` with every viewer library it finds, the IFML viewer coming from the skill's vendored `assets/ifml-js/`.

#### Scenario: Minimal package
- **WHEN** the package has use cases but no `architecture.json` and no `ui/`
- **THEN** `render.sh` skips the architecture and IFML steps and writes `diagrams/catalog.html`

#### Scenario: Gate failure stops the render
- **WHEN** `check-use-cases` fails
- **THEN** `render.sh` exits non-zero and writes no catalog

### Requirement: Gated sequence and collaboration diagrams

The skill SHALL accept sequence records `diagrams/sequences/<id>.json` with participants (actor, screen or dialog, architecture element) and messages that may nest in `alt`, `opt`, `loop` or `par` fragments, SHALL refuse (exit 1, naming the record) an unknown participant, participant ref, use case, UI action, package ref or malformed cite, SHALL derive a draft sequence deterministically from a UI-model action with `sequence-from-ui`, and SHALL project each sequence into a collaboration diagram with numbered messages on participant links.

#### Scenario: Draft from a UI action
- **WHEN** `sequence-from-ui` runs for an action with a guard and effects
- **THEN** the draft holds the user, the screen and the architecture component matched by each effect's cite file, the effects inside an `alt` fragment named by the guard, and passes `check-sequences`

#### Scenario: Dangling participant refused
- **WHEN** a message targets a participant that is not declared
- **THEN** `check-sequences` exits 1 naming the sequence and the participant

### Requirement: Gated state machines

The skill SHALL accept state-machine records `diagrams/state-machines/<id>.json` for one entity field and SHALL refuse an unknown entity or field, a state value not among the field's allowed values in `model.md`, not exactly one initial state, a transition to or from an unknown state, a transition without cite, an unresolved ref, and a state not reachable from the initial state; it SHALL export Mermaid `stateDiagram-v2` and SCXML.

#### Scenario: Unreachable state refused
- **WHEN** a state has no incoming transition and is not initial
- **THEN** `check-states` exits 1 naming the state as unreachable

### Requirement: Gated object diagrams

The skill SHALL accept object records with instances of ER entities and links, SHALL refuse an attribute that is not a field of its entity, a link with no ER relation between the two entities, and a link set that breaks the relation's single-valued side, SHALL generate synthetic instances from the ER diagrams and the model with `objects-synth`, and SHALL extract instances from a JSON database snapshot with `objects-from-db`, refusing a join that matches no ER relation and masking every value whose field is not listed in the job's `keep`.

#### Scenario: Masked extraction
- **WHEN** `objects-from-db` extracts an order with its lines and `keep` lists only `status`
- **THEN** every other attribute value is replaced by a pseudonym, equal source values get equal pseudonyms, and no source value appears in the output

#### Scenario: Local objects stay out of the shared catalog
- **WHEN** a real-data record sits in `PKG/_local/objects/`
- **THEN** `build-site` omits it unless `--local` is given

### Requirement: Behaviour views in the catalog

`build-site` SHALL gate and embed sequences (with collaboration projection), state machines (with SCXML) and object diagrams, and the catalog SHALL show each on its own page with links from and to the rules, quirks, gaps, entities, use cases and screen actions they reference; `behaviour <pkg> <outDir>` SHALL write one Mermaid file per diagram and one SCXML file per state machine.

#### Scenario: Backlink from a rule
- **WHEN** a state-machine transition references `BR-001`
- **THEN** the `BR-001` page lists that state machine

### Requirement: Diagram size budget

The diagram generator SHALL measure every generated diagram against a size budget given as
parameters (`--max-nodes`, default 30; `--max-edges`, default 40; `render.sh` `MAX_NODES` /
`MAX_EDGES`) and SHALL split a diagram over budget into an overview plus parts. Splitting SHALL be
deterministic: the same package and budget SHALL produce byte-identical output. A diagram within
budget SHALL render unchanged.

#### Scenario: Budget from parameters
- **WHEN** `build-site` runs with `--max-nodes 10`
- **THEN** a diagram with 12 nodes is split and a diagram with 8 nodes is not

#### Scenario: Size report
- **WHEN** `check-size <pkg> --strict` finds a part still over budget
- **THEN** it lists the part with its node and edge count and exits 1

### Requirement: IFML areas and parts

The IFML projection SHALL group screens into areas: each route record with the non-route records
it reaches by navigation or dialog opening (ties to the alphabetically first route; unreached
records form a shared area). The catalog SHALL show an overview map of areas with cross-area
navigation counts. Each area within budget SHALL be one part; otherwise each screen SHALL be a
part, and a screen over budget SHALL be split into action groups by trigger kind, chunked to the
budget; adjacent groups that fit together SHALL share one part. A split screen's forms and fields SHALL
ride with its first action group, or, when they do not fit beside its first action, SHALL lead as their
own parts packed field by field to the budget. Every part SHALL carry its own laid-out IFML XMI that passes `check-ifml`.

#### Scenario: Small groups packed
- **WHEN** a screen over budget has several trigger kinds with one action each
- **THEN** they share one part named after the joined kinds, within budget

#### Scenario: Large screen split by trigger kind
- **WHEN** a screen has toolbar, context-menu and keyboard actions and exceeds the budget
- **THEN** it becomes one part per trigger kind, each within budget, each with its own XMI

#### Scenario: Large form split from the actions
- **WHEN** a screen's forms and fields alone exceed the budget beside its first action
- **THEN** they become `P-<screen>-forms[-n]` parts, each within budget, every field in exactly one part

#### Scenario: Drill-down
- **WHEN** the reader clicks an area in the IFML overview
- **THEN** the catalog opens that area's part and offers a link back to the overview

### Requirement: Split behaviour diagrams

A state machine over the edge budget SHALL be drawn with transitions between the same two states
merged into one edge labelled with their count; its transitions table and SCXML export SHALL keep
every transition. A sequence over the edge budget SHALL be split into parts of consecutive
top-level steps, each within budget; a fragment SHALL be cut only when it alone exceeds the
budget, and each piece SHALL keep the fragment frame (`alt` label with piece number, `else`
branch as its own piece), and its main
diagram SHALL show each part as a `ref` block linking to it.

#### Scenario: Parallel transitions merged
- **WHEN** a state machine has 5 transitions from `a` to `b` and is over budget
- **THEN** the diagram has one `a --> b` edge labelled `5 transitions` and SCXML still has 5

#### Scenario: Oversized fragment
- **WHEN** one `alt` fragment holds 41 messages with budget 20
- **THEN** it becomes 3 pieces framed `alt <label> (1/3)` … none above 20 messages

#### Scenario: Sequence parts
- **WHEN** a sequence has 45 top-level messages with budget 20
- **THEN** it has 3 parts and a main diagram with 3 `ref` blocks

### Requirement: Split ER sets

An ER entity set over the node budget SHALL be drawn as one diagram per authored ER cluster
(`diagrams/er/*.json` other than `overview.json`) intersecting the set, plus budget-sized chunks
of the remaining entities, in a stable order; adjacent pieces that fit together SHALL share one
diagram, named after the joined clusters.

#### Scenario: Merged use-case view
- **WHEN** selected use cases touch 40 entities with budget 30
- **THEN** the merged view draws one ER per cluster they fall in, none above 30 entities

### Requirement: CRUD draft and gate

The diagram tool SHALL draft, per screen, every `write`/`read`/`export`/`call` UI effect with entity
candidates from an alias index of `model.md`, and SHALL gate CRUD records
(`diagrams/crud/<screen>.json`): the screen, action and effect index SHALL exist, the entity SHALL
exist in `model.md`, the op SHALL be one of C, R, U, D, entries SHALL be unique, and every
`write`/`read`/`export`/`call` effect of the screen SHALL be classified or listed as unmapped with a
reason. With `--complete` every screen having such effects SHALL have a record.

#### Scenario: Draft candidates
- **WHEN** an effect target reads `Cal_Resources.___mod(obj)` and `model.md` names table `cal_resources` for `CalResource`
- **THEN** the draft lists `CalResource` among the effect's candidates

#### Scenario: Unclassified effect refused
- **WHEN** a screen record omits one of its screen's write effects
- **THEN** `check-crud` names the effect and exits 1

### Requirement: CRUD matrix, findings and catalog

The diagram tool SHALL assemble an entity × use case matrix (a use case's actions are its UI
actions, else every action of its screens) and an entity × screen matrix from gated records,
SHALL report findings for persistent entities (never written, never read, created but never
deleted, untouched by the UI), SHALL export them as `crud.csv`, `crud-screens.csv` and
`crud-findings.md`, and the catalog SHALL show the matrix with its findings and a CRUD section
on entity and use-case pages. `build-site` SHALL refuse a package whose CRUD records fail the gate.

#### Scenario: Matrix cell
- **WHEN** a use case's UI action creates `Order` and another of its actions reads it
- **THEN** the `Order` row of that use case shows `CR`

#### Scenario: Finding
- **WHEN** persistent entity `Line` is created but never deleted
- **THEN** the findings list `Line` under "created but never deleted"

### Requirement: Generic CRUD aliases
The CRUD alias index SHALL derive aliases only from the entity name, its plural, `table X` / `collection X` phrases and the last segment of dotted identifiers in the entity's Persistence text.

#### Scenario: Dotted identifier
- **WHEN** an entity's Persistence names `cfg.tables.stock_rows`
- **THEN** `stock_rows` is one of its aliases

### Requirement: Object source encoding
`objects-from-db` SHALL decode its source by UTF-16 BOM, else UTF-8, else the job's `encoding`.

#### Scenario: Job encoding
- **WHEN** the job sets `encoding: "windows-1250"` and the source is not valid UTF-8
- **THEN** the source is decoded as windows-1250

### Requirement: Use-case UI links
The skill SHALL accept per-use-case link records `diagrams/uc-links/<UC-id>.json` that connect BPMN steps to UI actions with evidence, gate them with `check-uc-links`, and merge them into the use case's screens and UI actions.

#### Scenario: Candidate draft
- **WHEN** `uc-link-draft <pkg> <UC-id> <out>` runs
- **THEN** it lists the UI actions whose guard or effect refs intersect the use case's refs, ranked by overlap

#### Scenario: Evidence required
- **WHEN** a link shares no ref with the use case and carries no cite inside the action's handler or effect cites
- **THEN** `check-uc-links` fails naming the link

#### Scenario: Step must exist
- **WHEN** a link's `step` is not a task id of the use case's BPMN flows
- **THEN** `check-uc-links` fails

#### Scenario: No-UI use case
- **WHEN** a record has no links
- **THEN** it MUST carry a `noUi` reason, else the gate fails

#### Scenario: Completeness
- **WHEN** `check-uc-links --complete` runs and a use case has no record
- **THEN** it fails listing the use case

#### Scenario: Merge
- **WHEN** `build-site` runs with gated link records
- **THEN** each use case's screens and UI actions include the linked ones, and the CRUD, IFML and flow views use the merged set

### Requirement: Customer variability
The skill SHALL derive per-customer variability from code-read config paths and effective variant configs: a gated feature record, deterministic evaluation per variant and customer, reachability of screens and actions, findings, exports and a catalog view.

#### Scenario: Draft from code reads
- **WHEN** `variability-draft` runs
- **THEN** it lists only config paths matched by the adapter's `configReads` in the app's code, each with its cite and its value in every effective variant

#### Scenario: Feature grounded in code
- **WHEN** a feature's condition path is not read at any of its cited lines
- **THEN** `check-variability` fails naming the feature

#### Scenario: Complete coverage
- **WHEN** `check-variability --complete` runs and a varying code-read path is neither in a feature nor in `data`
- **THEN** it fails listing the path

#### Scenario: Evaluation per customer
- **WHEN** the package is assembled
- **THEN** each feature is on, off or mixed per customer from its condition evaluated on that customer's variants, with variants the adapter's `variants` hook marks as non-production flagged `env`

#### Scenario: Reachability
- **WHEN** a feature is off for a customer
- **THEN** the screens and actions it affects are shown unreachable for that customer in the catalog

#### Scenario: Findings
- **WHEN** a feature is off in every variant, on for one customer only, or constant across all
- **THEN** it appears in `variability-findings.md` under that heading
