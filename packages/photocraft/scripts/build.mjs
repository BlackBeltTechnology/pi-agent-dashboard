/**
 * Build the publishable CLI bundle (`dist/photocraft.js`) with esbuild.
 *
 * `bin/pi-photocraft` runs it for a published install, where `tsx` is absent.
 * `@blackbelt-technology/*` workspace code (shared platform/exec, nano-banana
 * path helpers) is raw TypeScript and MUST be bundled; the explicit `external`
 * list names real npm dependencies only (there are none today).
 * Run from `prepack`. See change: add-photocraft-plugin.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [join(root, "src", "bin", "photocraft.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  external: [],
  outfile: join(root, "dist", "photocraft.js"),
  banner: { js: "#!/usr/bin/env node" },
  legalComments: "none",
  logLevel: "info",
});
