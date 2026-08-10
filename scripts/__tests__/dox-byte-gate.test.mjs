/**
 * AGENTS.md byte-cap gate (test-plan #E16-#E18).
 *
 * `kb dox lint` already owns AGENTS_BYTE_CAP, so this gate recomputes nothing —
 * it FILTERS that command's own verdict. It has to, because the CLI exits 1 on
 * any of its seven issue kinds and the tree carries 59 issues today, exactly one
 * of which is the byte-cap breach. Wiring the raw command would adopt a 58-issue
 * backlog as a blocking gate that could never land green.
 *
 * Fixtures mirror the real `kb dox lint --json` shape.
 *
 * See change: wire-local-review-gate.
 */
import { describe, expect, it } from "vitest";
import { byteArmIssues } from "../dox-byte-gate.mjs";

const overBytes = {
  kind: "over-threshold",
  agentsFile: "docs/AGENTS.md",
  arm: "bytes",
  detail: "31521 bytes > cap 30000; auto-injected per turn",
};
const overRows = {
  kind: "over-threshold",
  agentsFile: "docs/AGENTS.md",
  arm: "rows",
  detail: "50 inline rows > cap 40; informational",
};

describe("byteArmIssues", () => {
  it("#E16 reports an over-cap file", () => {
    const found = byteArmIssues({ issues: [overBytes] });
    expect(found).toHaveLength(1);
    expect(found[0].agentsFile).toBe("docs/AGENTS.md");
  });

  it("#E17 ignores every non-byte issue kind", () => {
    const issues = [
      ...Array.from({ length: 30 }, (_, i) => ({ kind: "missing", agentsFile: `a${i}/AGENTS.md` })),
      ...Array.from({ length: 19 }, (_, i) => ({
        kind: "missing-companion",
        agentsFile: `b${i}/AGENTS.md`,
      })),
      ...Array.from({ length: 4 }, (_, i) => ({ kind: "broken-ref", agentsFile: `c${i}.md` })),
      { kind: "orphan", agentsFile: "d/AGENTS.md" },
      { kind: "stale", agentsFile: "e/AGENTS.md" },
      { kind: "broken-pointer", agentsFile: "f/AGENTS.md" },
    ];
    expect(byteArmIssues({ issues })).toHaveLength(0);
  });

  it("#E18 ignores the informational rows arm", () => {
    expect(byteArmIssues({ issues: [overRows] })).toHaveLength(0);
  });

  it("#E17 picks the single byte issue out of a realistic mixed report", () => {
    const issues = [overBytes, overRows, { kind: "missing", agentsFile: "x/AGENTS.md" }];
    expect(byteArmIssues({ issues }).map((i) => i.arm)).toEqual(["bytes"]);
  });

  it("tolerates an empty or malformed report without throwing", () => {
    expect(byteArmIssues({ issues: [] })).toHaveLength(0);
    expect(byteArmIssues({})).toHaveLength(0);
    expect(byteArmIssues(null)).toHaveLength(0);
  });
});
