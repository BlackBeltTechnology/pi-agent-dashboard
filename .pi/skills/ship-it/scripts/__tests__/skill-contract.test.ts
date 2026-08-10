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
 * See change: wire-local-review-gate.
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
    expect(s).toMatch(/never a third round/i);
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
