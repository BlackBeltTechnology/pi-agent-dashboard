// E14 / E15 (test-plan, ci level — check-root-package-imports): the ROOT
// meta-package tarball ships a runnable copy of packages/{server,shared,extension}
// and must not carry their tests, fixtures, mocks or per-file DOX sidecars, while
// still shipping the root AGENTS.md and tsconfig.base.json on purpose.
//
// `files` negation is order-sensitive in npm-packlist and a JSON array cannot
// carry that warning, so the packed set (on CI's npm, the npm that publishes) is
// the guard. ci-level, behind RUN_CI_SCENARIOS=1 — npm pack of the root is too
// CPU-heavy for the parallel unit suite.
// Exemplar: scripts/__tests__/kb-packaging.test.mjs.
import { describe, expect, it } from "vitest";
import { packWorkspace, REPO_ROOT, rootPackage } from "../verify-published-imports.mjs";

const CI_SCENARIOS = process.env.RUN_CI_SCENARIOS === "1";
const EXCLUDED = /(?:\/__tests__\/|\/__fixtures__\/|\/__mocks__\/|\.test\.|\.spec\.|\/AGENTS\.md$|\.AGENTS\.md$)/;

describe.runIf(CI_SCENARIOS)("root package tarball contents", () => {
  let files;
  const packed = async () => {
    if (files) return files;
    const res = await packWorkspace(REPO_ROOT, rootPackage(REPO_ROOT).name);
    expect(res.error).toBeNull();
    files = res.files;
    return files;
  };

  it("ships no tests, fixtures, mocks or DOX sidecars under packages/ (E14)", async () => {
    const leaked = (await packed()).filter((p) => p.startsWith("packages/") && EXCLUDED.test(p));
    expect(leaked).toEqual([]);
  }, 180_000);

  it("still ships the root AGENTS.md and tsconfig.base.json (E15)", async () => {
    const set = new Set(await packed());
    expect(set.has("AGENTS.md")).toBe(true);
    expect(set.has("tsconfig.base.json")).toBe(true);
    // Non-vacuity: the production sources the exclusions sit next to still ship.
    expect([...set].some((p) => p.startsWith("packages/server/src/"))).toBe(true);
  }, 180_000);
});
