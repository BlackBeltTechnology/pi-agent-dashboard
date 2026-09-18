/**
 * Build-output guard for change `add-lazy-terminal-diff-bootstrap` (design D5).
 *
 * Two directions, both required:
 *   1. the cold-landing `dist/index.html` must NOT preload (modulepreload) or
 *      stylesheet-link the `xterm-*` or `diff-*` chunks — JS **and** CSS;
 *   2. those chunks must still EXIST in `dist/assets` — otherwise a rename
 *      makes direction 1 pass vacuously forever.
 *
 * Matcher semantics are anchored (`/^diff-/`), NOT substring: D1 introduces a
 * `jsdiff` chunk whose name CONTAINS `diff`. A substring test would false-fail
 * immediately and the natural "fix" would be to weaken the assertion.
 *
 * Scope limit (stated, not hidden): this is a DOCUMENT-level guard. It proves
 * the chunks are not statically reachable from the entry; it cannot observe a
 * runtime dynamic import fired during landing. That property is covered by the
 * L3 activation specs instead.
 *
 * Skips cleanly when no build is present, matching
 * `eml-bundle-exclusion.test.ts` — the CI pipeline runs `npm run build` first.
 * See change: add-lazy-terminal-diff-bootstrap (test-plan E1–E6, E8).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, "../..");
const distDir = path.join(clientRoot, "dist");
const assetsDir = path.join(distDir, "assets");
const indexHtmlPath = path.join(distDir, "index.html");

/** Anchored chunk-name matchers — pinned by design D5. Do not loosen. */
const XTERM_RE = /^xterm-/;
const DIFF_RE = /^diff-/;

const hasBuild = (): boolean => existsSync(indexHtmlPath) && existsSync(assetsDir);

function readIndexHtml(): string {
  return readFileSync(indexHtmlPath, "utf8");
}

/** All attribute values for `<tag ... attr="value">` occurrences. */
function attrValues(html: string, tag: string, attr: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "gi"))) {
    const a = new RegExp(`${attr}="([^"]+)"`, "i").exec(m[0]);
    if (a) out.push(a[1]);
  }
  return out;
}

/** `script[type=module]` src values (the entry chunk). */
function entryScriptSrcs(html: string): string[] {
  return [...html.matchAll(/<script\b[^>]*>/gi)]
    .map((m) => m[0])
    .filter((t) => /type="module"/i.test(t))
    .map((t) => /src="([^"]+)"/i.exec(t)?.[1])
    .filter((v): v is string => typeof v === "string");
}

const basename = (href: string): string => path.basename(href);

const assetFiles = (re: RegExp): string[] => readdirSync(assetsDir).filter((f) => re.test(f) && f.endsWith(".js"));

describe("cold landing excludes the terminal + diff chunks (design D5)", () => {
  it("E1 · entry script + every modulepreload link are neither xterm-* nor diff-*", () => {
    if (!hasBuild()) return; // no build output — CI builds first
    const html = readIndexHtml();
    const eagerJs = [...entryScriptSrcs(html), ...attrValues(html, "link", "href").filter((h) => h.startsWith("/assets/"))];
    // Narrow to the JS side: modulepreload + the entry script.
    const preloads = [...html.matchAll(/<link\b[^>]*>/gi)]
      .map((m) => m[0])
      .filter((t) => /rel="modulepreload"/i.test(t))
      .map((t) => /href="([^"]+)"/i.exec(t)?.[1])
      .filter((v): v is string => typeof v === "string");
    const jsRefs = [...entryScriptSrcs(html), ...preloads];

    expect(jsRefs.length).toBeGreaterThan(0);
    expect(eagerJs.length).toBeGreaterThan(0);

    const offenders = jsRefs.filter((h) => XTERM_RE.test(basename(h)) || DIFF_RE.test(basename(h)));
    expect(offenders).toEqual([]);
  });

  it("E2 · no stylesheet link resolves to xterm-* or diff-*", () => {
    if (!hasBuild()) return;
    const html = readIndexHtml();
    const stylesheets = [...html.matchAll(/<link\b[^>]*>/gi)]
      .map((m) => m[0])
      .filter((t) => /rel="stylesheet"/i.test(t))
      .map((t) => /href="([^"]+)"/i.exec(t)?.[1])
      .filter((v): v is string => typeof v === "string");

    expect(stylesheets.length).toBeGreaterThan(0);
    const offenders = stylesheets.filter((h) => XTERM_RE.test(basename(h)) || DIFF_RE.test(basename(h)));
    expect(offenders).toEqual([]);
  });

  it("E3 · existence backstop — xterm + diff chunks are still emitted, JS and CSS", () => {
    if (!hasBuild()) return;
    const files = readdirSync(assetsDir);
    const has = (re: RegExp, ext: string) => files.some((f) => re.test(f) && f.endsWith(ext));

    // Both directions: a rename that stops emitting these must FAIL here rather
    // than let E1/E2 pass vacuously.
    expect(files.filter((f) => /^xterm-.*\.js$/.test(f)).length).toBeGreaterThan(0);
    expect(files.filter((f) => /^diff-.*\.js$/.test(f)).length).toBeGreaterThan(0);
    expect(files.filter((f) => /^xterm-.*\.css$/.test(f)).length).toBeGreaterThan(0);
    expect(files.filter((f) => /^diff-.*\.css$/.test(f)).length).toBeGreaterThan(0);

    expect(has(XTERM_RE, ".js")).toBe(true);
    expect(has(DIFF_RE, ".js")).toBe(true);
  });

  it("E4 · the matcher is ANCHORED — the jsdiff chunk does not trip /^diff-/", () => {
    if (!hasBuild()) return;
    const jsdiff = assetFiles(/^jsdiff-/);
    // The split exists…
    expect(jsdiff.length).toBeGreaterThan(0);
    // …and its name would be a false positive under a substring matcher, which
    // this guard must not use.
    for (const f of jsdiff) {
      expect(DIFF_RE.test(f)).toBe(false);
      expect(f.includes("diff")).toBe(true); // proves the anchor is doing work
    }
  });
});

