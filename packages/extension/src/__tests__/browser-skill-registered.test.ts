/**
 * Asserts the universal `browser` skill is registered in the extension
 * package and ships in the published tarball.
 *
 * Spec: `default-browser-skill` — "Required files present" + "pi.skills[]
 * declares the skill" + "Skill files ship in the published package".
 *
 * See change: ship-browser-skill-and-electron-cdp.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";

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
    "references/dashboard-relay.md",
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

  it("declares the panerelay + curl grants (E30)", () => {
    expect(src).toMatch(/Bash\(npx @panerelay\/setup:\*\)/);
    expect(src).toMatch(/Bash\(curl:\*\)/);
  });

  it("routes login-state tasks to the dashboard relay before the legacy Panerelay recipe", () => {
    expect(src).toContain("references/dashboard-relay.md");
    expect(src).toMatch(/dashboard-relay\.md.*preferred|preferred.*dashboard-relay\.md/is);
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
    // `npm pack --json` changed shape: npm <=11 emits an ARRAY of results,
    // npm 12 emits an OBJECT keyed by package name. Indexing [0] silently
    // yields undefined on the newer CLI, so accept both.
    const out = JSON.parse(
      execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: pkgDir, encoding: "utf8" }),
    ) as Array<{ files: Array<{ path: string }> }> | Record<string, { files: Array<{ path: string }> }>;
    const [result] = Array.isArray(out) ? out : Object.values(out);
    expect(result, `unexpected \`npm pack --json\` shape from npm ${process.env.npm_config_user_agent ?? "?"}`).toBeDefined();
    const files = result.files.map((f) => f.path);
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

describe("browser skill — dashboard relay routing branches (X15)", () => {
  const relay = fs.readFileSync(
    path.join(skillDir, "references", "dashboard-relay.md"),
    "utf-8",
  );

  it.each([
    ["404 (plugin absent)", /`404`[\s\S]*not usable/i],
    ["enabled:false → enable", /"enabled":false[\s\S]{0,120}enable/i],
    ["canOpenChrome:false → 503 / stop", /"canOpenChrome":false[\s\S]{0,160}503/i],
    ["409 not-installed", /`409`[\s\S]{0,40}`not-installed`/],
    ["409 busy", /`409`[\s\S]{0,40}`busy`/],
    ["504 timeout", /`504`[\s\S]{0,120}60 s/i],
    ["deny-list is a loud -32000", /-32000/],
    ["loopback requirement", /loopback/i],
    // change: add-browser-editor-pane-tab (#X17)
    ["browser_show_in_pane tool", /browser_show_in_pane/],
    ["browser_await_human tool", /browser_await_human/],
    ["ack-and-drop setDownloadBehavior", /setDownloadBehavior[^.]*acknowledged and dropped|ack-and-drop/i],
    ["vbscript is fenced", /vbscript:/],
    ["never fall back to the bundled browser", /Never fall back to the bundled browser/i],
  ])("dashboard-relay.md documents %s", (_label, pattern) => {
    expect(relay).toMatch(pattern);
  });
});

describe("browser skill — operator host recipe (#E59)", () => {
  const relay = fs.readFileSync(path.join(skillDir, "references", "dashboard-relay.md"), "utf-8");

  it("gates `host` on the `operatorHosts: true` status precondition", () => {
    expect(relay).toMatch(/`host`/);
    expect(relay).toMatch(/operatorHosts: true/);
    expect(relay).toMatch(/operatorHosts: true[\s\S]{0,200}`host`|`host`[\s\S]{0,200}operatorHosts: true/);
  });

  it.each(["unknown-host", "operator-denied", "consent-timeout", "no-chrome", "host-gone"])(
    "documents the %s error",
    (reason) => {
      expect(relay).toContain(`\`${reason}\``);
    },
  );

  it("states the own-computer rule and the never-fall-back rule for operator-denied", () => {
    expect(relay).toMatch(/own computer/i);
    expect(relay).toMatch(/operator-denied[\s\S]{0,300}(never|do not|not)[\s\S]{0,80}dashboard host/i);
  });
});

describe("browser skill — dedicated-browser recipe text (#E25)", () => {
  // test-plan #E25 — change: add-dedicated-agent-browser.
  // Prose is hard-wrapped: collapse whitespace so phrases match across line breaks.
  const flat = (t: string): string => t.replace(/\s+/g, " ");
  const relay = flat(fs.readFileSync(path.join(skillDir, "references", "dashboard-relay.md"), "utf-8"));
  const skill = flat(fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf-8"));

  it("names browser_connect as the primary recipe, before the REST fallback", () => {
    expect(relay).toContain("browser_connect");
    expect(relay.indexOf("## Primary recipe")).toBeGreaterThan(-1);
    expect(relay.indexOf("## Primary recipe")).toBeLessThan(relay.indexOf("## Fallback recipe"));
    expect(skill).toContain("browser_connect");
  });

  it("names dedicated/open and the {profileDirectory} body form", () => {
    expect(relay).toContain("dedicated/open");
    expect(relay).toContain("{profileDirectory}");
    expect(relay).toMatch(/"profileDirectory":"Default"/);
    expect(relay).toMatch(/dedicated\/\{connect,open,stop,reset\}/);
  });

  it("forbids reading, copying or launching a browser on the profile dir, and reading the downloads dir", () => {
    expect(relay).toMatch(/MUST NOT read, copy, or launch a browser on the dedicated profile directory/);
    expect(relay).toContain("~/.pi/dashboard/agent-chrome");
    expect(relay).toMatch(/MUST NOT read the dedicated downloads directory/);
    expect(relay).toContain("~/.pi/dashboard/agent-chrome-downloads");
    expect(relay).toMatch(/unless its task names a file/);
  });

  it("makes a headless result for a login task a stop, not a fallback", () => {
    expect(relay).toMatch(/\{browser: "headless"\}[^\n]*login[\s\S]{0,200}\*\*Stop\.\*\*/);
    expect(relay).toMatch(/never a fallback/i);
    expect(skill).toMatch(/`headless`\s+result[\s\S]{0,120}login task[\s\S]{0,40}stop, not a fallback/);
  });

  it("states the same-user limit and that browser_connect never routes to Panerelay", () => {
    expect(relay).toMatch(/same OS user/);
    expect(relay).toMatch(/`browser_connect` \*\*never\*\* routes to Panerelay/);
    expect(skill).toMatch(/`browser_connect` never routes to Panerelay/);
  });

  it("SKILL.md still references references/challenge.md", () => {
    expect(skill).toContain("references/challenge.md");
  });
});

