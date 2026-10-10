# Customer variability

Configuration-driven behaviour per customer. Code: `scripts/variability.mjs`; extraction in
`reverse-spec-for-rebuild` `scripts/ui-extract/config-reads.mjs`. Naming features is a gated
subagent step; evaluation, matrices, findings and exports are deterministic.

## Inputs

- `ui/_effective/<variant>.json` — merged config per variant (`config.mjs`, adapter `effectiveConfig`).
- `ui/_config-reads.json` — `{reads: [{path, cites}], variants: [{id, variant, customer, env}]}` from
  `config-reads.mjs APP <adapter> PKG`: adapter `configReads` (global regex, group 1 = dotted path,
  comments stripped) and `variantInfo(variantPath)` → `{customer, env: prod|demo|test|local}`.

## Record and gate

`diagrams/variability/features.json` — `features: [{id, name, kind: toggle|option|parameter,
condition: {path, op: exists|truthy|eq|ne|in, value?}, cites, affects: {screens, actions, refs},
deadEverywhere?}]`, `data: [{path, reason}]`.

`check-variability PKG APP [--complete]`: kind and op valid (`eq`/`ne` need `value`, `in` an
array); condition path is a read path or below one; with APP every cite line contains the path's
last segment; `deadEverywhere` ⇔ false in every variant; affected screens/actions/refs exist; ids
unique; data paths are read paths with a reason; `--complete`: every varying read path is covered
by a feature or data path (equal, above or below).

## Evaluation

- Per variant: the condition on its effective config (`on` / `off`).
- Per customer: its **production** variants decide (`on`, `off`, `mixed`); a customer with no
  production variant uses its other variants. Env variants appear in the per-variant matrix only.
- Unreachable UI of a customer: `affects` screens and actions of its `off` features.
- Findings: dead everywhere (off in all variants), single-customer (on for exactly one customer),
  constant (on in all variants — candidate for removal from config), customers without an own
  (single-customer) feature.

## Exports and catalog

`variability PKG outDir` (`render.sh` → `diagrams/variability-matrix/`): `variability.csv`,
`variability-customers.csv`, `variability-findings.md`, `feature-model.xml` (FeatureIDE: flat
optional features under one abstract root). Catalog **Variability** view (by customer / by config
variant, findings, data paths), customer page (variants, unreachable UI, feature states), feature
table on affected screen pages.
