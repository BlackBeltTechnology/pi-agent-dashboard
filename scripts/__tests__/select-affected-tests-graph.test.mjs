/**
 * Affected-test selector — graph builder on the REAL tree (change:
 * speed-up-ci-affected-tests, tasks 2.4 / 2.5; test-plan X1, P1).
 *
 * The first test in the repo to drive the vitest Node API (`createVitest`).
 * It runs the builder in a child process — never inside this vitest worker —
 * and asserts facts that only hold if both configs were resolved and the walk
 * tolerated the known transform failure:
 *   - monaco-setup.ts is a recorded leaf error, not an aborted walk (X1);
 *   - SettingsPanel.test.tsx still reaches SettingsPanel.tsx through it;
 *   - keeper.test.ts is collected by the real-process config only;
 *   - check-conventions.test.mjs names `openspec` by literal;
 *   - project setupFiles / globalSetup are global inputs (2.5);
 *   - the whole build, both configs + literal index, takes < 60 s (P1).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import { decide } from "../test-selection/decide.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let index;
let wallMs;

beforeAll(() => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sel-graph-")), "index.json");
  const script = `
    import { buildTestIndex } from ${JSON.stringify(path.join(repoRoot, "scripts/test-selection/graph.mjs"))};
    import fs from "node:fs";
    const idx = await buildTestIndex({ root: ${JSON.stringify(repoRoot)} });
    fs.writeFileSync(${JSON.stringify(out)}, JSON.stringify(idx));
    process.exit(0);
  `;
  const t0 = Date.now();
  execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 });
  wallMs = Date.now() - t0;
  index = JSON.parse(fs.readFileSync(out, "utf8"));
  fs.rmSync(path.dirname(out), { recursive: true, force: true });
}, 150_000);

const SETTINGS_TEST = "packages/client/src/components/__tests__/SettingsPanel.test.tsx";
const MONACO = "packages/client/src/components/editor-pane/monaco-setup.ts";

describe("graph builder on the current tree", () => {
  it("P1: builds both configs and the literal index in under 60 s", () => {
    expect(wallMs).toBeLessThan(60_000);
    expect(Object.keys(index.tests).length).toBeGreaterThan(1500);
  });

  it("X1: a module that fails to transform is a recorded leaf, not an aborted walk", () => {
    expect(index.leafErrors.map(([f]) => f)).toContain(MONACO);
    const deps = index.tests[SETTINGS_TEST].deps;
    expect(deps).toContain("packages/client/src/components/settings/SettingsPanel.tsx");
    expect(deps).toContain(MONACO);
  });

  it("the real-process config's files are collected in their own phase only", () => {
    expect(index.tests["packages/server/src/rpc-keeper/__tests__/keeper.test.ts"].phase).toBe("real-process");
  });

  it("path literals are indexed per test", () => {
    expect(index.tests["scripts/__tests__/check-conventions.test.mjs"].locations).toContain("openspec");
  });

  it("zero-dep contract tests have no local deps (the always-run set)", () => {
    expect(index.tests["packages/client/src/__tests__/mdi-chunk-size.test.ts"].deps).toEqual([]);
  });

  it("cross-package edges resolve to workspace source", () => {
    const deps = index.tests[SETTINGS_TEST].deps;
    expect(deps.some((d) => d.startsWith("packages/shared/src/"))).toBe(true);
    expect(deps.every((d) => !d.includes("node_modules"))).toBe(true);
  });

  it("the packaging-scenario files are detected by their env read", () => {
    const gated = Object.keys(index.tests).filter((t) => index.tests[t].gated);
    expect(gated).toEqual(
      expect.arrayContaining([
        "scripts/__tests__/root-packaging.test.mjs",
        "scripts/__tests__/kb-packaging.test.mjs",
        "scripts/__tests__/knip-scan.test.mjs",
      ]),
    );
    expect(gated).not.toContain("scripts/__tests__/select-affected-tests.test.mjs");
  });

  it("2.5: project setupFiles / globalSetup are global inputs — a diff to one is full", () => {
    expect(index.globalInputs).toContain("packages/shared/src/test-support/setup-home.ts");
    expect(index.globalInputs).toContain("packages/shared/src/test-support/setup-home-perfile.ts");
    const sel = decide({
      changed: ["packages/shared/src/test-support/setup-home-perfile.ts"],
      index,
      data: { triggers: {}, coveredElsewhere: [], slowTier: [] },
    });
    expect(sel.mode).toBe("full");
  });
});
