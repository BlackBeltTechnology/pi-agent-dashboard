# knip.json — index

(repo root) Knip 6.32.2 whole-graph dead-code config. 38 workspaces.
Entry points generated from manifests by `scripts/knip-config.mjs`: `pi-dashboard-plugin.{client,server,bridge}`, `pi.extensions`. `bin`/`main`/`exports` left to Knip natively.
Rooting load-bearing, not tuning. Unrooted Knip reports 723 findings / 90 unused files; calls `packages/extension/src/canvas-tool.ts` dead while `bridge.ts` imports it. Rooted: 437 / 10.
`scripts/**` entry because scripts shell/CI-invoked; consequence, dead script undetectable.
All dependency classes `off` — `noUndeclaredDependencies` in `biome.json` owns that rule. See change: add-knip-dead-code-oracle.
