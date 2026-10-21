#!/usr/bin/env node
/**
 * Builds the runtime-delivery canary fixture (`tests/fixtures/runtime-canary-plugin/`) and its failure variants
 * with the SDK Vite preset (`dashboard-plugin-runtime/src/vite-plugin/client-preset.ts`).
 *
 *   node scripts/build-runtime-canary.mjs [--base-only] [--out-json]
 *
 * Output (never committed — each dir's `.gitignore` excludes `dist/`):
 *   tests/fixtures/runtime-canary-plugin/dist/client/{index.js,s6-route.js,lazy-panel.js,client.css,chunks/}
 *   tests/fixtures/runtime-canary-plugin/variants/<name>/dist/client/index.js   (name: missing-export | bundled-react | throws-in-render | bundled-app-kit)
 *
 * The harness (task 7.5) calls this ONCE, hashes the built output, then copies it under
 * `~/.pi/dashboard/plugins/` and pre-seeds `auth.trustedPlugins` — it never rebuilds after seeding.
 *
 * See change: decouple-plugins-from-core (tasks 7.4, 8.1).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CANARY_ROOT = path.join(repoRoot, "tests/fixtures/runtime-canary-plugin");

const REACT_SPECIFIERS = ["react", "react/jsx-runtime", "react-dom", "react-dom/client"];
const APP_KIT_REACT = `${"@blackbelt-technology"}/pi-dashboard-app-kit/react`;

/** The base canary plus the four failure variants — each is one preset build. */
export const CANARY_BUILDS = [
  {
    name: "base",
    root: CANARY_ROOT,
    options: { entry: "src/client/index.tsx", lazyModules: { "s6-route": "src/client/S6Route.tsx", "lazy-panel": "src/client/LazyPanel.tsx" } },
  },
  {
    // `createSlotRegistry` is a shell internal, absent from the host shim → link-time SyntaxError in the browser.
    name: "missing-export",
    root: path.join(CANARY_ROOT, "variants/missing-export"),
    options: { entry: "src/client/index.tsx", styles: false },
  },
  {
    // Guard bypassed (TEST ONLY): bundles its own React.
    name: "bundled-react",
    root: path.join(CANARY_ROOT, "variants/bundled-react"),
    options: { entry: "src/client/index.tsx", styles: false, unsafeBundleSpecifiers: REACT_SPECIFIERS },
  },
  {
    name: "throws-in-render",
    root: path.join(CANARY_ROOT, "variants/throws-in-render"),
    options: { entry: "src/client/index.tsx", styles: false },
  },
  {
    // Bundles its own app-kit (TEST ONLY); app-kit ships dist-only exports, so alias its source like the client does.
    name: "bundled-app-kit",
    root: path.join(CANARY_ROOT, "variants/bundled-app-kit"),
    options: {
      entry: "src/client/index.tsx",
      styles: false,
      unsafeBundleSpecifiers: [APP_KIT_REACT],
      vite: { resolve: { alias: { [APP_KIT_REACT]: path.join(repoRoot, "packages/app-kit/src/react/index.ts") } } },
    },
  },
];

/** Build the canary (and, unless `baseOnly`, every variant). Returns the built dirs by name. */
export async function buildRuntimeCanary({ baseOnly = false } = {}) {
  const jiti = createJiti(import.meta.url, { interopDefault: true });
  const { buildDashboardClient, buildDashboardStandalone } = await jiti.import(path.join(repoRoot, "packages/dashboard-plugin-runtime/src/vite-plugin/index.ts"));
  const built = {};
  for (const b of CANARY_BUILDS) {
    if (baseOnly && b.name !== "base") continue;
    await buildDashboardClient({ root: b.root, ...b.options });
    built[b.name] = path.join(b.root, "dist/client");
  }
  // Standalone half of the base canary app (served by its server entry's `ctx.serveApp`): own React, app-kit aliased to source.
  await buildDashboardStandalone({
    root: CANARY_ROOT,
    outDir: "dist/standalone",
    vite: { resolve: { alias: { [APP_KIT_REACT]: path.join(repoRoot, "packages/app-kit/src/react/index.ts") } } },
  });
  built.standalone = path.join(CANARY_ROOT, "dist/standalone");
  return built;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const built = await buildRuntimeCanary({ baseOnly: process.argv.includes("--base-only") });
  if (process.argv.includes("--out-json")) console.info(JSON.stringify(built));
  else for (const [name, dir] of Object.entries(built)) console.info(`[build-runtime-canary] ${name} → ${path.relative(repoRoot, dir)}`);
}
