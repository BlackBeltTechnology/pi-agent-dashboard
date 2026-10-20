/**
 * #E8 — the supervised default set must not drift from the pinned pi built-ins.
 * A pi bump that adds a built-in outside readFamily ∪ riskySet ∪ wrapperTools
 * fails here and forces a classification (design D2). The fixture is regenerated
 * by the `bump-pi-version` procedure from pi's `docs/cli.md` built-in tool list.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readFamily, riskySet, wrapperTools } from "../supervised-policy.js";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/pi-builtin-tools.json", import.meta.url), "utf8"),
) as { piVersion: string; tools: string[] };

/** Built-ins not classified by any of the three sets (case-insensitive). */
function unclassified(tools: readonly string[]): string[] {
  const known = new Set([...readFamily, ...riskySet, ...wrapperTools].map((t) => t.toLowerCase()));
  return tools.filter((t) => !known.has(t.toLowerCase()));
}

function assertNoDrift(tools: readonly string[]): void {
  const missing = unclassified(tools);
  if (missing.length > 0) {
    throw new Error(
      `pi built-in tool(s) not classified by supervised mode: ${missing.join(", ")} — add to readFamily / riskySet / wrapperTools (design D2)`,
    );
  }
}

describe("supervised classification vs pinned pi built-ins (#E8)", () => {
  it("fixture pins pi 1.3.0 with the 8 built-ins + codemode,tool_search", () => {
    expect(fixture.piVersion).toBe("1.3.0");
    expect([...fixture.tools].sort()).toEqual(
      ["read", "bash", "powershell", "edit", "write", "grep", "find", "ls", "codemode", "tool_search"].sort(),
    );
  });

  it("pinned fixture passes", () => {
    expect(() => assertNoDrift(fixture.tools)).not.toThrow();
  });

  it("variant adding patch_file FAILS with a message naming patch_file", () => {
    expect(() => assertNoDrift([...fixture.tools, "patch_file"])).toThrow(/patch_file/);
  });
});
