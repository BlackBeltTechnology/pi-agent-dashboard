/**
 * Dual-scope scanner tests: scope tagging, merge, collision-across-scopes,
 * invalid-file isolation. See change: add-automation-plugin.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanAutomations } from "../server/scanner.js";

const KNOWN = new Set(["schedule"]);

function writeAutomation(base: string, name: string, yaml: string): void {
  const dir = path.join(base, ".pi", "automation", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "automation.yaml"), yaml);
}

const VALID = `
on: { kind: schedule, cron: "0 9 * * 1" }
action: { kind: prompt, prompt: ./prompt.md }
model: "@fast"
`;

let repoRoot: string;
let homeDir: string;

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "auto-repo-"));
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-home-"));
});
afterEach(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
  fs.rmSync(homeDir, { recursive: true, force: true });
});

describe("scanAutomations", () => {
  it("discovers per-folder automations tagged scope=folder", () => {
    writeAutomation(repoRoot, "weekly-brief", VALID);
    const out = scanAutomations({ repoRoot, homeDir }, KNOWN);
    const a = out.find((x) => x.name === "weekly-brief");
    expect(a?.scope).toBe("folder");
    expect(a?.valid).toBe(true);
  });

  it("discovers global automations tagged scope=global", () => {
    writeAutomation(homeDir, "nightly-bugfix", VALID);
    const out = scanAutomations({ repoRoot, homeDir }, KNOWN);
    const a = out.find((x) => x.name === "nightly-bugfix");
    expect(a?.scope).toBe("global");
  });

  it("keeps same-name automations across scopes as distinct entries", () => {
    writeAutomation(repoRoot, "x", VALID);
    writeAutomation(homeDir, "x", VALID);
    const out = scanAutomations({ repoRoot, homeDir }, KNOWN).filter((a) => a.name === "x");
    expect(out).toHaveLength(2);
    expect(out.map((a) => a.scope).sort()).toEqual(["folder", "global"]);
  });

  it("isolates an invalid automation without dropping siblings", () => {
    writeAutomation(repoRoot, "good", VALID);
    writeAutomation(repoRoot, "bad", `on: { kind: slack.message }\naction: { kind: prompt, prompt: ./p.md }\nmodel: x`);
    const out = scanAutomations({ repoRoot, homeDir }, KNOWN);
    const good = out.find((a) => a.name === "good");
    const bad = out.find((a) => a.name === "bad");
    expect(good?.valid).toBe(true);
    expect(bad?.valid).toBe(false);
    expect(bad?.error).toContain("slack.message");
  });

  it("ignores the runs/ store dir", () => {
    fs.mkdirSync(path.join(repoRoot, ".pi", "automation", "runs"), { recursive: true });
    const out = scanAutomations({ repoRoot, homeDir }, KNOWN);
    expect(out.find((a) => a.name === "runs")).toBeUndefined();
  });

  it("returns empty when no automation dirs exist", () => {
    expect(scanAutomations({ repoRoot, homeDir }, KNOWN)).toEqual([]);
  });

  it("honors scanFolder/scanGlobal toggles", () => {
    writeAutomation(repoRoot, "f", VALID);
    writeAutomation(homeDir, "g", VALID);
    const folderOnly = scanAutomations({ repoRoot, homeDir, scanGlobal: false }, KNOWN);
    expect(folderOnly.map((a) => a.name)).toEqual(["f"]);
    const globalOnly = scanAutomations({ repoRoot, homeDir, scanFolder: false }, KNOWN);
    expect(globalOnly.map((a) => a.name)).toEqual(["g"]);
  });
});
