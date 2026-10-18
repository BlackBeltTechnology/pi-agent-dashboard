/**
 * Tests for the local-design-evidence override that fixes session-card
 * button rendering for split-design (Case B) and no-design (Case A) changes.
 * See change: fix-openspec-design-detection.
 */
import { describe, expect, it } from "vitest";
import { buildOpenSpecData } from "../openspec-poller.js";
import {
  evaluateLocalDesignSatisfaction,
  type DesignEvidenceProbe,
} from "../openspec-design-evidence.js";

/** In-memory probe stub. */
function probe(opts: {
  hasDesignFile?: boolean;
  hasDesignDirWithMd?: boolean;
  tasksHasCheckboxes?: boolean;
}): DesignEvidenceProbe {
  return {
    hasDesignFile: () => opts.hasDesignFile === true,
    hasDesignDirWithMd: () => opts.hasDesignDirWithMd === true,
    tasksHasCheckboxes: () => opts.tasksHasCheckboxes === true,
  };
}

describe("evaluateLocalDesignSatisfaction", () => {
  it("R1: design.md (or design-*.md) present → satisfied", () => {
    expect(evaluateLocalDesignSatisfaction("/c", probe({ hasDesignFile: true }))).toBe(true);
  });

  it("R2: design/ folder with .md → satisfied", () => {
    expect(evaluateLocalDesignSatisfaction("/c", probe({ hasDesignDirWithMd: true }))).toBe(true);
  });

  it("R3: tasks.md with checkboxes → satisfied", () => {
    expect(evaluateLocalDesignSatisfaction("/c", probe({ tasksHasCheckboxes: true }))).toBe(true);
  });

  it("no evidence → not satisfied", () => {
    expect(evaluateLocalDesignSatisfaction("/c", probe({}))).toBe(false);
  });

  it("R1 short-circuits before R2/R3", () => {
    let r2 = 0;
    let r3 = 0;
    const p: DesignEvidenceProbe = {
      hasDesignFile: () => true,
      hasDesignDirWithMd: () => {
        r2++;
        return false;
      },
      tasksHasCheckboxes: () => {
        r3++;
        return false;
      },
    };
    expect(evaluateLocalDesignSatisfaction("/c", p)).toBe(true);
    expect(r2).toBe(0);
    expect(r3).toBe(0);
  });

  it("R2 short-circuits before R3", () => {
    let r3 = 0;
    const p: DesignEvidenceProbe = {
      hasDesignFile: () => false,
      hasDesignDirWithMd: () => true,
      tasksHasCheckboxes: () => {
        r3++;
        return false;
      },
    };
    expect(evaluateLocalDesignSatisfaction("/c", p)).toBe(true);
    expect(r3).toBe(0);
  });

  it("passes the changeDir through to every probe call", () => {
    const seen: string[] = [];
    const p: DesignEvidenceProbe = {
      hasDesignFile: (d) => {
        seen.push(d);
        return false;
      },
      hasDesignDirWithMd: (d) => {
        seen.push(d);
        return false;
      },
      tasksHasCheckboxes: (d) => {
        seen.push(d);
        return false;
      },
    };
    evaluateLocalDesignSatisfaction("/abs/path/to/change", p);
    expect(seen).toEqual([
      "/abs/path/to/change",
      "/abs/path/to/change",
      "/abs/path/to/change",
    ]);
  });
});

// ── Real-fs probe tests (createFsDesignEvidenceProbe) ──────────────────────

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFsDesignEvidenceProbe } from "../openspec-design-evidence.js";

function tmpChangeDir(): string {
  return mkdtempSync(path.join(tmpdir(), "openspec-design-evidence-"));
}

