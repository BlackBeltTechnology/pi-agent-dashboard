/**
 * Generality gate: the rebuild skills carry no knowledge of a particular analysed application.
 * App knowledge lives in a project-owned adapter profile (`parent: "<built-in>"`), never here.
 */
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

/** Pilot application / customer names and application conventions that must stay in a profile. */
const APP_NAMES = /\b(plantifier|deltadot|delta-dot|kaizen ?pro|plb|protokon|ivanka|granit)\b|windows-1250|\bcp1250\b/i;
const APP_CONVENTIONS = /\bCONF\.|\bOpBar\b|\bopbar\b|_STR_|\bangModal\b|\bmodalw\b/;
const APP_TOKENS = { test: (l: string) => APP_NAMES.test(l) || APP_CONVENTIONS.test(l) } as RegExp;

function hits(re: RegExp, pick: (p: string) => boolean): string[] {
  return files.filter(pick).flatMap((p) =>
    readFileSync(p, "utf8")
      .split("\n")
      .flatMap((l, i) => (re.test(l) ? [`${rel(p)}:${i + 1}: ${l.trim().slice(0, 100)}`] : [])),
  );
}

describe("rebuild skills are application-neutral", () => {
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
