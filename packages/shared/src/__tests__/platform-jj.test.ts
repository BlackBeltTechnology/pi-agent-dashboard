/**
 * Tests for packages/shared/src/platform/jj.ts — Recipe argv shapes
 * and the pure `parseWorkspaceList` helper.
 *
 * Live integration tests (running real `jj` against a temp repo) are
 * deferred to the integration-test phase; argv shape coverage here
 * catches the most common refactor mistakes without requiring `jj`
 * on the test runner's PATH.
 *
 * See change: add-jj-workspace-plugin.
 */
import { describe, it, expect } from "vitest";
import {
  JJ_VERSION,
  JJ_WORKSPACE_ROOT,
  JJ_WORKSPACE_LIST,
  JJ_WORKSPACE_ADD,
  JJ_WORKSPACE_FORGET,
  JJ_BOOKMARK_CREATE,
  JJ_BOOKMARK_LIST,
  JJ_GIT_INIT_COLOCATE,
  JJ_GIT_PUSH,
  JJ_DIFF,
  JJ_RESOLVE_LIST,
  JJ_OP_LOG_HEAD,
  JJ_OP_RESTORE,
  JJ_REBASE,
  JJ_LOG_REVSET,
  JJ_RECIPES,
  parseWorkspaceList,
  findWorkspaceByName,
} from "../platform/jj.js";

// ── Argv shapes ─────────────────────────────────────────────────────────────

describe("JJ_VERSION.argv", () => {
  it("is `jj --version`", () => {
    expect(JJ_VERSION.argv({})).toEqual(["jj", "--version"]);
  });

  it("parses `jj 0.18.0` into `0.18.0`", () => {
    expect(JJ_VERSION.parse("jj 0.18.0\n", {})).toBe("0.18.0");
  });

  it("falls back to trimmed string when version regex fails", () => {
    expect(JJ_VERSION.parse("unknown-format\n", {})).toBe("unknown-format");
  });
});

describe("JJ_WORKSPACE_ROOT.argv", () => {
  it("is `jj workspace root`", () => {
    expect(JJ_WORKSPACE_ROOT.argv({ cwd: "/tmp" })).toEqual([
      "jj", "workspace", "root",
    ]);
  });
});

describe("JJ_WORKSPACE_LIST.argv", () => {
  it("includes --no-pager", () => {
    expect(JJ_WORKSPACE_LIST.argv({ cwd: "/tmp" })).toEqual([
      "jj", "workspace", "list", "--no-pager",
    ]);
  });
});

describe("JJ_WORKSPACE_ADD.argv", () => {
  it("without baseRev", () => {
    expect(JJ_WORKSPACE_ADD.argv({ cwd: "/repo", destPath: "/repo/.shadow/agent-1" })).toEqual([
      "jj", "workspace", "add", "/repo/.shadow/agent-1",
    ]);
  });

  it("with baseRev", () => {
    expect(JJ_WORKSPACE_ADD.argv({
      cwd: "/repo",
      destPath: "/repo/.shadow/agent-1",
      baseRev: "develop",
    })).toEqual([
      "jj", "workspace", "add", "/repo/.shadow/agent-1", "-r", "develop",
    ]);
  });

  it("path with spaces is passed verbatim (argv-array, no shell)", () => {
    expect(JJ_WORKSPACE_ADD.argv({ cwd: "/repo", destPath: "/repo/my workspace" })).toEqual([
      "jj", "workspace", "add", "/repo/my workspace",
    ]);
  });
});

describe("JJ_WORKSPACE_FORGET.argv", () => {
  it("is `jj workspace forget <name>`", () => {
    expect(JJ_WORKSPACE_FORGET.argv({ cwd: "/repo", name: "agent-1" })).toEqual([
      "jj", "workspace", "forget", "agent-1",
    ]);
  });
});

describe("JJ_BOOKMARK_CREATE.argv", () => {
  it("is `jj bookmark create <name> -r <rev>`", () => {
    expect(JJ_BOOKMARK_CREATE.argv({ cwd: "/repo", name: "feat", rev: "@" })).toEqual([
      "jj", "bookmark", "create", "feat", "-r", "@",
    ]);
  });
});

