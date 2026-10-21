# RoleRef.tsx — index

Shared `@role[:level]` display. Exports `RoleRef`, `RoleRefProps`, `RoleRefLabels`. `follows`: role token + model id (provider prefix in `sr-only`, no `aria-label`) + level chip; `once`: model + "from @role". No model value → warning pill "No model assigned" (`resolving` suppresses it while loading). Strings via `labels`; optional `testIds`. Presentational: no fetch, no client import. See change: retro-ux-model-selector.
