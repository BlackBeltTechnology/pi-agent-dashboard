/**
 * Generality gate: the rebuild skills carry no knowledge of a particular analysed application.
 * App knowledge lives in a project-owned adapter profile (`parent: "<built-in>"`), never here.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { PKG } from "./files";

const SKILLS = ["reverse-spec-for-rebuild", "rebuild-package-diagrams"].map((s) => join(PKG, ".pi", "skills", s));
const TEXT = /\.(mjs|js|ts|md|sh|json|css|html)$/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "assets" || n === "node_modules" ? [] : walk(p);
    return TEXT.test(n) && !n.endsWith(".AGENTS.md") ? [p] : [];
  });
}
const files = SKILLS.flatMap(walk).concat(walk(join(PKG, "agents")));
const rel = (p: string) => relative(PKG, p);
const isAdapter = (p: string) => /[\\/]adapters[\\/]/.test(p);

/**
 * Pilot application / customer names, kept as truncated SHA-256 of the lower-cased word with
 * non-alphanumerics removed (this repo is public; the names are not). A line matches when any word,
 * or any two adjacent words joined, hashes into the set (so "foo-bar" and "foo bar" match "foobar").
 */
const NAME_HASHES = new Set([
  "d4e9888d1d0b48f1",
  "71941f8062e16e7f",
  "b056df5af91bf32d",
  "67aec554788a90f0",
  "50e4e766822b4c51",
  "1320eae11fd9a982",
  "b114cb8d493431b0",
]);
const sha = (w: string) => createHash("sha256").update(w).digest("hex").slice(0, 16);
export function namesIn(line: string, hashes: Set<string> = NAME_HASHES): boolean {
  const words = line.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.some((w, i) => hashes.has(sha(w)) || (i > 0 && hashes.has(sha(words[i - 1] + w))));
}
const APP_ENCODINGS = /windows-1250|\bcp1250\b/i;
const APP_CONVENTIONS = /\bCONF\.|\bOpBar\b|\bopbar\b|_STR_|\bangModal\b|\bmodalw\b/;
const APP_TOKENS = { test: (l: string) => namesIn(l) || APP_ENCODINGS.test(l) || APP_CONVENTIONS.test(l) } as RegExp;

function hits(re: RegExp, pick: (p: string) => boolean): string[] {
  return files.filter(pick).flatMap((p) =>
    readFileSync(p, "utf8")
      .split("\n")
      .flatMap((l, i) => (re.test(l) ? [`${rel(p)}:${i + 1}: ${l.trim().slice(0, 100)}`] : [])),
  );
}

describe("rebuild skills are application-neutral", () => {
  it("hashed name check matches single and joined words, case- and punctuation-insensitively", () => {
    const h = new Set([sha("acmecorp"), sha("foobar")]);
    expect(namesIn("built for AcmeCorp today", h)).toBe(true);
    expect(namesIn("the Foo-Bar project", h)).toBe(true);
    expect(namesIn("foo bar", h)).toBe(true);
    expect(namesIn("acme corporation", h)).toBe(false);
  });

  it("no pilot app / customer names or app conventions outside adapters", () => {
    expect(hits(APP_TOKENS, (p) => !isAdapter(p))).toEqual([]);
  });

  it("no template-language attributes handled by non-adapter scripts", () => {
    expect(hits(/["'`]ng-[a-z]|\bng-(click|model|if|repeat|bind)\b/, (p) => !isAdapter(p) && /\.(mjs|js|sh)$/.test(p))).toEqual([]);
  });

  it("built-in adapters are stack-level: no app names and no app file paths", () => {
    const appPath = /["'`](?:\.\.\/)?(?:js|html|conf|css)\/[\w.-]+\.(?:js|htm|html|json|css)\b/;
    expect(hits(APP_TOKENS, isAdapter)).toEqual([]);
    expect(hits(appPath, isAdapter)).toEqual([]);
  });
});
