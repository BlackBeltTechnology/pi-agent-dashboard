# z-layer-lint.mjs — index

Overlay z-index ratchet (spec overlay-layering). Freezes raw numeric `z-[NNNN]`/`z-<n>` in `packages/client/src` (excl. tests) as `z-layer-baseline.json`; FAILS on a NEW occurrence outside the `z-<layer>` token utilities. Baseline = migration backlog, may only shrink. `--write-baseline` regenerates. Exports `extractRawZ`/`scanRawZ`/`ratchetDecision`. Wired into `quality:changed` + `z-layer:lint`. See change: add-overlay-layering-system.
