/**
 * Repo-level invariant: a published tarball MUST NOT carry the internal
 * agent doc-tree, and every publishable workspace MUST carry the metadata
 * npm renders on a package page.
 *
 * Why: `files: ["src/"]` sweeps in every `AGENTS.md` / `<File>.ts.AGENTS.md`
 * sidecar under that directory. At 0.7.0 this shipped 374 internal doc files
 * to the public registry across 30 packages — `pi-dashboard-server` alone
 * carried 203, including per-file rows with change history and known-gap
 * notes. Harmless to consumers, but it publishes engineering notes nobody
 * outside the repo should have to read, and bloats every tarball.
 *
 * NOT covered here (deliberately): `src/test-support/` in
 * `pi-dashboard-shared` and `dashboard-plugin-runtime`. Those look like test
 * files but are a DECLARED PUBLIC EXPORT — `dashboard-plugin-runtime`'s
 * `exports` map publishes `./test-support`, and third-party plugin authors
 * import `withUiPrimitiveProvider` / `setup-home.ts` from them to test their
 * own plugins. Excluding them would break that contract.
 *
 * BOTH exclusion patterns are required (see the assertions below). The plain
 * directory-glob matches only the per-directory tree files; the per-file
 * sidecars are named `<File>.ts.AGENTS.md` and need the star-dot-prefixed
 * variant. Asserting only the first passes while 281 files still ship — the
 * exact vacuous-gate this comment exists to prevent.
 *
 * (Neither glob is spelled out in this comment: the `*` `/` sequence inside a
 * doubled-star path glob terminates a block comment.)
 *
 * If this test fails, add the missing pattern to that package's `files`
 * array — do not weaken the assertion.
 */

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const PACKAGES_DIR = path.join(REPO_ROOT, "packages");

interface Pkg {
  dir: string;
  name: string;
  license?: string;
  files?: string[];
  private?: boolean;
}

function publishablePackages(): Pkg[] {
  const out: Pkg[] = [];
  for (const dir of fs.readdirSync(PACKAGES_DIR)) {
    const p = path.join(PACKAGES_DIR, dir, "package.json");
    if (!fs.existsSync(p)) continue;
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    if (typeof raw.name !== "string") continue;
    if (raw.private === true) continue;
    out.push({ dir, name: raw.name, license: raw.license, files: raw.files });
  }
  return out;
}

describe("published tarball hygiene", () => {
  const pkgs = publishablePackages();

  it("discovers publishable packages (guards against a vacuous pass)", () => {
    expect(pkgs.length).toBeGreaterThan(30);
  });

  it("every publishable package declares an explicit files allowlist", () => {
    const missing = pkgs.filter((p) => !Array.isArray(p.files)).map((p) => p.name);
    expect(missing, "packages with no `files` array publish the whole directory").toEqual([]);
  });

  it("no publishable package ships the per-directory AGENTS.md tree", () => {
    const missing = pkgs
      .filter((p) => !(p.files ?? []).includes("!**/AGENTS.md"))
      .map((p) => `${p.name} (packages/${p.dir})`);
    expect(missing, 'add "!**/AGENTS.md" to the `files` array').toEqual([]);
  });

  it("no publishable package ships the per-file <File>.ts.AGENTS.md sidecars", () => {
    const missing = pkgs
      .filter((p) => !(p.files ?? []).includes("!**/*.AGENTS.md"))
      .map((p) => `${p.name} (packages/${p.dir})`);
    expect(missing, 'add "!**/*.AGENTS.md" — "!**/AGENTS.md" does NOT match sidecars').toEqual([]);
  });

  it("every publishable package declares a license", () => {
    const missing = pkgs.filter((p) => !p.license).map((p) => p.name);
    expect(missing, "npm renders a license-less package as UNLICENSED").toEqual([]);
  });

  it("every publishable package ships a README", () => {
    const missing = pkgs
      .filter((p) => !fs.existsSync(path.join(PACKAGES_DIR, p.dir, "README.md")))
      .map((p) => `${p.name} (packages/${p.dir}/README.md)`);
    expect(missing, "a README-less package renders a blank npm page").toEqual([]);
  });
});
