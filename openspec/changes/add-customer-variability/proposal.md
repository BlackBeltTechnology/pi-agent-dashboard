## Why

Plantifier ships one code base to 7 customers (ac, audi, ctc, granit, ivanka, plb, protokon) through
25 config variants layered by `parameters.js` `defaultsDeep`. A rebuild must decide which behaviour
is core, which is a customer feature and which is dead everywhere (e.g. `normalization` absent in all
variants, `calendar` off for PLB, `orders.add.unique` only for protokon/ivanka/audi). `_effective/`
already holds every variant's merged config, but 2,161 of 2,318 leaf paths differ — mostly data
(db tables, shifts, strings), not features. Deterministic diff finds the paths; an LLM names
features; a gate checks every feature against code and configs; evaluation per variant is deterministic.

## What Changes

- Adapter hooks (stack/app knowledge stays in the project profile, see `generalize-rebuild-skills`):
  `configReads` (`{re}` with group 1 = config path, e.g. a profile's `CONF\.([\w.]+)`),
  `variants(app)` → `[{id, customer, env: prod|demo|test|local}]`; effective configs come from the
  existing `effectiveConfig` hook (`ui/_effective/`).
- `diagrams.mjs variability-draft <pkg> <app> <adapter> <out.json>`: config paths **read by code**
  (`configReads` matches with cite) × value per variant from `ui/_effective/*.json`, grouped by
  top-level key; flags paths that vary and paths absent everywhere.
- Record `diagrams/variability/features.json`:
  `features: [{id: "F-…", name, kind: toggle|option|parameter, condition: {path, op: exists|eq|ne|truthy|in, value?},
  cites: ["file:line"], affects: {screens, actions, refs}}]`, `data: [{path, reason}]` (config that is
  data, not behaviour), written by `rsfr-variability-classifier` (`prompts/variability-classifier.md`).
- **Gate `check-variability <pkg> --app <app> --adapter <adapter> [--complete]`**:
  - condition path is read in code at a cited line (cite text contains the path's last segment);
  - path exists in ≥1 effective config, or the feature is marked `deadEverywhere`;
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

- Customer grouping and env classification come from the profile's `variants` hook (Plantifier
  profile: file prefix `plb--…` = customer; `prez` = demo, `local`/`test` = env). Env variants are
  shown but not counted as a customer's production behaviour. Confirm.

## Discipline Skills

`doubt-driven-review` (condition semantics decide reachability).
