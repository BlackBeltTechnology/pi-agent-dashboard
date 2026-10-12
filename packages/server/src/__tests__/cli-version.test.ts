/**
 * Tests for `packages/server/bin/pi-dashboard.mjs` --version short-circuit.
 *
 * Bug B (see openspec/changes/fix-electron-cold-launch-probe-cascade):
 * The wrapper previously resolved its TS loader BEFORE parsing argv, exiting 1
 * with "cannot find jiti" even for metadata queries like --version.
 * That killed `probeNpmGlobal` in launch-source.ts (since deleted), which
 * called `pi-dashboard --version` and rejected null/empty/non-zero responses.
 *
 * Contract enforced by these tests:
 *   - `--version` / `-v` / `version` SHALL print sibling package.json's
 *     `version` to stdout and exit 0, EVEN when the native loader is unresolvable.
 *   - Any other subcommand (start, status, no args) SHALL exit 1 with the
 *     corrupted-install hint when the wrapper can't resolve the native
 *     TypeScript loader.
 *   - When sibling package.json is unreadable / malformed, the short
 *     circuit MUST NOT silently succeed with an empty string — it
 *     SHALL fall through to the loader-resolve path.
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import url from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

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
 * NO node_modules adjacency. The shared package (and so the native register
 * module) cannot be resolved from there, so the loader-miss path is exercised.
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

// The loader-miss cases (b)/(d)/(d') assert the corrupted-install hint; there is
// no jiti or tsx fallback. See change: strip-only-native-ts-loader.
describe("bin/pi-dashboard.mjs --version short-circuit (Bug B)", () => {
  it("(a) --version with no native loader reachable → exit 0, stdout = pkg.version", () => {
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
      expect(result.stderr).not.toContain("cannot find the native TypeScript loader");
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

  it("(b) start with no native loader reachable → exit 1, stderr contains the corrupted-install hint", () => {
    const fakePkg = JSON.stringify({ name: "pi-dashboard-test", version: "9.9.9-isolated" });
    const { wrapper, cleanup } = makeIsolatedWrapper(fakePkg);
    try {
      const result = spawnSync(process.execPath, [wrapper, "start"], {
        encoding: "utf-8",
        env: { ...process.env, NODE_PATH: "" },
        timeout: 10_000,
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("pi-dashboard: cannot find the native TypeScript loader");
      expect(result.stderr).toContain("npm install -g @blackbelt-technology/pi-agent-dashboard");
      expect(result.stderr).not.toMatch(/jiti|tsx/i);
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
    expect(result.stderr).not.toContain("cannot find the native TypeScript loader");
  }, 30_000);

  it("(d) --version with corrupt sibling package.json → falls through to the loader-resolve path", () => {
    const { wrapper, cleanup } = makeIsolatedWrapper("{ this is not valid json");
    try {
      const result = spawnSync(process.execPath, [wrapper, "--version"], {
        encoding: "utf-8",
        env: { ...process.env, NODE_PATH: "" },
        timeout: 10_000,
      });
      // Fall-through: loader unreachable in tmp dir → corrupted-install hint fires.
      // Critically: NOT a silent exit 0 with empty version.
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("pi-dashboard: cannot find the native TypeScript loader");
    } finally {
      cleanup();
    }
  });

  it("(d') --version with missing sibling package.json → falls through", () => {
    const { wrapper, cleanup } = makeIsolatedWrapper(null);
    try {
      const result = spawnSync(process.execPath, [wrapper, "--version"], {
        encoding: "utf-8",
        env: { ...process.env, NODE_PATH: "" },
        timeout: 10_000,
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("pi-dashboard: cannot find the native TypeScript loader");
    } finally {
      cleanup();
    }
  });
});
