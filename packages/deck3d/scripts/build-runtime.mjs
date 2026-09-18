/**
 * Build the inlined browser runtime (`dist/runtime.js`) with esbuild.
 * Fixed options, no content hashes — `render` inlines this file verbatim, so
 * the same build + IR + font always produces byte-identical HTML (design D3).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

await build({
  entryPoints: [join(root, "src", "runtime", "index.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  outfile: join(root, "dist", "runtime.js"),
  legalComments: "none",
  logLevel: "info",
});
