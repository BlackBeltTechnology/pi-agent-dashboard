/**
 * Tests for `packages/server/bin/pi-dashboard.mjs` --version short-circuit.
 *
 * Bug B (see openspec/changes/fix-electron-cold-launch-probe-cascade):
 * The wrapper previously resolved jiti BEFORE parsing argv, exiting 1
 * with "cannot find jiti" even for metadata queries like --version.
 * That killed `probeNpmGlobal` in launch-source.ts, which calls
 * `pi-dashboard --version` and rejects null/empty/non-zero responses.
 *
 * Contract enforced by these tests:
 *   - `--version` / `-v` / `version` SHALL print sibling package.json's
 *     `version` to stdout and exit 0, EVEN when jiti is missing.
 *   - Any other subcommand (start, status, no args) SHALL preserve the
 *     pre-fix behaviour: exit 1 with "cannot find jiti" install hint
 *     when the wrapper can't resolve jiti.
 *   - When sibling package.json is unreadable / malformed, the short
 *     circuit MUST NOT silently succeed with an empty string — it
 *     SHALL fall through to the existing jiti-resolve path.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const wrapperPath = path.resolve(here, "..", "..", "bin", "pi-dashboard.mjs");
const sibPkgJson = path.resolve(here, "..", "..", "package.json");

beforeAll(() => {
  if (!existsSync(wrapperPath)) throw new Error(`Wrapper missing at ${wrapperPath}`);
  if (!existsSync(sibPkgJson))   throw new Error(`Sibling package.json missing at ${sibPkgJson}`);
});

const expectedVersion = JSON.parse(readFileSync(sibPkgJson, "utf-8")).version as string;

/**
 * Copy the wrapper + a chosen package.json into an isolated tmp dir with
 * NO node_modules adjacency. createRequire from there cannot resolve
 * jiti, so the jiti-miss path is exercised.
 */
function makeIsolatedWrapper(pkgJsonContent: string | null): { wrapper: string; cleanup: () => void } {
  const tmp = mkdtempSync(path.join(tmpdir(), "pi-dashboard-cli-version-"));
  // Wrapper has to live at .../bin/pi-dashboard.mjs because it computes
  // sibling package.json as `../package.json` relative to itself.
  const binDir = path.join(tmp, "bin");
  cpSync(path.dirname(wrapperPath), binDir, { recursive: true });
  if (pkgJsonContent !== null) {
    writeFileSync(path.join(tmp, "package.json"), pkgJsonContent);
  }
  const wrapper = path.join(binDir, "pi-dashboard.mjs");
  return { wrapper, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}

// The jiti-miss cases (b)/(d)/(d') pin PI_DASHBOARD_TS_LOADER=jiti: the native
// loader is the default, and a missing jiti is fatal only under that opt-in.
// See change: fix-appimage-cold-boot-latency.
describe("bin/pi-dashboard.mjs --version short-circuit (Bug B)", () => {
  it("(a) --version with no jiti reachable → exit 0, stdout = pkg.version", () => {
    const fakePkg = JSON.stringify({ name: "pi-dashboard-test", version: "9.9.9-isolated" });
    const { wrapper, cleanup } = makeIsolatedWrapper(fakePkg);
    try {
      const result = spawnSync(process.execPath, [wrapper, "--version"], {
        encoding: "utf-8",
        env: { ...process.env, NODE_PATH: "" },
        timeout: 10_000,
      });
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("9.9.9-isolated");
      expect(result.stderr).not.toContain("cannot find jiti");
    } finally {
      cleanup();
    }
  });

  it("(a') -v shortform behaves identically", () => {
    const fakePkg = JSON.stringify({ name: "pi-dashboard-test", version: "1.2.3-short" });
    const { wrapper, cleanup } = makeIsolatedWrapper(fakePkg);
    try {
      const result = spawnSync(process.execPath, [wrapper, "-v"], {
        encoding: "utf-8",
        env: { ...process.env, NODE_PATH: "" },
        timeout: 10_000,
      });
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("1.2.3-short");
    } finally {
      cleanup();
    }
  });

  it("(b) start with no jiti reachable → exit 1, stderr contains install-hint", () => {
    const fakePkg = JSON.stringify({ name: "pi-dashboard-test", version: "9.9.9-isolated" });
    const { wrapper, cleanup } = makeIsolatedWrapper(fakePkg);
    try {
      const result = spawnSync(process.execPath, [wrapper, "start"], {
        encoding: "utf-8",
        env: { ...process.env, NODE_PATH: "", PI_DASHBOARD_TS_LOADER: "jiti" },
        timeout: 10_000,
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("pi-dashboard: cannot find jiti");
      expect(result.stderr).toContain("npm install -g @earendil-works/pi-coding-agent");
      expect(result.stdout.trim()).not.toBe("9.9.9-isolated");
    } finally {
      cleanup();
    }
  });

  it("(c) --version on healthy install → exit 0 without re-execing cli.ts", () => {
    const result = spawnSync(process.execPath, [wrapperPath, "--version"], {
      encoding: "utf-8",
      timeout: 15_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(expectedVersion);
    // No cli.ts startup banner — proves no re-exec.
    expect(result.stdout).not.toMatch(/Dashboard server/i);
    expect(result.stderr).not.toContain("cannot find jiti");
  }, 30_000);

  it("(d) --version with corrupt sibling package.json → falls through to jiti path", () => {
    const { wrapper, cleanup } = makeIsolatedWrapper("{ this is not valid json");
    try {
      const result = spawnSync(process.execPath, [wrapper, "--version"], {
        encoding: "utf-8",
        env: { ...process.env, NODE_PATH: "", PI_DASHBOARD_TS_LOADER: "jiti" },
        timeout: 10_000,
      });
      // Fall-through: jiti unreachable in tmp dir → legacy install-hint fires.
      // Critically: NOT a silent exit 0 with empty version.
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("pi-dashboard: cannot find jiti");
    } finally {
      cleanup();
    }
  });

  it("(d') --version with missing sibling package.json → falls through", () => {
    const { wrapper, cleanup } = makeIsolatedWrapper(null);
    try {
      const result = spawnSync(process.execPath, [wrapper, "--version"], {
        encoding: "utf-8",
        env: { ...process.env, NODE_PATH: "", PI_DASHBOARD_TS_LOADER: "jiti" },
        timeout: 10_000,
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("pi-dashboard: cannot find jiti");
    } finally {
      cleanup();
    }
  });
});
