## Why

The browsable catalog of `rebuild-package-diagrams` shows rules, quirks and gaps, but not the open questions a rebuild raises toward the client (on the pilot app: 140 claim-level questions from the doc↔package comparison plus 17 key questions). Reviewers have to cross-read a separate Markdown file and cannot see which use case, requirement or rule a question affects. Several catalog parts are also only linked one way (a rule does not show its capabilities' pages or the flow steps that use it).

## What Changes

- Optional gated input `diagrams/questions.json`: `[{id, text, severity, status?, source?, claim?, note?, codeCite?, refs[], group?}]`; `build-site` refuses a question whose `refs` do not resolve in the package or whose id is duplicated.
- Catalog: Questions tab + question page; questions linked to rules/quirks/gaps and, through them, to requirements, capabilities and use cases; "Open questions" in use-case and merged views (shared marker when ≥2 selected use cases hit it).
- Two-way links: item → capabilities, questions, flow steps that document it; capability → its rules/quirks/gaps and questions; requirement → questions.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `rebuild-package-diagrams`: browsable catalog gains the question register and cross-links.

## Impact

- `packages/eng-disciplines/.pi/skills/rebuild-package-diagrams/` (`scripts/site.mjs`, `scripts/lib.mjs`, `templates/catalog.js`, `SKILL.md`), `src/__tests__/diagrams.test.ts`.
- No new dependency; `questions.json` optional (catalogs without it are unchanged). Rollback = revert.

## Discipline Skills

- `review-code` — inline review of the site/template diff.
- No security, performance or observability triggers: local file-in/file-out build, no untrusted network input.
