/**
 * Repo hygiene guards for wire-local-review-gate (test-plan #E9, #X10-#X13).
 *
 * Style mirrors `scripts/__tests__/lint-ledger.test.mjs`: shell out only where
 * the behaviour under test IS the external command.
 *
 * See change: wire-local-review-gate.
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8" });
const run = (cmd, args) => {
  try {
    execFileSync(cmd, args, { cwd: repoRoot, encoding: "utf8", stdio: "pipe" });
    return 0;
  } catch (err) {
    return err.status ?? 1;
  }
};

describe("#E9 reviewer diff scope excludes the step-2.5 merge", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "review-scope-"));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("three-dot shows only commits authored on the branch, two-dot does not", () => {
    const w = (f, s) => fs.writeFileSync(path.join(tmp, f), s);
    git(["init", "-q", "-b", "develop"], tmp);
    git(["config", "user.email", "t@t"], tmp);
    git(["config", "user.name", "t"], tmp);
    w("base.txt", "base");
    git(["add", "-A"], tmp);
    git(["commit", "-qm", "base"], tmp);

    // develop moves on with 3 commits
    git(["checkout", "-qb", "feature"], tmp);
    git(["checkout", "-q", "develop"], tmp);
    for (const n of [1, 2, 3]) {
      w(`dev${n}.txt`, `d${n}`);
      git(["add", "-A"], tmp);
      git(["commit", "-qm", `dev${n}`], tmp);
    }

    // the change authors 2 commits, then merges develop (ship-it step 2.5)
    git(["checkout", "-q", "feature"], tmp);
    for (const n of [1, 2]) {
      w(`own${n}.txt`, `o${n}`);
      git(["add", "-A"], tmp);
      git(["commit", "-qm", `own${n}`], tmp);
    }
    git(["merge", "--no-edit", "-q", "develop"], tmp);

    const threeDot = git(["diff", "--name-only", "develop...HEAD"], tmp).split("\n").filter(Boolean);

    expect(threeDot.sort()).toEqual(["own1.txt", "own2.txt"]);
    for (const f of ["dev1.txt", "dev2.txt", "dev3.txt"]) {
      expect(threeDot, "merged develop code must not be attributed").not.toContain(f);
    }
  });

  it("two-dot leaks develop's files when develop has moved but is not yet merged", () => {
    // The pre-2.5 state, and the reason the range is pinned in the spec rather
    // than left to taste. Once the merge completes the two ranges agree, so a
    // post-merge comparison would hide the difference entirely.
    const before = git(["diff", "--name-only", "develop", "HEAD~1"], tmp)
      .split("\n")
      .filter(Boolean);
    const beforeThree = git(["diff", "--name-only", "develop...HEAD~1"], tmp)
      .split("\n")
      .filter(Boolean);

    expect(before).toEqual(expect.arrayContaining(["dev1.txt", "dev2.txt", "dev3.txt"]));
    expect(beforeThree.sort()).toEqual(["own1.txt", "own2.txt"]);
  });
});

describe("#X10 i18n enforcers are repaired, not merely wired", () => {
  it("i18n-parity exits 0", () => {
    expect(run("node", ["scripts/i18n-parity.mjs"])).toBe(0);
  });

  it("reads catalog paths that actually exist", () => {
    const src = fs.readFileSync(path.join(repoRoot, "scripts/i18n-parity.mjs"), "utf8");
    const refs = [...src.matchAll(/"(packages\/client\/src\/lib\/[^"]+)"/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThanOrEqual(2);
    for (const ref of refs) {
      expect(fs.existsSync(path.join(repoRoot, ref)), `stale path: ${ref}`).toBe(true);
    }
  });

  it("its anchors still resolve in the catalogs", () => {
    const i18n = fs.readFileSync(
      path.join(repoRoot, "packages/client/src/lib/i18n/i18n.tsx"),
      "utf8",
    );
    const hu = fs.readFileSync(
      path.join(repoRoot, "packages/client/src/lib/i18n/i18n-hu.ts"),
      "utf8",
    );
    expect(i18n).toMatch(/const zhCN/);
    expect(hu).toMatch(/huCatalog/);
  });

  it("i18n-lint gates only with --strict", () => {
    expect(run("node", ["scripts/i18n-lint.mjs", "--strict"])).toBe(0);
  });
});

describe("#X11 #X12 the change touched nothing it promised not to", () => {

  it("#X11 does not wire the new enforcers into quality:changed (D11)", () => {
    // The requirement is a property of the script, not of git history: the ship
    // gate lives in ship-it step 4.4. Comparing against origin/develop would
    // test inherited commits instead — that ref is behind this branch and an
    // unrelated commit already edited this script.
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    const quality = pkg.scripts["quality:changed"];
    expect(quality).toBeTruthy();
    for (const enforcer of ["check-conventions", "dox-byte-gate", "i18n", "kb dox"]) {
      expect(quality, `quality:changed must not run ${enforcer}`).not.toContain(enforcer);
    }
  });

  it("#X12 leaves split-large-agents.mjs unmodified", () => {
    // Frozen content baseline, NOT a diff against origin/develop: CI checks out
    // at depth 1 (`actions/checkout@v4`, no `fetch-depth`), so that ref does not
    // exist there and a diff-scoped guard either throws or resolves an EMPTY
    // diff and passes vacuously. Same reasoning as
    // `scripts/__tests__/async-semantics-guards.test.mjs`. This hash is the file
    // as it stands on origin/develop; any edit to the splitter fails here.
    const FROZEN_SHA256 =
      "16ff1ef6b190fd7267d92339ab7b2f3cc3adb02efad6b4730fe00ba8fa10fbac";
    const actual = crypto
      .createHash("sha256")
      .update(fs.readFileSync(path.join(repoRoot, "scripts/split-large-agents.mjs")))
      .digest("hex");
    expect(actual, "split-large-agents.mjs must not be modified by this change").toBe(
      FROZEN_SHA256,
    );
  });

  it("#X12 defines no second per-file byte threshold", () => {
    // packages/kb owns AGENTS_BYTE_CAP. The gate filters kb's verdict; it must
    // not restate the number, or the two copies will drift.
    for (const f of ["scripts/dox-byte-gate.mjs", "scripts/check-conventions.mjs"]) {
      const src = fs.readFileSync(path.join(repoRoot, f), "utf8");
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code, `${f} restates the cap`).not.toMatch(/\b30000\b|\b30_000\b/);
    }
  });
});

describe("#X13 the gate is green on the change's own tree", () => {
  // Both guards run tree-scoped rather than through the ship-gate invocation.
  // `--base origin/develop` and `npx kb dox lint` both need a developer/worktree
  // environment that CI's depth-1 checkout does not have; asserting them here
  // made a green CI depend on the ref existing. The touched-set half of
  // check-conventions has dedicated fixture coverage in
  // `check-conventions.test.mjs` (#E10-#E15), and `byteArmIssues` has it in
  // `dox-byte-gate.test.mjs` (#E16-#E18), so nothing loses its oracle.

  it("check-conventions passes on the tree", () => {
    // No --base: the three tree-scoped rules still gate fully; only the
    // Discipline-Skills rule drops to reporting (its gating path is #E10-#E15).
    expect(run("node", ["scripts/check-conventions.mjs"])).toBe(0);
  });

  it("no AGENTS.md exceeds the byte cap", async () => {
    // Asserts the same property `dox-byte-gate.mjs` gates on, without shelling
    // out to `npx kb` (absent in CI, where the gate correctly fails closed).
    // The cap is IMPORTED from its owner, never restated — see #X12's sibling.
    const { AGENTS_BYTE_CAP } = await import("../../packages/kb/src/dox.ts");
    const tracked = git(["ls-files", "-z", "*AGENTS.md"], repoRoot).split("\0").filter(Boolean);
    expect(tracked.length).toBeGreaterThan(0);

    const over = tracked.filter(
      (f) => fs.statSync(path.join(repoRoot, f)).size > AGENTS_BYTE_CAP,
    );
    expect(over, `over the ${AGENTS_BYTE_CAP}-byte cap`).toEqual([]);
  });
});
