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
