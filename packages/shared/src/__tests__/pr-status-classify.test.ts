/**
 * `collapseCheckRollup` bucket table (test-plan #E1) and the `GH_PR_STATUS`
 * three-way classification (test-plan #E2).
 * See change: redesign-composer-session-strip (D5).
 */
import { describe, expect, it } from "vitest";
import { type CheckRollupEntry, collapseCheckRollup } from "../platform/check-rollup.js";
import { classifyPrStatus, GH_PR_STATUS, type GhPrViewJson } from "../platform/git.js";
import type { Result } from "../platform/runner.js";

describe("collapseCheckRollup (#E1)", () => {
  const cr = (status: string, conclusion?: string): CheckRollupEntry => ({ __typename: "CheckRun", status, conclusion });
  const sc = (state: string): CheckRollupEntry => ({ __typename: "StatusContext", state });
  const table: Array<[string, CheckRollupEntry[], string]> = [
    ["empty", [], "none"],
    ["CheckRun SUCCESS", [cr("COMPLETED", "SUCCESS")], "passing"],
    ["StatusContext SUCCESS", [sc("SUCCESS")], "passing"],
    ["CheckRun SKIPPED + NEUTRAL", [cr("COMPLETED", "SKIPPED"), cr("COMPLETED", "NEUTRAL")], "passing"],
    ["CheckRun FAILURE + IN_PROGRESS", [cr("COMPLETED", "FAILURE"), cr("IN_PROGRESS")], "failing"],
    ["CheckRun TIMED_OUT + SUCCESS", [cr("COMPLETED", "TIMED_OUT"), cr("COMPLETED", "SUCCESS")], "failing"],
    ["CheckRun STALE", [cr("COMPLETED", "STALE")], "failing"],
    ["StatusContext ERROR", [sc("ERROR")], "failing"],
    ["StatusContext PENDING", [sc("PENDING")], "pending"],
    ["StatusContext EXPECTED", [sc("EXPECTED")], "pending"],
    ["CheckRun conclusion WEIRD", [cr("COMPLETED", "WEIRD")], "pending"],
  ];
  it.each(table)("%s", (_name, rollup, expected) => {
    expect(collapseCheckRollup(rollup)).toBe(expected);
  });

  it("null / undefined rollup → none", () => {
    expect(collapseCheckRollup(null)).toBe("none");
    expect(collapseCheckRollup(undefined)).toBe("none");
  });

  it("legacy entries without __typename keep their previous meaning", () => {
    expect(collapseCheckRollup([{ status: "SUCCESS", conclusion: "SUCCESS" }])).toBe("passing");
    expect(collapseCheckRollup([{ status: "PENDING" }])).toBe("pending");
    expect(collapseCheckRollup([{ status: "FAILURE", conclusion: "FAILURE" }])).toBe("failing");
  });
});

describe("GH_PR_STATUS classification (#E2)", () => {
  const ok = (stdout: string): Result<GhPrViewJson> => {
    try {
      return { ok: true, value: GH_PR_STATUS.parse(stdout, { cwd: "/r" }) };
    } catch (e) {
      return { ok: false, error: { kind: "spawn-failure", message: (e as Error).message } };
    }
  };
  const exit = (code: number, stderr: string): Result<GhPrViewJson> => ({
    ok: false,
    error: { kind: "exit", code, signal: null, stdout: "", stderr },
  });

  it("exit 0 + JSON → parsed with lowercased state", () => {
    const r = classifyPrStatus(
      ok(JSON.stringify({ number: 747, state: "OPEN", isDraft: false, url: "https://gh/pr/747", statusCheckRollup: [] })),
    );
    expect(r).toEqual({
      kind: "parsed",
      value: { number: 747, state: "open", isDraft: false, url: "https://gh/pr/747", checks: "none" },
    });
  });

  it('exit 1 + "no pull requests found" → absent', () => {
    expect(classifyPrStatus(exit(1, 'no pull requests found for branch "x"')).kind).toBe("absent");
  });

  it("exit 1 + HTTP 401 → failure", () => {
    expect(classifyPrStatus(exit(1, "HTTP 401: Bad credentials")).kind).toBe("failure");
  });

  it("exit 4 → failure", () => {
    expect(classifyPrStatus(exit(4, "auth required")).kind).toBe("failure");
  });

  it("timeout at 20 s → failure", () => {
    expect(classifyPrStatus({ ok: false, error: { kind: "timeout", timeoutMs: 20_000, binary: "gh" } }).kind).toBe("failure");
  });

  it("ENOENT (gh missing) → failure", () => {
    expect(classifyPrStatus({ ok: false, error: { kind: "not-found", binary: "gh" } }).kind).toBe("failure");
  });

  it("malformed JSON → failure", () => {
    expect(classifyPrStatus(ok("not json")).kind).toBe("failure");
  });
});
