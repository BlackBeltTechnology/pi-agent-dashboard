/**
 * Tests for applyResourceToggle — replays pi's config-selector write via
 * pi's real SettingsManager against on-disk fixtures.
 *
 * See change: folder-resource-activation-toggle.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyResourceToggle } from "../resource-activation-toggle.js";

let tmpDir: string;
let globalDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-toggle-cwd-"));
  globalDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-toggle-global-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(globalDir, { recursive: true, force: true });
});

function readLocalSettings() {
  const p = path.join(tmpDir, ".pi", "settings.json");
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf-8")) : {};
}

function writeLooseExtension(baseDir: string, name: string) {
  const dir = path.join(baseDir, "extensions");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.ts`), "export default {};");
  return path.join(dir, `${name}.ts`);
}

describe("applyResourceToggle — loose resource", () => {
  it("toggles a local loose extension off then on", async () => {
    const filePath = writeLooseExtension(path.join(tmpDir, ".pi"), "my-ext");

    const off = await applyResourceToggle({
      scope: "local",
      cwd: tmpDir,
      type: "extension",
      filePath,
      enabled: false,
    });
    expect(off).toEqual({ ok: true });
    expect(readLocalSettings().extensions).toContain("-extensions/my-ext.ts");

    const on = await applyResourceToggle({
      scope: "local",
      cwd: tmpDir,
      type: "extension",
      filePath,
      enabled: true,
    });
    expect(on).toEqual({ ok: true });
    const arr = readLocalSettings().extensions;
    expect(arr).toContain("+extensions/my-ext.ts");
    expect(arr).not.toContain("-extensions/my-ext.ts");
  });

  it("toggles a global loose extension off, writing the global settings file", async () => {
    // Point HOME at an isolated dir so AGENT_DIR resolves under it. The
    // test-support setup already sets HOME to a tmp dir; place the global
    // pi agent dir there and confirm the write lands in ~/.pi/agent.
    const agentDir = path.join(os.homedir(), ".pi", "agent");
    const filePath = writeLooseExtension(agentDir, "global-ext");

    const off = await applyResourceToggle({
      scope: "global",
      type: "extension",
      filePath,
      enabled: false,
    });
    expect(off).toEqual({ ok: true });
    const settings = JSON.parse(fs.readFileSync(path.join(agentDir, "settings.json"), "utf-8"));
    expect(settings.extensions).toContain("-extensions/global-ext.ts");
    // No folder settings written for a global toggle.
    expect(fs.existsSync(path.join(tmpDir, ".pi", "settings.json"))).toBe(false);

    fs.rmSync(path.join(agentDir, "extensions", "global-ext.ts"), { force: true });
  });

  it("404s when the filePath is not in the scanned set (rejects ../ escape)", async () => {
    const res = await applyResourceToggle({
      scope: "local",
      cwd: tmpDir,
      type: "extension",
      filePath: path.join(tmpDir, "..", "escape.ts"),
      enabled: false,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(404);
  });
});

describe("applyResourceToggle — package resource", () => {
  it("disables a package-contributed skill in object form without uninstalling", async () => {
    // Build a path-source package contributing one skill, referenced by the
    // folder's settings.packages.
    const pkgDir = path.join(tmpDir, "mypkg");
    fs.mkdirSync(path.join(pkgDir, "skills", "brave-search"), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, "skills", "brave-search", "SKILL.md"), "---\nname: brave-search\n---\nb");
    fs.writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify({ name: "pi-skills", pi: { skills: ["skills"] } }));
    fs.mkdirSync(path.join(tmpDir, ".pi"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".pi", "settings.json"), JSON.stringify({ packages: [pkgDir] }));
    const skillPath = path.join(pkgDir, "skills", "brave-search", "SKILL.md");

    const res = await applyResourceToggle({
      scope: "local",
      cwd: tmpDir,
      type: "skill",
      filePath: skillPath,
      enabled: false,
      packageSource: pkgDir,
    });
    expect(res).toEqual({ ok: true });

    const settings = readLocalSettings();
    const entry = settings.packages.find(
      (p: any) => (typeof p === "string" ? p : p.source) === pkgDir,
    );
    // Rewritten to object form excluding the skill; package still present.
    expect(typeof entry).toBe("object");
    expect(entry.source).toBe(pkgDir);
    expect(entry.skills).toContain("-skills/brave-search/SKILL.md");
    expect(settings.packages.length).toBe(1);
  });

  it("400s when packageSource does not match the resolved resource's own source", async () => {
    const pkgDir = path.join(tmpDir, "mypkg");
    fs.mkdirSync(path.join(pkgDir, "skills", "brave-search"), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, "skills", "brave-search", "SKILL.md"), "---\nname: brave-search\n---\nb");
    fs.writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify({ name: "pi-skills", pi: { skills: ["skills"] } }));
    fs.mkdirSync(path.join(tmpDir, ".pi"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".pi", "settings.json"), JSON.stringify({ packages: [pkgDir] }));

    const res = await applyResourceToggle({
      scope: "local",
      cwd: tmpDir,
      type: "skill",
      filePath: path.join(pkgDir, "skills", "brave-search", "SKILL.md"),
      enabled: false,
      packageSource: "npm:some-other-package",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(400);
  });
});
