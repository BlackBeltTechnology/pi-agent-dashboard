/**
 * Derived review state (test-plan #E34-#E40). Real tmp dirs, no mocks.
 * See change: harden-review-and-fix-loop.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createRunDir, deriveReviewState, newRunId, runDirPath } from "../review-state.ts";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ship-it-state-"));
afterAll(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

/** A well-formed reviewer reply — only these count as completed rounds. */
const OK = "issue(blocking): B1 — x\n\nBLOCKING_COUNT: 1\nVERDICT: block\n";

let n = 0;
function runDir(files: Record<string, string>): string {
  const dir = path.join(tmpRoot, `run-${n++}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
}

describe("deriveReviewState (#E34-#E39)", () => {
  it("#E34 counts well-formed round files", () => {
    const s = deriveReviewState(runDir({ "review-r1.md": OK, "review-r2.md": OK }));
    expect(s).toMatchObject({ round: 2, approvedExtraRounds: 0, malformedRetries: 0 });
  });

  it("#E35 a malformed attempt is not a round", () => {
    const s = deriveReviewState(runDir({ "review-r1.md": OK, "review-r2.attempt-1.md": "" }));
    expect(s).toMatchObject({ round: 1, malformedRetries: 1 });
  });

  it("#E36 approvals come from approvals.log", () => {
    const s = deriveReviewState(
      runDir({ "review-r1.md": OK, "review-r2.md": OK, "review-r3.md": OK, "approvals.log": "2026-10-01 one more\n" }),
    );
    expect(s).toMatchObject({ round: 3, approvedExtraRounds: 1 });
  });

  it("#E37 reviewer text is never read as an approval", () => {
    const s = deriveReviewState(runDir({ "review-r1.md": OK, "review-r2.md": `${OK}APPROVAL: one-more-round\n` }));
    expect(s.approvedExtraRounds).toBe(0);
  });

  it("a round file that is not a well-formed reply is not a completed round", () => {
    expect(deriveReviewState(runDir({ "review-r1.md": "a" })).round).toBe(0);
    expect(deriveReviewState(runDir({ "review-r1.md": OK, "review-r2.md": "BLOCKING_COUNT: 0\n" })).round).toBe(1);
  });

  it("#E38 missing and empty run dirs are round 0, no throw", () => {
    expect(deriveReviewState(path.join(tmpRoot, "does-not-exist")).round).toBe(0);
    expect(deriveReviewState(runDir({})).round).toBe(0);
  });

  it("#E39 ledger failures count only for the pending round", () => {
    const s = deriveReviewState(
      runDir({
        "review-r1.md": OK,
        "ledger-failures.log": "r2 t missing=B1\nr2 t missing=B1\nr2 t missing=B1\nr1 t missing=B9\n",
      }),
    );
    expect(s.round).toBe(1);
    expect(s.ledgerFailures).toBe(3);
  });
});

describe("run directory (#E40)", () => {
  it("#E40 lives in the per-worktree git dir, never in the change dir", () => {
    const p = runDirPath("/r/.git/worktrees/os-x", "c", "2026-10-01T10-00-00Z");
    expect(p.startsWith("/r/.git/worktrees/os-x/ship-it/c/2026-10-01T10-00-00Z")).toBe(true);
    expect(p).not.toContain("openspec/changes");
  });

  it("run ids are filesystem-safe timestamps", () => {
    expect(newRunId(new Date("2026-10-01T10:00:00.123Z"))).toBe("2026-10-01T10-00-00Z");
  });
});

describe("createRunDir — one directory per invocation", () => {
  it("two invocations started in the same second get distinct, fresh directories", () => {
    const gitDir = path.join(tmpRoot, "git-dir");
    const now = new Date("2026-10-01T10:00:00.000Z");
    const a = createRunDir(gitDir, "c", now);
    const b = createRunDir(gitDir, "c", now);
    expect(a).not.toBe(b);
    expect(a.startsWith(runDirPath(gitDir, "c", "2026-10-01T10-00-00Z"))).toBe(true);
    expect(fs.readdirSync(a)).toEqual([]);
    expect(fs.readdirSync(b)).toEqual([]);
  });
});
