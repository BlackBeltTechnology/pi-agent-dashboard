/**
 * Repo-level invariant: the Electron-bundled Node version (single
 * source of truth in `packages/electron/scripts/_node-version.sh::
 * BUNDLED_NODE_VERSION`) MUST satisfy the Node floor required by the
 * pi version pinned in `packages/server/package.json::
 * piCompatibility.minimum`.
 *
 * Pi 0.75.0 raised its own Node floor to 22.19; future pi minors may
 * raise it further. This test catches a future bundled-Node downgrade
 * (or pi-floor bump that outruns the bundled Node) at lint time
 * instead of at user-install time.
 *
 * The piMinimum → required Node table is intentionally a literal in
 * this file. When a future change bumps `piCompatibility.minimum`, add
 * a row and update `BUNDLED_NODE_VERSION` together.
 *
 * Also (change raise-node-floor-to-26, test-plan #E14/#E15): the dashboard
 * server floor (root + server `engines.node`) MUST be at or above pi's own
 * `engines.node` lower bound (read from the installed pi), and
 * BUNDLED_NODE_VERSION MUST meet BOTH floors (dashboard server + pi).
 *
 * See change: bump-pi-compat-to-0-75, raise-node-floor-to-26.
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";
import { MIN_PI_SPAWN_NODE, MIN_SERVER_NODE, meetsFloor } from "../node-version.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const NODE_VERSION_SH = path.join(
  REPO_ROOT,
  "packages/electron/scripts/_node-version.sh",
);
const SERVER_PKG_JSON = path.join(
  REPO_ROOT,
  "packages/server/package.json",
);
const ROOT_PKG_JSON = path.join(REPO_ROOT, "package.json");

/** Lower bound of an `engines.node` range string (`>=X.Y.Z …`), or null. */
function enginesFloor(range: string): string | null {
  const m = range.match(/>=\s*v?(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

/** Installed pi's `engines.node` — walked up from the repo root (worktrees share the parent's node_modules). */
function readInstalledPiEngines(): string {
  let dir = REPO_ROOT;
  for (;;) {
    const f = path.join(dir, "node_modules/@earendil-works/pi-coding-agent/package.json");
    if (fs.existsSync(f)) {
      const range = JSON.parse(fs.readFileSync(f, "utf8"))?.engines?.node;
      if (typeof range !== "string") throw new Error(`engines.node missing in ${f}`);
      return range;
    }
    const up = path.dirname(dir);
    if (up === dir) throw new Error("installed @earendil-works/pi-coding-agent not found");
    dir = up;
  }
}

/** Repo-lint core: dashboard floor >= pi floor. Returns a violation message or null. */
function checkFloorVsPi(dashboardRange: string, piRange: string): string | null {
  const dash = enginesFloor(dashboardRange);
  const pi = enginesFloor(piRange);
  if (!dash || !pi) return `unparseable engines range: dashboard "${dashboardRange}", pi "${piRange}"`;
  return meetsFloor(dash, pi) ? null : `dashboard engines floor ${dash} is below pi's engines floor ${pi}`;
}

/** Repo-lint core: bundled Node meets both floors. Returns a violation message or null. */
function checkBundledMeetsFloors(bundled: string, floors: { server: string; pi: string }): string | null {
  for (const [name, floor] of [["dashboard server", floors.server], ["pi", floors.pi]] as const) {
    if (!meetsFloor(bundled, floor)) {
      return `BUNDLED_NODE_VERSION ${bundled} (packages/electron/scripts/_node-version.sh) is below the ${name} floor ${floor}`;
    }
  }
  return null;
}

/** piCompatibility.minimum → minimum Node major.minor required by that pi. */
const PI_MIN_TO_NODE_FLOOR: Record<string, { major: number; minor: number }> = {
  "0.70.0": { major: 22, minor: 18 },
  "0.71.0": { major: 22, minor: 18 },
  "0.72.0": { major: 22, minor: 18 },
  "0.73.0": { major: 22, minor: 18 },
  "0.74.0": { major: 22, minor: 18 },
  "0.75.0": { major: 22, minor: 19 },
  "0.76.0": { major: 22, minor: 19 },
  "0.77.0": { major: 22, minor: 19 },
  "0.78.0": { major: 22, minor: 19 },
  // 0.85.1 continues the 22.19 floor (`engines.node` is unchanged at
  // `>=22.19.0`); the row is required by the EXACT-key lookup, not by a Node
  // move. See change: update-pi-core-0-85-adopt-apis.
  "0.85.1": { major: 22, minor: 19 },
  // 0.86.1 also keeps `engines.node` at `>=22.19.0` — the bump exists for the
  // bundled OAuth provider set (`meta`), not a Node move.
  // See change: delegate-provider-oauth-to-pi-ai.
  "0.86.1": { major: 22, minor: 19 },
  // 1.0.0 keeps `engines.node` at `>=22.19.0` (verified against the published
  // manifest). See change: update-pi-core-1-0-adopt-apis.
  "1.0.0": { major: 22, minor: 19 },
  // 1.1.0 keeps `engines.node` at `>=22.19.0` (verified against the published
  // manifest). See change: update-pi-core-1-1-adopt-apis.
  "1.1.0": { major: 22, minor: 19 },
  // 1.3.0 keeps `engines.node` at `>=22.19.0` (verified against the published
  // manifest). See change: update-pi-core-1-3-adopt-apis.
  "1.3.0": { major: 22, minor: 19 },
};

function parseSemver(v: string): [number, number, number] | null {
  const m = v.trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function readBundledNodeVersion(): string {
  const sh = fs.readFileSync(NODE_VERSION_SH, "utf8");
  const m = sh.match(/^\s*export\s+BUNDLED_NODE_VERSION="([^"]+)"/m);
  if (!m) {
    throw new Error(
      `Could not find BUNDLED_NODE_VERSION in ${NODE_VERSION_SH}`,
    );
  }
  return m[1];
}

function readPiMinimum(): string {
  const pkg = JSON.parse(fs.readFileSync(SERVER_PKG_JSON, "utf8"));
  const min = pkg?.piCompatibility?.minimum;
  if (typeof min !== "string") {
    throw new Error(
      `piCompatibility.minimum missing or not a string in ${SERVER_PKG_JSON}`,
    );
  }
  return min;
}

describe("bundled Node version meets pi-floor Node requirement", () => {
  it("BUNDLED_NODE_VERSION >= required Node for piCompatibility.minimum", () => {
    const bundled = readBundledNodeVersion();
    const piMin = readPiMinimum();
    const bundledParts = parseSemver(bundled);
    expect(
      bundledParts,
      `Could not parse BUNDLED_NODE_VERSION="${bundled}" as semver`,
    ).not.toBeNull();
    const [bMajor, bMinor] = bundledParts as [number, number, number];

    const floor = PI_MIN_TO_NODE_FLOOR[piMin];
    expect(
      floor,
      `No Node-floor entry for piCompatibility.minimum="${piMin}". ` +
        `Add a row to PI_MIN_TO_NODE_FLOOR in this test (and check ` +
        `BUNDLED_NODE_VERSION in _node-version.sh meets the new floor).`,
    ).toBeDefined();

    const ok =
      bMajor > floor.major ||
      (bMajor === floor.major && bMinor >= floor.minor);

    expect(
      ok,
      `Bundled Node v${bMajor}.${bMinor} is below the floor required ` +
        `by pi ${piMin} (Node >= ${floor.major}.${floor.minor}). ` +
        `Bump BUNDLED_NODE_VERSION in ` +
        `packages/electron/scripts/_node-version.sh to at least ` +
        `Node ${floor.major}.${floor.minor}.0.`,
    ).toBe(true);
  });
});

// test-plan #E14
describe("dashboard server floor is at or above pi's engines floor", () => {
  it("root and server engines.node name the Node 26 range", () => {
    expect(JSON.parse(fs.readFileSync(ROOT_PKG_JSON, "utf8")).engines.node).toBe(">=26.0.0 <27");
    expect(JSON.parse(fs.readFileSync(SERVER_PKG_JSON, "utf8")).engines.node).toBe(">=26.0.0");
  });

  it("engines floors equal MIN_SERVER_NODE", () => {
    expect(enginesFloor(JSON.parse(fs.readFileSync(ROOT_PKG_JSON, "utf8")).engines.node)).toBe(MIN_SERVER_NODE);
    expect(enginesFloor(JSON.parse(fs.readFileSync(SERVER_PKG_JSON, "utf8")).engines.node)).toBe(MIN_SERVER_NODE);
  });

  it("the real tree passes against the installed pi's engines.node", () => {
    const piRange = readInstalledPiEngines();
    for (const f of [ROOT_PKG_JSON, SERVER_PKG_JSON]) {
      expect(checkFloorVsPi(JSON.parse(fs.readFileSync(f, "utf8")).engines.node, piRange), f).toBeNull();
    }
  });

  it("fails when a fixture dashboard floor is below pi's 22.19.0", () => {
    expect(checkFloorVsPi(">=22.18.0 <27", ">=22.19.0")).toMatch(/22\.18\.0.*below.*22\.19\.0/);
    expect(checkFloorVsPi(">=26.0.0 <27", ">=22.19.0")).toBeNull();
  });
});

// test-plan #E15
describe("BUNDLED_NODE_VERSION meets both floors", () => {
  const floors = { server: MIN_SERVER_NODE, pi: MIN_PI_SPAWN_NODE };

  it("the real BUNDLED_NODE_VERSION passes", () => {
    expect(checkBundledMeetsFloors(readBundledNodeVersion(), floors)).toBeNull();
  });

  it("passes for v26.x and fails for v24.15.0 naming both versions and _node-version.sh", () => {
    expect(checkBundledMeetsFloors("v26.13.0", floors)).toBeNull();
    const msg = checkBundledMeetsFloors("v24.15.0", floors);
    expect(msg).toContain("v24.15.0");
    expect(msg).toContain("26.0.0");
    expect(msg).toContain("_node-version.sh");
  });
});
