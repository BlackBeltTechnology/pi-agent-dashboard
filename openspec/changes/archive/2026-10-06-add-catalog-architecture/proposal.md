## Why

The catalog shows behaviour (BPMN), data (ER) and UI (screens, IFML) of a legacy system, but no architecture perspective: which deployable parts exist, what runs where, which external systems are touched, and which code implements which part. Rebuild teams and stakeholders ask for this in the two zoomable notations in use: the C4 model (c4model.com; system context, container, component, deployment) and the C5 model (softwarearchitecturemodels.com; System → Component (deployable) → Element, plus Deployment Node). Both views must stay traceable to the code and the package like every other catalog part.

## What Changes

- New optional `diagrams/architecture.json`: people, systems (in-scope or external), containers, components, deployment nodes (hosting containers) and relations; each with `file:line` cites and refs to rules/quirks/gaps, requirements, capabilities, screens and use cases.
- `diagrams.mjs check-architecture <packageDir> [--app <appDir>]`: exits 1 on duplicate ids, unknown or ill-nested parents (container in a system, component in a container, node in a node), hosts that are not containers, dangling relation ends, malformed cites, unresolvable refs; with `--app`, every cite must resolve to an existing file and line range.
- One model, two notations (`scripts/arch.mjs`): C4 views (context, containers, one component view per container, deployment) and a C5 view (System/Component/Element/Deployment Node, C4 container = C5 component, C4 component = C5 element); relations between nested elements are lifted to the level shown. Exports: Structurizr DSL and Mermaid C4 (context + container).
- `diagrams.mjs arch <packageDir> <outDir>` writes `workspace.dsl` and `c4.md` (Mermaid C4).
- `build-site` gates the model like the other parts, embeds it with pre-rendered view texts, and the catalog gets an Architecture button, a page per view, a page per element (cites, refs, relations, children) and backlinks from rules/quirks/gaps, requirements, capabilities, screens and use cases to the architecture elements that reference them.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `rebuild-package-diagrams`: gated architecture model, C4 and C5 projections with exports, architecture catalog view.

## Impact

- `packages/eng-disciplines/.pi/skills/rebuild-package-diagrams/` (`scripts/arch.mjs` (new), `scripts/diagrams.mjs`, `scripts/site.mjs`, `templates/catalog.{js,html,css}`, `references/architecture-mapping.md` (new), `SKILL.md`), `src/__tests__/diagrams.test.ts`.
- No new dependency (views drawn with the already-inlined Mermaid). `build-site` stays unchanged for packages without `architecture.json`. Rollback = revert.

## Discipline Skills

- `review-code` — inline review of the projection, gate and template diff.
