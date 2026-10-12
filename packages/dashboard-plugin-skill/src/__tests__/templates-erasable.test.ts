/**
 * The dashboard server loads plugin server TypeScript with the strip-only
 * native loader, so every scaffold template must be erasable: no `enum`,
 * runtime `namespace`, or constructor parameter properties, and type-only
 * imports written as `import type`.
 *
 * See change: strip-only-native-ts-loader (task 4.3).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "templates");
const templates = readdirSync(dir).filter((f) => /\.tsx?(\.tmpl)?$/.test(f));

describe("scaffold templates are erasable TypeScript", () => {
  it("finds the templates", () => {
    expect(templates.length).toBeGreaterThan(3);
  });

  it.each(templates)("%s has no non-erasable syntax", (name) => {
    const src = readFileSync(path.join(dir, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/^\s*(export\s+)?(declare\s+)?(const\s+)?enum\s/m);
    expect(src).not.toMatch(/^\s*(export\s+)?(declare\s+)?namespace\s/m);
    expect(src).not.toMatch(/constructor\s*\([^)]*\b(public|private|protected|readonly)\s/);
  });
});
