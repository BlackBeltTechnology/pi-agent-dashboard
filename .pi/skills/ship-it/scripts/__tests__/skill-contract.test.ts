/**
 * ship-it SKILL.md contract (test-plan #E19, #E20, #F1, #F2, #P1, #X3).
 *
 * The skill IS the implementation for steps 4.4 and 4.5 — the orchestration is
 * prose an agent follows, not code it calls. So the prose is what these
 * assertions pin. Without them the wiring can be silently deleted and every
 * other test in this change would still pass.
 *
 * Style mirrors `scripts/__tests__/lint-ledger.test.mjs`.
 *
 * See change: wire-local-review-gate, harden-review-and-fix-loop (#X4-#X11).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SKILL = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");

const indexOfStep = (heading: string) => {
  const i = SKILL.indexOf(heading);
  expect(i, `missing section: ${heading}`).toBeGreaterThan(-1);
  return i;
};

describe("#F1 step ordering", () => {
  it("places enforcers and review between the harness and ship-change", () => {
    const harness = indexOfStep("### 3. Harness lifecycle");
    const enforcers = indexOfStep("### 4.4.");
    const review = indexOfStep("### 4.5.");
    const shipChange = indexOfStep("### 6. Drive ship-change INLINE");

    expect(harness).toBeLessThan(enforcers);
    expect(enforcers).toBeLessThan(review);
    expect(review).toBeLessThan(shipChange);
  });

  it("#P1 states that a 4.4 failure prevents 4.5 from running", () => {
    const s = SKILL.slice(indexOfStep("### 4.4."), indexOfStep("### 4.5."));
    expect(s).toMatch(/step 4\.5\*{0,2}\s*\n?\s*\*{0,2}does not run/i);
    expect(s).toMatch(/never spend a model call|before any model call/i);
  });
});

describe("#E20 the enforcers wired at 4.4", () => {
  const section = () => SKILL.slice(indexOfStep("### 4.4."), indexOfStep("### 4.5."));

  it("invokes check-conventions with an explicit --base", () => {
    expect(section()).toMatch(/check-conventions\.mjs --base origin\/develop/);
  });

  it("invokes the dox byte-arm gate, not raw `kb dox lint`", () => {
    expect(section()).toMatch(/dox-byte-gate\.mjs/);
    expect(section()).not.toMatch(/^\s*(npx )?kb dox lint\s*$/m);
  });

  it("#E20 invokes i18n-lint with --strict, since it exits 0 otherwise", () => {
    expect(section()).toMatch(/i18n-lint\.mjs --strict/);
  });

  it("invokes i18n-parity", () => {
    expect(section()).toMatch(/i18n-parity\.mjs/);
  });

  it("keeps the enforcers out of quality:changed", () => {
    expect(section()).toMatch(/do NOT move into `quality:changed`|not into `quality:changed`/i);
  });
});

describe("the review checkpoint at 4.5", () => {
  const section = () => SKILL.slice(indexOfStep("### 4.5."), indexOfStep("### 5. Boundary-reverse"));

  it("#E19 declares no triviality escape", () => {
    const s = section();
    expect(s).toMatch(/no triviality escape/i);
    expect(s).toMatch(/every.{0,20}invocation/i);
  });

  it("#X3 spawns an isolated subagent on @review, never an inline self-review", () => {
    const s = section();
    expect(s).toMatch(/`Agent` call with `model: "@review"`/);
    expect(s).toMatch(/[Nn]ever an in-context self-review/);
  });

  it("#X3 does not delegate to the CodeRabbit CLI", () => {
    expect(section()).toMatch(/never the\s*\n?\s*CodeRabbit CLI/i);
  });

  it("requires @review with no fallback to the session default", () => {
    const s = section();
    expect(s).toMatch(/REQUIRED/);
    expect(s).toMatch(/no fallback to the session\s*\n?\s*default model/i);
    expect(s).toMatch(/update_roles/);
  });

  it("scopes the diff three-dot so the 2.5 merge is not attributed", () => {
    expect(section()).toMatch(/git diff origin\/develop\.\.\.HEAD/);
  });

  it("bounds the call by the shared timeout constant", () => {
    expect(section()).toMatch(/REVIEW_TIMEOUT_MS/);
  });

  it("routes only issue(blocking) into the fix loop", () => {
    expect(section()).toMatch(/only `issue\(blocking\)`/);
  });

  it("#F2 states the hard two-round cap and rejects a no-progress bound", () => {
    const s = section();
    expect(s).toMatch(/base cap is two rounds/i);
    expect(s).toMatch(/hard numeric cap/i);
    expect(s).toMatch(/no-progress bound would never fire/i);
  });

  it("routes an unsatisfiable finding to the escape hatch without relaxing the guardrail", () => {
    const s = section();
    expect(s).toMatch(/assertNoWeakening/);
    expect(s).toMatch(/never relaxed/i);
  });
});

describe("#F2 guardrails and composed skills", () => {
  it("names review-code as a composed skill", () => {
    expect(SKILL.slice(indexOfStep("## Composed skills"))).toMatch(/`review-code`/);
  });

  it("carries the new invariants in Guardrails", () => {
    const g = SKILL.slice(indexOfStep("## Guardrails"), indexOfStep("## Composed skills"));
    expect(g).toMatch(/Enforcers \(4\.4\) before the reviewer \(4\.5\)/);
    expect(g).toMatch(/Two review rounds, hard cap/);
    expect(g).toMatch(/never fall back to the session default model/i);
  });

  it("shows 4.4 and 4.5 in the flowchart", () => {
    const chart = SKILL.slice(SKILL.indexOf("```mermaid"), SKILL.indexOf("```", SKILL.indexOf("```mermaid") + 3));
    expect(chart).toMatch(/4\.4/);
    expect(chart).toMatch(/4\.5/);
  });

  it("points at review-gate.ts as unit-tested decision logic", () => {
    expect(SKILL).toMatch(/scripts\/review-gate\.ts/);
    expect(SKILL).toMatch(/reviewRoundDecision/);
  });
});

// ─── harden-review-and-fix-loop (test-plan #X4-#X11) ─────────────────────────

const REPO = path.resolve(skillDir, "../../..");
const step45 = () => SKILL.slice(indexOfStep("### 4.5."), indexOfStep("### 5. Boundary-reverse"));
const step1 = () => SKILL.slice(indexOfStep("### 1. Orient"), indexOfStep("### 2. Run apply"));
const guardrails = () => SKILL.slice(indexOfStep("## Guardrails"), indexOfStep("## Composed skills"));

function frontmatter(file: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(fs.readFileSync(file, "utf8"));
  expect(m, `no frontmatter in ${file}`).not.toBeNull();
  const out: Record<string, string> = {};
  for (const line of m![1].split("\n")) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

describe("#X4 the CodeReviewer agent definition", () => {
  const fm = () => frontmatter(path.join(REPO, ".pi/agents/CodeReviewer.md"));

  it("runs on @review with context inheritance disabled", () => {
    expect(fm().model).toBe('"@review"');
    expect(fm().inherit_context).toBe("false");
  });

  it("has exactly the read-only tool set, in YAML array form", () => {
    const tools = /^\[(.*)\]$/.exec(fm().tools);
    expect(tools, "tools must be YAML array form").not.toBeNull();
    expect(tools![1].split(",").map((t) => t.trim())).toEqual(["read", "grep", "find", "ls", "bash"]);
  });
});

describe("#X5-#X7, #X11 step 4.5 procedure", () => {
  it("#X5 spawns only the CodeReviewer agent type", () => {
    const types = [...step45().matchAll(/subagent_type:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(types.length).toBeGreaterThan(0);
    expect(new Set(types)).toEqual(new Set(["CodeReviewer"]));
  });

  it("#X6 generates the prompt with the CLI and passes it verbatim", () => {
    const s = step45();
    expect(s).toMatch(/\.pi\/skills\/ship-it\/scripts\/review-prompt\.ts/);
    expect(s).toMatch(/--change <change> --round 1/);
    expect(s).toMatch(/\*\*verbatim\*\*/);
    expect(s).toMatch(/never hand-write/i);
  });

  it("#X6 derives state and validates the ledger through the CLI", () => {
    const s = step45();
    expect(s).toMatch(/--state "\$RUN"/);
    expect(s).toMatch(/--validate-ledger --prior/);
    expect(s).toMatch(/No verification round while validation fails/);
  });

  it("#X6 commits before each round and re-runs harness + enforcers after a review fix", () => {
    const s = step45();
    expect(s).toMatch(/Commit the worktree before each round/);
    expect(s).toMatch(/re-run the harness \(step 3\) and the step-4\.4 enforcers/i);
  });

  it("commits only the change's own paths before a round — never unrelated local edits", () => {
    const s = step45();
    expect(s).not.toMatch(/git add -A/);
    expect(s).toMatch(/stage the\s+change's own paths explicitly/);
    expect(s).toMatch(/unrelated local edits[\s\S]{0,80}stay unstaged/);
    // `git commit` alone takes everything already staged — commit the path list only.
    expect(s).toMatch(/git commit -- <paths>/);
    expect(s).toMatch(/already staged[\s\S]{0,60}stay out/);
  });

  it("#X6 retries a malformed reply once, then halts like a timeout", () => {
    const s = step45();
    expect(s).toMatch(/Retry once/);
    expect(s).toMatch(/second malformed reply halts\s+like\s+a timeout/i);
  });

  it("#X7 preserves the safety clauses", () => {
    const s = step45();
    expect(s).toMatch(/`Agent` call with `model: "@review"`/);
    expect(s).toMatch(/REVIEW_TIMEOUT_MS/);
    expect(s).toMatch(/never the\s*\n?\s*CodeRabbit CLI/i);
    expect(s).toMatch(/assertNoWeakening/);
  });

  it("#X11 a failing ask_user call is treated as headless and escapes", () => {
    expect(step45()).toMatch(/If the `ask_user` call fails, treat the run as\s+headless and take the escape hatch/);
  });

  it("asks with exactly the two continuation options and records approvals", () => {
    const s = step45();
    expect(s).toMatch(/one more verification round\*\* \/ \*\*hand back to\s+planning/);
    expect(s).toMatch(/approvals\.log/);
  });
});

