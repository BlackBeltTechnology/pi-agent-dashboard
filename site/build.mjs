#!/usr/bin/env node
/**
 * Assemble site/dist/ — the artifact GitHub Pages uploads.
 *
 *   node build.mjs        (or: npm run build)
 *
 * The site is a hand-written static page, so "build" is a copy with a
 * manifest, not a compile. It still exists as a step for three reasons:
 *   1. `dist/` is what deploy-site.yml uploads; keeping that contract means
 *      the workflow's artifact path and the /app shell copy are untouched.
 *   2. design-scratch/ (236 MB of renders, labs and reference captures) must
 *      never reach the artifact. An explicit allowlist guarantees that far
 *      more reliably than an ignore list.
 *   3. It fails loudly when a referenced asset is missing, instead of
 *      deploying a page with a broken <img> nobody notices.
 */
import { cp, mkdir, rm, readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DIST = join(HERE, "dist");

/** Everything the deployed site consists of. Anything not listed never ships. */
const ENTRIES = [
  "index.html",
  "404.html",
  "field.js",
  "media", // hero film + posters
  "vendor", // three.module.min.js
];

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

for (const entry of ENTRIES) {
  const src = join(HERE, entry);
  if (!existsSync(src)) throw new Error(`build: missing ${entry}`);
  await cp(src, join(DIST, entry), { recursive: true });
}

// public/ is copied to the root, as Astro did: CNAME (the pi-dashboard.dev
// apex binding — losing it takes the custom domain down), favicon, og-card.
for (const name of await readdir(join(HERE, "public"))) {
  await cp(join(HERE, "public", name), join(DIST, name), { recursive: true });
}

// Fail on a reference the artifact cannot satisfy. A missing hero poster or
// favicon is invisible in review and obvious to every visitor.
const html = await readFile(join(DIST, "index.html"), "utf8");
const refs = [...html.matchAll(/(?:src|href)="(?!https?:|#|mailto:)([^"]+)"/g)].map((m) => m[1]);
const broken = [];
for (const ref of new Set(refs)) {
  if (!existsSync(join(DIST, ref.split("?")[0]))) broken.push(ref);
}
if (broken.length) throw new Error(`build: index.html references missing files: ${broken.join(", ")}`);

let bytes = 0;
const walk = async (dir) => {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p);
    else bytes += (await stat(p)).size;
  }
};
await walk(DIST);
console.log(`dist/ ready — ${(bytes / 1024 / 1024).toFixed(1)} MB, ${refs.length} local refs all resolved`);
