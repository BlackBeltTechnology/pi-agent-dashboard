/**
 * pi pin coherence gate: the three single-source pi-version pins (server dep
 * range, piCompatibility.recommended, docker/Dockerfile global-install pin) MUST
 * resolve to one normalized version. Drives the exported checkPiPinCoherence fn
 * with fixtures (importing the module must not run the CLI).
 *
 * See change: update-pi-core-0-83-adopt-apis (test-plan #E8-#E10).
 */
import { describe, expect, it } from "vitest";
import { checkPiPinCoherence } from "../verify-release-deps.mjs";

const serverPkg = (dep, recommended) => ({
  dependencies: { "@earendil-works/pi-coding-agent": dep },
  piCompatibility: { recommended },
});
const dockerfile = (pin) => `RUN npm install -g @earendil-works/pi-coding-agent@${pin} openspec \\`;

describe("checkPiPinCoherence (E8-E10)", () => {
  it("E8: coherent pins pass", () => {
    expect(checkPiPinCoherence(serverPkg("^0.83.0", "0.83.0"), dockerfile("0.83.0"))).toBeNull();
  });

  it("E10: differing syntaxes for the same version pass (normalized compare)", () => {
    // ^0.83.0 / 0.83.0 / @0.83.0 all floor to 0.83.0
    expect(checkPiPinCoherence(serverPkg("~0.83.0", "0.83.0"), dockerfile("0.83.0"))).toBeNull();
  });

  it("E9: a drifted recommended fails and names it", () => {
    const err = checkPiPinCoherence(serverPkg("^0.83.0", "0.82.0"), dockerfile("0.83.0"));
    expect(err).toBeTruthy();
    expect(err).toContain("drift");
    expect(err).toContain("piCompatibility.recommended");
  });

  it("E9b: a drifted Dockerfile pin fails and names it", () => {
    const err = checkPiPinCoherence(serverPkg("^0.83.0", "0.83.0"), dockerfile("0.81.1"));
    expect(err).toBeTruthy();
    expect(err).toContain("docker/Dockerfile");
  });

  it("missing a governed pin is reported", () => {
    expect(checkPiPinCoherence(serverPkg("^0.83.0", "0.83.0"), "no pin here")).toContain("missing");
  });
});
