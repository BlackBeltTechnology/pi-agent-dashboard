# host-api-surface.mjs — index

Host API surface snapshot + bump gate. `--write` regenerates `packages/dashboard-plugin-runtime/host-api-surface.json` from `public.ts`/`./sdk`/shared contract types via the TS checker; default `--check` fails on a stale snapshot; `--base <ref>` enforces removal→major, addition/shape change→≥minor vs that ref's snapshot. Exports `computeSurface`, `diffSurface`, `checkBump`, `bumpKind`, `parseHostDesignTokens`. See change: decouple-plugins-from-core.
