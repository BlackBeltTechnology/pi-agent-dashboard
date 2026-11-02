/**
 * E10 / E15 / E16 (slim-windows-install-file-count): textual contracts of the
 * canonical `resources/server` layout — workspace source ships ONCE, under
 * `node_modules/@blackbelt-technology/<pkg>`.
 *
 * Pure text/regex assertions over build scripts and shipped launch helpers; no
 * runtime. The runtime half is asserted on the BUILT bundle in CI
 * (`assert-bundle-layout.mjs`, E8) and by the plugin-load gate (X2).
 *
 * See change: slim-windows-install-file-count (design D2).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const electronRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...p: string[]) => readFileSync(path.join(electronRoot, ...p), "utf8");

describe("bundle-server.mjs ordering (E10)", () => {
  const src = read("scripts", "bundle-server.mjs");
  const at = (needle: string) => {
    const i = src.indexOf(needle);
    expect(i, `marker missing in bundle-server.mjs: ${needle}`).toBeGreaterThanOrEqual(0);
    return i;
  };

  it("release-lock install+audit → materialize → web copy → drop packages/<dir> → prune → keyring GO/NO-GO", () => {
    const order = [
      at("await installFromReleaseLock("),
      at("workspace symlink(s) under @blackbelt-technology/"),
      at("Materialized pi-dashboard-web into"),
      at("dropWorkspaceCopies(SERVER_BUNDLE"),
      at("pruneBundle(SERVER_BUNDLE"),
      at("checkKeyringBundle({"),
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("the release-lock audit (which needs the packages/<dir> link targets) runs inside the install step", () => {
    const fn = src.slice(src.indexOf("async function releaseLockInstall"));
    expect(fn).toContain("auditInstalledTree(");
  });

  it("no longer carries its own node_modules prune walker", () => {
    expect(src).not.toContain("walkAndPrune(NM");
  });
});

describe("manual launch helpers (E15)", () => {
  const norm = (text: string) => text.replace(/\\/g, "/");
  for (const file of ["start-server.sh", "start-server.ps1", "start-server.cmd", "README.md"]) {
    it(`${file} names the node_modules server cli, never packages/server`, () => {
      const text = norm(read("scripts", "server-launch-helpers", file));
      expect(text).toContain("node_modules/@blackbelt-technology/pi-dashboard-server/src/cli.ts");
      expect(text).not.toContain("packages/server/src/cli.ts");
    });
  }
});

/**
 * E16: no code reads a workspace package from the removed `resources/server/packages/<dir>`
 * copy. Scope: the shell, its build scripts, the extension, and the Electron e2e specs.
 * Ignored: `__tests__` fixtures (they pin the NEGATIVE), comment-only lines, and the two
 * harnesses below that boot the `--source-only` intermediate, where `packages/<dir>` is
 * the ONLY copy (no install has run, so no node_modules copy exists yet).
 */
describe("no reader of the removed server/packages copy (E16)", () => {
  const repoRoot = path.resolve(electronRoot, "..", "..");
  const ROOTS = ["packages/electron/src", "packages/electron/scripts", "packages/extension/src", "tests/e2e-electron"];
  const SOURCE_ONLY_HARNESSES = new Set([
    "packages/electron/scripts/test-server-launch.sh",
    "packages/electron/scripts/test-electron-install.sh",
  ]);
  const LEFTOVER = [/server[/\\]+packages[/\\]+(server|extension|shared)\b/, /"server",\s*"packages"/];

  function* walk(dir: string): Generator<string> {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "__tests__" || name === "out") continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) yield* walk(full);
      else if (/\.(ts|tsx|mjs|cjs|js|sh|ps1|cmd)$/.test(name)) yield full;
    }
  }

  it("finds zero leftover readers", () => {
    const hits: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(path.join(repoRoot, root))) {
        const rel = path.relative(repoRoot, file).split(path.sep).join("/");
        if (SOURCE_ONLY_HARNESSES.has(rel)) continue;
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (/^\s*(\/\/|\*|\/\*|#|rem\b)/.test(line)) return;
            if (LEFTOVER.some((re) => re.test(line))) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
          });
      }
    }
    expect(hits).toEqual([]);
  });
});
