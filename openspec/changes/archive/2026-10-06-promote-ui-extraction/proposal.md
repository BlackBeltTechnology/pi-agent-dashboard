## Why

The frontend half of reverse engineering (UI inventory, effective config, form records, gated screen records, flows from code, style kit, screen plans) was proven on the pilot, but its programs live only in that project's folder. The rebuild-package render (catalog with every viewer, IFML, architecture) is run there by a project script too. Other rebuilds cannot reuse either.

## What Changes

- `reverse-spec-for-rebuild` ships the UI-extraction programs under `scripts/ui-extract/` (dependency-free Node >= 20): `inventory`, `config`, `forms`, `screen-form`, `gate`, `flow`, `compare`, `refs-for`, `fill`, `style-kit`, `screen-plan` plus `lib`/`lib-html`, the reference adapter `adapters/angularjs-hta.mjs`, the screen-generator prompt `prompts/ui-screen-generator.md`, and references `ui-model.md` (screen record format) and `ui-extraction.md` (steps, adapter contract, gate rules, plan transform rules).
- Adapters load by built-in name or by file path (a project's own stack adapter). The toolbar convention used by screen plans (`OpBar.<key>` in the pilot) becomes an adapter hook `toolbar: {ref, assign}`; without it no toolbar filtering happens.
- SKILL.md gains an optional "Frontend UI model" phase after the package gate.
- `rebuild-package-diagrams` ships `scripts/render.sh <pkg> [appDir]` running the full render with its gates (check-use-cases, check-architecture + arch when `architecture.json` exists, ifml + check-ifml + round-trip ifml-diff when `ui/` exists, build-site with every viewer found) and vendors the ifml-js 0.3.0 viewer under `assets/ifml-js/` (bpmn.io licence; watermark stays).

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `reverse-spec-for-rebuild`: frontend UI-model extraction programs and phase.
- `rebuild-package-diagrams`: one-command render script, vendored IFML viewer.

## Impact

- New files under both skills; `NOTICE` gains ifml-js; `src/__tests__/ui-extract.test.ts`, `diagrams.test.ts`.
- The pilot project pilot switches to the skill copies and deletes its own (outputs byte-identical). No dependency added. Rollback = revert.

## Discipline Skills

- `security-hardening` — adapters and app sources are untrusted input; adapter by path executes project code only when the user names it.
- `review-code` — inline review.
