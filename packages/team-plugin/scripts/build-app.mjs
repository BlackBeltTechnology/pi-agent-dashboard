#!/usr/bin/env node
/**
 * Build the team SPA (`packages/team-app`) and copy it into this package's
 * `dist/app/`, which the server entry serves at `/apps/team/` (D14). Runs as
 * `prepack` (so the npm tarball + Electron bundle carry the app) and from the
 * root `npm run build`. See change: add-team-plugin.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(here, "..");
const appDir = path.resolve(pluginDir, "..", "team-app");
const dest = path.join(pluginDir, "dist", "app");

if (!existsSync(path.join(appDir, "package.json"))) {
  // Published tarball consumers have no sibling workspace; the prebuilt dist/app ships instead.
  console.log("[team-plugin] team-app workspace not present — keeping existing dist/app");
  process.exit(0);
}

const require = createRequire(path.join(appDir, "package.json"));
const { build } = await import(pathToFileURL(require.resolve("vite")).href);
process.chdir(appDir);
try {
  await build({ root: appDir, logLevel: "warn" });
} catch (err) {
  console.error("[team-plugin] team-app build failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}
const out = path.join(appDir, "dist");
if (!existsSync(path.join(out, "index.html"))) {
  console.error("[team-plugin] team-app build produced no index.html");
  process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
mkdirSync(path.dirname(dest), { recursive: true });
cpSync(out, dest, { recursive: true });
console.log(`[team-plugin] app copied to ${path.relative(process.cwd(), dest)}`);
