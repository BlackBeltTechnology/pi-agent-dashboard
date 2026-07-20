/**
 * T-S1 (test-plan #S1): verify-release-deps openspec floor consistency.
 *
 * The single-source governance guard must FAIL when the extension's
 * `@fission-ai/openspec` floor diverges from the server's, and PASS when they
 * match — no root `overrides`, so the two declaration sites are the source of
 * truth. Drives the exported `checkOpenspecFloorConsistency` rule fn directly
 * with package.json fixtures (importing the module must not run the CLI).
 *
 * See change: provision-openspec-cli-in-sessions.
 */
import { describe, expect, it } from "vitest";
import { checkOpenspecFloorConsistency, floorOf } from "../verify-release-deps.mjs";

const serverPkg = (range) => ({ dependencies: { "@fission-ai/openspec": range } });
const extPkg = (range) => ({ dependencies: { "@fission-ai/openspec": range } });

describe("checkOpenspecFloorConsistency (T-S1)", () => {
  it("passes when server and extension floors match", () => {
    expect(checkOpenspecFloorConsistency(serverPkg("^1.6.0"), extPkg("^1.6.0"))).toBeNull();
    // caret vs tilde vs exact all floor to 1.6.0 — same floor, no drift.
    expect(checkOpenspecFloorConsistency(serverPkg("^1.6.0"), extPkg("~1.6.0"))).toBeNull();
  });

  it("fails, naming the drifted sites, when the extension floor diverges", () => {
    const err = checkOpenspecFloorConsistency(serverPkg("^1.6.0"), extPkg("^1.4.1"));
    expect(err).toBeTruthy();
    expect(err).toContain("floor drift");
    expect(err).toContain("1.6.0"); // server floor named
    expect(err).toContain("1.4.1"); // extension floor named
  });

  it("fails when a site is missing the dependency entirely", () => {
    expect(checkOpenspecFloorConsistency(serverPkg("^1.6.0"), { dependencies: {} })).toContain(
      "missing",
    );
  });

  it("floorOf strips caret/tilde and prerelease suffixes", () => {
    expect(floorOf("^1.6.0")).toBe("1.6.0");
    expect(floorOf("~1.6.0")).toBe("1.6.0");
    expect(floorOf("1.6.0")).toBe("1.6.0");
    expect(floorOf("*")).toBeNull();
  });
});
