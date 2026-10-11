## Why

A rebuild package now can carry a UI model (`ui/screens/*.json` screen/dialog records with actions, effects, guards, dialogs, navigation; `ui/forms/*.json` form records with fields, labels, validations, per-layer cites), produced by the frontend-extraction pilot on the pilot app. The browsable catalog does not show it, so reviewers cannot see which screens, forms and buttons a use case goes through, which UI actions a rule guards or validates, or compare a prose-authored flow with the flow derived from code.

## What Changes

- Optional gated input `ui/screens/*.json` + `ui/forms/*.json`; `build-site` embeds them and exits 1 (no HTML written) on a duplicate screen/action/dialog id, a dangling `BR-`/`QUIRK-`/`GAP-`/`spec:` ref in guards, refs or effect refs, or a screen form ref without a form record.
- `use-cases.json` gains optional `screens[]` (screen ids) and `altFlows[]` (`{label, bpmn}` extra flows, e.g. "from code"); `check-use-cases` and `build-site` refuse unknown screens and missing alt-flow files.
- Catalog: Screens tab (screens + dialogs), screen page (actions with trigger, handler, guards, effects as steps, dialogs, navigation, forms), form page (fields, labels, required/editable/computed, validations, views, layer cites, flags); alternate flows selectable in the flow switcher.
- Two-way links: use case / merged view → screens and forms; screen → use cases; rule/quirk/gap → UI actions that guard, reference or effect it; requirement → UI actions; form → screens.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `rebuild-package-diagrams`: catalog gains the UI model and alternate flows.

## Impact

- `packages/eng-disciplines/.pi/skills/rebuild-package-diagrams/` (`scripts/lib.mjs`, `scripts/site.mjs`, `templates/catalog.js`, `templates/catalog.css`, `SKILL.md`), `src/__tests__/diagrams.test.ts`, package `AGENTS.md`.
- No new dependency; all new inputs optional (catalogs without `ui/` are unchanged). Rollback = revert.

## Discipline Skills

- `review-code` — inline review of the site/template diff.
- No security, performance or observability triggers: local file-in/file-out build; record text is escaped before rendering.
