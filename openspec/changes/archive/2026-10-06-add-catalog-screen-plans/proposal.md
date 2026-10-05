## Why

Reviewers of a rebuild package need to see the original screens: where each control sits, what it triggers and which rules guard it. The UI model lists actions and fields, but not the layout. A deterministic extraction step (outside this skill) can render the original template as a static screen plan styled with a style kit derived from the app's own CSS, numbering every control and linking it to the UI model. The catalog should show those plans and the style kit next to the screen records.

## What Changes

- `build-site` embeds optional `ui/plans/<screenId>.html` (self-contained screen-plan pages) and `ui/style-kit.json` (design tokens + components with cites) into the catalog's UI model; it exits 1 when a plan file has no screen record.
- Catalog: the screen page shows the screen plan in a frame with an "open in new tab" action; a plan's action links (posted as `{type: "screen-plan-open", screen, action}`) open that action on the screen page. A Style kit page (header button) lists colour tokens as swatches with uses and cites, fonts, font-size and radius scales, and components with their selectors, declarations and cites.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `rebuild-package-diagrams`: screen plans and style kit in the catalog.

## Impact

- `packages/eng-disciplines/.pi/skills/rebuild-package-diagrams/` (`scripts/lib.mjs`, `templates/catalog.{js,css}`, `SKILL.md`), `src/__tests__/diagrams.test.ts`.
- Packages without `ui/plans` or `ui/style-kit.json` build unchanged. No new dependency. Rollback = revert.

## Discipline Skills

- `security-hardening` — plan HTML is package content rendered in a sandboxed iframe (`srcdoc`, `sandbox="allow-scripts"`, no same-origin), messages accepted only with the expected shape.
- `review-code` — inline review.
