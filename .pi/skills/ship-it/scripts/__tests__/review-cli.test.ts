/**
 * review-prompt.ts CLI (test-plan #E33, #X1-#X3). Child process, real files —
 * mirrors the `spawnSync(process.execPath, …)` pattern of
 * `scripts/__tests__/check-kb-dist-fresh.test.mjs`.
 * See change: harden-review-and-fix-loop.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, "../review-prompt.ts");
const REPO = path.resolve(HERE, "../../../../..");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ship-it-cli-"));
afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

const run = (args: string[], cwd = REPO) =>
  spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", CLI, ...args], {
    cwd,
    encoding: "utf8",
  });

function write(dir: string, name: string, body: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, name);
  fs.writeFileSync(f, body);
  return f;
}

const entry = (id: string) => ({
  id,
  test: { untestable: "only observable in a live reviewer transcript" },
  siblings: { searched: "rg -n foo", sites: [] },
  fixedIn: "worktree",
});

describe("review-prompt CLI", () => {
  it("#X1 an unknown change exits non-zero naming it", () => {
    const r = run(["--change", "does-not-exist", "--round", "1"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("does-not-exist");
  });

  it("#X2 an incomplete ledger exits 1 listing the missing id", () => {
    const dir = path.join(tmpRoot, "x2");
    const prior = write(dir, "review-r1.md", "issue(blocking): B1 — a\n\nissue(blocking): B2 — b\n\nBLOCKING_COUNT: 2\nVERDICT: block\n");
    const ledger = write(dir, "fix-ledger-r1.json", JSON.stringify([entry("B1")]));
    const r = run(["--validate-ledger", "--prior", prior, "--ledger", ledger], dir);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/missing: B2/);
    // the failure is recorded against the round it would unlock
    expect(fs.readFileSync(path.join(dir, "ledger-failures.log"), "utf8")).toMatch(/^r2 /);
  });

  it("#E33 a round's ledger never inherits an older round's entry", () => {
    const dir = path.join(tmpRoot, "e33");
    write(dir, "fix-ledger-r1.json", JSON.stringify([entry("B1")]));
    const prior = write(dir, "review-r2.md", "issue(blocking): B1 — new\n\nBLOCKING_COUNT: 1\nVERDICT: block\n");
    const ledger = write(dir, "fix-ledger-r2.json", "[]");
    const r = run(["--validate-ledger", "--prior", prior, "--ledger", ledger], dir);
    expect(r.status).not.toBe(0);
    expect(r.stdout).toMatch(/missing: B1/);
  });

  it("#X3 --state on a nonexistent run dir prints round 0 and exits 0", () => {
    const r = run(["--state", path.join(tmpRoot, "nope")]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("round: 0");
  });

  it("resolves artifacts from the change dir and prints the prompt", () => {
    const repo = path.join(tmpRoot, "repo");
    const change = path.join(repo, "openspec/changes/demo");
    write(change, "proposal.md", "# p\n");
    write(change, "tasks.md", "- [ ] 1\n");
    write(path.join(change, "specs/a"), "spec.md", "# a\n");
    spawnSync("git", ["init", "-q"], { cwd: repo });

    const r = run(["--change", "demo", "--round", "1"], repo);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("openspec/changes/demo/proposal.md");
    expect(r.stdout).toContain("openspec/changes/demo/specs/a/spec.md");
    expect(r.stdout).not.toContain("design.md");

    const r2 = run(["--change", "demo", "--round", "2"], repo);
    expect(r2.status).not.toBe(0); // round 2 needs --prior and --since
  });
});
