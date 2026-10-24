/**
 * Build the publishable bundles for `pi-blender`: `dist/blender.js` (CLI + MCP server entry),
 * `dist/host.js` (the disposable Blender host child) and `dist/worker-boot.cjs` (copied verbatim:
 * it runs inside a worker_thread and must stay CommonJS). `bin/pi-blender` runs `dist/blender.js`
 * for a published install, where `tsx` is absent. Workspace code under `@blackbelt-technology/*`
 * is raw TypeScript and is bundled; `external` names real npm dependencies only (none today).
 * Run from `prepack`. See change: add-blender-wasm-mcp.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const common = {
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  external: [],
  legalComments: "none",
  logLevel: "info",
  banner: { js: '#!/usr/bin/env node\nimport { createRequire as __blenderRequire } from "node:module";\nconst require = __blenderRequire(import.meta.url);' },
};

for (const [entry, out] of [
  [join("src", "bin", "blender.ts"), "blender.js"],
  [join("src", "host", "host.ts"), "host.js"],
]) {
  await build({ ...common, entryPoints: [join(root, entry)], outfile: join(root, "dist", out) });
}

mkdirSync(join(root, "dist"), { recursive: true });
copyFileSync(join(root, "src", "host", "worker-boot.cjs"), join(root, "dist", "worker-boot.cjs"));
