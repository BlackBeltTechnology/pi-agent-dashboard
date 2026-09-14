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
import { execFileSync } from "node:child_process";
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
    "references/challenge.md",
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

  it("declares metadata.version \"1.2\"", () => {
    // test-plan #E2
    expect(src).toMatch(/^\s*version:\s*"1\.2"\s*$/m);
  });

  it("names references/challenge.md somewhere", () => {
    // test-plan #E2
    expect(src).toContain("references/challenge.md");
  });
});

describe("browser skill — challenge hook sits in the execute step", () => {
  const src = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf-8");

  it("places the challenge mention between ## Step 1 and ## Notes", () => {
    // test-plan #E6
    const step1 = src.slice(src.indexOf("## Step 1"), src.indexOf("## Notes"));
    expect(step1).toMatch(/references\/challenge\.md/);
  });

  it("lists challenge.md as authored in Notes", () => {
    // test-plan #E6
    const notes = src.slice(src.indexOf("## Notes"));
    expect(notes).toMatch(/challenge\.md/);
    expect(notes).toMatch(/authored, not vendored/i);
  });
});

describe("browser skill — UPSTREAM.md marks the challenge reference not vendored", () => {
  // test-plan #E3 — the first assertion set that reads UPSTREAM.md.
  const upstream = fs.readFileSync(path.join(skillDir, "UPSTREAM.md"), "utf-8");

  it("lists challenge.md in the not-vendored paragraph", () => {
    // Scoped to the paragraph itself: the step-4 line below also names
    // challenge.md, so a whole-file match would pass even if the paragraph
    // dropped it — and the paragraph is what exempts the file from refresh.
    const paragraph = upstream.slice(upstream.indexOf("Not vendored"), upstream.indexOf("| Field"));
    expect(paragraph).toContain("challenge.md");
  });

  it("adds challenge.md to the refresh step-4 leave-untouched line", () => {
    // Scoped to step 4 so this cannot match the not-vendored paragraph above;
    // the instruction is wrapped across comment lines, hence [\s\S].
    const step4 = upstream.slice(upstream.indexOf("# 4."));
    expect(step4).toMatch(/Leave\b[\s\S]*?challenge\.md[\s\S]*?untouched/);
  });
});

describe("browser skill — challenge reference body", () => {
  // test-plan #E4 — required-token decision table + solver deny-list.
  const challenge = fs.readFileSync(path.join(skillDir, "references", "challenge.md"), "utf-8");

  it("carries the required rule tokens", () => {
    for (const token of ["close --all", "--headed", "--restore", "AutomationControlled", "Never"]) {
      expect(challenge, `challenge.md must mention ${token}`).toContain(token);
    }
  });

  it("names no CAPTCHA-solving service", () => {
    for (const vendor of ["2captcha", "anti-captcha", "capsolver", "capmonster"]) {
      expect(challenge, `challenge.md must not name ${vendor}`).not.toContain(vendor);
    }
  });
});

describe("browser skill — own-browser troubleshooting defers on a challenge", () => {
  // test-plan #E5 — line-scoped so the row, not the file, must carry the pointer.
  it("points the fresh --session row at challenge.md", () => {
    const own = fs.readFileSync(path.join(skillDir, "references", "own-browser.md"), "utf-8");
    const row = own.split("\n").find((line) => /fresh `--session`/.test(line));
    expect(row, "own-browser.md must keep the fresh --session troubleshooting row").toBeDefined();
    expect(row).toContain("challenge.md");
  });
});

describe("browser skill — shipped tarball", () => {
  // test-plan #E7 — packlist boundary: `files[]` ships the reference, the
  // `!**/*.AGENTS.md` negation keeps the sidecar out.
  it("packs references/challenge.md but not its AGENTS sidecar", () => {
    const out = JSON.parse(
      execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: pkgDir, encoding: "utf8" }),
    ) as Array<{ files: Array<{ path: string }> }>;
    const files = out[0].files.map((f) => f.path);
    expect(files).toContain(".pi/skills/browser/references/challenge.md");
    expect(files).not.toContain(".pi/skills/browser/references/challenge.md.AGENTS.md");
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
