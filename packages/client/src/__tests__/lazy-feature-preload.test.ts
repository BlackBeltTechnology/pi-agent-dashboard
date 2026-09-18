/**
 * Build guard: the cold-landing document must NOT reference the terminal
 * (`@xterm/*`) or rich diff-viewer (`@git-diff-view/*`) chunks — in either their
 * JS (entry script + `modulepreload`) or their CSS (`stylesheet`) form — while
 * still emitting both feature families as separately loadable artifacts.
 *
 * A manual chunk is not a lazy boundary: before this change Vite emitted
 * `modulepreload` for `xterm-*.js` / `diff-*.js` and `stylesheet` for
 * `xterm-*.css` / `diff-*.css` in `index.html`, so every cold landing paid for
 * them. The guard is build-conditional and skips when no production build is
 * present (matching `eml-bundle-exclusion.test.ts`); CI builds first.
 *
 * Matcher anchoring (D5): D1 splits npm `diff` into a `jsdiff` chunk. The
 * patterns are anchored `/^(xterm|diff)-/` so `jsdiff-<hash>.js` never trips
 * them. A substring test would false-fail on the split.
 *
 * See change: add-lazy-terminal-diff-bootstrap (test-plan E1–E4, design D5).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, "../../dist");
const assetsDir = path.join(distDir, "assets");
const indexHtmlPath = path.join(distDir, "index.html");

/** Anchored feature-chunk matcher — NOT a substring test (D5). */
const FEATURE_CHUNK_RE = /^(?:xterm|diff)-/;

function readIndexHtml(): string | null {
  if (!existsSync(indexHtmlPath)) return null;
  return readFileSync(indexHtmlPath, "utf8");
}

/** Collect the `href`/`src` of every tag matching `pattern` (global regex). */
function collect(html: string, pattern: RegExp): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(pattern)) out.push(m[1]);
  return out;
}

const basenameOf = (href: string): string => href.split("/").pop() ?? "";

describe("lazy feature bootstrap — cold-landing preload guard (D5)", () => {
  it("E1: landing document preloads no xterm/diff JS chunk", () => {
    const html = readIndexHtml();
    if (!html) return; // no build output — CI builds first
    const entry = collect(html, /<script[^>]+type="module"[^>]+src="([^"]+)"/gi);
    const preloads = collect(html, /<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/gi);
    const offenders = [...entry, ...preloads].map(basenameOf).filter((b) => FEATURE_CHUNK_RE.test(b));
    expect(offenders, `feature JS chunk(s) referenced by the landing document: ${offenders.join(", ")}`).toEqual([]);
  });

  it("E2: landing document stylesheet-links no xterm/diff CSS", () => {
    const html = readIndexHtml();
    if (!html) return;
    const links = collect(html, /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/gi);
    const offenders = links.map(basenameOf).filter((b) => FEATURE_CHUNK_RE.test(b));
    expect(offenders, `feature stylesheet(s) linked by the landing document: ${offenders.join(", ")}`).toEqual([]);
  });

  it("E3: both feature families still emit as JS and CSS assets (existence backstop)", () => {
    if (!existsSync(assetsDir)) return;
    const assets = readdirSync(assetsDir);
    const required: ReadonlyArray<readonly [string, RegExp]> = [
      ["xterm-*.js", /^xterm-.*\.js$/],
      ["diff-*.js", /^diff-.*\.js$/],
      ["xterm-*.css", /^xterm-.*\.css$/],
      ["diff-*.css", /^diff-.*\.css$/],
    ];
    for (const [label, re] of required) {
      expect(assets.some((f) => re.test(f)), `missing emitted feature asset ${label} — the guard would pass vacuously`).toBe(true);
    }
  });

  it("E4: anchored matcher tolerates the D1 `jsdiff` split chunk", () => {
    if (!existsSync(assetsDir)) return;
    const assets = readdirSync(assetsDir);
    // D1 moves npm `diff` to `jsdiff-<hash>.js`. If that chunk exists it MUST
    // NOT be classified as a feature chunk (and, because it stays eager on the
    // chat path, E1 would fail if the matcher were unanchored).
    for (const f of assets.filter((f) => /^jsdiff-/.test(f))) {
      expect(FEATURE_CHUNK_RE.test(f), `${f} wrongly classified as a feature chunk`).toBe(false);
    }
  });

  it("E5: npm `diff` and @git-diff-view land in different chunks (D1)", () => {
    if (!existsSync(assetsDir)) return;
    // A `jsdiff` chunk must exist and be distinct from the `diff-*` chunk(s).
    const jsdiff = readdirSync(assetsDir).filter((f) => /^jsdiff-.*\.js$/.test(f));
    expect(jsdiff.length, "expected a jsdiff-*.js chunk after the D1 split").toBeGreaterThan(0);
    // Both families must still be emitted, and the npm-`diff` chunk must NOT be
    // one of the `diff-*` (git-diff-view) chunks — i.e. the split actually
    // separated them rather than aliasing one chunk name.
    const gitDiffChunks = readdirSync(assetsDir).filter((f) => /^diff-.*\.js$/.test(f));
    expect(gitDiffChunks.length, "expected a diff-*.js (git-diff-view) chunk").toBeGreaterThan(0);
    expect(jsdiff.some((f) => gitDiffChunks.includes(f)), "jsdiff must not be a diff-* chunk").toBe(false);
  });
});
