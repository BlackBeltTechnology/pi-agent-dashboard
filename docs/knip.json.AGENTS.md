# knip.json — index

(repo root) Knip 6.32.2 whole-graph dead-code config. 38 workspaces.
Entry points generated from manifests by `scripts/knip-config.mjs`: `pi-dashboard-plugin.{client,server,bridge}`, `pi.extensions`. `bin`/`main`/`exports` left to Knip natively.
Rooting load-bearing, not tuning. Unrooted Knip reports 723 findings / 90 unused files; calls `packages/extension/src/canvas-tool.ts` dead while `bridge.ts` imports it. Rooted: 437 / 10.
`scripts/**` entry because scripts shell/CI-invoked; consequence, dead script undetectable.
`packages/kb` entry `src/cli.ts` declared explicitly. Reason: `bin.kb` now `bin/kb.mjs` (plain-JS shim); shim imports `dist/cli.js` via runtime dynamic import — Knip cannot resolve edge; without entry `src/cli.ts` reported unused file. See change: fix-kb-eval-measurement-integrity.
All dependency classes `off` — `noUndeclaredDependencies` in `biome.json` owns that rule. See change: add-knip-dead-code-oracle.
Root workspace `entry` += `tests/e2e/*/global-{setup,teardown}.ts`. Roots `playwright.identity.config.ts` / `playwright.identity-matrix.config.ts` globalSetup/globalTeardown. Reason: knip playwright plugin parses only default `playwright.config.ts`.
Root workspace `ignore` += `packages/deck3d/fixtures/**`. Fixture generators `build-deck.mjs` / `build-overrides.mjs` + local fx `fx/closing-mark.js`. Follows `docker/fixtures/**` precedent.
Hand-added entries not checked by `scripts/knip-config.mjs` (manifest-derived only).
See change: close-e2e-tooling-followups.