describe("JJ_BOOKMARK_LIST.argv", () => {
  it("includes name template and --no-pager", () => {
    const argv = JJ_BOOKMARK_LIST.argv({ cwd: "/repo" });
    expect(argv[0]).toBe("jj");
    expect(argv).toContain("bookmark");
    expect(argv).toContain("list");
    expect(argv).toContain("-T");
    expect(argv).toContain("--no-pager");
  });
});

describe("JJ_GIT_INIT_COLOCATE.argv", () => {
  it("is `jj git init --colocate`", () => {
    expect(JJ_GIT_INIT_COLOCATE.argv({ cwd: "/repo" })).toEqual([
      "jj", "git", "init", "--colocate",
    ]);
  });
});

describe("JJ_GIT_PUSH.argv", () => {
  it("includes --bookmark <name>", () => {
    expect(JJ_GIT_PUSH.argv({ cwd: "/repo", bookmark: "feat/agent-1" })).toEqual([
      "jj", "git", "push", "--bookmark", "feat/agent-1",
    ]);
  });
});

describe("JJ_DIFF.argv", () => {
  it("default invocation has no --from/--to", () => {
    expect(JJ_DIFF.argv({ cwd: "/repo" })).toEqual([
      "jj", "diff", "--no-pager",
    ]);
  });

  it("with --from and --to", () => {
    expect(JJ_DIFF.argv({ cwd: "/repo", fromRev: "develop", toRev: "@" })).toEqual([
      "jj", "diff", "--no-pager", "--from", "develop", "--to", "@",
    ]);
  });

  it("with path filter", () => {
    expect(JJ_DIFF.argv({
      cwd: "/repo",
      fromRev: "develop",
      toRev: "@",
      path: "src/auth.ts",
    })).toEqual([
      "jj", "diff", "--no-pager",
      "--from", "develop",
      "--to", "@",
      "--", "src/auth.ts",
    ]);
  });

  it("path-only diff (working copy)", () => {
    expect(JJ_DIFF.argv({ cwd: "/repo", path: "src/auth.ts" })).toEqual([
      "jj", "diff", "--no-pager", "--", "src/auth.ts",
    ]);
  });
});

describe("JJ_RESOLVE_LIST.argv", () => {
  it("is `jj resolve --list`", () => {
    expect(JJ_RESOLVE_LIST.argv({ cwd: "/repo" })).toEqual([
      "jj", "resolve", "--list", "--no-pager",
    ]);
  });

  it("tolerates exit code 1 (no conflicts)", () => {
    expect(JJ_RESOLVE_LIST.tolerate).toContain(1);
  });
});

describe("JJ_OP_LOG_HEAD.argv", () => {
  it("includes --limit 1 and id.short() template", () => {
    const argv = JJ_OP_LOG_HEAD.argv({ cwd: "/repo" });
    expect(argv).toContain("op");
    expect(argv).toContain("log");
    expect(argv).toContain("--limit");
    expect(argv).toContain("1");
    expect(argv).toContain("-T");
  });

  it("parses single-line short id output", () => {
    expect(JJ_OP_LOG_HEAD.parse("abc1234\n", { cwd: "/repo" })).toBe("abc1234");
  });

  it("returns undefined for empty output", () => {
    expect(JJ_OP_LOG_HEAD.parse("\n", { cwd: "/repo" })).toBeUndefined();
  });
});

describe("JJ_OP_RESTORE.argv", () => {
  it("is `jj op restore <op-id>`", () => {
    expect(JJ_OP_RESTORE.argv({ cwd: "/repo", opId: "abc1234" })).toEqual([
      "jj", "op", "restore", "abc1234",
    ]);
  });
});

describe("JJ_REBASE.argv", () => {
  it("is `jj rebase -d <dest> -s <src>`", () => {
    expect(JJ_REBASE.argv({ cwd: "/repo", dest: "main", src: "agent-1" })).toEqual([
      "jj", "rebase", "-d", "main", "-s", "agent-1",
    ]);
  });
});

