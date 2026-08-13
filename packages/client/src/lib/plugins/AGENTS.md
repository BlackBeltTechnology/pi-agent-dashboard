# DOX — packages/client/src/lib/plugins

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `shell-primitives.tsx` | Shell-bound UI primitive wrappers registered in `main.tsx`. Exports `ModelSelectorPrimitive` (public contract `{ current, models, onSelect, placeholder }`; injects `favorites` / `onToggleFavorite` / `onRefresh` from `ModelConfigContext` via `useModelConfigOptional()` — context absent ⇒ no favorites, no refresh, caller's list still renders) and `ThinkingLevelSelectorPrimitive` (thin pass-through to the shell `ThinkingLevelSelector`; `supportedLevels` stays caller-supplied). Extracted from `main.tsx` so the binding is testable without booting the app. See change: upgrade-model-selector-primitives. |
