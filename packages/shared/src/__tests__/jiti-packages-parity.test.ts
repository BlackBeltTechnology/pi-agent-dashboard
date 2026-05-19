/**
 * Repo-lint: assert `JITI_PACKAGES` is identical between the two source
 * sites that resolve jiti at process startup.
 *
 *   1. `packages/shared/src/platform/binary-lookup.ts` (canonical, used
 *      by the server-launcher / electron / doctor / cli runtime path).
 *   2. `packages/server/bin/pi-dashboard.mjs` (bin wrapper, runs before
 *      any TS loader is registered so it cannot import the canonical
 *      module and must inline the constant).
 *
 * If these drift, a clean-machine `npm i -g pi-dashboard && pi-dashboard`
 * boots inconsistently: the bin wrapper might accept a jiti spec the
 * cli.ts's daemon respawn rejects (or vice-versa). Caught us once with
 * `@oh-my-pi/jiti` in v0.5.3.
 *
 * The lint is a string-parse rather than an import because the bin
 * wrapper is ESM-not-TS and we want to fail fast even if a future move
 * to a CJS-only environment breaks dynamic import.
 *
 * See change: enable-standalone-npm-install task 7.3.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..", "..", "..", "..");

const BIN_PATH = path.join(REPO_ROOT, "packages/server/bin/pi-dashboard.mjs");
const SHARED_PATH = path.join(REPO_ROOT, "packages/shared/src/platform/binary-lookup.ts");

/**
 * Parse a `const JITI_PACKAGES = [ ... ]` (with optional `export` /
 * `as const`) and return the array of string literals in declared order.
 * Returns `null` if no such declaration is found.
 */
function parseJitiPackagesArray(source: string): string[] | null {
  // Match either:
  //   const JITI_PACKAGES = ["a", "b"];
  //   export const JITI_PACKAGES = ["a", "b"] as const;
  const decl = source.match(
    /(?:export\s+)?const\s+JITI_PACKAGES\s*(?::[^=]+)?=\s*\[([^\]]+)\]/,
  );
  if (!decl) return null;
  const inner = decl[1]!;
  const items: string[] = [];
  // Pull every quoted string in order. Accepts double or single quotes.
  for (const m of inner.matchAll(/['"]([^'"]+)['"]/g)) {
    items.push(m[1]!);
  }
  return items;
}

describe("JITI_PACKAGES parity (binary-lookup.ts ⇔ bin/pi-dashboard.mjs)", () => {
  it("both sites declare the same array in the same order", () => {
    const binSrc = readFileSync(BIN_PATH, "utf-8");
    const sharedSrc = readFileSync(SHARED_PATH, "utf-8");

    const binList = parseJitiPackagesArray(binSrc);
    const sharedList = parseJitiPackagesArray(sharedSrc);

    expect(binList, `JITI_PACKAGES not found in ${BIN_PATH}`).not.toBeNull();
    expect(sharedList, `JITI_PACKAGES not found in ${SHARED_PATH}`).not.toBeNull();

    expect(binList).toEqual(sharedList);
  });

  it("primary lookup is bare \"jiti\" (regression for v0.5.3 fork drift)", () => {
    const binList = parseJitiPackagesArray(readFileSync(BIN_PATH, "utf-8"));
    const sharedList = parseJitiPackagesArray(readFileSync(SHARED_PATH, "utf-8"));
    // Plain "jiti" is what `dependencies.jiti` in packages/server/package.json
    // installs. It MUST be the first candidate or the bin wrapper will look up
    // the wrong package on a clean install.
    expect(binList?.[0]).toBe("jiti");
    expect(sharedList?.[0]).toBe("jiti");
  });

  it("does NOT contain @oh-my-pi/jiti (removed by 2026-05-08-migrate-pi-fork-to-earendil)", () => {
    const binList = parseJitiPackagesArray(readFileSync(BIN_PATH, "utf-8"));
    const sharedList = parseJitiPackagesArray(readFileSync(SHARED_PATH, "utf-8"));
    expect(binList).not.toContain("@oh-my-pi/jiti");
    expect(sharedList).not.toContain("@oh-my-pi/jiti");
  });
});
