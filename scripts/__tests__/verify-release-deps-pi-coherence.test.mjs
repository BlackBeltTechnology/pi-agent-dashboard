/**
 * pi pin coherence gate: the SIX single-source pi-version pins (server dep
 * range, `piCompatibility.minimum`, `piCompatibility.recommended`, the
 * docker/Dockerfile global-install pin, the pnpm-workspace.yaml override, and
 * the checker's own `minVersion`) MUST resolve to one normalized version.
 * Drives the exported checkPiPinCoherence fn with fixtures (importing the
 * module must not run the CLI).
 *
 * See change: update-pi-core-0-85-adopt-apis (test-plan #E1/#E2/#E3).
 */
import { describe, expect, it } from "vitest";
import { checkPiPinCoherence } from "../verify-release-deps.mjs";

const V = "0.85.1";
const serverPkg = (dep, recommended, minimum = recommended) => ({
  dependencies: { "@earendil-works/pi-coding-agent": dep },
  piCompatibility: { recommended, minimum },
});
const dockerfile = (pin) =>
  `RUN npm install -g @earendil-works/pi-coding-agent@${pin} openspec \\`;
const workspace = (pin) =>
  `overrides:\n  "@earendil-works/pi-coding-agent": ${pin}\n`;
const check = (pkg, dock, ws, checker = V) => checkPiPinCoherence(pkg, dock, ws, checker);

describe("checkPiPinCoherence — six governed pins", () => {
  it("E8: coherent six-pin fixture passes", () => {
    expect(check(serverPkg(`^${V}`, V), dockerfile(V), workspace(V))).toBeNull();
  });

  it("E10: differing syntaxes for the same version pass (normalized compare)", () => {
    // ^0.85.1 / ~0.85.1 / 0.85.1 / @0.85.1 all floor to 0.85.1
    expect(check(serverPkg(`~${V}`, V), dockerfile(V), workspace(V))).toBeNull();
  });

  it("E9: a drifted recommended fails and names it", () => {
    const err = check(serverPkg(`^${V}`, "0.84.4"), dockerfile(V), workspace(V));
    expect(err).toBeTruthy();
    expect(err).toContain("drift");
    expect(err).toContain("piCompatibility.recommended");
  });

  it("E9b: a drifted Dockerfile pin fails and names it", () => {
    const err = check(serverPkg(`^${V}`, V), dockerfile("0.84.4"), workspace(V));
    expect(err).toBeTruthy();
    expect(err).toContain("docker/Dockerfile");
  });

  it("E3: a lagging minimum fails and names it specifically", () => {
    const err = check(serverPkg(`^${V}`, V, "0.78.0"), dockerfile(V), workspace(V));
    expect(err).toBeTruthy();
    expect(err).toContain("piCompatibility.minimum");
    expect(err).toContain("0.78.0");
  });

  it("a stale pnpm-workspace override fails and names it", () => {
    const err = check(serverPkg(`^${V}`, V), dockerfile(V), workspace("0.84.4"));
    expect(err).toBeTruthy();
    expect(err).toContain("pnpm-workspace.yaml overrides");
  });

  it("a stale checker minVersion fails and names it", () => {
    const err = check(serverPkg(`^${V}`, V), dockerfile(V), workspace(V), "0.84.4");
    expect(err).toBeTruthy();
    expect(err).toContain("verify-release-deps.mjs minVersion");
  });

  it("missing a governed pin is reported", () => {
    expect(check(serverPkg(`^${V}`, V), "no pin here", workspace(V))).toContain("missing");
    expect(check(serverPkg(`^${V}`, V), dockerfile(V), "no override here")).toContain("missing");
  });
});
