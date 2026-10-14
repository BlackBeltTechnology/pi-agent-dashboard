/**
 * Build the publishable CLI bundles (`dist/craft.js`, `dist/photocraft.js`) with esbuild.
 *
 * `bin/pi-craft` and `bin/pi-photocraft` run them for a published install, where `tsx` is absent.
 * `@blackbelt-technology/*` workspace code (shared platform/exec, nano-banana
 * path helpers) is raw TypeScript and MUST be bundled; the explicit `external`
 * list names real npm dependencies only (there are none today).
 * Run from `prepack`. See change: add-photocraft-plugin, add-craft-apps-core.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

for (const name of ["craft", "photocraft"]) {
  await build({
    entryPoints: [join(root, "src", "bin", `${name}.ts`)],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    external: [],
    outfile: join(root, "dist", `${name}.js`),
    banner: { js: "#!/usr/bin/env node" },
    legalComments: "none",
    logLevel: "info",
  });
}
