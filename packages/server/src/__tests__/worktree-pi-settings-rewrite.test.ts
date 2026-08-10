/**
 * Tests for `rewriteWorktreePiSettings` — the post-`git worktree add`
 * fixup that makes relative `packages[].source` in a worktree's
 * `.pi/settings.json` resolve against the MAIN repo's `.pi/` instead of
 * the worktree's own.
 *
 * Pins the contract:
 *   - Missing settings file → no-op (no fabrication).
 *   - Malformed JSON → logged + no-op (no crash, no overwrite with garbage).
 *   - Empty / missing `packages` → no-op.
 *   - Relative `source` ('..', './x', '../x', 'a/b') → rewritten absolute.
 *   - Absolute `source` → untouched.
 *   - URL-like `source` ('https://...', 'git+ssh://...') → untouched.
 *   - Bare npm-style name ('@scope/pkg', 'foo') → untouched.
 *   - End-to-end via addWorktree on a real tmpdir repo.
 *
 * See change: add-worktree-spawn-dialog.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { addWorktree, rewriteWorktreePiSettings } from "../git-worktree/git-operations.js";

let workDir: string;
beforeEach(() => { workDir = realpathSync(mkdtempSync(join(tmpdir(), "wt-pi-settings-"))); });
afterEach(() => rmSync(workDir, { recursive: true, force: true }));

function writeSettings(at: string, json: unknown): void {
  mkdirSync(join(at, ".pi"), { recursive: true });
  writeFileSync(join(at, ".pi", "settings.json"), JSON.stringify(json, null, 2));
}

function readSettings(at: string): any {
  return JSON.parse(readFileSync(join(at, ".pi", "settings.json"), "utf-8"));
}

describe("rewriteWorktreePiSettings — unit", () => {
  it("no-op when settings file is missing", () => {
    const worktree = join(workDir, "wt");
    mkdirSync(worktree);
    rewriteWorktreePiSettings(worktree, workDir);
    expect(existsSync(join(worktree, ".pi", "settings.json"))).toBe(false);
  });

  it("rewrites '..' source to absolute against main root", () => {
    const worktree = join(workDir, "wt");
    const main = join(workDir, "main");
    mkdirSync(main, { recursive: true });
    writeSettings(worktree, { packages: [{ source: "..", extensions: ["+a.ts"] }] });
    rewriteWorktreePiSettings(worktree, main);
    expect(readSettings(worktree).packages[0].source).toBe(main);
  });

  it("rewrites '../packages/extension' style source", () => {
    const worktree = join(workDir, "wt");
    const main = join(workDir, "main");
    mkdirSync(main, { recursive: true });
    writeSettings(worktree, { packages: [{ source: "../packages/extension" }] });
    rewriteWorktreePiSettings(worktree, main);
    // resolves: <main>/.pi/../packages/extension = <main>/packages/extension
    expect(readSettings(worktree).packages[0].source).toBe(join(main, "packages", "extension"));
  });

  it("rewrites './local' source against main .pi/", () => {
    const worktree = join(workDir, "wt");
    const main = join(workDir, "main");
    mkdirSync(main, { recursive: true });
    writeSettings(worktree, { packages: [{ source: "./local" }] });
    rewriteWorktreePiSettings(worktree, main);
    expect(readSettings(worktree).packages[0].source).toBe(join(main, ".pi", "local"));
  });

  it("rewrites bare relative 'a/b' source", () => {
    const worktree = join(workDir, "wt");
    const main = join(workDir, "main");
    mkdirSync(main, { recursive: true });
    writeSettings(worktree, { packages: [{ source: "a/b" }] });
    rewriteWorktreePiSettings(worktree, main);
    expect(readSettings(worktree).packages[0].source).toBe(join(main, ".pi", "a", "b"));
  });

  it("leaves absolute source untouched", () => {
    const worktree = join(workDir, "wt");
    const main = join(workDir, "main");
    mkdirSync(main, { recursive: true });
    writeSettings(worktree, { packages: [{ source: "/already/absolute" }] });
    rewriteWorktreePiSettings(worktree, main);
    expect(readSettings(worktree).packages[0].source).toBe("/already/absolute");
  });

  it("leaves URL-like sources untouched (https, git+ssh)", () => {
    const worktree = join(workDir, "wt");
    writeSettings(worktree, {
      packages: [
        { source: "https://github.com/owner/repo.git" },
        { source: "git+ssh://git@github.com/owner/repo.git" },
      ],
    });
    rewriteWorktreePiSettings(worktree, workDir);
    const out = readSettings(worktree);
    expect(out.packages[0].source).toBe("https://github.com/owner/repo.git");
    expect(out.packages[1].source).toBe("git+ssh://git@github.com/owner/repo.git");
  });

  it("leaves bare npm-style names untouched ('@scope/pkg', 'foo')", () => {
    const worktree = join(workDir, "wt");
    writeSettings(worktree, {
      packages: [
        { source: "@scope/pkg" },
        { source: "foo" },
      ],
    });
    rewriteWorktreePiSettings(worktree, workDir);
    const out = readSettings(worktree);
    expect(out.packages[0].source).toBe("@scope/pkg");
    expect(out.packages[1].source).toBe("foo");
  });

  it("mixed entries: rewrites only the relative ones", () => {
    const worktree = join(workDir, "wt");
    const main = join(workDir, "main");
    mkdirSync(main, { recursive: true });
    writeSettings(worktree, {
      packages: [
        { source: ".." },
        { source: "@scope/keep" },
        { source: "/absolute/keep" },
      ],
    });
    rewriteWorktreePiSettings(worktree, main);
    const out = readSettings(worktree);
    expect(out.packages[0].source).toBe(main);
    expect(out.packages[1].source).toBe("@scope/keep");
    expect(out.packages[2].source).toBe("/absolute/keep");
  });

  it("preserves other fields in the settings JSON (e.g. extensions)", () => {
    const worktree = join(workDir, "wt");
    const main = join(workDir, "main");
    mkdirSync(main, { recursive: true });
    writeSettings(worktree, {
      packages: [{ source: "..", extensions: ["+packages/extension/src/bridge.ts"] }],
      // Some other top-level field the user may have customized.
      themes: ["dark"],
    });
    rewriteWorktreePiSettings(worktree, main);
    const out = readSettings(worktree);
    expect(out.packages[0].source).toBe(main);
    expect(out.packages[0].extensions).toEqual(["+packages/extension/src/bridge.ts"]);
    expect(out.themes).toEqual(["dark"]);
  });

  it("no-op when packages is missing entirely", () => {
    const worktree = join(workDir, "wt");
    const original = { themes: ["dark"] };
    writeSettings(worktree, original);
    rewriteWorktreePiSettings(worktree, workDir);
    expect(readSettings(worktree)).toEqual(original);
  });

  it("no-op when packages is empty", () => {
    const worktree = join(workDir, "wt");
    const original = { packages: [], themes: ["dark"] };
    writeSettings(worktree, original);
    rewriteWorktreePiSettings(worktree, workDir);
    expect(readSettings(worktree)).toEqual(original);
  });

  it("malformed JSON → no-op (preserves the broken file as-is)", () => {
    const worktree = join(workDir, "wt");
    mkdirSync(join(worktree, ".pi"), { recursive: true });
    const broken = "{ this is not json }";
    writeFileSync(join(worktree, ".pi", "settings.json"), broken);
    rewriteWorktreePiSettings(worktree, workDir);
    expect(readFileSync(join(worktree, ".pi", "settings.json"), "utf-8")).toBe(broken);
  });
});

describe("rewriteWorktreePiSettings — end-to-end via addWorktree", () => {
  let repo: string;
  beforeEach(() => {
    repo = realpathSync(mkdtempSync(join(tmpdir(), "wt-pi-e2e-")));
    execSync(`git -c init.defaultBranch=main init`, { cwd: repo, stdio: "pipe" });
    execSync(`git config user.email test@test.com`, { cwd: repo, stdio: "pipe" });
    execSync(`git config user.name Test`, { cwd: repo, stdio: "pipe" });
    // Track .pi/settings.json on the initial commit so the worktree
    // checks it out with the relative source.
    writeSettings(repo, { packages: [{ source: "..", extensions: ["+x.ts"] }] });
    writeFileSync(join(repo, "README.md"), "init");
    execSync(`git add .`, { cwd: repo, stdio: "pipe" });
    execSync(`git commit -m init`, { cwd: repo, stdio: "pipe" });
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("new worktree's .pi/settings.json source is rewritten to main repo absolute", () => {
    const res = addWorktree({ cwd: repo, base: "main", newBranch: "feat/x" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const settings = readSettings(res.path);
    // Before rewrite, source `..` from the worktree's `.pi/` would resolve
    // to `<worktreePath>`. After rewrite, it should be the MAIN repo path.
    expect(settings.packages[0].source).toBe(repo);
    expect(settings.packages[0].extensions).toEqual(["+x.ts"]);
  });
});
