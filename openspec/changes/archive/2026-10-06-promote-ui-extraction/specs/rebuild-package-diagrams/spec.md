## ADDED Requirements

### Requirement: One-command package render

The skill SHALL ship `scripts/render.sh <packageDir> [appDir]` that runs every applicable gate and render step in order and stops at the first failure: `check-use-cases`; `check-architecture` (with `--app` when given) and `arch` when `diagrams/architecture.json` exists; `ifml`, `check-ifml` and a round-trip `ifml-diff` that must report no differences when `ui/` exists; and `build-site` with every viewer library it finds, the IFML viewer coming from the skill's vendored `assets/ifml-js/`.

#### Scenario: Minimal package
- **WHEN** the package has use cases but no `architecture.json` and no `ui/`
- **THEN** `render.sh` skips the architecture and IFML steps and writes `diagrams/catalog.html`

#### Scenario: Gate failure stops the render
- **WHEN** `check-use-cases` fails
- **THEN** `render.sh` exits non-zero and writes no catalog
