# DOX — packages/dashboard-plugin-runtime/src/vite-plugin

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `index.ts` | `viteDashboardPluginsPlugin(repoRoot?)` — generates `packages/client/src/generated/plugin-registry.tsx` with named imports (tree-shaking). Watches manifests during dev; regenerates + triggers HMR on changes. Selects through the shared `selectClientRegistryPlugins` on BOTH the build and dev-regeneration paths (build-time and runtime hashes over the same set). `writeBundle` emits `pi-dashboard-build.json` (via `emitBuildDeclaration`) into the resolved client build output on production only — dev writes no declaration. Invoked from packages/client/vite.config.ts via dynamic import (see change: wire-plugin-registry-into-shell). Wires manifest `predicate` AND `shouldRender` strings to `ClaimEntry` function refs (predicate path was previously dead code). See change: auto-hide-empty-session-subcards. See change: add-served-build-coherence-and-hash-parity (design D0/D1). Emits `customType` onto generated `custom-entry-renderer` claims and hard-fails generation on a cross-plugin `(custom-entry-renderer, customType)` collision naming BOTH plugin ids and the type (new code — no aggregate check existed). See change: add-custom-entry-renderer-slot. |
