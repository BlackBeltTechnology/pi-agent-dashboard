/**
 * Repo-level lint: every test that reads a repo source file (`.ts` / `.tsx`)
 * and asserts on its text must say why, with a `@structural-pin <reason>` JSDoc
 * tag. A text assertion on source is a deliberate structural pin or it is a
 * behaviour test written the wrong way round; the tag is the proof someone chose.
 *
 * Detection (deliberately conservative, tuned against `packages/**\/__tests__`):
 *  - the test calls `readFile` / `readFileSync` (or `fs.promises` form), AND
 *  - a `.ts` / `.tsx` string literal sits in a path expression
 *    (`resolve(` / `join(` / `new URL(`) anchored on a module or repo location or a `readdir`+`.endsWith(".ts")` scan, AND
 *  - that literal's file name is NOT written by the same test (`writeFile*` of a
 *    fixture it created is not a source read). Config files (`vitest.*.ts`),
 *    `${…}`-built names and `.tmp-` fixtures are ignored.
 *
 * Out of scope on purpose: reads of docs, JSON, YAML or config files.
 *
 * See change: test-trust-audit (design D4; test-plan E10).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const PACKAGES = path.join(REPO_ROOT, "packages");

const MIN_REASON_CHARS = 10;
/**
 * A path expression counts as a read of REPO source only when it is anchored on a
 * module/repo location (`__dirname`, `here`, `import.meta.*`, `*ROOT`, `*_DIR`, `..`).
 * Paths under a scratch dir (`tmpDir`, `dir`, `repo`, …) are fixtures the test built.
 */
const MODULE_ANCHORED =
  /__dirname|\bhere\b|\bHERE\b|import\.meta\.(?:dirname|url)|\b[A-Za-z_]*(?:ROOT|Root)\b|\b[A-Z_]+_(?:DIR|SRC|PATH)\b|\b(?:engineDir|srcDir|piDir|LIB|lib|CLIENT|SRC|[a-z]+Src)\b|\.\.|["'`](?:src|packages)\//;
const TAG_RE = /@structural-pin[ \t]+([^\n*]*)/g;

function walk(dir: string, out: string[]): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.test\.tsx?$/.test(e.name) && full.split(path.sep).includes("__tests__")) out.push(full);
  }
}

/** Basenames of `.ts`/`.tsx` string literals in a text. */
function tsLiteralsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/["'`]([^"'`\n]*?\.tsx?)["'`]/g)) {
    const base = path.basename(m[1]);
    // Config files (`vitest.*.ts`), `${…}`-built names and `.tmp-` fixtures are not source under test.
    if (/^vitest[.\w-]*\.ts$/.test(base) || base.includes("${") || base.startsWith(".tmp-")) continue;
    out.push(base);
  }
  return out;
}

/** Reads a repo `.ts`/`.tsx` file as text? Exported shape kept testable via the fixtures below. */
export function readsRepoSource(text: string): boolean {
  // Helper-based readers: the extension's guard tests read bridge modules via `readBridgeSource("…ts")`.
  if (/\breadBridgeSource\s*\(\s*["'][^"']*\.tsx?["']/.test(text)) return true;
  if (!/\breadFile(?:Sync)?\s*\(|\.readFile\s*\(/.test(text)) return false;
  const written = new Set<string>();
  for (const m of text.matchAll(/\bwriteFile(?:Sync)?\s*\(/g)) for (const b of tsLiteralsIn(text.slice(m.index, m.index + 300))) written.add(b);
  const pathLiterals: string[] = [];
  for (const m of text.matchAll(/\b(?:resolve|join|URL)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) {
    if (MODULE_ANCHORED.test(m[1])) pathLiterals.push(...tsLiteralsIn(m[1]));
  }
  if (pathLiterals.some((b) => !written.has(b))) return true;
  // Directory scan: `readdir…` + `.endsWith(".ts")` / `/\.tsx?$/` filter feeding readFile.
  const scans = /\breaddir(?:Sync)?\s*\(/.test(text) && (/\.endsWith\(\s*["'`]\.tsx?["'`]/.test(text) || /\\\.tsx?\$\/\.test\(/.test(text));
  return scans;
}

/** Reason texts of every `@structural-pin` tag in a file. */
export function pinReasons(text: string): string[] {
  return [...text.matchAll(TAG_RE)].map((m) => m[1].trim());
}

function offenders(): string[] {
  const files: string[] = [];
  walk(PACKAGES, files);
  const out: string[] = [];
  for (const f of files.sort()) {
    const text = fs.readFileSync(f, "utf8");
    if (!readsRepoSource(text)) continue;
    if (!pinReasons(text).some((r) => r.replace(/\s/g, "").length >= MIN_REASON_CHARS)) out.push(path.relative(REPO_ROOT, f));
  }
  return out;
}

describe("source-reading tests carry @structural-pin (E10)", () => {
  it("flags a source reader and ignores a fixture writer", () => {
    expect(readsRepoSource('const s = readFileSync(resolve(here, "../bridge.ts"), "utf8");')).toBe(true);
    expect(readsRepoSource('writeFileSync(join(d, "a.ts"), "x"); const s = readFileSync(join(d, "a.ts"), "utf8");')).toBe(false);
    expect(readsRepoSource('const s = readFileSync(join(d, "package.json"), "utf8");')).toBe(false);
    expect(readsRepoSource('const s = readBridgeSource("bridge-handlers/lifecycle.ts");')).toBe(true);
    expect(readsRepoSource('readdirSync(d).filter((f) => f.endsWith(".ts")).map((f) => readFileSync(join(d, f), "utf8"));')).toBe(true);
  });

  it("requires a reason of at least 10 non-space characters", () => {
    expect(pinReasons("/** @structural-pin ab */")).toEqual(["ab"]);
    expect(pinReasons("/**\n * @structural-pin registration order is load-bearing\n */")).toEqual(["registration order is load-bearing"]);
    expect(pinReasons("no tag here")).toEqual([]);
  });

  it("every test that reads repo source text has a @structural-pin with a reason", () => {
    const missing = offenders();
    expect(missing, `tests reading source text without \`@structural-pin <reason>\`:\n${missing.join("\n")}`).toEqual([]);
  });
});
