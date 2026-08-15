/**
 * Architectural guard: the engine must stay zero-dependency and portable.
 *
 * The estimator has to run inside a project with no dashboard installed. The
 * moment `src/engine/` imports a workspace package — or the telemetry adapter —
 * that portability is gone, silently, and nothing else in the suite would catch
 * it. Hence a test rather than a convention.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, test } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const engineDir = join(here, "..", "engine");

/**
 * Every module specifier in a source file.
 *
 * The excluded characters are load-bearing:
 *   `;` stops a match spanning past the end of an import statement;
 *   `=` rejects assignments, because a real `import`/`export ... from` clause
 *       never contains one, whereas prose like
 *       `export const SRC = 'see "x" from "the docs"'` does.
 * Both cases occur in defaults.ts, which is dense with provenance notes.
 */
function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  let match: RegExpExecArray | null;

  const statement = /^[ \t]*(?:import|export)\b[^;=]*?\bfrom\s+["']([^"']+)["']/gm;
  while ((match = statement.exec(source)) !== null) specifiers.push(match[1]);

  // side-effect imports: `import "x";`
  const bare = /^[ \t]*import\s+["']([^"']+)["']/gm;
  while ((match = bare.exec(source)) !== null) specifiers.push(match[1]);

  return specifiers;
}

const engineFiles = readdirSync(engineDir).filter((f) => f.endsWith(".ts"));

describe("engine purity", () => {
  test("the engine directory is non-empty (guard would pass vacuously otherwise)", () => {
    expect(engineFiles.length).toBeGreaterThan(5);
  });

  test("the specifier scanner actually finds imports and ignores prose", () => {
    // Guards the guard: a scanner that silently matched nothing would make every
    // purity assertion below pass vacuously.
    const found = importSpecifiers(readFileSync(join(engineDir, "estimate.ts"), "utf8"));
    expect(found.length).toBeGreaterThan(3);
    expect(found.every((s) => s.startsWith("./") || s.startsWith("node:"))).toBe(true);

    const prose = 'import { a } from "./real.js";\nexport const NOTE = \'see "agent" from "the docs"\';';
    expect(importSpecifiers(prose)).toEqual(["./real.js"]);
  });

  for (const file of engineFiles) {
    test(`${file} imports nothing outside the engine`, () => {
      const source = readFileSync(join(engineDir, file), "utf8");
      for (const specifier of importSpecifiers(source)) {
        const isRelativeSibling = specifier.startsWith("./");
        const isNodeBuiltin = specifier.startsWith("node:");
        expect(
          isRelativeSibling || isNodeBuiltin,
          `${file} imports "${specifier}" — the engine must depend only on ./siblings and node: builtins, ` +
            "otherwise it stops working in a project without the dashboard installed",
        ).toBe(true);
      }
    });
  }

  test("no engine module reaches into telemetry, server or client", () => {
    for (const file of engineFiles) {
      const source = readFileSync(join(engineDir, file), "utf8");
      for (const specifier of importSpecifiers(source)) {
        expect(/telemetry|server|client|dashboard-plugin/.test(specifier), `${file} → ${specifier}`).toBe(false);
      }
    }
  });
});
