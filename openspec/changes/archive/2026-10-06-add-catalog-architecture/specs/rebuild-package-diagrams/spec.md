## ADDED Requirements

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
