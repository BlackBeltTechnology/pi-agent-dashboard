## Why

The UI model of a rebuild package (screens, dialogs, forms, actions, guards, effects, navigation) is IFML-shaped but not IFML. Rebuild teams and modelling tools speak the OMG Interaction Flow Modeling Language: an IFML view lets reviewers read the interaction structure in a standard notation, and an IFML XMI file lets the model be opened in IFML tooling. Both must stay traceable to the screens, actions and use cases they come from.

## What Changes

- Deterministic projection UI model → IFML 1.0 (`lib.mjs` `buildIfml`): screen/dialog → `Window` (`isModal`, `isLandmark`), form record / template fields → `Form` with `SimpleField`/`SelectionField` parts and `ValidationRule` constraints, action → `ViewElementEvent` (`OnSubmitEvent` when it validates a form) + `Action` with a normal `ActionEvent`, guards → `ActivationExpression`, navigation and dialog opening → `NavigationFlow`. Every element carries a trace (screen, action, form, field, dialog) as an `Annotation`.
- New CLI command `ifml <packageDir> <out.xmi>` writing IFML XMI (namespace `http://www.omg.org/spec/IFML/20140301`), and `check-ifml <file.xmi>` validating an XMI against `references/ifml-metamodel.json` (extracted from the normative OMG metamodel: known concrete metaclasses, features declared on the class or a superclass, resolvable id references, single-valued features not repeated). `ifml` runs the same check before writing and exits 1 on any violation.
- Catalog: IFML view (Mermaid flowchart in IFML style: windows as containers, forms inside, events as circles, actions as hexagons, navigation flows as arrows), filtered to the selected use cases; click-through from IFML elements to screen/action/form pages; links "IFML" from screen, use-case and merged views; XMI download from the single HTML file.
- Use case → action links from alternate flows whose node documentation carries `ui: <screen>#<action>`.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `rebuild-package-diagrams`: IFML projection, XMI export + conformance check, IFML catalog view.

## Impact

- `packages/eng-disciplines/.pi/skills/rebuild-package-diagrams/` (`scripts/lib.mjs`, `scripts/ifml.mjs` (new), `scripts/diagrams.mjs`, `scripts/site.mjs`, `templates/catalog.js`, `templates/catalog.css`, `references/ifml-mapping.md` (new), `references/ifml-metamodel.json` (new), `SKILL.md`), `src/__tests__/diagrams.test.ts`.
- No new dependency (no XML library: the checker parses the restricted XMI the projection emits). Optional input: packages without `ui/` are unchanged. Rollback = revert.

## Discipline Skills

- `review-code` — inline review of the projection, checker and template diff.
- No security, performance or observability triggers: local file-in/file-out build; all record text escaped in XML and HTML.
