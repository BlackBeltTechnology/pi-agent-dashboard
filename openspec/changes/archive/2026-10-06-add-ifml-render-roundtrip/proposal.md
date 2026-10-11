## Why

The catalog draws IFML with a Mermaid approximation, and the IFML XMI is export-only. Reviewers want the real IFML notation, and the model must travel both ways: an IFML file edited in an IFML editor (ifml.io / VS Code ifml-io, both on `ifml-js`) must come back to the rebuild package as a reviewable diff or as applied changes, and an IFML file from elsewhere must be usable as the starting UI model of a rebuild. A first render attempt showed the export did not open in `ifml-js`: trace `Annotation`s and an id-referenced `activationExpression` crash its importer, and the file carried no diagram geometry.

## What Changes

- Export (`ifml`): IFML-DI geometry (`ifmldi:IFMLDiagram`, `IFMLNode` bounds, `IFMLConnection` waypoints) from a deterministic layout; trace carried by dot-separated element ids (`W.<screen>`, `E.<screen>.<action>`, `P.<screen>.<form>.<field>`, …) instead of `Annotation`s (opt-in); `ActivationExpression` nested in its event (the form IFML tooling reads). `check-ifml` validates DI references (`modelElement` resolves) and skips DI metaclasses outside the IFML metamodel.
- Catalog: when `build-site` gets `--ifml-js <ifml-navigated-viewer.production.min.js>` and `--ifml-css <file>`…, the IFML view renders the XMI with `ifml-js` (scope zoom, out-of-scope elements dimmed, use-case actions highlighted, click-through); without it the Mermaid view stays.
- Reverse: `ifml-to-ui <file.xmi> <outDir>` writes `ui/screens/*.json` + `ui/forms/*.json` from any IFML XMI (ids from the trace when present, else from names; records marked `source: "ifml"`).
- Round-trip: `ifml-diff <packageDir> <file.xmi> [--apply]` compares the edited IFML with the package UI model element by element (added, removed, renamed, changed guard/validation/flow); exit 1 when they differ; `--apply` merges additions, renames, guard and validation changes into `ui/` and only reports deletions.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `rebuild-package-diagrams`: IFML export with DI, ifml-js rendering, IFML import and round-trip diff/apply.

## Impact

- `packages/eng-disciplines/.pi/skills/rebuild-package-diagrams/` (`scripts/ifml.mjs`, `scripts/ifml-import.mjs` (new), `scripts/diagrams.mjs`, `scripts/site.mjs`, `templates/catalog.js`, `templates/catalog.html`, `references/ifml-mapping.md`, `SKILL.md`), `src/__tests__/diagrams.test.ts`.
- `ifml-js` is not shipped; the user passes its built files to `build-site` like bpmn-js (bpmn.io license: watermark stays visible). No new dependency. Rollback = revert.

## Discipline Skills

- `review-code` — inline review of the layout, import, diff/apply and template diff.
- `doubt-driven-review` — `--apply` writes into the package UI model: deletions never applied, existing cites/effects never dropped.