describe("createFsDesignEvidenceProbe — R1", () => {
  it("matches design.md", () => {
    const d = tmpChangeDir();
    try {
      writeFileSync(path.join(d, "design.md"), "");
      const probe = createFsDesignEvidenceProbe();
      expect(probe.hasDesignFile(d)).toBe(true);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("matches design-rendering.md (split design)", () => {
    const d = tmpChangeDir();
    try {
      writeFileSync(path.join(d, "design-rendering.md"), "");
      writeFileSync(path.join(d, "design-state.md"), "");
      const probe = createFsDesignEvidenceProbe();
      expect(probe.hasDesignFile(d)).toBe(true);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("does NOT match designate.md (must start with 'design')", () => {
    const d = tmpChangeDir();
    try {
      // 'designate' starts with 'design' — accepted by ^design.*\.md$.
      // We're testing a non-matching name instead:
      writeFileSync(path.join(d, "redesign.md"), "");
      const probe = createFsDesignEvidenceProbe();
      expect(probe.hasDesignFile(d)).toBe(false);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("does NOT match design.txt (must end with .md)", () => {
    const d = tmpChangeDir();
    try {
      writeFileSync(path.join(d, "design.txt"), "");
      const probe = createFsDesignEvidenceProbe();
      expect(probe.hasDesignFile(d)).toBe(false);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("returns false on missing directory", () => {
    const probe = createFsDesignEvidenceProbe();
    expect(probe.hasDesignFile("/nonexistent/path/xyz123")).toBe(false);
  });
});

describe("createFsDesignEvidenceProbe — R2", () => {
  it("matches design/ folder with at least one .md", () => {
    const d = tmpChangeDir();
    try {
      mkdirSync(path.join(d, "design"));
      writeFileSync(path.join(d, "design", "architecture.md"), "");
      const probe = createFsDesignEvidenceProbe();
      expect(probe.hasDesignDirWithMd(d)).toBe(true);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("does NOT match empty design/ folder", () => {
    const d = tmpChangeDir();
    try {
      mkdirSync(path.join(d, "design"));
      const probe = createFsDesignEvidenceProbe();
      expect(probe.hasDesignDirWithMd(d)).toBe(false);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("does NOT match design/ with only non-md files", () => {
    const d = tmpChangeDir();
    try {
      mkdirSync(path.join(d, "design"));
      writeFileSync(path.join(d, "design", "notes.txt"), "");
      const probe = createFsDesignEvidenceProbe();
      expect(probe.hasDesignDirWithMd(d)).toBe(false);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("returns false when design/ does not exist", () => {
    const d = tmpChangeDir();
    try {
      const probe = createFsDesignEvidenceProbe();
      expect(probe.hasDesignDirWithMd(d)).toBe(false);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("createFsDesignEvidenceProbe — R3", () => {
  it("matches tasks.md with `- [ ]` checkbox", () => {
    const d = tmpChangeDir();
    try {
      writeFileSync(path.join(d, "tasks.md"), "## 1. Setup\n\n- [ ] 1.1 Do thing\n");
      const probe = createFsDesignEvidenceProbe();
      expect(probe.tasksHasCheckboxes(d)).toBe(true);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("matches tasks.md with `- [x]` checkbox (already complete)", () => {
    const d = tmpChangeDir();
    try {
      writeFileSync(path.join(d, "tasks.md"), "- [x] done\n");
      const probe = createFsDesignEvidenceProbe();
      expect(probe.tasksHasCheckboxes(d)).toBe(true);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("matches tasks.md with `- [X]` (uppercase X)", () => {
    const d = tmpChangeDir();
    try {
      writeFileSync(path.join(d, "tasks.md"), "- [X] done\n");
      const probe = createFsDesignEvidenceProbe();
      expect(probe.tasksHasCheckboxes(d)).toBe(true);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("does NOT match empty tasks.md", () => {
    const d = tmpChangeDir();
    try {
      writeFileSync(path.join(d, "tasks.md"), "");
      const probe = createFsDesignEvidenceProbe();
      expect(probe.tasksHasCheckboxes(d)).toBe(false);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("does NOT match tasks.md with only headings (no checkboxes)", () => {
    const d = tmpChangeDir();
    try {
      writeFileSync(path.join(d, "tasks.md"), "## 1. Setup\n\nSome prose.\n");
      const probe = createFsDesignEvidenceProbe();
      expect(probe.tasksHasCheckboxes(d)).toBe(false);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("does NOT match a `[ ]` not preceded by `- `", () => {
    const d = tmpChangeDir();
    try {
      writeFileSync(path.join(d, "tasks.md"), "this [ ] is inline text\n");
      const probe = createFsDesignEvidenceProbe();
      expect(probe.tasksHasCheckboxes(d)).toBe(false);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("returns false when tasks.md does not exist", () => {
    const d = tmpChangeDir();
    try {
      const probe = createFsDesignEvidenceProbe();
      expect(probe.tasksHasCheckboxes(d)).toBe(false);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("evaluateLocalDesignSatisfaction — pi-spec-driven schema gate", () => {
  it("#E29 pi-spec-driven + design-a.md present → evidence not evaluated, not satisfied", () => {
    const calls = { r1: 0, r2: 0, r3: 0 };
    const p: DesignEvidenceProbe = {
      hasDesignFile: () => (calls.r1++, true),
      hasDesignDirWithMd: () => (calls.r2++, true),
      tasksHasCheckboxes: () => (calls.r3++, true),
    };
    expect(evaluateLocalDesignSatisfaction("/c", p, "pi-spec-driven")).toBe(false);
    expect(calls).toEqual({ r1: 0, r2: 0, r3: 0 });
  });

  it("#E29 buildOpenSpecData keeps CLI design:ready for pi-spec-driven (probe spy 0 calls)", () => {
    const calls = { count: 0 };
    const p: DesignEvidenceProbe = {
      hasDesignFile: () => (calls.count++, true),
      hasDesignDirWithMd: () => (calls.count++, true),
      tasksHasCheckboxes: () => (calls.count++, true),
    };
    const data = buildOpenSpecData(
      { changes: [{ name: "x", status: "no-tasks", completedTasks: 0, totalTasks: 0 }] },
      new Map<string, any>([["x", { schemaName: "pi-spec-driven", artifacts: [{ id: "design", status: "ready" }] }]]),
      () => p,
    );
    expect(calls.count).toBe(0);
    expect(data.changes[0].artifacts[0].status).toBe("ready");
  });

  it("other schemas keep evaluating evidence", () => {
    expect(evaluateLocalDesignSatisfaction("/c", probe({ hasDesignFile: true }), "team-flow")).toBe(true);
  });
});
