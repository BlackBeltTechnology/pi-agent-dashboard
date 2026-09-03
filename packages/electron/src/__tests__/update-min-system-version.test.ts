/**
 * The update-stream gate value, asserted BEHAVIOURALLY.
 *
 * Covers test-plan scenarios U2 (below-floor blocked), U3 (at/above-floor
 * admitted), U4 (both inert spellings rejected) and U7 (the shipped client
 * implements the gate).
 *
 * Why behaviourally and not by inspection: `electron-updater`'s
 * `checkIfUpdateSupported` does
 *
 *   try { if (semver.lt(os.release(), minimumSystemVersion)) return false }
 *   catch (e) { logger.warn(...) }
 *   return true
 *
 * so a malformed value THROWS, is caught, and falls through to "update
 * supported". A string-equality test would pass on `"12.0"` / `"21"` while the
 * gate is completely dead. These tests run the same comparator against the
 * same value.
 *
 * See change: upgrade-electron-runtime; design.md Decision 5.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";
// @ts-expect-error — plain .mjs module, no type declarations by design.
import { UPDATE_MINIMUM_SYSTEM_VERSION } from "../../scripts/macos-floor.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

/** Exactly what `checkIfUpdateSupported` does, including the fail-open catch. */
function updateIsSupported(osRelease: string, minimumSystemVersion: string) {
  try {
    if (semver.lt(osRelease, minimumSystemVersion)) return false;
  } catch {
    return true; // ← the fail-open fall-through
  }
  return true;
}

describe("U2: clients below the floor are blocked", () => {
  it.each([
    { darwin: "19.6.0", macos: "10.15 Catalina" },
    { darwin: "20.6.0", macos: "11 Big Sur" },
  ])("Darwin $darwin ($macos) is not offered the update", ({ darwin }) => {
    expect(semver.lt(darwin, UPDATE_MINIMUM_SYSTEM_VERSION)).toBe(true);
    expect(updateIsSupported(darwin, UPDATE_MINIMUM_SYSTEM_VERSION)).toBe(false);
  });
});

describe("U3: clients at or above the floor are admitted", () => {
  it.each([
    { darwin: "21.0.0", macos: "12.0 Monterey — the boundary" },
    { darwin: "21.6.0", macos: "12.7 Monterey" },
    { darwin: "25.0.0", macos: "26" },
  ])("Darwin $darwin ($macos) is still offered the update", ({ darwin }) => {
    // The 21.0.0 case is what a naive `<=` gets wrong.
    expect(semver.lt(darwin, UPDATE_MINIMUM_SYSTEM_VERSION)).toBe(false);
    expect(updateIsSupported(darwin, UPDATE_MINIMUM_SYSTEM_VERSION)).toBe(true);
  });
});

describe("U4: both inert spellings are rejected", () => {
  it.each(["12.0", "21"])(
    "the value %s makes semver.lt throw (gate silently dead)",
    (inert) => {
      expect(() => semver.lt("19.6.0", inert)).toThrow();
      // …and the throw is caught upstream, so Catalina WOULD be offered the
      // update. This is the fail-open trap the shipped value must avoid.
      expect(updateIsSupported("19.6.0", inert)).toBe(true);
    },
  );

  it("the shipped value is a full three-component semver that does NOT throw", () => {
    expect(UPDATE_MINIMUM_SYSTEM_VERSION).toBe("21.0.0");
    expect(semver.valid(UPDATE_MINIMUM_SYSTEM_VERSION)).toBe("21.0.0");
    expect(() => semver.lt("19.6.0", UPDATE_MINIMUM_SYSTEM_VERSION)).not.toThrow();
  });

  it("is a Darwin kernel version, not the marketing version", () => {
    // os.release() returns the Darwin version on macOS, so the marketing
    // scale would be wrong even if it parsed.
    expect(Number(UPDATE_MINIMUM_SYSTEM_VERSION.split(".")[0])).toBe(21);
  });
});

describe("U7: the already-shipped client implements the gate", () => {
  // `checkIfUpdateSupported` must exist in the build ALREADY IN THE FIELD, or
  // the gate reaches nobody.
  const MIN_UPDATER_WITH_GATE = "6.8.0";

  /**
   * `electron-updater` versions resolved by RELEASES ALREADY IN THE FIELD.
   *
   * Recorded here rather than read from the git tag on every run: CI checks out
   * shallow (`fetch-depth: 1`, no tags), so `git show v0.7.0:pnpm-lock.yaml`
   * exits 128 there and the check would ERROR in CI while passing locally in a
   * full clone. A shipped release's lockfile is immutable history, so a
   * recorded value cannot go stale — and the cross-check below re-derives it
   * from the tag whenever the tag IS reachable, so this table cannot silently
   * drift from reality either.
   */
  const SHIPPED_UPDATER_VERSIONS: Record<string, string[]> = {
    "v0.7.0": ["6.8.9"],
  };

  function resolveUpdaterVersions(lockfile: string): string[] {
    // Deduped: pnpm lists a package once bare and once per peer-suffixed
    // variant (`electron-updater@6.8.9(supports-color@8.1.1)`), which are the
    // same resolved version.
    return [
      ...new Set(
        [
          ...lockfile.matchAll(/^\s{2}electron-updater@(\d+\.\d+\.\d+)[(:]/gm),
        ].map((m) => m[1]),
      ),
    ];
  }

  function lockfileAtTag(tag: string): string | null {
    try {
      return execFileSync("git", ["show", `${tag}:pnpm-lock.yaml`], {
        cwd: repoRoot,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      return null; // shallow clone — the tag is not fetched
    }
  }

  it.each(Object.entries(SHIPPED_UPDATER_VERSIONS))(
    "%s shipped an electron-updater that implements checkIfUpdateSupported",
    (_tag, versions) => {
      expect(versions.length).toBeGreaterThan(0);
      for (const v of versions) {
        expect(semver.gte(v, MIN_UPDATER_WITH_GATE)).toBe(true);
      }
    },
  );

  it.each(Object.keys(SHIPPED_UPDATER_VERSIONS))(
    "the recorded %s versions still match the tag's own lockfile (when reachable)",
    (tag) => {
      const lock = lockfileAtTag(tag);
      if (lock === null) {
        // Shallow checkout. The recorded table above still ran, so U7 is not
        // vacuous here — only this drift cross-check is unavailable.
        return;
      }
      expect(resolveUpdaterVersions(lock).sort()).toEqual(
        [...SHIPPED_UPDATER_VERSIONS[tag]].sort(),
      );
    },
  );

  it("the current tree still resolves a gate-capable electron-updater", () => {
    // Read the working-tree lockfile directly — no git, so this works
    // identically in a shallow CI checkout and a full local clone.
    const lock = fs.readFileSync(path.join(repoRoot, "pnpm-lock.yaml"), "utf8");
    const versions = resolveUpdaterVersions(lock);
    expect(versions.length).toBeGreaterThan(0);
    for (const v of versions) {
      expect(semver.gte(v, MIN_UPDATER_WITH_GATE)).toBe(true);
    }
  });
});
