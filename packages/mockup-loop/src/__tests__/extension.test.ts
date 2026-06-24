/**
 * Smoke tests for the mockup-loop extension tools, focused on the new
 * design-system surface: list_design_systems, init_ui_contract (+system),
 * score_mockup (+system), validate_mockup. Back-compat: no-system calls must
 * behave exactly as before.
 *
 * Pattern: a fake ExtensionAPI captures registered tool handlers, then we
 * drive them directly. Mirrors image-fit-extension's extension.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import frontendMockupLoop from "../extension.js";

interface Tool {
  name: string;
  execute: (id: string, params: any) => Promise<{ content: { text: string }[]; details: Record<string, unknown> }>;
}

function makeFakePi() {
  const tools = new Map<string, Tool>();
  const pi: any = {
    registerTool(t: Tool) {
      tools.set(t.name, t);
    },
    registerCommand() {},
    on() {},
  };
  return { pi, tools };
}

describe("extension tool surface", () => {
  let tools: Map<string, Tool>;
  let workDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const f = makeFakePi();
    tools = f.tools;
    frontendMockupLoop(f.pi);
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), "ml-ext-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it("registers all five tools", () => {
    for (const name of ["serve_mockup", "score_mockup", "init_ui_contract", "list_design_systems", "validate_mockup"]) {
      expect(tools.has(name)).toBe(true);
    }
  });

  it("list_design_systems returns the 5-preset registry", async () => {
    const res = await tools.get("list_design_systems")!.execute("t", {});
    const presets = (res.details as any).presets as any[];
    expect(presets).toHaveLength(5);
    expect(presets.map((p) => p.id)).toContain("apple-hig");
  });

  it("init_ui_contract with no system writes the blank template (back-compat)", async () => {
    const target = path.join(workDir, "ui-contract.md");
    const res = await tools.get("init_ui_contract")!.execute("t", { path: target });
    expect((res.details as any).created).toBe(true);
    const body = fs.readFileSync(target, "utf8");
    expect(body).toContain("# UI Contract");
    expect(body).toContain("Anti-slop guardrails");
  });

  it("init_ui_contract --system shadcn writes a DTCG contract", async () => {
    const target = path.join(workDir, "ui-contract.tokens.json");
    const res = await tools.get("init_ui_contract")!.execute("t", { path: target, system: "shadcn" });
    expect((res.details as any).system).toBe("shadcn");
    const parsed = JSON.parse(fs.readFileSync(target, "utf8"));
    expect(parsed.color.primary).toHaveProperty("$value");
  });

  it("init_ui_contract rejects an unknown system", async () => {
    const res = await tools.get("init_ui_contract")!.execute("t", { system: "bogus" });
    expect((res.details as any).error).toContain("bogus");
  });

  it("score_mockup --system apple-hig returns the HIG rubric, not the generic one", async () => {
    const res = await tools.get("score_mockup")!.execute("t", { url: "http://x", system: "apple-hig" });
    const text = res.content.map((c) => c.text).join("\n");
    expect(text).toContain("Apple Human Interface Guidelines");
    expect(text).toContain("tab bar");
    expect(text).not.toContain("purple gradient");
  });

  it("validate_mockup returns the { gates, advisory, pass } shape", async () => {
    fs.writeFileSync(path.join(workDir, "index.html"), `<div class="text-primary">ok</div>`);
    const res = await tools.get("validate_mockup")!.execute("t", { system: "shadcn", dir: workDir });
    const d = res.details as any;
    expect(d.gates.l1).toBeTruthy();
    expect(d.gates.l2).toBeTruthy();
    expect(d.advisory.l4).toBeTruthy();
    expect(typeof d.pass).toBe("boolean");
  });
});
