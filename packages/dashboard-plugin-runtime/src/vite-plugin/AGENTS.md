# DOX — packages/dashboard-plugin-runtime/src/vite-plugin

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `index.ts` | `viteDashboardPluginsPlugin(repoRoot?)` — generates `packages/client/src/generated/plugin-registry.tsx` with named imports (tree-shaking). Watches manifests during dev; regenerates + triggers HMR on changes. Filters `fixture:true` plugins in production. Invoked from packages/client/vite.config.ts via dynamic import (see change: wire-plugin-registry-into-shell). Wires manifest `predicate` AND `shouldRender` strings to `ClaimEntry` function refs (predicate path was previously dead code). See change: auto-hide-empty-session-subcards. |
