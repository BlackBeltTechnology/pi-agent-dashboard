// gitignore.ts unit tests: matcher decision table (test-plan E16), loader
// seeding / negation / deeper-override (E13/E14/E15 unit level), robustness (X2).
// See change: fix-dox-lint-blind-rows, fix-kb-gitignore-excluded-parent.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadGitignoreMatcher, loadGitignoreMatcherYielding, patternMatches } from "../gitignore.js";
import { makeFlatDirs } from "./helpers/synthetic-tree.js";

describe("gitignore pattern forms (E16 decision table)", () => {
  it.each([
    ["bare name", "README.md", "docs/README.md", true],
    ["bare name no match", "README.md", "docs/notes.md", false],
    ["dir/ ignores contents", "out/", "out/x.md", true],
    ["dir/ ignores deeper contents", "out/", "out/sub/x.md", true],
    ["dir/ does not match same-prefix file", "out/", "outfile.md", false],
    ["*.ext glob", "*.db", "data.db", true],
    ["*.ext under dir", "*.db", "a/b/data.db", true],
    ["mid-name glob", "rows*.jsonl", "logs/rows-2026.jsonl", true],
    ["mid-name glob exact", "rows*.jsonl", "rows.jsonl", true],
    ["leading **/", "**/node_modules", "a/b/node_modules", true],
    ["leading **/ contents", "**/node_modules", "a/node_modules/x.js", true],
    ["mid ** zero dirs", "a/**/b", "a/b", true],
    ["mid ** deep", "a/**/b", "a/x/y/b", true],
    ["chained mid **", "packages/*/src/**/*.js", "packages/client/src/generated/x.js", true],
    ["chained mid ** zero", "packages/*/src/**/*.js", "packages/client/src/x.js", true],
    ["chained mid ** no match", "packages/*/src/**/*.js", "packages/client/lib/x.js", false],
    ["leading-slash anchor file", "/package-lock.json", "package-lock.json", true],
    ["leading-slash anchor rejects deep", "/package-lock.json", "a/package-lock.json", false],
    ["case-sensitive dir match", "Out/", "Out/x.md", true],
    ["case-sensitive dir no match", "Out/", "out/x.md", false],
    ["case-sensitive name no match", "Readme.md", "README.md", false],
    ["bare * matches file", "*", "anything.md", true],
    ["bare * matches contents", "*", "a/b/c.md", true],
    ["trailing /** everything inside", "site/design-scratch/**", "site/design-scratch/out/x.md", true],
    ["trailing /** not the dir itself", "site/design-scratch/**", "site/design-scratch", false],
  ])("%s", (_label, pattern, rel, expected) => {
    expect(patternMatches(pattern, rel)).toBe(expected);
  });

  it("negation is a match with flipped verdict (last-match-wins lives in the loader)", () => {
    expect(patternMatches("!keep.md", "keep.md")).toBe(true); // pattern engages
    expect(patternMatches("!keep.md", "other.md")).toBe(false);
  });

  it("skips a malformed pattern line without throwing (X2)", () => {
    expect(() => patternMatches("[abc", "abc.md")).not.toThrow();
    expect(patternMatches("[abc", "abc.md")).toBe(false);
  });
});

