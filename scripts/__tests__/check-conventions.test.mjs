/**
 * Repo convention checks (test-plan #E4-#E8, #E10-#E15).
 *
 * Style mirrors `scripts/__tests__/lint-ledger.test.mjs` — drive the exported
 * rule fns directly rather than shelling out, so each detector is pinned
 * independently of git state.
 *
 * The negative cases carry the weight here. A naive "any box-drawing character"
 * rule flags README.md's directory tree; a naive "browser" rule would mandate
 * migrating three qa/ WebSocket smokes that belong in the per-OS VM matrix.
 * Both were caught by doubt-review and both are asserted below.
 *
 * See change: wire-local-review-gate.
 */
import { describe, expect, it } from "vitest";
import {
  disciplineSkillsViolations,
  mermaidViolations,
  mermaidViolationsIn,
  rootIndexViolations,
  shellBrowserViolations,
  unionTouched,
} from "../check-conventions.mjs";

const BOX_DOC = ["```text", "┌───┐", "│ x │", "└───┘", "```"].join("\n");

describe("Mermaid, not ASCII box-drawing (#E4, #E5)", () => {
  it("#E4 flags box-drawing inside a fenced block", () => {
    const md = ["# Doc", "", "```text", "┌────────┐", "│ a box  │", "└────────┘", "```"].join("\n");
    const v = mermaidViolations("docs/x.md", md);
    expect(v).toHaveLength(1);
    expect(v[0].line).toBe(4);
  });

  it("#E5 does NOT flag a fenced directory tree", () => {
    const md = [
      "# Doc",
      "",
      "```text",
      "src/",
      "├── a.ts",
      "│   └── nested.ts",
      "└── b.ts",
      "```",
    ].join("\n");
    expect(mermaidViolations("README.md", md)).toHaveLength(0);
  });

  it("#E5 ignores box-drawing OUTSIDE a fence", () => {
    expect(mermaidViolations("docs/x.md", "prose with ┌ stray char\n")).toHaveLength(0);
  });

  it("does not flag a mermaid block", () => {
    const md = ["```mermaid", "flowchart LR", "  A --> B", "```"].join("\n");
    expect(mermaidViolations("docs/x.md", md)).toHaveLength(0);
  });
});

describe("Mermaid rule is scoped to TOUCHED files, like D7's proposal rule", () => {
  it("flags a box-drawing diagram in a file this change touched", () => {
    const v = mermaidViolationsIn([{ status: "M", path: "docs/new.md", content: BOX_DOC }]);
    expect(v).toHaveLength(1);
  });

  it("does NOT adopt the repo's pre-existing backlog", () => {
    // 214 tracked .md files carry a box-drawing diagram, most of them archived
    // OpenSpec history. A tree-absolute rule would make the gate unlandable and
    // repeat the raw `kb dox lint` mistake.
    expect(mermaidViolationsIn([])).toHaveLength(0);
  });

  it("does NOT flag a pure rename", () => {
    const v = mermaidViolationsIn([{ status: "R", path: "docs/moved.md", content: BOX_DOC }]);
    expect(v).toHaveLength(0);
  });

  it("only inspects markdown", () => {
    const v = mermaidViolationsIn([{ status: "M", path: "src/x.ts", content: BOX_DOC }]);
    expect(v).toHaveLength(0);
  });
});

describe("touched set spans commits AND the working tree", () => {
  it("includes an uncommitted edit the committed diff cannot see", () => {
    // ship-it runs this gate inside its fix loop, where fixes are still
    // uncommitted. A commits-only touched set would pass a dirty, violating
    // tree — a gate that inspects nothing always passes.
    const u = unionTouched(
      [{ status: "M", path: "a.md", content: "a" }],
      [{ status: "M", path: "b.md", content: "b" }],
    );
    expect(u.map((e) => e.path).sort()).toEqual(["a.md", "b.md"]);
  });

  it("de-duplicates a file that is both committed and dirty, keeping worktree content", () => {
    const u = unionTouched(
      [{ status: "M", path: "a.md", content: "committed" }],
      [{ status: "M", path: "a.md", content: "worktree" }],
    );
    expect(u).toHaveLength(1);
    expect(u[0].content).toBe("worktree");
  });

  it("promotes a committed pure-rename that was then edited in the worktree", () => {
    const u = unionTouched(
      [{ status: "R", path: "a.md", content: "x" }],
      [{ status: "M", path: "a.md", content: "x" }],
    );
    expect(u[0].status).toBe("M");
  });
});

