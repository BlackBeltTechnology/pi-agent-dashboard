# Architecture model → C4 and C5

Source: `diagrams/architecture.json` = `{elements: [...], relations: [...]}` (gated by
`check-architecture` and `build-site`).

## Element kinds

| `kind` | C4 (c4model.com) | C5 (softwarearchitecturemodels.com) | Parent | Notes |
|---|---|---|---|---|
| `person` | Person | user (outside the model; drawn as actor) | none | |
| `system` | Software System | System | none | `external: true` = outside the rebuild scope |
| `container` | Container (separately runnable/deployable) | Component (deployable unit) | a system | `store: true` draws a database shape |
| `component` | Component | Element | a container | |
| `node` | Deployment Node | Deployment Node | a node or none | `hosts: [containerIds]` |

Every element and relation may carry `cites` (`file:line` / `file:a-b`, checked against the code
with `check-architecture --app <appDir>`) and `refs`: `BR-`/`QUIRK-`/`GAP-` ids,
`spec:<cap>#<Requirement>`, `cap:<cap>`, screen/dialog ids, use-case ids.

## Views (`scripts/arch.mjs` `archViews`)

| View id | Shows | Relations |
|---|---|---|
| `c4-context` | people, all systems | lifted to system level |
| `c4-container` (`:<system>` when >1 in scope) | containers inside the system boundary + related people/systems | lifted to container level |
| `c4-component:<container>` | its components + related containers/people/systems | lifted to component level outside |
| `c4-deployment` | nodes (nested) with hosted containers; a container hosted on several nodes appears once per node (`<id>@<node>`), relations attach to the first | container level |
| `c5` | System → Component → Element boxes, Deployment Nodes, dotted "deploys" edges | element level |

Lifting: an end is replaced by its nearest ancestor shown in the view; one edge per ordered pair
(`label (+n)` when merged); an edge whose ends lift to the same box is dropped.

Drawn as Mermaid flowcharts in C4 colours (Mermaid's own `C4*` diagrams lay out poorly and are
not clickable). Exports for tools: `toStructurizr` (`workspace.dsl`: model, `deploymentEnvironment
"Production"`, `systemContext`/`container`/`component`/`deployment` views) and `toMermaidC4`
(`c4.md`: `C4Context` + `C4Container`). C5 defines no standard diagram types and has no tool
format, so it exists only as the catalog view.

## Authoring

Start from the package's architecture prose and capability list; one container per separately
started process or store, one component per cohesive code area (cite its entry file/factory);
relations name the business-level interaction and the technology. Every element should carry
at least one cite or ref, so the reviewer can check it.
