# generate-plugin-registry.mjs — index

Standalone generator for packages/client/src/generated/plugin-registry.tsx (committed). Runs regeneratePluginRegistry via jiti outside Vite so prelint/prebuild hooks + fresh clones produce the file before tsc/vitest/vite. Respects NODE_ENV=production. Also writes `plugin-sources.css` (Tailwind `@source` lines, same dir): `regeneratePluginRegistry` runs the shared `regenerate`, which emits both. Both files are committed. See change: decouple-plugins-from-core.
