# generate-plugin-registry.mjs — index

Standalone generator for packages/client/src/generated/plugin-registry.tsx (gitignored). Runs regeneratePluginRegistry via jiti outside Vite so prelint/prebuild hooks + fresh clones produce the file before tsc/vitest/vite. Respects NODE_ENV=production.
