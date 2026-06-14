/**
 * Unit tests for `deriveArtifactStatus` — the pure local derivation that
 * replaces the per-change `openspec status` spawn on the periodic poll path.
 *
 * Probes are injected (in-memory), mirroring the `buildOpenSpecData` test
 * style. `proposal` keys on a real `proposal.md`, so each case uses a real
 * temp change dir (real fs, not a mock).
 *
 * See change: optimize-openspec-poll-derive-artifacts-locally.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { deriveArtifactStatus } from "../openspec-poller.js";
import type { DesignEvidenceProbe } from "../openspec-design-evidence.js";
import type { SpecsEvidenceProbe } from "../openspec-specs-evidence.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeChangeDir(withProposal: boolean): string {
  const dir = mkdtempSync(path.join(tmpdir(), "derive-"));
  dirs.push(dir);
  if (withProposal) writeFileSync(path.join(dir, "proposal.md"), "# p\n");
  return dir;
}

const designProbe = (satisfied: boolean): DesignEvidenceProbe => ({
  hasDesignFile: () => satisfied,
  hasDesignDirWithMd: () => false,
  tasksHasCheckboxes: () => false,
});
const specsProbe = (satisfied: boolean): SpecsEvidenceProbe => ({
  hasAnySpecFile: () => satisfied,
});

function status(artifacts: Array<{ id: string; status: string }>, id: string): string {
  return artifacts.find((a) => a.id === id)!.status;
}

describe("deriveArtifactStatus", () => {
  it("all evidence present + tasks authored → every artifact done, isComplete true", () => {
    const dir = makeChangeDir(true);
    const r = deriveArtifactStatus(dir, { completedTasks: 0, totalTasks: 21 }, {
      design: designProbe(true),
      specs: specsProbe(true),
    });
    expect(r.artifacts.map((a) => a.id)).toEqual(["proposal", "design", "specs", "tasks"]);
    expect(r.artifacts.every((a) => a.status === "done")).toBe(true);
    expect(r.isComplete).toBe(true);
  });

  it("tasks artifact keys on authored (totalTasks>0), NOT completion", () => {
    const dir = makeChangeDir(true);
    // 0 of 21 complete, but tasks authored → tasks done.
    const r = deriveArtifactStatus(dir, { completedTasks: 0, totalTasks: 21 }, {
      design: designProbe(true),
      specs: specsProbe(true),
    });
    expect(status(r.artifacts, "tasks")).toBe("done");
  });

  it("totalTasks===0 → tasks blocked, isComplete false", () => {
    const dir = makeChangeDir(true);
    const r = deriveArtifactStatus(dir, { completedTasks: 0, totalTasks: 0 }, {
      design: designProbe(false),
      specs: specsProbe(false),
    });
    expect(status(r.artifacts, "tasks")).toBe("blocked");
    expect(r.isComplete).toBe(false);
  });

  it("missing proposal.md → proposal ready", () => {
    const dir = makeChangeDir(false);
    const r = deriveArtifactStatus(dir, { completedTasks: 1, totalTasks: 2 }, {
      design: designProbe(true),
      specs: specsProbe(true),
    });
    expect(status(r.artifacts, "proposal")).toBe("ready");
    expect(r.isComplete).toBe(false);
  });

  it("design evidence absent → design ready (no design.md, no checkboxes)", () => {
    const dir = makeChangeDir(true);
    const r = deriveArtifactStatus(dir, { completedTasks: 0, totalTasks: 5 }, {
      design: designProbe(false),
      specs: specsProbe(true),
    });
    expect(status(r.artifacts, "design")).toBe("ready");
  });

  it("specs evidence absent → specs ready", () => {
    const dir = makeChangeDir(true);
    const r = deriveArtifactStatus(dir, { completedTasks: 0, totalTasks: 5 }, {
      design: designProbe(true),
      specs: specsProbe(false),
    });
    expect(status(r.artifacts, "specs")).toBe("ready");
  });

  it("tt=0 with specs evidence → specs done but tasks blocked (matches CLI)", () => {
    const dir = makeChangeDir(true);
    const r = deriveArtifactStatus(dir, { completedTasks: 0, totalTasks: 0 }, {
      design: designProbe(false),
      specs: specsProbe(true),
    });
    expect(status(r.artifacts, "specs")).toBe("done");
    expect(status(r.artifacts, "tasks")).toBe("blocked");
    expect(status(r.artifacts, "design")).toBe("ready");
    expect(r.isComplete).toBe(false);
  });
});
