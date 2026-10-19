/**
 * test-plan #E18 (refresh-electron-bundled-components): poller compat with
 * openspec 1.14.3.
 *
 * The poller fails SILENT-EMPTY (`{ initialized: true, changes: [] }`) on a
 * `list|status --json` schema break, so the exact 1.14.3 payload shape is
 * pinned here. Payloads below were captured from the real 1.14.3 bin
 * (`node_modules/@fission-ai/openspec/bin/openspec.js list --json` and
 * `status --change <name> --json`, unrelated keys trimmed). Against 1.6.0 the
 * only status change is the additive per-artifact `requires` edge list (1.12) and
 * the `isPlanningComplete` / `applyRequires` keys; `buildOpenSpecData` must keep
 * the `{ id, status }` artifact shape.
 *
 * See change: refresh-electron-bundled-components (sibling:
 * openspec-poller-1.6.0-compat.test.ts).
 */
import { describe, expect, it } from "vitest";
import { buildOpenSpecData } from "../openspec-poller.js";

const LIST_1_14_3 = {
  root: "/repo/openspec",
  changes: [
    {
      name: "refresh-electron-bundled-components",
      completedTasks: 3,
      totalTasks: 49,
      lastModified: "2026-10-18T22:04:27.749Z",
      status: "in-progress",
    },
    {
      name: "done-change",
      completedTasks: 4,
      totalTasks: 4,
      lastModified: "2026-10-18T22:04:27.749Z",
      status: "complete",
    },
  ],
};

const STATUS_1_14_3 = {
  isPlanningComplete: true,
  isComplete: true,
  applyRequires: ["tasks"],
  artifacts: [
    { id: "proposal", outputPath: "proposal.md", status: "done", requires: [] },
    { id: "specs", outputPath: "specs/**/*.md", status: "done", requires: ["proposal"] },
    { id: "design", outputPath: "design.md", status: "done", requires: ["proposal"] },
    { id: "tasks", outputPath: "tasks.md", status: "done", requires: ["specs", "design"] },
  ],
};

describe("openspec-poller compat with 1.14.3 payload (E18)", () => {
  const statusResults = new Map(LIST_1_14_3.changes.map((c) => [c.name, STATUS_1_14_3] as const));

  it("parses a captured 1.14.3 list+status payload NON-empty (no silent-empty regression)", () => {
    const data = buildOpenSpecData(LIST_1_14_3, statusResults);
    expect(data.initialized).toBe(true);
    expect(data.changes).toHaveLength(LIST_1_14_3.changes.length);
  });

  it("keeps the { id, status } artifact shape, dropping outputPath and requires", () => {
    const data = buildOpenSpecData(LIST_1_14_3, statusResults);
    const change = data.changes.find((c) => c.name === "refresh-electron-bundled-components");
    expect(change?.status).toBe("in-progress");
    expect(change?.completedTasks).toBe(3);
    expect(change?.totalTasks).toBe(49);
    expect(change?.artifacts).toEqual([
      { id: "proposal", status: "done" },
      { id: "specs", status: "done" },
      { id: "design", status: "done" },
      { id: "tasks", status: "done" },
    ]);
    expect(change?.isComplete).toBe(true);
  });
});
