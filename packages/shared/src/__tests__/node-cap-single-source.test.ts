/**
 * Repo-lint — the Node engines-cap arithmetic lives in exactly ONE place.
 *
 * The `server-startup-node-version-guard` spec's single-source contract says
 * the cap is encoded once, in `packages/shared/src/node-version.ts`
 * (`isOutOfEnginesRange`), mirrored only by root `package.json#engines.node`.
 * A stray `major >= 26` re-implementation in another module would silently
 * keep refusing a Node major the manifest now accepts.
 *
 * PATTERN, defined mechanically rather than as the prose "engines-cap
 * arithmetic": a line matching `/major\s*>=\s*2\d/`. Two engineers writing a
 * regex from prose would not converge; this one is exact.
 *
 * SCOPE: `packages/*​/src/**` EXCLUDING `__tests__/`. The exclusion is
 * LOAD-BEARING — this file states both `major >= 26` and `major >= 27` in its
 * own assertions, so scanning tests would match the scanner itself and the lint
 * would pass vacuously.
 *
 * COVERAGE LIMIT: this catches CODE only. Prose like `At/above the cap (>=27)`
 * carries no `major` token and will NOT match (covered by the doc-comment edit
 * in task 2.3), and the `Required: >=22.19.0 <27` message literal is a string
 * (covered by `node-cap-message-matches-engines.test.ts`, test-plan #E10).
 *
 * See change: fix-pi-install-node26-and-omit-dev-build (test-plan #E5).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..", "..");
const PACKAGES_DIR = path.join(REPO_ROOT, "packages");

/** The sole file permitted to encode the engines-cap major comparison. */
const CAP_SOURCE = "packages/shared/src/node-version.ts";

/** Mechanical definition of "engines-cap arithmetic". */
const CAP_ARITHMETIC_RE = /major\s*>=\s*(2\d)/g;

const SKIP_DIRS = new Set([
  "__tests__",
  "node_modules",
  "dist",
  "build",
  "test-support",
]);

function* walk(dir: string): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      yield* walk(path.join(dir, e.name));
    } else if (e.isFile() && /\.(ts|tsx|mts|cts|mjs|cjs|js)$/.test(e.name)) {
      yield path.join(dir, e.name);
    }
  }
}

/** Every `packages/<pkg>/src` directory, tests excluded by `walk`. */
function* packageSrcFiles(): Generator<string> {
  for (const pkg of fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue;
    const src = path.join(PACKAGES_DIR, pkg.name, "src");
    if (!fs.existsSync(src)) continue;
    yield* walk(src);
  }
}

function collectCapHits(): Array<{ file: string; major: string }> {
  const hits: Array<{ file: string; major: string }> = [];
  for (const abs of packageSrcFiles()) {
    const rel = path.relative(REPO_ROOT, abs).split(path.sep).join("/");
    const content = fs.readFileSync(abs, "utf-8");
    for (const m of content.matchAll(CAP_ARITHMETIC_RE)) {
      hits.push({ file: rel, major: m[1] });
    }
  }
  return hits;
}

describe("node engines-cap arithmetic is single-source", () => {
  it("only node-version.ts compares a Node major against the cap", () => {
    const strays = collectCapHits()
      .filter((h) => h.file !== CAP_SOURCE)
      .map((h) => `${h.file} (major >= ${h.major})`);

    expect(
      strays,
      "Engines-cap arithmetic must live only in " +
        `${CAP_SOURCE}::isOutOfEnginesRange. Stray comparisons found:\n  ` +
        `${strays.join("\n  ")}\n\n` +
        "Import `isOutOfEnginesRange` / `isUsableNodeVersion` from " +
        "`@blackbelt-technology/pi-dashboard-shared/node-version.js` instead of " +
        "re-implementing the range.",
    ).toEqual([]);
  });

  it("the single source encodes the current cap (27), not a stale one", () => {
    const majors = collectCapHits()
      .filter((h) => h.file === CAP_SOURCE)
      .map((h) => h.major);

    expect(
      majors.length,
      `Expected the engines cap comparison in ${CAP_SOURCE}; found none. ` +
        "Did isOutOfEnginesRange stop using `major >= N`? Update this lint's " +
        "CAP_ARITHMETIC_RE together with the predicate.",
    ).toBeGreaterThan(0);

    expect(
      [...new Set(majors)],
      `${CAP_SOURCE} still encodes a stale engines cap. The cap must match ` +
        "root package.json#engines.node (>=22.19.0 <27).",
    ).toEqual(["27"]);
  });
});

// ── Floor literals + non-TS mirrors (change raise-node-floor-to-26, test-plan #E16) ──

/** A quoted floor literal (`"26.0.0"`, `'22.19.0'`, `` `v26.0.0` ``) in code. */
const FLOOR_LITERAL_RE = /["'`]v?(26\.0\.0|22\.19\.0)["'`]/g;

describe("node floor literals are single-source", () => {
  it("only node-version.ts quotes the 26.0.0 / 22.19.0 floor literals", () => {
    const strays: string[] = [];
    let inSource = 0;
    for (const abs of packageSrcFiles()) {
      const rel = path.relative(REPO_ROOT, abs).split(path.sep).join("/");
      const hits = [...fs.readFileSync(abs, "utf-8").matchAll(FLOOR_LITERAL_RE)].map((m) => m[1]);
      if (rel === CAP_SOURCE) inSource = hits.length;
      else for (const h of hits) strays.push(`${rel} ("${h}")`);
    }
    expect(inSource, `${CAP_SOURCE} must define both floor constants`).toBeGreaterThanOrEqual(2);
    expect(
      strays,
      "Import MIN_SERVER_NODE / MIN_PI_SPAWN_NODE from node-version.ts instead of quoting a floor:\n  " +
        strays.join("\n  "),
    ).toEqual([]);
  });
});

describe("Docker base images pin the server Node major", () => {
  // Mirrors not expressible in TS; each pinned here to MIN_SERVER_NODE's major.
  const MIRRORS: Array<[string, RegExp]> = [
    ["docker/Dockerfile", /^FROM node:(\d+)-bookworm-slim\b/m],
    ["packages/electron/scripts/Dockerfile.build", /^ARG NODE_BUILD_IMAGE=node:(\d+)-bookworm-slim$/m],
    ["packages/electron/scripts/test-server-launch.sh", /^FROM node:(\d+)-bookworm-slim$/m],
    ["packages/electron/scripts/_node-version.sh", /^export BUNDLED_NODE_MAJOR="(\d+)"$/m],
    ["scripts/test-standalone-npm-install-docker.sh", /^IMAGE="node:(\d+)-bookworm-slim"$/m],
  ];

  it.each(MIRRORS)("%s names the server Node major", async (rel, re) => {
    const { MIN_SERVER_NODE } = await import("../node-version.js");
    const m = fs.readFileSync(path.join(REPO_ROOT, rel), "utf-8").match(re);
    expect(m, `${rel}: pattern ${re} not found`).not.toBeNull();
    expect(m?.[1]).toBe(MIN_SERVER_NODE.split(".")[0]);
  });
});
