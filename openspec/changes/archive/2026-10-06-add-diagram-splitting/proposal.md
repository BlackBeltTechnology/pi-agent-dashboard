## Why

Generated diagrams of a real legacy package outgrow what a reader can follow: the pilot-app IFML
of all 39 screens has ~760 elements, one plan-grid screen 47 actions, the `Process.locked` state
machine 79 transitions between 3 states, a set-done sequence 45 messages. Drawn whole they are
unreadable; the reader needs an overview and parts small enough to understand.

## What Changes

- A size budget for every generated diagram, as parameters: `--max-nodes` (default 30) and
  `--max-edges` (default 40) on `build-site`, and `MAX_NODES` / `MAX_EDGES` for `render.sh`.
- Deterministic splitting in the generator step, along the structure each model already has:
  - IFML: screens are grouped into areas (a route plus the dialogs/panels it opens, by
    navigation); an overview map of areas; one part per area within budget, else per screen;
    a screen over budget is split into action groups by trigger kind. Every part gets its own
    laid-out IFML XMI.
  - State machine over budget: transitions between the same two states are drawn as one edge
    with a count; the full list stays in the table and in SCXML.
  - Sequence over budget: top-level steps are chunked into parts within budget; the main
    diagram shows each part as a `ref` block.
  - ER entity sets over budget (use-case merge, capability views): drawn per authored ER
    cluster (`diagrams/er/*.json`), remaining entities in budget-sized chunks.
- `diagrams.mjs check-size <pkg> [--max-nodes n] [--max-edges n] [--strict]` reports every
  diagram's size and its split; `--strict` exits 1 when a part still exceeds the budget.
- Catalog: IFML overview with drill-down into parts and a breadcrumb back; split sequences and
  state machines show the overview first; parts exported as `.mmd` / `.xmi`.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `rebuild-package-diagrams`: diagram size budget and structural splitting.

## Impact

- New `scripts/split.mjs`; `diagrams.mjs`, `site.mjs`, `behaviour.mjs` (export), `templates/catalog.{js,css}`,
  `render.sh`, SKILL.md, references, tests. No dependency. Diagrams within budget render
  unchanged. Deterministic: same input and budget give byte-identical output. Rollback = revert.

## Discipline Skills

- `code-simplification` — keep splitting structural and small; no generic graph clustering unless a real diagram needs it.
- `review-code` — inline review.
