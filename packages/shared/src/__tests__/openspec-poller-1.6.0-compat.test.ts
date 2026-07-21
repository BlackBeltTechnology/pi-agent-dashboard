/**
 * T-S3 (test-plan #S3): poller + init compat with openspec 1.6.0.
 *
 * Risk gate for `provision-openspec-cli-in-sessions`: raising the installed
 * `@fission-ai/openspec` 1.4.1 → 1.6.0 moves the server poller too. The poller
 * fails SILENT-EMPTY (`{ initialized: true, changes: [] }`) on a `status|list
 * --json` schema break — no error. This test feeds a payload CAPTURED from the
 * real 1.6.0 CLI (`openspec list --json` + `openspec status --change --json`,
 * bin `node_modules/@fission-ai/openspec@1.6.0/bin/openspec.js`) into
 * `buildOpenSpecData` and asserts it stays NON-empty with 1.4.1 parity shape:
 * changes map, artifacts `{ id, status }`, `isComplete`.
 *
 * See change: provision-openspec-cli-in-sessions.
 */
import { describe, expect, it } from "vitest";
import { buildOpenSpecData } from "../openspec-poller.js";

// Captured verbatim from @fission-ai/openspec@1.6.0. list --json carries the
// extra `lastModified` + `root` keys (1.6.0) the poller ignores; the fields the
// poller consumes (name, status, completedTasks, totalTasks) are unchanged from
// 1.4.1. status --json carries extra keys (planningHome, artifactPaths, …) the
// poller ignores; `artifacts[]` is `{ id, outputPath, status }`.
const LIST_1_6_0 = {
  root: "/repo/openspec",
  changes: [
    {
      name: "provision-openspec-cli-in-sessions",
      completedTasks: 0,
      totalTasks: 25,
      lastModified: "2026-07-20T22:12:54.766Z",
      status: "in-progress",
    },
    {
      name: "windows-authenticode-signing",
      completedTasks: 21,
      totalTasks: 21,
      lastModified: "2026-07-20T22:12:54.766Z",
      status: "complete",
    },
  ],
};

const STATUS_1_6_0: Record<
  string,
  { artifacts: Array<{ id: string; outputPath: string; status: string }>; isComplete: boolean }
> = {
  "provision-openspec-cli-in-sessions": {
    artifacts: [
      { id: "proposal", outputPath: "proposal.md", status: "done" },
      { id: "design", outputPath: "design.md", status: "done" },
      { id: "specs", outputPath: "specs/**/*.md", status: "done" },
      { id: "tasks", outputPath: "tasks.md", status: "done" },
    ],
    isComplete: false,
  },
  "windows-authenticode-signing": {
    artifacts: [
      { id: "proposal", outputPath: "proposal.md", status: "done" },
      { id: "design", outputPath: "design.md", status: "done" },
      { id: "specs", outputPath: "specs/**/*.md", status: "done" },
      { id: "tasks", outputPath: "tasks.md", status: "done" },
    ],
    isComplete: true,
  },
};

describe("openspec-poller compat with 1.6.0 payload (T-S3)", () => {
  it("parses a captured 1.6.0 list+status payload NON-empty (no silent-empty regression)", () => {
    const statusResults = new Map(
      LIST_1_6_0.changes.map((c) => [c.name, STATUS_1_6_0[c.name]] as const),
    );

    const data = buildOpenSpecData(LIST_1_6_0, statusResults);

    // Non-empty parity: initialized + one change per list entry (the
    // silent-empty failure mode would yield changes.length === 0).
    expect(data.initialized).toBe(true);
    expect(data.changes).toHaveLength(LIST_1_6_0.changes.length);
  });

  it("maps 1.6.0 artifacts to the 1.4.1 OpenSpecData shape", () => {
    const statusResults = new Map(
      LIST_1_6_0.changes.map((c) => [c.name, STATUS_1_6_0[c.name]] as const),
    );

    const data = buildOpenSpecData(LIST_1_6_0, statusResults);
    const change = data.changes.find((c) => c.name === "provision-openspec-cli-in-sessions");

    expect(change).toBeDefined();
    expect(change?.status).toBe("in-progress");
    expect(change?.completedTasks).toBe(0);
    expect(change?.totalTasks).toBe(25);
    // artifacts flattened to { id, status } — the extra 1.6.0 outputPath dropped.
    expect(change?.artifacts).toEqual([
      { id: "proposal", status: "done" },
      { id: "design", status: "done" },
      { id: "specs", status: "done" },
      { id: "tasks", status: "done" },
    ]);
  });

  it("preserves isComplete from the 1.6.0 status payload", () => {
    const statusResults = new Map(
      LIST_1_6_0.changes.map((c) => [c.name, STATUS_1_6_0[c.name]] as const),
    );

    const data = buildOpenSpecData(LIST_1_6_0, statusResults);
    const complete = data.changes.find((c) => c.name === "windows-authenticode-signing");

    expect(complete?.isComplete).toBe(true);
  });
});
