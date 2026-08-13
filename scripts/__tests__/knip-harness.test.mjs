/**
 * Dead-code oracle reproducibility inside the Docker harness (test-plan #H1).
 *
 * What this guards: the harness analysing a DIFFERENT TREE than the host, which
 * silently changes the verdict. It is not hypothetical — the image carried
 * `qa/fixtures` but no knip.json, no tests/, no public/, no .pi/skills, and no
 * playwright.config.ts or .github/, and reported 13 unused files / 233 exports
 * against the host's 10 / 227. A weaker assertion ("it runs", "exits 0") passes
 * happily against that wrong tree and proves nothing.
 *
 * What it deliberately does NOT assert: scalar equality of every class. Measured
 * — the `types` class differs by exactly one (`KbSettingsClaimProps`) between
 * host and container although the file md5s, the identifier's references,
 * typescript 5.9.3 and @types/react 19.2.17 are all identical, and each
 * environment is internally deterministic across repeat runs (host 189,
 * container 188). The only remaining difference is the Node minor (24.15 vs
 * 24.19). Exact cross-environment scalar equality is therefore not a property
 * Knip has, and asserting it would produce a permanently red or Node-pinned
 * gate for no signal.
 *
 * What IS asserted, because it holds and it is the high-signal half:
 *   - the unused-FILES set matches exactly (this is the class the tree shape
 *     actually moves — it went 90 → 10 when the graph was rooted)
 *   - every tree the knip.json entries name is present in the image
 *   - the ratchet passes inside the container
 *
 * Precondition, not a silent skip: this needs a running harness, which ship-it
 * step 3 stands up. `.pi-test-harness.json` is written by docker/test-up.sh.
 *
 * See change: add-knip-dead-code-oracle.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const STATE_FILE = join(REPO_ROOT, ".pi-test-harness.json");
const HARNESS_UP = existsSync(STATE_FILE);
const EXEC_TIMEOUT_MS = 240_000;

const project = () => JSON.parse(readFileSync(STATE_FILE, "utf8")).project;

function execInHarness(command) {
  return execFileSync("docker", ["compose", "-p", project(), "exec", "-T", "pi-dashboard", "bash", "-lc", command], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: EXEC_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Files Knip reports as unused, as a set, from a `--reporter json` payload. */
function unusedFiles(raw) {
  const issues = JSON.parse(raw).issues ?? [];
  return new Set(issues.filter((e) => (e.files ?? []).length > 0).map((e) => e.file));
}

function scanHost() {
  try {
    return execFileSync("npx", ["knip", "--reporter", "json", "--no-progress"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: EXEC_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (err) {
    // Non-zero exit is normal while the baseline is above zero.
    return err.stdout ?? "";
  }
}

describe.skipIf(!HARNESS_UP)("#H1 knip inside the harness", () => {
  let host;
  let container;

  beforeAll(() => {
    host = unusedFiles(scanHost());
    container = unusedFiles(execInHarness("cd /app && npx knip --reporter json --no-progress || true"));
  }, EXEC_TIMEOUT_MS);

  it("reports exactly the same unused files as the host", () => {
    // Set equality both ways: an extra finding means a tree is missing from the
    // image, a missing finding means the image carries something the host does
    // not. Sorted for a readable diff on failure.
    expect([...container].sort()).toEqual([...host].sort());
  });

  it("finds a non-empty result, so the comparison is not two empty sets", () => {
    expect(host.size).toBeGreaterThan(0);
  });

  // Explicit timeouts: each of these shells a whole-workspace scan into the
  // container, well past vitest's 5s default.
  it(
    "passes the ratchet inside the container",
    () => {
      expect(execInHarness("cd /app && node scripts/knip-ratchet.mjs")).toContain("✓ knip-ratchet");
    },
    EXEC_TIMEOUT_MS,
  );

  it(
    "roots every manifest-declared entry inside the container too",
    () => {
      expect(execInHarness("cd /app && node scripts/knip-config.mjs")).toContain("✓ knip-config");
    },
    EXEC_TIMEOUT_MS,
  );

  it("carries every tree the knip.json entries name", () => {
    const present = execInHarness(
      "cd /app && for p in knip.json knip-baseline.json playwright.config.ts .github/workflows " +
        'tests/e2e qa/scripts public/sw.js .pi/skills; do test -e "$p" && echo "OK $p" || echo "MISSING $p"; done',
    );
    expect(present).not.toContain("MISSING");
  });

  it("does NOT carry .pi/settings.json, which pins a host path", () => {
    // Copying it would point container sessions at an absolute host directory.
    expect(execInHarness("cd /app && test -e .pi/settings.json && echo PRESENT || echo ABSENT")).toContain("ABSENT");
  });
});
