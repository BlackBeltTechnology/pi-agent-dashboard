# DOX — packages/client/src/lib/spawn

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `__tests__/spawn-choice-memory.test.ts` | E36 storage-unavailable totality, E37 per-field fallback, garbled JSON → empty. See change: add-spawn-model-choice. |
| `__tests__/spawn-opts.test.ts` | E44 `siblingSpawnOpts` matrix (pi / empty / ACP) + `initializeSpawnOpts`. See change: add-spawn-model-choice. |
| `spawn-choice-memory.ts` | Per-folder spawn model · thinking memory. localStorage `pi-dashboard:spawn-choice:<cwd>` = `{model?, thinkingLevel?}`; `@role` stored verbatim. `getRememberedSpawnChoice` / `setRememberedSpawnChoice` / `clearRememberedSpawnField` total over unavailable storage. Settings-defaults mirror `setSpawnDefaults` / `getSpawnDefaults` / `subscribeSpawnDefaults` (App writes; no React — eager landing chunk). `getEffectiveSpawnChoice(cwd, fallback?)` = remembered ?? default, per field. See change: add-spawn-model-choice. |
| `spawn-opts.ts` | `siblingSpawnOpts(s)` — ACP → `{agent}`, pi → non-empty `model`/`thinkingLevel`, else `undefined`. `initializeSpawnOpts(cwd, prompt)` — `{initialPrompt, ...getEffectiveSpawnChoice(cwd)}`, always pi. Used by `SessionList` + `App`. See change: add-spawn-model-choice. |
