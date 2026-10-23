/**
 * Verifies `buildOpenSpecData`'s design-artifact override behavior.
 * Invariants: promote-only, design-only, never demote, isComplete only
 * promoted to true (never demoted from CLI true).
 *
 * See change: fix-openspec-design-detection.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildOpenSpecData, createFsProbeFactory } from "../openspec-poller.js";
import type { DesignEvidenceProbe } from "../openspec-design-evidence.js";

function probe(satisfied: boolean, calls?: { count: number }): DesignEvidenceProbe {
  return {
    hasDesignFile: () => {
      if (calls) calls.count++;
      return satisfied;
    },
    hasDesignDirWithMd: () => false,
    tasksHasCheckboxes: () => false,
  };
}

const listResult = {
  changes: [
    { name: "x", status: "in-progress", completedTasks: 1, totalTasks: 3 },
  ],
};

describe("buildOpenSpecData design override", () => {
  it("promotes design ready→done when probe satisfies", () => {
    const statusResults = new Map<string, any>([
      [
        "x",
        {
          artifacts: [
            { id: "proposal", status: "done" },
            { id: "specs", status: "done" },
            { id: "design", status: "ready" },
            { id: "tasks", status: "ready" },
          ],
          isComplete: false,
        },
      ],
    ]);
    const data = buildOpenSpecData(listResult, statusResults, () => probe(true));
    const x = data.changes[0];
    expect(x.artifacts.find((a) => a.id === "design")!.status).toBe("done");
  });

  it("does NOT promote when probe says not satisfied", () => {
    const statusResults = new Map<string, any>([
      [
        "x",
        {
          artifacts: [
            { id: "design", status: "ready" },
          ],
        },
      ],
    ]);
    const data = buildOpenSpecData(listResult, statusResults, () => probe(false));
    expect(data.changes[0].artifacts.find((a) => a.id === "design")!.status).toBe("ready");
  });

  it("never promotes blocked → done", () => {
    const statusResults = new Map<string, any>([
      [
        "x",
        {
          artifacts: [{ id: "design", status: "blocked" }],
        },
      ],
    ]);
    const data = buildOpenSpecData(listResult, statusResults, () => probe(true));
    expect(data.changes[0].artifacts.find((a) => a.id === "design")!.status).toBe("blocked");
  });

  it("never demotes done → ready (CLI says done; we trust it)", () => {
    const statusResults = new Map<string, any>([
      [
        "x",
        {
          artifacts: [{ id: "design", status: "done" }],
        },
      ],
    ]);
    const data = buildOpenSpecData(listResult, statusResults, () => probe(false));
    expect(data.changes[0].artifacts.find((a) => a.id === "design")!.status).toBe("done");
  });

  it("only mutates design — other artifact statuses pass through", () => {
    const statusResults = new Map<string, any>([
      [
        "x",
        {
          artifacts: [
            { id: "proposal", status: "ready" },
            { id: "specs", status: "blocked" },
            { id: "design", status: "ready" },
            { id: "tasks", status: "ready" },
          ],
        },
      ],
    ]);
    const data = buildOpenSpecData(listResult, statusResults, () => probe(true));
    const arts = data.changes[0].artifacts;
    expect(arts.find((a) => a.id === "proposal")!.status).toBe("ready");
    expect(arts.find((a) => a.id === "specs")!.status).toBe("blocked");
    expect(arts.find((a) => a.id === "design")!.status).toBe("done");
    expect(arts.find((a) => a.id === "tasks")!.status).toBe("ready");
  });

  it("re-derives isComplete=true when all artifacts done after override", () => {
    const statusResults = new Map<string, any>([
      [
        "x",
        {
          artifacts: [
            { id: "proposal", status: "done" },
            { id: "specs", status: "done" },
            { id: "design", status: "ready" },
            { id: "tasks", status: "done" },
          ],
          isComplete: false,
        },
      ],
    ]);
    const data = buildOpenSpecData(listResult, statusResults, () => probe(true));
    expect(data.changes[0].isComplete).toBe(true);
  });

  it("re-derives isComplete=true when the rest is done or skipped (skip_specs) after the design override", () => {
    const statusResults = new Map<string, any>([
      [
        "x",
        {
          artifacts: [
            { id: "proposal", status: "done" },
            { id: "specs", status: "skipped" },
            { id: "design", status: "ready" },
            { id: "tasks", status: "done" },
          ],
          isComplete: false,
        },
      ],
    ]);
    const data = buildOpenSpecData(listResult, statusResults, () => probe(true));
    // `skipped` satisfies planning completeness, exactly as in deriveArtifactStatus (poller/CLI parity).
    expect(data.changes[0].isComplete).toBe(true);
  });

  it("does NOT promote isComplete when any non-design artifact is not done", () => {
    const statusResults = new Map<string, any>([
      [
        "x",
        {
          artifacts: [
            { id: "proposal", status: "done" },
            { id: "specs", status: "ready" },
            { id: "design", status: "ready" },
            { id: "tasks", status: "blocked" },
          ],
          isComplete: false,
        },
      ],
    ]);
    const data = buildOpenSpecData(listResult, statusResults, () => probe(true));
    // design becomes done, but specs/tasks are still not — isComplete passes through CLI value (false)
    expect(data.changes[0].isComplete).toBe(false);
  });

  it("never demotes CLI isComplete=true to false", () => {
    const statusResults = new Map<string, any>([
      [
        "x",
        {
          artifacts: [{ id: "proposal", status: "done" }],
          isComplete: true,
        },
      ],
    ]);
    // Probe says NOT satisfied, single artifact is done so override re-derive would also be true.
    // Use a more adversarial setup: probe NOT satisfied, single artifact is "ready", CLI says complete.
    const adversarial = new Map<string, any>([
      [
        "x",
        {
          artifacts: [{ id: "proposal", status: "ready" }],
          isComplete: true,
        },
      ],
    ]);
    const data = buildOpenSpecData(listResult, adversarial, () => probe(false));
    expect(data.changes[0].isComplete).toBe(true);
  });

  it("no-probe call site preserves today's behavior verbatim", () => {
    const statusResults = new Map<string, any>([
      [
        "x",
        {
          artifacts: [
            { id: "design", status: "ready" },
            { id: "tasks", status: "blocked" },
          ],
          isComplete: false,
        },
      ],
    ]);
    const data = buildOpenSpecData(listResult, statusResults);
    expect(data.changes[0].artifacts.find((a) => a.id === "design")!.status).toBe("ready");
    expect(data.changes[0].isComplete).toBe(false);
  });

  it("probe factory receives the change name", () => {
    const seen: string[] = [];
    const statusResults = new Map<string, any>([
      [
        "x",
        {
          artifacts: [{ id: "design", status: "ready" }],
        },
      ],
    ]);
    buildOpenSpecData(listResult, statusResults, (changeName) => {
      seen.push(changeName);
      return probe(false);
    });
    expect(seen).toContain("x");
  });

  it("probe is NOT consulted when CLI says design is already done", () => {
    const calls = { count: 0 };
    const statusResults = new Map<string, any>([
      [
        "x",
        {
          artifacts: [{ id: "design", status: "done" }],
        },
      ],
    ]);
    buildOpenSpecData(listResult, statusResults, () => probe(true, calls));
    expect(calls.count).toBe(0);
  });
});

describe("buildOpenSpecData design override — pi-spec-driven schema gate", () => {
  const checkboxProbe = (): DesignEvidenceProbe => ({
    hasDesignFile: () => false,
    hasDesignDirWithMd: () => false,
    tasksHasCheckboxes: () => true,
  });
  const readyDesign = (schemaName?: string) =>
    new Map<string, any>([
      ["x", { ...(schemaName ? { schemaName } : {}), artifacts: [{ id: "design", status: "ready" }] }],
    ]);
  const designStatus = (data: ReturnType<typeof buildOpenSpecData>) =>
    data.changes[0].artifacts.find((a) => a.id === "design")!.status;

  it("#E27 status --all row schemaName pi-spec-driven + checkboxes → NOT promoted", () => {
    expect(designStatus(buildOpenSpecData(listResult, readyDesign("pi-spec-driven"), checkboxProbe))).toBe("ready");
  });

  it("#E27 status --all row schemaName team-flow + checkboxes → promoted", () => {
    expect(designStatus(buildOpenSpecData(listResult, readyDesign("team-flow"), checkboxProbe))).toBe("done");
  });

  describe("fallback list path resolves schemaName locally", () => {
    function withChange(yaml: string | null, fn: (cwd: string) => void): void {
      const cwd = mkdtempSync(path.join(tmpdir(), "poller-schema-gate-"));
      try {
        const dir = path.join(cwd, "openspec", "changes", "x");
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, "tasks.md"), "- [ ] 1.1 do\n");
        if (yaml !== null) writeFileSync(path.join(dir, ".openspec.yaml"), yaml);
        fn(cwd);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    }

    it("#E27 .openspec.yaml naming pi-spec-driven + checkboxes → NOT promoted", () => {
      withChange("schema: pi-spec-driven\ncreated: 2026-01-01\n", (cwd) => {
        expect(designStatus(buildOpenSpecData(listResult, readyDesign(), createFsProbeFactory(cwd)))).toBe("ready");
      });
    });

    it("#E27 no .openspec.yaml metadata + checkboxes → promoted", () => {
      withChange(null, (cwd) => {
        expect(designStatus(buildOpenSpecData(listResult, readyDesign(), createFsProbeFactory(cwd)))).toBe("done");
      });
    });
  });
});
