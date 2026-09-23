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
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

/**
 * test-plan E28 — the gate is what actually holds the repo's OWN six pins
 * together at HEAD, not just synthetic fixtures.
 *
 * The floor asserted here is `0.86.1` (the version that bundles the `meta`
 * OAuth provider) rather than an exact equality: the requirement is
 * "`^0.86.1` or later, and every other pin agrees", so a later lockstep bump
 * must NOT have to edit this test. What it forbids is a pin below the floor or
 * any disagreement between the six surfaces.
 * See change: delegate-provider-oauth-to-pi-ai (D3).
 */
describe("repo HEAD — six governed pins agree at or above the meta floor", () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8");
  const FLOOR = "0.86.1";

  const serverPkg = JSON.parse(read("packages/server/package.json"));
  const dockerfileText = read("docker/Dockerfile");
  const workspaceYamlText = read("pnpm-workspace.yaml");
  const checkerText = read("scripts/verify-release-deps.mjs");

  const checkerPin = checkerText.match(
    /dep:\s*"@earendil-works\/pi-coding-agent"[\s\S]*?minVersion:\s*"([^"]+)"/,
  )?.[1];

  const floorOf = (value) => String(value ?? "").match(/(\d+\.\d+\.\d+)/)?.[1];

  it("the six-pin coherence gate passes on the real tree", () => {
    expect(
      checkPiPinCoherence(serverPkg, dockerfileText, workspaceYamlText, checkerPin),
    ).toBeNull();
  });

  it("every governed pin resolves at or above the floor", () => {
    const dockerPin = dockerfileText.match(
      /@earendil-works\/pi-coding-agent@(\S+)/,
    )?.[1];
    const overridePin = workspaceYamlText.match(
      /^\s*"@earendil-works\/pi-coding-agent":\s*(\S+)/m,
    )?.[1];

    const pins = {
      "server dep": serverPkg.dependencies["@earendil-works/pi-coding-agent"],
      "piCompatibility.minimum": serverPkg.piCompatibility.minimum,
      "piCompatibility.recommended": serverPkg.piCompatibility.recommended,
      "docker/Dockerfile": dockerPin,
      "pnpm-workspace.yaml override": overridePin,
      "verify-release-deps.mjs minVersion": checkerPin,
    };

    for (const [name, value] of Object.entries(pins)) {
      const floor = floorOf(value);
      expect(floor, `${name} must declare a version`).toBeTruthy();
      expect(
        floor.localeCompare(FLOOR, undefined, { numeric: true }) >= 0,
        `${name} = "${value}" is below the ${FLOOR} floor`,
      ).toBe(true);
    }
  });

  it("the checker reaches the coherence gate at all (not vacuous)", () => {
    // A drifted fixture MUST fail, so a green run above cannot be vacuous.
    const drifted = checkPiPinCoherence(
      { ...serverPkg, piCompatibility: { ...serverPkg.piCompatibility, minimum: "0.78.0" } },
      dockerfileText,
      workspaceYamlText,
      checkerPin,
    );
    expect(drifted).toBeTruthy();
    expect(drifted).toContain("piCompatibility.minimum");
  });
});