describe("#X8 step-1 entry gate", () => {
  it("stops headless runs and asks interactive runs when SHIP_IT_BLOCKED.md exists", () => {
    const s = step1();
    expect(s).toMatch(/SHIP_IT_BLOCKED\.md/);
    expect(s).toMatch(/\*\*Headless\*\* → exit non-zero naming `SHIP_IT_BLOCKED\.md`/);
    expect(s).toMatch(/`ask_user` \*\*resume \/ abort\*\*/);
    expect(s).toMatch(/copy `SHIP_IT_BLOCKED\.md` into it[\s\S]*remove\s+the file/);
  });
});

describe("#X9 Guardrails — the continuation cap", () => {
  it("states the cap, the +1-per-approval rule, no self-renewal, and the escape hatch", () => {
    const g = guardrails();
    expect(g).toMatch(/Two review rounds, hard cap/);
    expect(g).toMatch(/\+1 round per human approval/);
    expect(g).toMatch(/never renews its own\s+budget/);
    expect(g).toMatch(/boundary-reverse \(step-5\) escape hatch/);
    expect(g).not.toMatch(/never a third round/i);
  });
});

describe("#X10 review-code rubric — defect classes and fix protocol", () => {
  const RC = fs.readFileSync(path.join(REPO, "packages/eng-disciplines/.pi/skills/review-code/SKILL.md"), "utf8");
  const between = (a: string, b: string) => {
    const i = RC.indexOf(a);
    const j = RC.indexOf(b, i + 1);
    expect(i, `missing ${a}`).toBeGreaterThan(-1);
    return RC.slice(i, j < 0 ? undefined : j);
  };

  it("names all eight defect classes", async () => {
    const { DEFECT_CLASSES } = await import("../review-gate.ts");
    for (const c of DEFECT_CLASSES) expect(RC).toContain(c);
  });

  it("states the four-step fix protocol inside The Review → Fix Loop", () => {
    const loop = between("## The Review → Fix Loop", "\n## ");
    for (const step of [/Reproducing test first/, /Smallest fix/, /Sibling sweep/, /Re-read the fix against the finding's class/]) {
      expect(loop).toMatch(step);
    }
  });

  it("asks for a per-class sweep summary in Verification", () => {
    expect(between("## Verification", "\n## ")).toMatch(/per-class sweep summary/);
  });
});