describe("gitignore loader", () => {
  const tmps: string[] = [];
  const tree = (files: Record<string, string>): string => {
    const d = mkdtempSync(join(tmpdir(), "kb-gi-"));
    tmps.push(d);
    for (const [p, body] of Object.entries(files)) {
      const abs = join(d, p);
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, body);
    }
    return d;
  };
  afterEach(() => {
    for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("no .gitignore anywhere → predicate ignores nothing, no throw (X1)", () => {
    const d = tree({ "a.md": "x\n", "sub/b.md": "x\n" });
    const m = loadGitignoreMatcher(d, { cwd: d });
    expect(m.isIgnored("a.md")).toBe(false);
    expect(m.isIgnored("sub/b.md")).toBe(false);
    expect(m.isIgnoredDir("sub")).toBe(false);
  });

  it("root patterns apply from the walk root", () => {
    const d = tree({ ".gitignore": "ignored/\n", "kept.md": "x\n", "ignored/x.md": "x\n" });
    const m = loadGitignoreMatcher(d, { cwd: d });
    expect(m.isIgnored("ignored/x.md")).toBe(true);
    expect(m.isIgnored("kept.md")).toBe(false);
  });

  it("up-walk seeding: a root-anchored pattern applies from a NESTED walk root (E14 unit)", () => {
    const d = tree({ ".gitignore": "src/generated/\n", "src/generated/x.md": "x\n", "src/keep.md": "x\n" });
    const m = loadGitignoreMatcher(join(d, "src"), { cwd: d });
    expect(m.isIgnored("generated/x.md")).toBe(true); // rel to walk root src/
    expect(m.isIgnored("keep.md")).toBe(false);
  });

  it("negation: both dir and content forms keep tracked coverage (E13 unit)", () => {
    const d = tree({
      ".gitignore": "skills/openspec-*/**\n!skills/openspec-shared/\n!skills/openspec-shared/**\n",
      "skills/openspec-alpha/SKILL.md": "x\n",
      "skills/openspec-shared/SKILL.md": "x\n",
    });
    const m = loadGitignoreMatcher(d, { cwd: d });
    expect(m.isIgnored("skills/openspec-alpha/SKILL.md")).toBe(true);
    expect(m.isIgnored("skills/openspec-shared/SKILL.md")).toBe(false);
    expect(m.isIgnoredDir("skills/openspec-shared")).toBe(false); // negated → do not prune
    expect(m.isIgnoredDir("skills/openspec-alpha")).toBe(false); // content pattern never matched the dir
  });

  it("excluded parent wins: nested negation cannot re-include (E1, git semantics)", () => {
    const d = tree({
      ".gitignore": "vendored/\n",
      "vendored/.gitignore": "!keep.md\n",
      "vendored/keep.md": "x\n",
      "vendored/other.md": "x\n",
    });
    const m = loadGitignoreMatcher(d, { cwd: d });
    expect(m.isIgnored("vendored/keep.md")).toBe(true);
    expect(m.isIgnored("vendored/other.md")).toBe(true);
    expect(m.isIgnoredDir("vendored")).toBe(true);
  });

  it("anchored root pattern applies from a nested walk root (E2)", () => {
    const d = tree({
      ".gitignore": "packages/electron/out\n",
      "packages/electron/out/a/.gitignore": "!*.md\n",
      "packages/electron/out/a/b/x.md": "x\n",
    });
    const m = loadGitignoreMatcher(join(d, "packages"), { cwd: d });
    expect(m.isIgnored("electron/out/a/b/x.md")).toBe(true);
    expect(m.isIgnoredDir("electron/out")).toBe(true);
  });

  it("dir-only negation `!*/` re-includes the dir, not its files (E3)", () => {
    const d = tree({ ".gitignore": "*\n!*/\n", "docs/x.md": "x\n" });
    const m = loadGitignoreMatcher(d, { cwd: d });
    expect(m.isIgnored("docs/x.md")).toBe(true);
    expect(m.isIgnoredDir("docs")).toBe(false);
  });

  it("unanchored name negation `!foo` re-includes the dir, not its files (E4)", () => {
    const d = tree({ ".gitignore": "*\n!foo\n", "foo/bar.md": "x\n" });
    const m = loadGitignoreMatcher(d, { cwd: d });
    expect(m.isIgnored("foo/bar.md")).toBe(true);
    expect(m.isIgnoredDir("foo")).toBe(false);
  });

  it("walk root inside an ignored dir → every file ignored (E5)", () => {
    const d = tree({ ".gitignore": "packages/electron/out\n", "packages/electron/out/app/z.md": "x\n" });
    const m = loadGitignoreMatcher(join(d, "packages", "electron", "out", "app"), { cwd: d });
    expect(m.isIgnored("z.md")).toBe(true);
  });

  it("root-level file negation under an ignored parent does not re-include (E6)", () => {
    const d = tree({ ".gitignore": "vendored/\n!vendored/keep.md\n", "vendored/keep.md": "x\n" });
    const m = loadGitignoreMatcher(d, { cwd: d });
    expect(m.isIgnored("vendored/keep.md")).toBe(true);
  });

  it("`!dir/` is prune-only: files stay ignored by `dir/**` (E7)", () => {
    const d = tree({ ".gitignore": "foo/**\n!foo/\n", "foo/x.md": "x\n" });
    const m = loadGitignoreMatcher(d, { cwd: d });
    expect(m.isIgnored("foo/x.md")).toBe(true);
    expect(m.isIgnoredDir("foo")).toBe(false);
  });

  it("own-dir allowlist stays selected (E8)", () => {
    const d = tree({
      "gen/.gitignore": "*\n!.gitignore\n!plugin-registry.tsx\n",
      "gen/plugin-registry.tsx": "x\n",
      "gen/other.ts": "x\n",
    });
    const m = loadGitignoreMatcher(d, { cwd: d });
    expect(m.isIgnoredDir("gen")).toBe(false);
    expect(m.isIgnored("gen/plugin-registry.tsx")).toBe(false);
    expect(m.isIgnored("gen/other.ts")).toBe(true);
  });

  it("dirOnly pattern never matches a regular file (E9)", () => {
    const f = tree({ ".gitignore": "out/\n", out: "x\n" });
    expect(loadGitignoreMatcher(f, { cwd: f }).isIgnored("out")).toBe(false);
    const d = tree({ ".gitignore": "out/\n", "out/x.md": "x\n" });
    expect(loadGitignoreMatcher(d, { cwd: d }).isIgnored("out/x.md")).toBe(true);
  });

  it("ancestor depth boundary (E10)", () => {
    const a = tree({ ".gitignore": "a/\n", "a/b/c/d/e.md": "x\n" });
    expect(loadGitignoreMatcher(a, { cwd: a }).isIgnored("a/b/c/d/e.md")).toBe(true);
    const b = tree({ ".gitignore": "a/b/c/d/\n", "a/b/c/x.md": "x\n", "a/b/c/d/x.md": "x\n" });
    const mb = loadGitignoreMatcher(b, { cwd: b });
    expect(mb.isIgnored("a/b/c/x.md")).toBe(false);
    expect(mb.isIgnored("a/b/c/d/x.md")).toBe(true);
  });

  it("verdicts are independent of query order / memo state (E13)", () => {
    const files = {
      ".gitignore": "vendored/\npackages/electron/out\n*\n!*/\n",
      "vendored/.gitignore": "!keep.md\n",
      "vendored/keep.md": "x\n",
      "packages/electron/out/a/.gitignore": "!*.md\n",
      "packages/electron/out/a/b/x.md": "x\n",
      "gen/.gitignore": "*\n!.gitignore\n!plugin-registry.tsx\n",
      "gen/plugin-registry.tsx": "x\n",
      "gen/other.ts": "x\n",
    };
    const paths = Object.keys(files).filter((p) => !p.endsWith(".gitignore"));
    const d = tree(files);
    const fwd = loadGitignoreMatcher(d, { cwd: d });
    const rev = loadGitignoreMatcher(d, { cwd: d });
    const a = paths.map((p) => fwd.isIgnored(p));
    const b = [...paths].reverse().map((p) => rev.isIgnored(p)).reverse();
    expect(a).toEqual(b);
  });

  it("loader does not throw when an ignored dir holds its own .gitignore (X1 TDZ guard)", () => {
    const d = tree({ ".gitignore": "vendored/\n", "vendored/.gitignore": "!keep.md\n", "vendored/x.md": "x\n" });
    let m: ReturnType<typeof loadGitignoreMatcher> | undefined;
    expect(() => {
      m = loadGitignoreMatcher(d, { cwd: d });
    }).not.toThrow();
    expect(m?.isIgnored("vendored/x.md")).toBe(true);
  });

  const hasGit = (() => {
    try {
      execFileSync("git", ["--version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();
  // Parity vs real git (E14). POSIX-only: relies on /dev/null + `git check-ignore`.
  it.skipIf(!hasGit || process.platform === "win32")("matcher agrees with `git check-ignore` on file paths (E14)", () => {
    const fixtures: Record<string, string>[] = [
      { ".gitignore": "vendored/\n", "vendored/.gitignore": "!keep.md\n", "vendored/keep.md": "x", "vendored/other.md": "x", "top.md": "x" },
      { ".gitignore": "packages/electron/out\n", "packages/electron/out/a/.gitignore": "!*.md\n", "packages/electron/out/a/b/x.md": "x", "packages/docs/y.md": "x" },
      { ".gitignore": "*\n!*/\n", "docs/x.md": "x" },
      { ".gitignore": "*\n!foo\n", "foo/bar.md": "x" },
      { ".gitignore": "vendored/\n!vendored/keep.md\n", "vendored/keep.md": "x" },
      { ".gitignore": "foo/**\n!foo/\n", "foo/x.md": "x" },
      { "gen/.gitignore": "*\n!.gitignore\n!plugin-registry.tsx\n", "gen/plugin-registry.tsx": "x", "gen/other.ts": "x" },
      { ".gitignore": "out/\n", out: "x" },
      { ".gitignore": "out/\n", "out/x.md": "x" },
      { ".gitignore": "a/\n", "a/b/c/d/e.md": "x" },
      { ".gitignore": "a/b/c/d/\n", "a/b/c/x.md": "x", "a/b/c/d/x.md": "x" },
    ];
    const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
    for (const files of fixtures) {
      const d = tree(files);
      execFileSync("git", ["init", "-q"], { cwd: d, env });
      writeFileSync(join(d, ".git", "info", "exclude"), "");
      const m = loadGitignoreMatcher(d, { cwd: d });
      for (const p of Object.keys(files).filter((f) => !f.endsWith(".gitignore"))) {
        let ignored = false;
        try {
          execFileSync("git", ["-c", "core.excludesFile=/dev/null", "check-ignore", "--no-index", "-q", p], { cwd: d, env, stdio: "ignore" });
          ignored = true; // exit 0
        } catch (e) {
          if ((e as { status?: number }).status !== 1) throw e; // 1 = not ignored; anything else = real failure
        }
        expect({ p, files, v: m.isIgnored(p) }).toEqual({ p, files, v: ignored });
      }
    }
  });

  it("malformed line skipped, valid line still applies (X2)", () => {
    const d = tree({ ".gitignore": "[abc\nquiet.md\n", "quiet.md": "x\n", "loud.md": "x\n" });
    const m = loadGitignoreMatcher(d, { cwd: d });
    expect(m.isIgnored("quiet.md")).toBe(true);
    expect(m.isIgnored("loud.md")).toBe(false);
  });
});

describe("yielding gitignore loader (bound-kb-search-freshness, E26 E28)", () => {
  const tmps: string[] = [];
  const mk = (files: Record<string, string>): string => {
    const d = mkdtempSync(join(tmpdir(), "kb-gi-y-"));
    tmps.push(d);
    for (const [p, body] of Object.entries(files)) {
      const abs = join(d, p);
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, body);
    }
    return d;
  };
  afterEach(() => {
    for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const noYield = { yieldEvery: 500, yieldFn: async () => {} };

  const fixtures: Array<[string, Record<string, string>]> = [
    ["flat", { ".gitignore": "*.log\nbuild/\n", "a.md": "x", "b.log": "x", "build/c.md": "x" }],
    ["nested + negation (deeper overrides)", { ".gitignore": "*.md\n", "a/.gitignore": "!keep.md\n", "a/keep.md": "x", "a/drop.md": "x", "b/.gitignore": "!b.md\n", "b/b.md": "x", "b/c/.gitignore": "*.md\n", "b/c/z.md": "x", "top.md": "x" }],
    ["ignored parent with its own .gitignore", { ".gitignore": "gen/\n", "gen/.gitignore": "!x.md\n", "gen/x.md": "x", "src/.gitignore": "tmp*\n", "src/tmp1.md": "x", "src/ok.md": "x" }],
    ["pruned dir", { ".gitignore": "*.tmp\n", "node_modules/.gitignore": "!x.md\n", "node_modules/x.md": "x", "ok/x.tmp": "x", "ok/y.md": "x" }],
  ];
  const paths = (d: string) => {
    const out: Array<[string, boolean]> = [];
    const walkDir = (rel: string, abs: string) => {
      for (const e of readdirSync(abs, { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        out.push([r, e.isDirectory()]);
        if (e.isDirectory() && e.name !== ".git") walkDir(r, join(abs, e.name));
      }
    };
    walkDir("", d);
    return out;
  };

  it.each(fixtures)("E26: sync and yielding loaders agree on every path — %s", async (_label, files) => {
    const d = mk(files);
    const opts = { cwd: d, prune: (rel: string) => /(^|\/)node_modules(\/|$)/.test(rel) };
    const sync = loadGitignoreMatcher(d, opts);
    const async_ = await loadGitignoreMatcherYielding(d, { ...opts, ...noYield });
    for (const [rel, isDir] of paths(d)) {
      expect({ rel, v: isDir ? async_.isIgnoredDir(rel) : async_.isIgnored(rel) }).toEqual({ rel, v: isDir ? sync.isIgnoredDir(rel) : sync.isIgnored(rel) });
    }
  });

  it.each([
    [499, 0],
    [500, 1],
    [501, 1],
    [1000, 2],
  ])("E28: %i directories visited → %i yields", async (dirs, yields) => {
    const d = mk({});
    makeFlatDirs(d, dirs - 1); // + the walk root = `dirs` directories stepped
    let n = 0;
    await loadGitignoreMatcherYielding(d, { cwd: d, yieldEvery: 500, yieldFn: async () => void n++ });
    expect(n).toBe(yields);
  });

  it("E22: the pre-scan never descends into .worktrees (prune), even under a negation", async () => {
    const d = mk({ ".gitignore": "!.worktrees/\n", ".worktrees/w/.gitignore": "*.md\n", ".worktrees/w/x.md": "x", "ok.md": "x" });
    const m = await loadGitignoreMatcherYielding(d, { cwd: d, prune: (rel) => /(^|\/)\.worktrees(\/|$)/.test(rel), ...noYield });
    // The nested file was never parsed, so its pattern can't apply: x.md is not ignored by it.
    expect(m.isIgnored(".worktrees/w/x.md")).toBe(false);
  });
});
