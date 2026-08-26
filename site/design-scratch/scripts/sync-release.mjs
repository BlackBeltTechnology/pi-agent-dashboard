#!/usr/bin/env node
/**
 * Rewrite the download block in site/index.html from the latest GitHub release.
 *
 *   node site/design-scratch/scripts/sync-release.mjs            # write
 *   node site/design-scratch/scripts/sync-release.mjs --check    # exit 1 if stale
 *
 * The site is a static page, so unlike the Astro version there is no build-time
 * fetch. This script is the replacement for it: run after cutting a release
 * (or in CI on `release: published`) and commit the diff. `--check` is the
 * guard that stops the page quietly advertising a version that no longer
 * exists -- it makes staleness a failing command instead of a thing nobody
 * notices until a user clicks a 404.
 *
 * Assets are matched by SHAPE (extension + arch suffix), never by a hardcoded
 * filename: electron-builder's names carry the version, so any literal match
 * would break on the very release this script exists to track.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const REPO = "BlackBeltTechnology/pi-agent-dashboard";
const PAGE = fileURLToPath(new URL("../../index.html", import.meta.url));
const CHECK = process.argv.includes("--check");

/** Same units as the Astro site's formatBytes(): binary, one decimal. */
const fmt = (n) =>
  n < 1024
    ? `${n} B`
    : n < 1024 ** 2
      ? `${(n / 1024).toFixed(1)} KB`
      : n < 1024 ** 3
        ? `${(n / 1024 ** 2).toFixed(1)} MB`
        : `${(n / 1024 ** 3).toFixed(2)} GB`;

const MATCH = {
  "mac-arm64": (n) => n.endsWith("arm64.dmg"),
  "mac-x64": (n) => n.endsWith("x64.dmg"),
  "linux-appimage-x64": (n) => n.endsWith("x64.AppImage"),
  "linux-appimage-arm64": (n) => n.endsWith("arm64.AppImage"),
  "linux-deb-x64": (n) => n.endsWith("amd64.deb"),
  "linux-deb-arm64": (n) => n.endsWith("arm64.deb"),
  "win-exe-x64": (n) => /Setup.*x64\.exe$/.test(n),
  "win-exe-arm64": (n) => /Setup.*arm64\.exe$/.test(n),
  "win-zip-x64": (n) => n.endsWith("win32-x64.zip"),
  "win-zip-arm64": (n) => n.endsWith("win32-arm64.zip"),
};

const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
  headers: { accept: "application/vnd.github+json" },
});
if (!res.ok) {
  console.error(`GitHub API ${res.status} ${res.statusText}`);
  process.exit(2); // distinct from 1: a network failure is not a stale page
}
const rel = await res.json();
// .blockmap files sit next to the real artifacts and end in the same suffixes;
// they are update deltas, not downloads, and must never win a match.
const assets = rel.assets.filter((a) => !a.name.endsWith(".blockmap") && !a.name.endsWith(".yml"));

let html = await readFile(PAGE, "utf8");
const before = html;
const missing = [];

for (const [key, test] of Object.entries(MATCH)) {
  const asset = assets.find((a) => test(a.name));
  if (!asset) {
    missing.push(key);
    continue;
  }
  // Anchor is matched by its data-asset key, then href and the trailing size
  // <span> are rewritten in place. Labels are left alone: they are editorial
  // ("Apple Silicon · DMG"), not data.
  const re = new RegExp(
    `(<a[^>]*data-asset="${key}"[^>]*href=")[^"]*("[^>]*>\\s*<span[^>]*>[^<]*</span>\\s*<span[^>]*>)[^<]*(</span>)`,
  );
  if (!re.test(html)) {
    missing.push(`${key} (no anchor in page)`);
    continue;
  }
  html = html.replace(re, `$1${asset.browser_download_url}$2${fmt(asset.size)}$3`);
}

const date = new Date(rel.published_at).toLocaleDateString("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
html = html
  .replace(/(<span class="ver" data-rel-tag>)[^<]*(<\/span>)/, `$1${rel.tag_name}$2`)
  .replace(/(<span class="when" data-rel-date>)[^<]*(<\/span>)/, `$1Released ${date}$2`)
  .replace(/(<a data-rel-notes href=")[^"]*(")/, `$1${rel.html_url}$2`);

if (missing.length) console.warn(`no asset matched: ${missing.join(", ")}`);

if (CHECK) {
  const stale = html !== before;
  console.log(stale ? `STALE — site/index.html is behind ${rel.tag_name}` : `up to date (${rel.tag_name})`);
  process.exit(stale ? 1 : 0);
}

await writeFile(PAGE, html);
console.log(`site/index.html <- ${rel.tag_name} (${assets.length} assets, ${missing.length} unmatched)`);
