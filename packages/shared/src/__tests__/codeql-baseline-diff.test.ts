/**
 * Reason-only baseline edits (test-plan #S11): `reasonOnlyDiff` in
 * `scripts/codeql-local.mjs` accepts a change that only re-types `reason`, and
 * reports (ok:false) any added / removed / count-changed entry — a `ruleId`,
 * `file` or `lineHash` change is an add + a remove.
 * See change: harden-path-and-process-guards (#1104).
 */
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const scriptUrl = url.pathToFileURL(path.resolve(here, "..", "..", "..", "..", "scripts", "codeql-local.mjs")).href;

type Entry = { ruleId: string; file: string; lineHash: string; count: number; reason: string };
type Diff = { ok: boolean; reasonOnly: string[]; other: string[] };
const { reasonOnlyDiff } = (await import(/* @vite-ignore */ scriptUrl)) as {
  reasonOnlyDiff: (a: { entries: Entry[] }, b: { entries: Entry[] }) => Diff;
};

const base: Entry = {
  ruleId: "js/path-injection",
  file: "packages/automation-plugin/src/server/automation-writer.ts",
  lineHash: "14d5e7e33b99b3ec:1",
  count: 1,
  reason: "accepted-risk: tracked in #1104",
};
const ref = { entries: [base] };

describe("reasonOnlyDiff (#S11)", () => {
  it("a reason-only change passes and is listed", () => {
    const r = reasonOnlyDiff(ref, { entries: [{ ...base, reason: "false-positive: gate: admitRouteCwdParam x.ts:1" }] });
    expect(r.ok).toBe(true);
    expect(r.reasonOnly).toHaveLength(1);
    expect(r.other).toEqual([]);
  });

  it("an unchanged baseline is ok with nothing listed", () => {
    expect(reasonOnlyDiff(ref, ref)).toEqual({ ok: true, reasonOnly: [], other: [] });
  });

  it.each([
    ["reason + lineHash", { lineHash: "ffff:1", reason: "false-positive: x" }],
    ["count", { count: 2 }],
    ["ruleId", { ruleId: "js/command-line-injection" }],
    ["file", { file: "packages/other/src/x.ts" }],
  ])("a %s change is reported and fails", (_n, patch) => {
    const r = reasonOnlyDiff(ref, { entries: [{ ...base, ...patch }] });
    expect(r.ok).toBe(false);
    expect(r.other.length).toBeGreaterThan(0);
  });

  it("a removed entry fails", () => {
    expect(reasonOnlyDiff(ref, { entries: [] }).ok).toBe(false);
  });
});
