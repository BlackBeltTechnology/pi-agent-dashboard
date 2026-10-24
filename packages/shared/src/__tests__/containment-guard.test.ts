/**
 * `containmentAllows` is true only for the exact path a decision was made for
 * (test-plan #E1, #E2, #E3, #X2) and only `containment-gate.ts` builds a `PathDecision` (#E11).
 *
 * See change: codeql-file-containment-barrier.
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";
import { containmentAllows, type PathDecision } from "../containment-guard.js";

const decide = (resolved: string, allowed: boolean, viaGrant = false): PathDecision => ({ allowed, viaGrant, resolved }) as PathDecision;

describe("containmentAllows (#E1 #E2 #E3 #X2)", () => {
  it("allows exactly the decided path", () => {
    expect(containmentAllows(decide("/k/a.txt", true), "/k/a.txt")).toBe(true);
    expect(containmentAllows(decide("/k/a.txt", true, true), "/k/a.txt")).toBe(true);
  });

  it("refuses a different path", () => {
    expect(containmentAllows(decide("/k/a.txt", true), "/k/b.txt")).toBe(false);
  });

  it.each(["/k/a.txt/", "/k/./a.txt", "/k/A.txt", ""])("refuses the spelling variant %j (strict equality only)", (variant) => {
    expect(containmentAllows(decide("/k/a.txt", true), variant)).toBe(false);
  });

  it("refuses when the decision refused, even for its own path", () => {
    expect(containmentAllows(decide("/k/a.txt", false), "/k/a.txt")).toBe(false);
  });

  it("a handler that decides A then asks about B fails closed (no read of B)", () => {
    const readBIfAllowed = (d: PathDecision, b: string): string | null => (containmentAllows(d, b) ? `read ${b}` : null);
    expect(readBIfAllowed(decide("/k/a.txt", true), "/k/b.txt")).toBeNull();
  });
});

// #E11 — a `PathDecision` can only be forged with a cast; confine the cast to the gate.
const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoPackages = path.resolve(here, "..", "..", "..");
const CAST = /as\s+(?:unknown\s+as\s+)?(?:PathDecision|ContainmentDecision)\b/;

function sources(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name === "__tests__" || e.name === "test-support") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sources(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}

describe("only containment-gate.ts constructs a PathDecision (#E11)", () => {
  it("no other non-test source casts to PathDecision / ContainmentDecision", () => {
    const offenders = ["server", "shared"]
      .flatMap((pkg) => sources(path.join(repoPackages, pkg, "src")))
      .filter((f) => CAST.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(repoPackages, f));
    expect(offenders).toEqual(["server/src/access/containment-gate.ts"]);
  });

  it("the pattern catches the double cast", () => {
    expect(CAST.test("x as unknown as PathDecision")).toBe(true);
    expect(CAST.test("x as PathDecision")).toBe(true);
    expect(CAST.test("const p = path as string")).toBe(false);
  });
});
