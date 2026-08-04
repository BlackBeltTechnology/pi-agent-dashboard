/**
 * TypeBox 1.3.7 (#7243) removed Type.Base/Awaited/Promise/AsyncIterator/
 * Iterator/Options and Value.Mutate. Audit: the extension source uses NONE of
 * them, so the bump is verify-not-migrate. This test fails if a removed API is
 * (re)introduced into packages/extension/src.
 *
 * See change: update-pi-core-0-83-adopt-apis (test-plan #E11).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(fileURLToPath(new URL("../", import.meta.url)));
const REMOVED = [
  /\bType\.Base\b/,
  /\bType\.Awaited\b/,
  /\bType\.Promise\b/,
  /\bType\.AsyncIterator\b/,
  /\bType\.Iterator\b/,
  /\bType\.Options\b/,
  /\bValue\.Mutate\b/,
];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      out.push(...tsFiles(p));
    } else if (name.endsWith(".ts")) {
      out.push(p);
    }
  }
  return out;
}

describe("removed TypeBox 1.3.7 API audit", () => {
  it("E11: no removed TypeBox API appears in packages/extension/src", () => {
    const offenders: string[] = [];
    for (const f of tsFiles(SRC)) {
      const text = readFileSync(f, "utf-8");
      for (const re of REMOVED) {
        if (re.test(text)) offenders.push(`${f} :: ${re}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
