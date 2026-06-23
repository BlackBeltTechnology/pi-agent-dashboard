/**
 * automation-writer tests: create-writes-scope + prompt.md.
 * See change: add-automation-plugin.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeAutomation, isValidAutomationName, deleteAutomation } from "../server/automation-writer.js";
import { parseAutomationYaml } from "../server/automation-schema.js";
import type { AutomationConfig } from "../shared/automation-types.js";

const KNOWN = new Set(["schedule"]);
let base: string;
beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "auto-writer-"));
});
afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

const promptConfig: AutomationConfig = {
  on: { kind: "schedule", cron: "0 9 * * 1" },
  action: { kind: "prompt", prompt: "ignored.md" },
  model: "@fast",
  mode: "worktree",
  sandbox: "workspace-write",
  concurrency: "skip",
  visibility: "hidden",
};

describe("isValidAutomationName", () => {
  it("accepts safe names and rejects traversal / reserved", () => {
    expect(isValidAutomationName("weekly-brief")).toBe(true);
    expect(isValidAutomationName("runs")).toBe(false);
    expect(isValidAutomationName("../escape")).toBe(false);
    expect(isValidAutomationName("a/b")).toBe(false);
  });
});

describe("writeAutomation", () => {
  it("writes automation.yaml that round-trips through the parser", () => {
    writeAutomation({ scopeBase: base, name: "weekly-brief", config: promptConfig, promptBody: "Summarize the week." });
    const yamlPath = path.join(base, ".pi", "automation", "weekly-brief", "automation.yaml");
    const parsed = parseAutomationYaml(fs.readFileSync(yamlPath, "utf-8"), KNOWN);
    expect(parsed.error).toBeUndefined();
    expect(parsed.config?.model).toBe("@fast");
    expect(parsed.config?.visibility).toBe("hidden");
  });

  it("writes prompt.md and normalizes action.prompt to ./prompt.md", () => {
    writeAutomation({ scopeBase: base, name: "p", config: promptConfig, promptBody: "Find regressions." });
    const dir = path.join(base, ".pi", "automation", "p");
    expect(fs.readFileSync(path.join(dir, "prompt.md"), "utf-8")).toContain("Find regressions.");
    const parsed = parseAutomationYaml(fs.readFileSync(path.join(dir, "automation.yaml"), "utf-8"), KNOWN);
    expect(parsed.config?.action).toEqual({ kind: "prompt", prompt: "./prompt.md" });
  });

  it("does not write prompt.md for skill actions", () => {
    const skillConfig: AutomationConfig = { ...promptConfig, action: { kind: "skill", skill: "$recent-code-bugfix" } };
    writeAutomation({ scopeBase: base, name: "s", config: skillConfig });
    const dir = path.join(base, ".pi", "automation", "s");
    expect(fs.existsSync(path.join(dir, "prompt.md"))).toBe(false);
  });

  it("create (default intent) rejects an existing-name collision", () => {
    writeAutomation({ scopeBase: base, name: "dup", config: promptConfig, promptBody: "a" });
    expect(() =>
      writeAutomation({ scopeBase: base, name: "dup", config: promptConfig, promptBody: "b" }),
    ).toThrow(/already exists/);
  });

  it("update overwrites an existing automation in place", () => {
    writeAutomation({ scopeBase: base, name: "edit-me", config: promptConfig, promptBody: "old body" });
    const updated: AutomationConfig = { ...promptConfig, model: "@coding" };
    writeAutomation({ scopeBase: base, name: "edit-me", config: updated, promptBody: "new body", intent: "update" });
    const dir = path.join(base, ".pi", "automation", "edit-me");
    expect(fs.readFileSync(path.join(dir, "prompt.md"), "utf-8")).toContain("new body");
    const parsed = parseAutomationYaml(fs.readFileSync(path.join(dir, "automation.yaml"), "utf-8"), KNOWN);
    expect(parsed.config?.model).toBe("@coding");
  });

  it("update of a missing automation fails", () => {
    expect(() =>
      writeAutomation({ scopeBase: base, name: "ghost", config: promptConfig, promptBody: "x", intent: "update" }),
    ).toThrow(/does not exist/);
  });

  it("deleteAutomation removes the dir", () => {
    writeAutomation({ scopeBase: base, name: "gone", config: promptConfig, promptBody: "x" });
    expect(deleteAutomation(base, "gone")).toBe(true);
    expect(fs.existsSync(path.join(base, ".pi", "automation", "gone"))).toBe(false);
  });
});