describe("browser skill — dedicated login wall routing (#R18)", () => {
  // test-plan #R18 — change: add-dedicated-agent-browser.
  const relay = fs
    .readFileSync(path.join(skillDir, "references", "dashboard-relay.md"), "utf-8")
    .replace(/\s+/g, " ");
  const section = (heading: string, next: string): string => {
    const a = relay.indexOf(heading);
    const b = relay.indexOf(next, a + heading.length);
    expect(a, `missing ${heading}`).toBeGreaterThan(-1);
    expect(b, `missing ${next}`).toBeGreaterThan(a);
    return relay.slice(a, b);
  };

  it("routes a dedicated login wall to dedicated/open + ask_user, never credentials in the agent's tab", () => {
    const wall = section("### Login wall in the dedicated profile", "### Chrome profile closes");
    expect(wall).toContain("POST /api/browser/dedicated/open");
    expect(wall).toMatch(/"url":/);
    expect(wall).toContain("ask_user");
    expect(wall).toMatch(/reload your own tab/i);
    expect(wall).toMatch(/do not ask for credentials/i);
  });

  it("scopes browser_await_human to Chrome profiles and non-sign-in steps", () => {
    const scope = section("**Scope of `browser_await_human`:**", "### Login wall in the dedicated profile");
    expect(scope).toMatch(/\*\*Chrome profile\*\*: use it for any human step — login/);
    expect(scope).toMatch(/\*\*Dedicated profile\*\*: use it only for \*\*non-sign-in\*\* steps/);
    expect(scope).toMatch(/sign-in goes through `dedicated\/open` \+ `ask_user`/);
  });

  it("diagnoses a password-manager detach from the audit closed:/extension: details", () => {
    const pm = section("### Chrome profile closes on a password page", "## Dedicated profile — limits");
    expect(pm).toContain("GET /api/browser/audit");
    expect(pm).toContain("closed:");
    expect(pm).toContain("extension:");
    expect(pm).toMatch(/password-manager/i);
    expect(pm).toMatch(/dedicated\s+profile/);
    expect(pm).toMatch(/Do \*\*not\*\* retry the same page/);
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