describe("JJ_LOG_REVSET.argv", () => {
  it("uses default change_id template", () => {
    const argv = JJ_LOG_REVSET.argv({ cwd: "/repo", revset: "trunk()..@" });
    expect(argv).toContain("log");
    expect(argv).toContain("-r");
    expect(argv).toContain("trunk()..@");
    expect(argv).toContain("--no-graph");
  });

  it("respects custom template", () => {
    const argv = JJ_LOG_REVSET.argv({
      cwd: "/repo",
      revset: "@",
      template: 'description ++ "\\n"',
    });
    expect(argv).toContain('description ++ "\\n"');
  });
});

describe("JJ_RECIPES registry", () => {
  it("enumerates all exported recipes", () => {
    const keys = Object.keys(JJ_RECIPES).sort();
    expect(keys).toEqual([
      "JJ_BOOKMARK_CREATE",
      "JJ_BOOKMARK_LIST",
      "JJ_DIFF",
      "JJ_GIT_INIT_COLOCATE",
      "JJ_GIT_PUSH",
      "JJ_LOG_REVSET",
      "JJ_OP_LOG_HEAD",
      "JJ_OP_RESTORE",
      "JJ_REBASE",
      "JJ_RESOLVE_LIST",
      "JJ_VERSION",
      "JJ_WORKSPACE_ADD",
      "JJ_WORKSPACE_FORGET",
      "JJ_WORKSPACE_LIST",
      "JJ_WORKSPACE_ROOT",
    ]);
  });

  it("every recipe has argv and parse functions", () => {
    for (const [name, recipe] of Object.entries(JJ_RECIPES)) {
      expect(typeof recipe.argv, `${name}.argv`).toBe("function");
      expect(typeof recipe.parse, `${name}.parse`).toBe("function");
    }
  });

  it("every recipe's argv starts with `jj`", () => {
    for (const [name, recipe] of Object.entries(JJ_RECIPES)) {
      // Use a forgiving input shape — we only care about the binary name.
      const argv = (recipe.argv as (i: any) => readonly string[])({
        cwd: "/tmp",
        destPath: "/x",
        baseRev: "@",
        name: "x",
        rev: "@",
        bookmark: "x",
        opId: "x",
        dest: "x",
        src: "x",
        revset: "@",
        path: "x",
      });
      expect(argv[0], `${name} first arg`).toBe("jj");
    }
  });
});

// ── parseWorkspaceList ──────────────────────────────────────────────────────

describe("parseWorkspaceList", () => {
  it("parses standard two-workspace output", () => {
    const out = `default: rxnxoqlk 4f2c1234 (no description set)
agent-1: tmysxysu 0c4b5678 (empty) (no description set)
`;
    expect(parseWorkspaceList(out)).toEqual([
      { name: "default", changeIdShort: "rxnxoqlk", commitIdShort: "4f2c1234" },
      { name: "agent-1", changeIdShort: "tmysxysu", commitIdShort: "0c4b5678" },
    ]);
  });

  it("captures non-default descriptions", () => {
    const out = `default: rxnxoqlk 4f2c1234 work in progress on auth\n`;
    expect(parseWorkspaceList(out)).toEqual([
      {
        name: "default",
        changeIdShort: "rxnxoqlk",
        commitIdShort: "4f2c1234",
        description: "work in progress on auth",
      },
    ]);
  });

  it("ignores blank and malformed lines", () => {
    const out = `\ndefault: rxnxoqlk 4f2c1234 (no description set)\nrandom garbage\n: missing-name 1234 5678\n`;
    const entries = parseWorkspaceList(out);
    expect(entries.map((e) => e.name)).toEqual(["default"]);
  });

  it("yields entry without ids when format is unexpected", () => {
    const out = `weird-name: this is not an id pair\n`;
    const entries = parseWorkspaceList(out);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe("weird-name");
    expect(entries[0]?.changeIdShort).toBeUndefined();
  });

  it("returns empty array for empty input", () => {
    expect(parseWorkspaceList("")).toEqual([]);
  });
});

describe("findWorkspaceByName", () => {
  const fixtures = parseWorkspaceList(
    `default: aaaa 1111 (no description set)\nagent-1: bbbb 2222 (no description set)\n`,
  );

  it("returns the matching entry by name", () => {
    expect(findWorkspaceByName(fixtures, "agent-1")?.changeIdShort).toBe("bbbb");
  });

  it("returns undefined for unknown name", () => {
    expect(findWorkspaceByName(fixtures, "ghost")).toBeUndefined();
  });
});
