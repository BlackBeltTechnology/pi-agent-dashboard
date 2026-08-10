/**
 * S1 — bogus send is a compile error (type-negative).
 * Triple: send() with bad type/missing field · tsc --noEmit · compile error
 * (test-plan #S1).
 *
 * Strategy: `src/__tests__/fixtures/bad-send.ts` guards each malformed payload
 * with `@ts-expect-error`. `tsc` reports an error for an UNUSED directive, so a
 * clean compile proves every bad payload is rejected AND the well-formed ones
 * compile. We assert `tsc -p tsconfig.fixtures.json` exits 0.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, "..", "..");

describe("typed send is compile-checked (S1)", () => {
  it("the type-negative fixture compiles (every bad send is rejected)", () => {
    const tscBin = path.resolve(PKG_ROOT, "..", "..", "node_modules", ".bin", "tsc");
    expect(() =>
      execFileSync(tscBin, ["-p", "tsconfig.fixtures.json"], {
        cwd: PKG_ROOT,
        stdio: "pipe",
      }),
    ).not.toThrow();
  }, 60_000);
});
