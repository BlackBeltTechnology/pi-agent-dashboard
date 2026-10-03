/**
 * pi pin coherence gate: the single-source pi-version pins (server dep
 * range, `piCompatibility.minimum`, `piCompatibility.recommended`, the
 * docker/Dockerfile global-install pin, the pnpm-workspace.yaml override, and
 * the checker's own `minVersion`) MUST resolve to one normalized version.
 * Drives the exported checkPiPinCoherence fn with fixtures (importing the
 * module must not run the CLI).
 *
 * See change: update-pi-core-0-85-adopt-apis (test-plan #E1/#E2/#E3).
 * update-pi-core-1-0-adopt-apis widens the governed set to the pi-ai / pi-tui
 * overrides plus every `@earendil-works` pi peer lower bound and devDependency
 * range in the root + packages/* manifests (test-plan #E4).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkPiPinCoherence, piManifests } from "../verify-release-deps.mjs";

const V = "1.0.0";
const serverPkg = (dep, recommended, minimum = recommended) => ({
  dependencies: { "@earendil-works/pi-coding-agent": dep },
  piCompatibility: { recommended, minimum },
});
const dockerfile = (pin) =>
  `RUN npm install -g @earendil-works/pi-coding-agent@${pin} openspec \\`;
const workspace = (pin, { ai = pin, tui = pin } = {}) =>
  "overrides:\n" +
  `  "@earendil-works/pi-coding-agent": ${pin}\n` +
  `  "@earendil-works/pi-ai": ${ai}\n` +
  `  "@earendil-works/pi-tui": ${tui}\n`;
const check = (pkg, dock, ws, checker = V, manifests) =>
  checkPiPinCoherence(pkg, dock, ws, checker, manifests);
const manifest = (path, pkg) => ({ path, pkg });
const peerPkg = (range, devRange) => ({
  peerDependencies: { "@earendil-works/pi-coding-agent": range },
  peerDependenciesMeta: { "@earendil-works/pi-coding-agent": { optional: true } },
  ...(devRange ? { devDependencies: { "@earendil-works/pi-tui": devRange } } : {}),
});

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

  it("E4: a drifted pi-tui override fails and names it", () => {
    const err = check(serverPkg(`^${V}`, V), dockerfile(V), workspace(V, { tui: "0.98.0" }));
    expect(err).toBeTruthy();
    expect(err).toContain("pnpm-workspace.yaml overrides @earendil-works/pi-tui");
    expect(err).not.toContain("overrides @earendil-works/pi-ai");
  });

  it("E4: a missing pi-ai override is reported", () => {
    const ws = `overrides:\n  "@earendil-works/pi-coding-agent": ${V}\n  "@earendil-works/pi-tui": ${V}\n`;
    const err = check(serverPkg(`^${V}`, V), dockerfile(V), ws);
    expect(err).toContain("missing");
    expect(err).toContain("@earendil-works/pi-ai");
  });

  it("E4: coherent manifests (peer lower bounds + devDeps) pass", () => {
    const manifests = [
      manifest("package.json", peerPkg(`>=${V}`, `^${V}`)),
      manifest("packages/a/package.json", peerPkg(`>=${V}`)),
    ];
    expect(check(serverPkg(`^${V}`, V), dockerfile(V), workspace(V), V, manifests)).toBeNull();
  });

  it("E4: a drifted peer lower bound fails naming exactly that manifest", () => {
    const manifests = [
      manifest("package.json", peerPkg(`>=${V}`)),
      manifest("packages/a/package.json", peerPkg(">=0.86.1")),
    ];
    const err = check(serverPkg(`^${V}`, V), dockerfile(V), workspace(V), V, manifests);
    expect(err).toBeTruthy();
    expect(err).toContain("packages/a/package.json peerDependencies.@earendil-works/pi-coding-agent");
    // only the drifted manifest is named, not the coherent root one
    expect(err.match(/peerDependencies\./g)).toHaveLength(1);
  });

  it("E4: a drifted pi devDependency fails naming the manifest", () => {
    const manifests = [manifest("packages/b/package.json", peerPkg(`>=${V}`, "^0.86.1"))];
    const err = check(serverPkg(`^${V}`, V), dockerfile(V), workspace(V), V, manifests);
    expect(err).toContain("packages/b/package.json devDependencies.@earendil-works/pi-tui");
  });

  it("ungoverned pi-coding-agent scopes are not governed here", () => {
    const pkg = {
      ...peerPkg(`>=${V}`),
      devDependencies: { "@other/pi-coding-agent": ">=0.80.10" },
    };
    const manifests = [manifest("packages/c/package.json", pkg)];
    expect(check(serverPkg(`^${V}`, V), dockerfile(V), workspace(V), V, manifests)).toBeNull();
  });
});

/**
 * test-plan E28 — the gate is what actually holds the repo's OWN pins
 * together at HEAD, not just synthetic fixtures.
 *
 * The floor asserted here is `1.0.0` rather than an exact equality: the
 * requirement is "`^1.0.0` or later, and every other pin agrees", so a later
 * lockstep bump must NOT have to edit this test. What it forbids is a pin below
 * the floor or any disagreement between the governed surfaces.
 * See change: delegate-provider-oauth-to-pi-ai (D3), update-pi-core-1-0-adopt-apis.
 */
describe("repo HEAD — governed pins agree at or above the 1.0.0 floor", () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8");
  const FLOOR = "1.0.0";

  const serverPkg = JSON.parse(read("packages/server/package.json"));
  const dockerfileText = read("docker/Dockerfile");
  const workspaceYamlText = read("pnpm-workspace.yaml");
  const checkerText = read("scripts/verify-release-deps.mjs");

  const checkerPin = checkerText.match(
    /dep:\s*"@earendil-works\/pi-coding-agent"[\s\S]*?minVersion:\s*"([^"]+)"/,
  )?.[1];

  const floorOf = (value) => String(value ?? "").match(/(\d+\.\d+\.\d+)/)?.[1];

  it("the coherence gate passes on the real tree (incl. every manifest)", () => {
    expect(
      checkPiPinCoherence(
        serverPkg,
        dockerfileText,
        workspaceYamlText,
        checkerPin,
        piManifests(repoRoot),
      ),
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
