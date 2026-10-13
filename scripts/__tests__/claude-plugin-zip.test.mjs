/**
 * Release zip of the Claude plugin (`scripts/build-claude-plugin-zip.mjs`).
 *
 *  - E44: layout — manifest at the zip root, both skills, README, LICENSE,
 *    nothing that blocks Cowork / claude.ai, no `.DS_Store`.
 *  - E45: a version that differs from `plugin.json` (or none) is refused and
 *    no zip is written.
 *
 * See change: add-claude-code-plugin (design D10).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = path.join(REPO_ROOT, "scripts/build-claude-plugin-zip.mjs");
const PLUGIN_DIR = path.join(REPO_ROOT, "packages/claude-plugin");
const pluginVersion = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, ".claude-plugin/plugin.json"), "utf8")).version;

const tmpDirs = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "claude-plugin-zip-"));
  tmpDirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const build = (args) => spawnSync("node", [SCRIPT, ...args], { encoding: "utf8" });
const listZip = (zip) => spawnSync("zipinfo", ["-1", zip], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);

describe("zip layout (E44)", () => {
  it("writes one zip with the manifest at its root", () => {
    const out = tmp();
    // A stray file that must not be shipped.
    const junk = path.join(PLUGIN_DIR, ".DS_Store");
    fs.writeFileSync(junk, "x");
    try {
      const r = build(["--version", pluginVersion, "--out", out]);
      expect(r.status, r.stderr).toBe(0);
      const zips = fs.readdirSync(out);
      expect(zips).toEqual([`pi-dashboard-claude-plugin-${pluginVersion}.zip`]);

      const entries = listZip(path.join(out, zips[0]));
      for (const want of [
        ".claude-plugin/plugin.json",
        "skills/pi-dashboard-bootstrap/SKILL.md",
        "skills/pi-dashboard-bootstrap/scripts/ensure-dashboard.sh",
        "skills/pi-dashboard-control/SKILL.md",
        "README.md",
        "LICENSE",
      ]) {
        expect(entries, want).toContain(want);
      }
      expect(entries.filter((e) => /^(bin|hooks)\//.test(e) || e === ".mcp.json")).toEqual([]);
      expect(entries.filter((e) => e.endsWith(".DS_Store"))).toEqual([]);

      const manifest = spawnSync("unzip", ["-p", path.join(out, zips[0]), ".claude-plugin/plugin.json"], {
        encoding: "utf8",
      }).stdout;
      expect(JSON.parse(manifest).version).toBe(pluginVersion);
    } finally {
      fs.rmSync(junk, { force: true });
    }
  });
});

describe("version gate (E45)", () => {
  it("refuses a mismatching version naming both, and writes no zip", () => {
    const out = tmp();
    const r = build(["--version", "99.99.99", "--out", out]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("99.99.99");
    expect(r.stderr).toContain(pluginVersion);
    expect(fs.readdirSync(out)).toEqual([]);
  });

  it("refuses a missing --version", () => {
    const out = tmp();
    const r = build(["--out", out]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("--version");
    expect(fs.readdirSync(out)).toEqual([]);
  });
});
