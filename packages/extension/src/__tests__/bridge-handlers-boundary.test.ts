/**
 * Import boundary of the modules extracted from `bridge.ts` (test-plan E6).
 *
 * `bridge-handlers/*` receive everything through the per-incarnation instance object; none may
 * import the bridge entry point (directly or as `./bridge.js`). A cycle through the entry point
 * would make the modules untestable without booting it.
 *
 * See change: test-trust-audit (design D2 boundary rule).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = resolve(import.meta.dirname, "..", "bridge-handlers");

/** Every import / re-export / dynamic-import specifier in a source text. */
function specifiers(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/\b(?:import|export)\b[^"'`;]*?\bfrom\s*["']([^"']+)["']/g)) out.push(m[1]);
  for (const m of source.matchAll(/\bimport\s*["']([^"']+)["']/g)) out.push(m[1]);
  for (const m of source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1]);
  return out;
}

/** Does a specifier written in `bridge-handlers/` resolve to the entry point? */
function reachesEntryPoint(spec: string): boolean {
  return /^(?:\.\.\/|\.\/)+bridge(?:\.[jt]s)?$/.test(spec) && resolve(DIR, spec).replace(/\.[jt]s$/, "").endsWith(`${resolve(DIR, "..")}/bridge`);
}

/**
 * @structural-pin import boundary of the extracted modules: whether one imports the entry point is a code-shape fact, not behaviour
 */
describe("bridge-handlers never import the entry point (E6)", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".ts"));

  it("finds the extracted modules", () => {
    expect(files).toEqual(expect.arrayContaining(["instance.ts", "lifecycle.ts", "dispatch.ts", "forwarders.ts", "ui-prompt-patch.ts"]));
  });

  it.each(files)("%s imports nothing that resolves to bridge.ts", (file) => {
    const specs = specifiers(readFileSync(join(DIR, file), "utf8"));
    expect(specs.filter(reachesEntryPoint)).toEqual([]);
  });

  it("the matcher flags the forms it must (not vacuous)", () => {
    expect(specifiers('import { x } from "../bridge.js";').filter(reachesEntryPoint)).toHaveLength(1);
    expect(specifiers('export * from "../bridge.js";\nconst m = await import("../bridge.js");').filter(reachesEntryPoint)).toHaveLength(2);
    expect(specifiers('import { x } from "../bridge-polling.js";').filter(reachesEntryPoint)).toHaveLength(0);
  });
});
