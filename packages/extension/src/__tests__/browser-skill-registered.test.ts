/**
 * Asserts the universal `browser` skill is registered in the extension
 * package and ships in the published tarball.
 *
 * Spec: `default-browser-skill` — "Required files present" + "pi.skills[]
 * declares the skill" + "Skill files ship in the published package".
 *
 * See change: ship-browser-skill-and-electron-cdp.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, "..", "..");
const skillDir = path.join(pkgDir, ".pi", "skills", "browser");
const pkgJsonPath = path.join(pkgDir, "package.json");
const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8")) as {
  pi?: { skills?: string[] };
  files?: string[];
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

describe("browser skill — required files present", () => {
  for (const rel of [
    "SKILL.md",
    "UPSTREAM.md",
    "LICENSE",
    "references/web.md",
    "references/electron.md",
    "scripts/detect-dashboard.sh",
  ]) {
    it(`ships ${rel}`, () => {
      const full = path.join(skillDir, rel);
      expect(fs.existsSync(full), `missing ${rel}`).toBe(true);
      const stat = fs.statSync(full);
      expect(stat.size).toBeGreaterThan(0);
    });
  }
});

describe("browser skill — SKILL.md frontmatter", () => {
  const src = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf-8");

  it("declares name: browser", () => {
    expect(src).toMatch(/^name:\s*browser\s*$/m);
  });

  it("declares allowed-tools with agent-browser bash patterns", () => {
    expect(src).toMatch(/allowed-tools:.*Bash\(agent-browser:\*\)/);
    expect(src).toMatch(/Bash\(npx agent-browser:\*\)/);
  });

  it("documents the Step-0 preflight halt message", () => {
    expect(src).toMatch(/pi install npm:pi-agent-browser/);
  });
});

describe("browser skill — package.json registration", () => {
  it("pi.skills[] includes .pi/skills/browser", () => {
    expect(pkgJson.pi?.skills).toContain(".pi/skills/browser");
  });

  it("files[] ships .pi/skills/browser/", () => {
    expect(pkgJson.files).toContain(".pi/skills/browser/");
  });
});

describe("browser skill — no bundled CLI", () => {
  it("agent-browser is NOT a runtime dep", () => {
    expect(pkgJson.dependencies?.["agent-browser"]).toBeUndefined();
    expect(pkgJson.peerDependencies?.["agent-browser"]).toBeUndefined();
    expect(pkgJson.optionalDependencies?.["agent-browser"]).toBeUndefined();
  });

  it("pi-agent-browser is NOT a runtime dep", () => {
    expect(pkgJson.dependencies?.["pi-agent-browser"]).toBeUndefined();
    expect(pkgJson.peerDependencies?.["pi-agent-browser"]).toBeUndefined();
    expect(pkgJson.optionalDependencies?.["pi-agent-browser"]).toBeUndefined();
  });
});
