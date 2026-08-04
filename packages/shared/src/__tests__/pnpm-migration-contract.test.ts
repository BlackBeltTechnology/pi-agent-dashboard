/**
 * pnpm-migration-contract.test.ts — static contracts for change
 * adopt-pnpm-for-dev-ci. Folds the statically-verifiable automated scenarios
 * from test-plan.md (X3, X5, X6, X7, E8) into repo-lint assertions.
 *
 * NOT covered here (require CI / VM / docker harness): E1/E2/E3/X1 (L2 qa
 * smoke), E5/E6/E7 (electron — verified locally via bundle-server +
 * electron-forge package), X2/X8 (real publish/smoke runs). X4 (full
 * ci-electron.yml installer matrix) passed on a dispatched run.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const WF = path.join(REPO_ROOT, ".github", "workflows");
const read = (p: string) => fs.readFileSync(path.join(REPO_ROOT, p), "utf8");
const readWf = (name: string) => fs.readFileSync(path.join(WF, name), "utf8");

// ── root-script phantom-dep guard (pnpm hoisted ≠ npm accidental hoist) ─────
describe("root scripts/ workspace imports are declared in root package.json", () => {
  // Under npm, an undeclared `@blackbelt-technology/*` import in a root script
  // resolved via accidental hoist to root node_modules. pnpm's hoisted linker
  // only links a workspace package into importers that DECLARE it, so a root
  // script importing an undeclared workspace pkg fails ERR_MODULE_NOT_FOUND
  // (regressed the Windows introspection smoke). See change: adopt-pnpm-for-dev-ci.
  const scriptsDir = path.join(REPO_ROOT, "scripts");
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  const declared = new Set([
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
    // The root metapackage's own name is always resolvable (it IS the repo) —
    // a script naming it (e.g. `nightly-verdaccio-publish.mjs`'s ROOT_META
    // publish-ordering sentinel) is never a pnpm phantom-dep hazard.
    pkg.name,
  ]);
  const importRe = /['"](@blackbelt-technology\/[a-z0-9-]+)(?:\/[^'"]*)?['"]/g;
  const files = fs
    .readdirSync(scriptsDir)
    .filter((f) => /\.(ts|mjs|js|cjs)$/.test(f));
  for (const f of files) {
    it(`scripts/${f} imports only declared workspace packages`, () => {
      const src = fs.readFileSync(path.join(scriptsDir, f), "utf8");
      const missing = new Set<string>();
      for (const m of src.matchAll(importRe)) {
        if (!declared.has(m[1])) missing.add(m[1]);
      }
      if (missing.size) {
        throw new Error(
          `scripts/${f} imports undeclared workspace package(s): ${[...missing].join(", ")}. ` +
            "Add them to root package.json devDependencies — pnpm's hoisted linker " +
            "only links declared deps to root node_modules (npm hoisted them by accident). " +
            "See change: adopt-pnpm-for-dev-ci.",
        );
      }
    });
  }
});

// ── E4: single lockfile hygiene (post-§9 swap) ────────────────────────────
describe("E4 — pnpm-lock.yaml is the single committed lockfile", () => {
  it("pnpm-lock.yaml is present at the repo root", () => {
    expect(fs.existsSync(path.join(REPO_ROOT, "pnpm-lock.yaml"))).toBe(true);
  });
  it("package-lock.json is absent at the repo root", () => {
    expect(fs.existsSync(path.join(REPO_ROOT, "package-lock.json"))).toBe(false);
  });
});

// ── X3: runtime installs stay npm (Column C guard) ────────────────────────
// The shipped server / electron app installs pi-core on END-USER machines via
// `npm install` (npm ships in Node). These MUST NOT be rewritten to pnpm.
// `"pnpm".includes("npm")` is true, so npm-presence uses a word boundary.
describe("X3 — runtime pi-core installs stay npm (never pnpm)", () => {
  // `recovery-server.ts` is deliberately NOT in this list. It DOES reference
  // pnpm, but only behind an explicit workspace probe: `detectPackageManager`
  // returns "pnpm" solely when `pnpm-workspace.yaml` / `pnpm-lock.yaml` sits at
  // the resolved repo root, and `suggestedReinstallCommand` consults it ONLY
  // for the `monorepo` layout. The end-user layouts (`npm-global`, `electron`,
  // and the default fallback) still return npm, so the Column C premise — "runs
  // on an end-user machine, where pnpm is not present" — does not hold for that
  // reference. Blanket-guarding it would force `npm install` onto a pnpm
  // hoisted workspace, which is exactly the tree-corrupting bug
  // `recovery-server-respect-package-manager` fixed.
  const columnC = [
    "packages/server/src/pi/pi-core-updater.ts",
    "packages/server/src/pi/pi-core-checker.ts",
    "packages/electron/src/lib/update-checker.ts",
  ];
  for (const file of columnC) {
    it(`${file} invokes npm and is not rewritten to pnpm`, () => {
      const src = read(file);
      expect(/\bnpm\b/.test(src), `${file} must reference npm (Column C runtime)`).toBe(true);
      if (/\bpnpm\b/.test(src)) {
        throw new Error(
          `${file} references pnpm — Column C runtime installs MUST stay npm ` +
            "(they run on end-user machines against the public registry, where " +
            "pnpm is not present). See change: adopt-pnpm-for-dev-ci (§1.2 / X3).",
        );
      }
    });
  }
});

// ── X5: CI cache flip — dev/CI workflows use pnpm, not `npm ci` ────────────
describe("X5 — root/workspace workflows install with pnpm", () => {
  const migrated = [
    "ci.yml",
    "publish.yml",
    "_electron-build.yml",
    "_smoke.yml",
    "ci-e2e-electron.yml",
  ];
  for (const wf of migrated) {
    it(`${wf} uses pnpm/action-setup + cache: pnpm and no \`npm ci\``, () => {
      const y = readWf(wf);
      expect(y, `${wf} missing pnpm/action-setup`).toContain("pnpm/action-setup");
      expect(y, `${wf} missing \`cache: pnpm\``).toMatch(/cache:\s*pnpm/);
      expect(y, `${wf} still installs with pnpm`).toMatch(/pnpm install/);
      if (/\bnpm ci\b/.test(y)) {
        throw new Error(
          `${wf} still runs \`npm ci\` — every root/workspace install must be ` +
            "`pnpm install --frozen-lockfile`. See change: adopt-pnpm-for-dev-ci (§6.2).",
        );
      }
    });
  }

  it("publish.yml drops the npm@11.12.1 EALLOWGIT pin (§8.3)", () => {
    expect(readWf("publish.yml")).not.toContain("npm@11.12.1");
  });
});

// ── X6: deploy-site is dual-install — site/ stays npm, root uses pnpm ──────
describe("X6 — deploy-site.yml dual-install regression", () => {
  const y = readWf("deploy-site.yml");
  it("site/ job keeps its own npm lockfile + npm ci (unmigrated)", () => {
    expect(y).toContain("cache-dependency-path: site/package-lock.json");
    expect(y, "site/ install must stay `npm ci`").toMatch(/\bnpm ci\b/);
  });
  it("root shell install uses pnpm", () => {
    expect(y).toContain("pnpm/action-setup");
    expect(y).toMatch(/pnpm install --frozen-lockfile/);
  });
});

// ── X7: the npm/cli#4828 `rm -f package-lock.json` hack is gone ────────────
describe("X7 — #4828 lockfile-nuke workaround removed from all workflows", () => {
  const files = fs.readdirSync(WF).filter((f) => f.endsWith(".yml"));
  for (const f of files) {
    it(`${f} has no package-lock.json clean-install hack`, () => {
      const y = readWf(f);
      const patterns = [
        /rm -rf node_modules package-lock\.json/,
        /rm -f package-lock\.json/,
        /Remove-Item[^\n]*package-lock\.json/,
      ];
      for (const re of patterns) {
        if (re.test(y)) {
          throw new Error(
            `${f} still contains the npm/cli#4828 lockfile-nuke hack (${re}). ` +
              "pnpm re-resolves the platform optional-dep tree from " +
              "pnpm-lock.yaml, so the workaround must be removed. See change: " +
              "adopt-pnpm-for-dev-ci (§6.5 / X7).",
          );
        }
      }
    });
  }
});

// ── E8: bundle-server cpSync filter is Windows-safe (split, not path.sep) ──
describe("E8 — bundle-server.mjs node_modules filter is Windows-safe", () => {
  const src = read("packages/electron/scripts/bundle-server.mjs");
  it("excludes node_modules via a `/[\\\\/]/` split (both separators)", () => {
    expect(src).toMatch(/split\(\/\[\\\\\/\]\/\)/);
    expect(src).toContain('includes("node_modules")');
  });
  it("does not gate the filter on path.sep (breaks the win32 node-pty leg)", () => {
    // A path.sep-based split misses `/` on win32 (or `\` on POSIX), copying
    // broken pnpm store-symlinks into the bundle → empty node-pty prebuilds.
    expect(src).not.toMatch(/split\(path\.sep\)/);
  });
});
