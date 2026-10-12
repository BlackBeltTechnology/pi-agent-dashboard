/**
 * Build the publishable CLI bundle (`dist/nano-banana.js`) with esbuild.
 *
 * `bin/pi-nano-banana` runs it for a published install, where `tsx` is absent.
 * `@blackbelt-technology/*` workspace code is raw TypeScript and MUST be bundled
 * (it cannot be loaded from node_modules at runtime); only real npm dependencies
 * are external. `@the-focus-ai/nano-banana` is an `npx` subprocess, never imported.
 * Run from `prepack`. See change: add-photocraft-plugin.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [join(root, "src", "bin", "nano-banana.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  external: ["@earendil-works/pi-coding-agent", "typebox"],
  outfile: join(root, "dist", "nano-banana.js"),
  legalComments: "none",
  logLevel: "info",
});