describe("D1 chunk partition (test-plan E5, E8)", () => {
  it("E5 · npm `diff` and `@git-diff-view/*` land in DIFFERENT emitted chunks", () => {
    if (!hasBuild()) return;
    // `includeFileHeaders` is an npm-`diff` runtime string literal; the bare
    // package name survives in @git-diff-view's bundle. Both are genuine
    // markers (verified against the emitted output).
    const NPM_DIFF_MARK = "includeFileHeaders";
    const GIT_DIFF_VIEW_MARK = "git-diff-view";

    const jsChunks = readdirSync(assetsDir).filter((f) => f.endsWith(".js"));
    const withNpmDiff = jsChunks.filter((f) => readFileSync(path.join(assetsDir, f), "utf8").includes(NPM_DIFF_MARK));
    const withGitDiffView = jsChunks.filter((f) => readFileSync(path.join(assetsDir, f), "utf8").includes(GIT_DIFF_VIEW_MARK));

    expect(withNpmDiff.length).toBeGreaterThan(0);
    expect(withGitDiffView.length).toBeGreaterThan(0);
    // Disjoint sets ⇒ different chunks.
    expect(withNpmDiff.filter((f) => withGitDiffView.includes(f))).toEqual([]);
    // And specifically: the pinned `jsdiff` chunk carries npm `diff`.
    expect(withNpmDiff.some((f) => /^jsdiff-/.test(f))).toBe(true);
    // …while the `diff` chunk carries git-diff-view and NOT npm `diff`.
    expect(withGitDiffView.some((f) => /^diff-/.test(f))).toBe(true);
    expect(withNpmDiff).not.toContain(withGitDiffView.find((f) => /^diff-/.test(f)));
  });

  it("E6 · the emitted chunk graph has no static import cycle", () => {
    if (!hasBuild()) return;
    // Rollup's circular-chunk warning IS a chunk-level static cycle. Read every
    // emitted chunk's STATIC imports (minified form: `from"./x.js"`) and assert
    // the graph is acyclic. Dynamic `import("./x.js")` is intentionally ignored —
    // that is the lazy boundary this change adds, not a cycle.
    const jsChunks = readdirSync(assetsDir).filter((f) => f.endsWith(".js"));
    const graph = new Map<string, string[]>();
    for (const f of jsChunks) {
      const src = readFileSync(path.join(assetsDir, f), "utf8");
      const deps = new Set<string>();
      for (const m of src.matchAll(/from"\.\/([^"]+\.js)"/g)) deps.add(m[1]);
      for (const m of src.matchAll(/from'\.\/([^']+\.js)'/g)) deps.add(m[1]);
      graph.set(f, [...deps].filter((d) => jsChunks.includes(d)));
    }

    // Report the actual cycle for a readable failure.
    const cycles: string[] = [];
    for (const [a, deps] of graph) {
      for (const b of deps) {
        if ((graph.get(b) ?? []).includes(a)) cycles.push(`${a} <-> ${b}`);
      }
    }
    expect(cycles).toEqual([]);
  });

  it("E8 · the chat-path module graph reaches npm `diff` and no @git-diff-view", () => {
    // Static-import walk over SOURCE files: `lineDelta.ts` must keep using the
    // cheap npm `diff` package and must never reach the heavy viewer family.
    const entry = path.join(clientRoot, "src/lib/util/lineDelta.ts");
    expect(existsSync(entry)).toBe(true);

    const seen = new Set<string>();
    const bare = new Set<string>();
    const walk = (file: string): void => {
      if (seen.has(file) || !existsSync(file)) return;
      seen.add(file);
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s+"([^"]+)"/g)) {
        const spec = m[1];
        if (spec.startsWith(".")) {
          // TS-ESM: `./x.js` on disk is `./x.ts`.
          const resolved = path.resolve(path.dirname(file), spec).replace(/\.js$/, "");
          for (const cand of [`${resolved}.ts`, `${resolved}.tsx`, resolved]) {
            if (existsSync(cand) && !cand.includes("node_modules")) {
              walk(cand);
              break;
            }
          }
        } else {
          bare.add(spec);
        }
      }
    };
    walk(entry);

    expect(bare.has("diff")).toBe(true);
    expect([...bare].filter((s) => s.startsWith("@git-diff-view"))).toEqual([]);
  });
});
