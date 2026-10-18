/**
 * Parity test: the bash wrapper at
 * `.pi/skills/openspec-shared/scripts/effective-status.sh` must apply the
 * SAME R1/R2/R3 promotion as the TS `evaluateLocalDesignSatisfaction`,
 * so skill-driven prompts and dashboard buttons cannot disagree.
 *
 * Strategy: the wrapper calls the real `openspec` CLI. We can't invoke it
 * here without the binary on PATH and an in-tree change. Instead we
 * verify the wrapper's RULE EVALUATION against the same fixtures we
 * use for `evaluateLocalDesignSatisfaction`, by piping a synthetic
 * `openspec status --json`-shaped JSON into the override section of the
 * script. Since the script's CLI invocation is at the very top, we
 * exercise it with a stubbed `openspec` shim on PATH.
 *
 * See change: fix-openspec-design-detection.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { buildOpenSpecData } from "../openspec-poller.js";

const SCRIPT_PATH = path.resolve(
  __dirname,
  "../../../../.pi/skills/openspec-shared/scripts/effective-status.sh",
);

function setupHarness(): { root: string; changeName: string; changeDir: string; binDir: string } {
  const root = mkdtempSync(path.join(tmpdir(), "effective-status-test-"));
  const changeName = "demo-change";
  const changesDir = path.join(root, "openspec", "changes", changeName);
  mkdirSync(changesDir, { recursive: true });
  const binDir = path.join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  return { root, changeName, changeDir: changesDir, binDir };
}

function writeOpenspecStub(binDir: string, jsonOutput: string): void {
  const stub = path.join(binDir, "openspec");
  writeFileSync(
    stub,
    `#!/usr/bin/env bash\ncat <<'JSON_EOF'\n${jsonOutput}\nJSON_EOF\n`,
    { mode: 0o755 },
  );
  chmodSync(stub, 0o755);
}

function runWrapper(root: string, binDir: string, changeName: string): unknown {
  const out = execFileSync("bash", [SCRIPT_PATH, changeName], {
    cwd: root,
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` },
    encoding: "utf8",
  });
  return JSON.parse(out);
}

const BASE_STATUS = JSON.stringify({
  changeName: "demo-change",
  schemaName: "spec-driven",
  isComplete: false,
  applyRequires: ["tasks"],
  artifacts: [
    { id: "proposal", outputPath: "proposal.md", status: "done" },
    { id: "specs", outputPath: "specs/**/*.md", status: "done" },
    { id: "design", outputPath: "design.md", status: "ready" },
    { id: "tasks", outputPath: "tasks.md", status: "done" },
  ],
});

