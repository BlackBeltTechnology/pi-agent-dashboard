/**
 * Unit tests for scripts/nightly-verdaccio-publish.mjs (change:
 * add-nightly-verdaccio-build, task 1.4 + scenario 7.1).
 *
 * Asserts the pure decision logic, no network / no npm invocation:
 *   - version-slug format `X.Y.Z-nightly.<8digits>.<7hex>`;
 *   - `<base>` = next patch of the current version;
 *   - the publish SET equals the filesystem non-private workspace set
 *     (so a brand-new workspace is included automatically — scenario 7.1);
 *   - the ordering invariant: every pkg appears AFTER its
 *     @blackbelt-technology/* workspace deps, and the root metapackage is last.
 */

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";
import {
  computeNightlyVersion,
  discoverWorkspaces,
  NIGHTLY_VERSION_RE,
  nextPatch,
  orderPublishSet,
} from "../nightly-verdaccio-publish.mjs";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ROOT_META = "@blackbelt-technology/pi-agent-dashboard";

/** Ground-truth non-private workspace set, computed independently here. */
function fsNonPrivateWorkspaceNames() {
  const names = [];
  const packagesDir = path.join(REPO_ROOT, "packages");
  for (const e of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const pj = path.join(packagesDir, e.name, "package.json");
    if (!fs.existsSync(pj)) continue;
    const raw = JSON.parse(fs.readFileSync(pj, "utf8"));
    if (typeof raw.name === "string" && raw.private !== true) names.push(raw.name);
  }
  const root = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
  );
  if (root.private !== true) names.push(root.name);
  return names;
}

describe("nextPatch", () => {
  it("bumps the patch component", () => {
    expect(nextPatch("0.6.1")).toBe("0.6.2");
    expect(nextPatch("1.2.9")).toBe("1.2.10");
    expect(nextPatch("0.6.1-rc.1")).toBe("0.6.2"); // ignores prerelease
  });
  it("rejects a non-SemVer input", () => {
    expect(() => nextPatch("latest")).toThrow();
  });
});

describe("computeNightlyVersion", () => {
  it("emits X.Y.Z-nightly.<8digits>.<7hex>", () => {
    const v = computeNightlyVersion("0.6.2", "20260115", "abcdef1234567");
    expect(v).toBe("0.6.2-nightly.20260115.abcdef1");
    expect(v).toMatch(NIGHTLY_VERSION_RE);
  });
  it("strips dashes from an ISO date and truncates the sha to 7", () => {
    const v = computeNightlyVersion("1.0.0", "2026-01-15", "0123456789abcdef");
    expect(v).toBe("1.0.0-nightly.20260115.0123456");
    expect(v).toMatch(NIGHTLY_VERSION_RE);
  });
  it("the slug composed from the live version matches the shape", () => {
    const current = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
    ).version;
    const v = computeNightlyVersion(nextPatch(current), "20260115", "abc1234");
    expect(v).toMatch(NIGHTLY_VERSION_RE);
  });
});

describe("discoverWorkspaces / orderPublishSet", () => {
  const workspaces = discoverWorkspaces(REPO_ROOT);
  const order = orderPublishSet(workspaces);

  it("publish set equals the non-private workspace set", () => {
    const expected = new Set(fsNonPrivateWorkspaceNames());
    const actual = new Set(order);
    expect(actual).toEqual(expected);
    expect(order.length).toBe(expected.size);
  });

  it("has no duplicates", () => {
    expect(new Set(order).size).toBe(order.length);
  });

  it("publishes the root metapackage LAST", () => {
    expect(order[order.length - 1]).toBe(ROOT_META);
  });

  it("orders every package after its @blackbelt-technology/* workspace deps", () => {
    const pos = new Map(order.map((n, i) => [n, i]));
    for (const w of workspaces) {
      for (const dep of w.scopedDeps) {
        if (!pos.has(dep)) continue; // external / non-published dep — skip
        expect(
          pos.get(dep),
          `${dep} must publish before ${w.name}`,
        ).toBeLessThan(pos.get(w.name));
      }
    }
  });

  it("scenario 7.1: a synthetic new workspace is included + correctly ordered", () => {
    const synthetic = {
      name: "@blackbelt-technology/pi-dashboard-brand-new",
      dir: "brand-new",
      scopedDeps: ["@blackbelt-technology/pi-dashboard-shared"],
    };
    const withNew = orderPublishSet([...workspaces, synthetic]);
    expect(withNew).toContain(synthetic.name);
    const pos = new Map(withNew.map((n, i) => [n, i]));
    expect(pos.get("@blackbelt-technology/pi-dashboard-shared")).toBeLessThan(
      pos.get(synthetic.name),
    );
    expect(withNew[withNew.length - 1]).toBe(ROOT_META);
  });
});
