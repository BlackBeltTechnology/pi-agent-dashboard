#!/usr/bin/env node
/**
 * Standalone generator for packages/client/src/generated/plugin-registry.tsx.
 *
 * Runs the same logic as viteDashboardPluginsPlugin's buildStart, but outside
 * Vite so prelint/prebuild hooks (and fresh clones) can produce the file
 * before tsc / vitest / vite ever runs.
 *
 * The file is gitignored — Vite regenerates it on dev start and during build,
 * and this script regenerates it for non-Vite consumers (tsc --noEmit, IDEs
 * on a fresh clone, CI lint steps).
 */
import { createJiti } from "jiti";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { interopDefault: true });

const mod = await jiti.import(
  path.join(repoRoot, "packages/dashboard-plugin-runtime/src/vite-plugin/index.ts"),
);
const { regeneratePluginRegistry } = mod;

const isProd = process.env.NODE_ENV === "production";
const { changed } = regeneratePluginRegistry(repoRoot, isProd);
console.info(
  `[generate-plugin-registry] ${changed ? "wrote" : "unchanged"} packages/client/src/generated/plugin-registry.tsx (isProd=${isProd})`,
);
