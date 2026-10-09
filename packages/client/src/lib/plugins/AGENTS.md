# DOX — packages/client/src/lib/plugins

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `embedded-app-shell.ts` | `createEmbeddedAppShell(deps)` → runtime `EmbeddedAppShell`. `fetch`/`wsUrl` refuse non-root-relative paths (`isSafeDashboardPath`, no request); fetch adds `Authorization: Bearer` from `getApiBearer()`, `credentials:"same-origin"`; wsUrl mints `mintWsTicket("browser")` iff `getApiBearer()||isDevicePaired()` (useWebSocket predicate). Folder codec = `lib/util/folder-encoding.ts`. Wired once in `App.tsx`. See change: add-plugin-app-host. |
| `shell-primitives.tsx` | Shell-bound UI primitive wrappers registered in `main.tsx`. Exports `ModelSelectorPrimitive` (public contract `{ current, models, onSelect, placeholder }`; injects `favorites` / `onToggleFavorite` / `onRefresh` from `ModelConfigContext` via `useModelConfigOptional()` — context absent ⇒ no favorites, no refresh, caller's list still renders) and `ThinkingLevelSelectorPrimitive` (thin pass-through to the shell `ThinkingLevelSelector`; `supportedLevels` stays caller-supplied). Extracted from `main.tsx` so the binding is testable without booting the app. See change: upgrade-model-selector-primitives. Change: `ModelSelectorPrimitive` forwards `allowRoles`. See change: add-role-aware-model-refs. |