describe("effective-status.sh — parity with evaluateLocalDesignSatisfaction", () => {
  it("R1: design.md present → promotes design to done", () => {
    const h = setupHarness();
    try {
      writeFileSync(path.join(h.changeDir, "design.md"), "");
      writeOpenspecStub(h.binDir, BASE_STATUS);
      const out = runWrapper(h.root, h.binDir, h.changeName) as any;
      const design = out.artifacts.find((a: any) => a.id === "design");
      expect(design.status).toBe("done");
      expect(out.isComplete).toBe(true); // all artifacts done after promotion
    } finally {
      rmSync(h.root, { recursive: true, force: true });
    }
  });

  it("R1: split design (design-A.md + design-B.md, no design.md) → promoted", () => {
    const h = setupHarness();
    try {
      writeFileSync(path.join(h.changeDir, "design-rendering.md"), "");
      writeFileSync(path.join(h.changeDir, "design-state.md"), "");
      writeOpenspecStub(h.binDir, BASE_STATUS);
      const out = runWrapper(h.root, h.binDir, h.changeName) as any;
      expect(out.artifacts.find((a: any) => a.id === "design").status).toBe("done");
    } finally {
      rmSync(h.root, { recursive: true, force: true });
    }
  });

  it("R2: design/ folder with .md → promoted", () => {
    const h = setupHarness();
    try {
      mkdirSync(path.join(h.changeDir, "design"));
      writeFileSync(path.join(h.changeDir, "design", "architecture.md"), "");
      writeOpenspecStub(h.binDir, BASE_STATUS);
      const out = runWrapper(h.root, h.binDir, h.changeName) as any;
      expect(out.artifacts.find((a: any) => a.id === "design").status).toBe("done");
    } finally {
      rmSync(h.root, { recursive: true, force: true });
    }
  });

  it("R3: tasks.md with `- [ ]` → promoted", () => {
    const h = setupHarness();
    try {
      writeFileSync(path.join(h.changeDir, "tasks.md"), "## 1. x\n\n- [ ] 1.1 do\n");
      writeOpenspecStub(h.binDir, BASE_STATUS);
      const out = runWrapper(h.root, h.binDir, h.changeName) as any;
      expect(out.artifacts.find((a: any) => a.id === "design").status).toBe("done");
    } finally {
      rmSync(h.root, { recursive: true, force: true });
    }
  });

  it("no evidence → design stays ready", () => {
    const h = setupHarness();
    try {
      writeFileSync(path.join(h.changeDir, "proposal.md"), "");
      writeOpenspecStub(h.binDir, BASE_STATUS);
      const out = runWrapper(h.root, h.binDir, h.changeName) as any;
      expect(out.artifacts.find((a: any) => a.id === "design").status).toBe("ready");
      expect(out.isComplete).toBe(false);
    } finally {
      rmSync(h.root, { recursive: true, force: true });
    }
  });

  it("never demotes done → ready", () => {
    const h = setupHarness();
    try {
      // No evidence in fs, but CLI says design done.
      const cliDone = JSON.stringify({
        ...JSON.parse(BASE_STATUS),
        artifacts: [
          { id: "proposal", outputPath: "proposal.md", status: "done" },
          { id: "design", outputPath: "design.md", status: "done" },
        ],
        isComplete: true,
      });
      writeOpenspecStub(h.binDir, cliDone);
      const out = runWrapper(h.root, h.binDir, h.changeName) as any;
      expect(out.artifacts.find((a: any) => a.id === "design").status).toBe("done");
      expect(out.isComplete).toBe(true);
    } finally {
      rmSync(h.root, { recursive: true, force: true });
    }
  });

  it("never promotes blocked → done even with evidence", () => {
    const h = setupHarness();
    try {
      writeFileSync(path.join(h.changeDir, "design.md"), "");
      const blocked = JSON.stringify({
        ...JSON.parse(BASE_STATUS),
        artifacts: [
          { id: "design", outputPath: "design.md", status: "blocked" },
        ],
      });
      writeOpenspecStub(h.binDir, blocked);
      const out = runWrapper(h.root, h.binDir, h.changeName) as any;
      expect(out.artifacts.find((a: any) => a.id === "design").status).toBe("blocked");
    } finally {
      rmSync(h.root, { recursive: true, force: true });
    }
  });
});

describe("effective-status.sh — pi-spec-driven schema gate", () => {
  const withSchema = (schemaName: string) => JSON.stringify({ ...JSON.parse(BASE_STATUS), schemaName });

  it("#E28 pi-spec-driven + checkboxes → design stays ready; spec-driven + checkboxes → done", () => {
    const results: Record<string, any> = {};
    for (const schema of ["pi-spec-driven", "spec-driven"]) {
      const h = setupHarness();
      try {
        writeFileSync(path.join(h.changeDir, "tasks.md"), "## 1. x\n\n- [ ] 1.1 do\n");
        writeOpenspecStub(h.binDir, withSchema(schema));
        results[schema] = runWrapper(h.root, h.binDir, h.changeName);
      } finally {
        rmSync(h.root, { recursive: true, force: true });
      }
    }
    const design = (o: any) => o.artifacts.find((a: any) => a.id === "design").status;
    expect(design(results["pi-spec-driven"])).toBe("ready");
    expect(results["pi-spec-driven"].isComplete).toBe(false);
    expect(design(results["spec-driven"])).toBe("done");
  });

  it("#E28 dashboard build agrees: pi-spec-driven stays ready, spec-driven promoted", () => {
    const build = (schemaName: string) =>
      buildOpenSpecData(
        { changes: [{ name: "x", status: "no-tasks", completedTasks: 0, totalTasks: 0 }] },
        new Map<string, any>([["x", { ...JSON.parse(withSchema(schemaName)) }]]),
        () => ({ hasDesignFile: () => false, hasDesignDirWithMd: () => false, tasksHasCheckboxes: () => true }),
      ).changes[0].artifacts.find((a) => a.id === "design")!.status;
    expect(build("pi-spec-driven")).toBe("ready");
    expect(build("spec-driven")).toBe("done");
  });
});
