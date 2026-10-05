## 1. Tests first

- [x] 1.1 `diagrams.test.ts`: valid model passes `check-architecture`; broken model (ill-nested, bad host, dangling relation, unknown ref, cite past EOF with `--app`) exits 1 naming each; `build-site` refuses it
- [x] 1.2 `arch` writes `workspace.dsl` + `c4.md`; context view lifts a component→external relation to system→external, once
- [x] 1.3 `build-site` embeds `arch` (model, views, dsl) and embeds none without the file

## 2. Implementation

- [x] 2.1 `scripts/arch.mjs`: `checkArch`, `archViews`, `toStructurizr`, `toMermaidC4`
- [x] 2.2 `diagrams.mjs`: `check-architecture`, `arch`; `site.mjs`: gate + embed
- [x] 2.3 catalog: Architecture button, view chips, element page, backlinks, downloads
- [x] 2.4 `references/architecture-mapping.md`, `SKILL.md`, `AGENTS.md` rows

## 3. Pilot

- [x] 3.1 Plantifier `diagrams/architecture.json` from `doc/architecture.md` + code, cites checked with `--app plantifier-v2.11.1`
- [x] 3.2 Catalog rebuilt, views verified in the browser

## Notes

- Research: C4 = c4model.com (Simon Brown; context/container/component/code + landscape/dynamic/deployment); C5 = softwarearchitecturemodels.com (Sprinting Software; System, Component = deployable unit, Element, Deployment Node; no standard diagram types). One model serves both: C4 container = C5 component, C4 component = C5 element.
- Mermaid's `C4*` diagrams were not used for the catalog (poor layout, no click-through); they are an export only, next to Structurizr DSL.
- Plantifier pilot: 24 elements (2 people, 4 systems of which 3 external, 5 containers, 10 components, 3 nodes), 19 relations; `check-architecture --app plantifier-v2.11.1` passes (cites into UTF-16 handler files included). First-pass rule refs from a context grep were wrong (BR-149, BR-515, BR-045 unrelated); refs were re-picked by statement text.
- Browser: all 5 views render (context 6 boxes, containers 10, components 19, deployment 6 + 2 node groups, C5 22), every box clickable to its element page; BR-097 and SCR-order pages list their architecture elements. Fixed during verification: a container hosted on two nodes now appears in both; long cluster titles shortened (they wrapped under the boxes).
- Not verified: `workspace.dsl` against the Structurizr CLI (not installed).
