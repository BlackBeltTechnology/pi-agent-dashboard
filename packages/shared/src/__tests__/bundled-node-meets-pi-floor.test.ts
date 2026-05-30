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
 * See change: bump-pi-compat-to-0-75.
 */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";

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