describe("Browser scenarios are Playwright specs (#E8)", () => {
  it("#E8 does NOT flag WebSocket / HTTP / health assertions", () => {
    const sh = [
      "#!/usr/bin/env bash",
      'curl -sf "http://localhost:$PORT/api/health" | jq -e .ok',
      'websocat "ws://localhost:$PORT/bridge" <<< "$payload"',
    ].join("\n");
    expect(shellBrowserViolations("qa/tests/03-websocket.sh", sh)).toHaveLength(0);
  });

  it("#E8 does NOT flag a display-server launch", () => {
    const sh = "#!/usr/bin/env bash\nxvfb-run -a ./run-electron-smoke.sh\n";
    expect(shellBrowserViolations("qa/tests/09-electron.sh", sh)).toHaveLength(0);
  });

  it("flags a shell test that drives rendered browser UI (regression guard)", () => {
    const sh = [
      "#!/usr/bin/env bash",
      'agent-browser open "http://localhost:$PORT"',
      'agent-browser click "@e1"',
    ].join("\n");
    const v = shellBrowserViolations("qa/tests/99-ui.sh", sh);
    expect(v).toHaveLength(1);
    expect(v[0].message).toMatch(/Playwright|tests\/e2e/);
  });

  it("only applies to qa/tests/*.sh", () => {
    expect(shellBrowserViolations("scripts/x.sh", 'agent-browser open "http://x"')).toHaveLength(0);
  });
});

describe("Root AGENTS.md has no per-file index (#E6, #E7)", () => {
  it("#E6 flags a table of file→purpose rows", () => {
    const md = [
      "# Root",
      "",
      "## Key Files",
      "",
      "| File | Purpose |",
      "|---|---|",
      "| `server.ts` | starts the server |",
      "| `client.ts` | renders the UI |",
    ].join("\n");
    expect(rootIndexViolations(md)).toHaveLength(1);
  });

  it("#E7 does NOT flag a pointer-only Key Files section", () => {
    const md = [
      "# Root",
      "",
      "## Key Files",
      "",
      "The architectural backbone is NOT indexed here. Per-file record = the",
      "directory `AGENTS.md` tree, via `kb agents <path>`.",
    ].join("\n");
    expect(rootIndexViolations(md)).toHaveLength(0);
  });

  it("#E7 does not flag an unrelated two-column table", () => {
    const md = ["| Subagent | Use for |", "|---|---|", "| `Explore` | read-only search |"].join(
      "\n",
    );
    expect(rootIndexViolations(md)).toHaveLength(0);
  });
});

describe("Touched proposals carry ## Discipline Skills (#E10-#E15)", () => {
  const withHeading = "# P\n\n## Discipline Skills\n\n- security-hardening\n";
  const without = "# P\n\n## Why\n\nbecause\n";

  it("#E10 flags an ADDED proposal without the heading", () => {
    const v = disciplineSkillsViolations([
      { status: "A", path: "openspec/changes/x/proposal.md", content: without },
    ]);
    expect(v).toHaveLength(1);
  });

  it("#E11 does not gate a proposal absent from the touched set", () => {
    expect(disciplineSkillsViolations([])).toHaveLength(0);
  });

  it("#E12 does not flag a PURE rename", () => {
    const v = disciplineSkillsViolations([
      { status: "R", path: "openspec/changes/x/proposal.md", content: without },
    ]);
    expect(v).toHaveLength(0);
  });

  it("#E13 flags a rename that also edited content", () => {
    const v = disciplineSkillsViolations([
      { status: "M", path: "openspec/changes/x/proposal.md", content: without },
    ]);
    expect(v).toHaveLength(1);
  });

  it("#E15 accepts a proposal stating no discipline applies", () => {
    const v = disciplineSkillsViolations([
      {
        status: "A",
        path: "openspec/changes/x/proposal.md",
        content: "# P\n\n## Discipline Skills\n\nNone apply — docs-only change.\n",
      },
    ]);
    expect(v).toHaveLength(0);
  });

  it("only applies to proposal.md", () => {
    const v = disciplineSkillsViolations([
      { status: "A", path: "openspec/changes/x/design.md", content: without },
    ]);
    expect(v).toHaveLength(0);
  });

  it("accepts a conforming proposal", () => {
    const v = disciplineSkillsViolations([
      { status: "A", path: "openspec/changes/x/proposal.md", content: withHeading },
    ]);
    expect(v).toHaveLength(0);
  });
});
