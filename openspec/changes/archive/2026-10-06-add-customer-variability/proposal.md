## Why

Pilot app ships one code base to 7 customers (A–G) through
25 config variants layered by `parameters.js` `defaultsDeep`. A rebuild must decide which behaviour
is core, which is a customer feature and which is dead everywhere (e.g. `normalization` absent in all
variants, `calendar` off for customer F, `orders.add.unique` only for customers G/E/B). `_effective/`
already holds every variant's merged config, but 2,161 of 2,318 leaf paths differ — mostly data
(db tables, shifts, strings), not features. Deterministic diff finds the paths; an LLM names
features; a gate checks every feature against code and configs; evaluation per variant is deterministic.

## What Changes

- Extraction (`reverse-spec-for-rebuild` `ui-extract/config-reads.mjs <app> <adapter> <pkg>`, needs
  the adapter): adapter hooks `configReads` (global regex, group 1 = dotted config path read by
  code, e.g. a profile's `\bCONF((?:\.\w+)+)`) and `variantInfo(variantPath)` → `{customer, env:
  prod|demo|test|local}` (default: customer = variant, env prod) → `PKG/ui/_config-reads.json`
  `{reads: [{path, cites}], variants: [{id, variant, customer, env}]}` (comments stripped).
  Effective configs: the existing `effectiveConfig` hook (`ui/_effective/<id>.json`).
- `diagrams.mjs variability-draft <pkg> <out.json>` (no adapter needed): each read path × value per
  variant, grouped by top-level key; flags paths that vary and paths absent everywhere.
- Record `diagrams/variability/features.json`:
  `features: [{id: "F-…", name, kind: toggle|option|parameter, condition: {path, op: exists|eq|ne|truthy|in, value?},
  cites: ["file:line"], affects: {screens, actions, refs}}]`, `data: [{path, reason}]` (config that is
  data, not behaviour), written by `rsfr-variability-classifier` (`prompts/variability-classifier.md`).
- Record `diagrams/variability/features.json` (one classifier run; the pilot app reads only 62 paths).
- **Gate `check-variability <pkg> <app> [--complete]`**:
  - condition path is a read path (or below one), every cite line contains the path's last segment;
  - `deadEverywhere` ⇔ the condition is false in every variant;
  - `affects` screens/actions/refs resolve; feature ids unique;
  - `--complete`: every code-read path that varies across variants is in a feature or in `data`.
- Assembly (deterministic): evaluate each condition on each variant → feature × variant and feature ×
  customer matrices (customer = on when any of its variants on; mixed shown); **reachability** of
  screens/actions per customer (an action is unreachable when an `affects` feature is off);
  findings: dead everywhere, single-customer features, features with identical value everywhere
  (constant — candidate for removal from config), customers with no own feature.
- Exports `variability.csv`, `variability-customers.csv`, `variability-findings.md`; FeatureIDE-style
  `feature-model.xml` (flat optional features, no constraints).
- Catalog: **Variability** view (matrix, customer filter, findings); a customer selector greys out
  unreachable screens/actions on screen, IFML and CRUD views; feature chips on screen/action pages.

## Capabilities

### Modified Capabilities
- `rebuild-package-diagrams`: variability draft, gate, evaluation, reachability, catalog, export.
- `reverse-spec-for-rebuild`: variability classifier prompt and step.

## Impact

`scripts/variability.mjs` (new), `diagrams.mjs`, `site.mjs`, `catalog.{js,css}`, `render.sh`,
SKILL.md files, `agents/rsfr-variability-classifier.md`, tests. No dependency. Depends on
`ui/_effective/` (ui-extract `config.mjs`). Packages without `diagrams/variability/` build unchanged.

## Open questions

- Customer grouping and env classification come from the profile's `variants` hook (Pilot app
  profile: file prefix `f--…` = customer; `prez` = demo, `local`/`test` = env). Env variants are
  shown but not counted as a customer's production behaviour. Confirm.

## Discipline Skills

`doubt-driven-review` (condition semantics decide reachability).
