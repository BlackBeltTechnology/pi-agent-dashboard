/**
 * Build the publishable CLI bundle (`dist/cli.js`) with esbuild.
 *
 * `bin/deck3d` runs this file directly for a published install, where `tsx` is
 * a devDependency and therefore absent. Fixed options, no content hashes:
 * deterministic output. `packages: "external"` keeps every npm dependency out
 * of the bundle — runtime data (`assets/`, `src/ir/schema.json`,
 * `src/render/template.html`) is read from the package root at runtime via
 * `src/util/paths.ts`, and relative sources are bundled in.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

await build({
  entryPoints: [join(root, "src", "cli.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  packages: "external",
  outfile: join(root, "dist", "cli.js"),
  banner: { js: "#!/usr/bin/env node" },
  legalComments: "none",
  logLevel: "info",
});
