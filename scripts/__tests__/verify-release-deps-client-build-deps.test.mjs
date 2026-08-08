/**
 * test-plan #E7: verify-release-deps fires when a client build dep regresses.
 *
 * The release gate must FAIL when any of the client's direct build-time
 * requirements is moved back into `devDependencies` — that regression silently
 * re-breaks `pi install git:...`, which runs `npm install --omit=dev` (#357),
 * and the published tarball would ship broken.
 *
 * Drives the exported `collectFailures({ repoRoot })` against a tmp fixture
 * tree rather than mutating a tracked package.json (a vitest run must not touch
 * the working tree) or `execSync`-ing the CLI (no exemplar for asserting a
 * subprocess exit code in this suite). The fixture carries the other files the
 * unrelated gates read — `packages/server/package.json`,
 * `packages/extension/package.json`, `docker/Dockerfile` — copied from the real
 * repo so only the client rules vary between the pass and fail cases.
 *
 * See change: fix-pi-install-node26-and-omit-dev-build.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { collectFailures } from "../verify-release-deps.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");

/** Files the non-client gates read; copied verbatim so they stay green. */
const CARRIED = [
  "packages/server/package.json",
  "packages/extension/package.json",
  "docker/Dockerfile",
];

const tmpDirs = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Build a fixture repo tree. `mutate` receives the real client package.json
 * (parsed) and may move deps around before it is written.
 */
function fixtureRepo(mutate = () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "verify-release-deps-"));
  tmpDirs.push(root);

  for (const rel of CARRIED) {
    const dest = path.join(root, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, rel), dest);
  }

  const clientPkg = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "packages/client/package.json"), "utf-8"),
  );
  mutate(clientPkg);
  const dest = path.join(root, "packages/client/package.json");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(clientPkg, null, 2));

  return root;
}

/** Move `dep` from dependencies back into devDependencies (the regression). */
function regress(pkg, dep) {
  pkg.devDependencies = pkg.devDependencies ?? {};
  pkg.devDependencies[dep] = pkg.dependencies[dep];
  delete pkg.dependencies[dep];
}

describe("verify-release-deps client build-dep rules (E7)", () => {
  it("passes against the real repo tree", () => {
    expect(collectFailures({ repoRoot: fixtureRepo() })).toEqual([]);
  });

  for (const dep of ["vite", "@vitejs/plugin-react", "@tailwindcss/vite", "tailwindcss", "tsx"]) {
    it(`fails, naming the dep, when \`${dep}\` regresses to devDependencies`, () => {
      const failures = collectFailures({
        repoRoot: fixtureRepo((pkg) => regress(pkg, dep)),
      });

      expect(failures).toHaveLength(1);
      expect(failures[0]).toContain("packages/client/package.json");
      expect(failures[0]).toContain(`dependencies.${dep}`);
      expect(failures[0]).toContain("Missing");
    });
  }

  it("reports every regressed dep, not just the first", () => {
    const failures = collectFailures({
      repoRoot: fixtureRepo((pkg) => {
        regress(pkg, "vite");
        regress(pkg, "tailwindcss");
      }),
    });

    expect(failures).toHaveLength(2);
    expect(failures.join("\n")).toContain("dependencies.vite");
    expect(failures.join("\n")).toContain("dependencies.tailwindcss");
  });
});
