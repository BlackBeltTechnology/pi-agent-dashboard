/**
 * `containmentAllows` over decisions × spellings: true only for an allowed decision, byte-equal path and a
 * decided `real` (test-plan #E32). An admitting decision without `real` cannot bind an open, so it fails closed.
 *
 * See change: close-local-listener-and-egress-gaps (D2).
 */
import { describe, expect, it } from "vitest";
import { containmentAllows, type PathDecision } from "../containment-guard.js";

const decide = (resolved: string, allowed: boolean, real?: string): PathDecision =>
  ({ allowed, viaGrant: false, resolved, real }) as PathDecision;

const PATHS = ["/p/a.txt", "/p/b.txt", "/p/a.txt/", "/p/../p/a.txt"];

describe("containmentAllows decision table (#E32)", () => {
  const cases: Array<[string, PathDecision, boolean[]]> = [
    ["allowed /p/a.txt", decide("/p/a.txt", true, "/p/a.txt"), [true, false, false, false]],
    ["refused", decide("/p/a.txt", false), [false, false, false, false]],
    ["dashboard-secret refused", decide("/p/a.txt", false), [false, false, false, false]],
    ["allowed but no decided real (fail closed)", decide("/p/a.txt", true, undefined), [false, false, false, false]],
  ];
  it.each(cases)("%s", (_name, decision, expected) => {
    expect(PATHS.map((p) => containmentAllows(decision, p))).toEqual(expected);
  });
});
