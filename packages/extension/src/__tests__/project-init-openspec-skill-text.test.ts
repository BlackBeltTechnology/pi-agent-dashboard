/**
 * Text guards for the project-init SKILL.md OpenSpec detection (Steps 3b/3c/6).
 * The skill is prose an agent executes, so the contract is pinned by asserting
 * the load-bearing rules and the embedded opt-out one-liner stay present and
 * correct. Covers test-plan #E9–#E13 of change fix-project-setup-completion-state.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO = path.resolve(__dirname, "../../../..");
const SKILL = fs.readFileSync(path.join(REPO, "packages/extension/.pi/skills/project-init/SKILL.md"), "utf-8");
const ROUTES = fs.readFileSync(path.join(REPO, "packages/server/src/routes/openspec-routes.ts"), "utf-8");

function section(from: string, to: string): string {
  const a = SKILL.indexOf(from);
  const b = SKILL.indexOf(to, a + from.length);
  if (a < 0 || b < 0) throw new Error(`SKILL.md section not found: ${from} .. ${to}`);
  return SKILL.slice(a, b);
}
const STEP_3B = section("### 3b", "### 3c");
const STEP_3C = section("### 3c", "## Step 4 ");
const STEP_6 = section("## Step 6", "## Step 7");

/** String entries of a `const NAME = [ ... ];` array literal in openspec-routes.ts. */
function routeList(name: string): string[] {
  const m = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`).exec(ROUTES);
  if (!m) throw new Error(`list not found: ${name}`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

/**
 * @structural-pin SKILL.md is prose executed by an agent, so there is no code path to run; the load-bearing rules (fail-closed config, git placement, command + legacy disclosure, Step 6 gate) are pinned in its text, and the legacy lists are pinned against openspec-routes.ts
 */
describe("project-init SKILL.md — OpenSpec detection text", () => {
  it("E9: config fail-closed; absent file/key → dashboard defaults", () => {
    expect(STEP_3B).toContain("~/.pi/dashboard/config.json");
    expect(STEP_3B).toMatch(/fail closed/i);
    expect(STEP_3B).toMatch(/unreadable|not valid JSON/i);
    expect(STEP_3B).toMatch(/wrong type|non-boolean|non-array/i);
    expect(STEP_3B).toMatch(/absent[^\n]*default/i);
    for (const key of ["enabled", "offerInitialization", "optOutDirectories"]) expect(STEP_3B).toContain(key);
  });

  it("E11: git placement checks, offer switch, repair row keyed on openspec-explore", () => {
    expect(STEP_3B).toContain("--path-format=absolute");
    expect(STEP_3B).toContain("--is-inside-work-tree");
    expect(STEP_3B).toContain("--show-toplevel");
    expect(STEP_3B).toMatch(/offerInitialization[^\n]*false/);
    expect(STEP_3B).toContain(".pi/skills/openspec-explore");
    expect(STEP_3B).toMatch(/OPENSPEC_MODE/);
    for (const mode of ["offer", "repair", "skip"]) expect(STEP_3B).toContain(`\`${mode}\``);
  });

  it("E12: commands + legacy disclosure mirror the dashboard route lists", () => {
    for (const s of [STEP_3B, STEP_3C, STEP_6]) expect(s).toContain("openspec init --tools pi --force");
    const lists = [
      ...routeList("LEGACY_CONFIG_FILES"),
      ...routeList("LEGACY_COMMAND_DIRS"),
      ...routeList("LEGACY_COMMAND_FILE_DIRS"),
    ];
    expect(lists.length).toBeGreaterThan(20);
    for (const entry of lists) expect(STEP_3B).toContain(entry);
    for (const s of ["OPENSPEC:START", "OPENSPEC:END"]) expect(STEP_3B).toContain(s);
    expect(STEP_3C).toMatch(/other legacy OpenSpec files/i);
    expect(STEP_3C).toMatch(/global config/i);
    expect(STEP_3C).toMatch(/may be removed/i);
  });

  it("E13: Step 6 gate, verification, warning listing; idempotent paragraph rewritten", () => {
    expect(STEP_6).toMatch(/OPENSPEC_MODE/);
    expect(STEP_6).toMatch(/repair/);
    expect(STEP_6).toMatch(/confirmed/);
    expect(STEP_6).toContain(".pi/skills/openspec-explore");
    expect(STEP_6).toContain("ls .pi/skills");
    const idem = STEP_6.slice(STEP_6.indexOf("**Idempotent re-run")).replace(/\s+/g, " ");
    expect(idem).not.toMatch(/Step 3b never asked/);
    expect(idem).not.toMatch(/already existed[^\n]*skipped/);
    expect(idem).toMatch(/lands in `skip`.{0,160}both.{0,160}present/i);
  });
});

/**
 * @structural-pin the opt-out comparison is a shell one-liner embedded in SKILL.md; the test extracts it from the text and executes it, so the shipped snippet itself is what is verified
 */
describe("project-init SKILL.md — embedded opt-out one-liner", () => {
  let tmp: string;
  let preload: string;
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-optout-"));
    preload = path.join(tmp, "platform.cjs");
    fs.writeFileSync(preload, "Object.defineProperty(process,'platform',{value:process.env.FAKE_PLATFORM,configurable:true});");
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const m = /node -e '([^']+)' "\$TARGET" "\$OPT_OUT_JSON"/.exec(STEP_3B);

  function run(platform: string, target: string, entries: string[]): string {
    if (!m) throw new Error("one-liner not found in Step 3b");
    return execFileSync(process.execPath, ["-r", preload, "-e", m[1], target, JSON.stringify(entries)], {
      encoding: "utf-8",
      env: { ...process.env, FAKE_PLATFORM: platform },
    }).trim();
  }

  it("is embedded with the $TARGET / $OPT_OUT_JSON argument shape", () => {
    expect(m).not.toBeNull();
  });

  it.skipIf(process.platform === "win32")("E10: matches case-insensitively off linux, case-sensitively on linux, ignores trailing separators", () => {
    expect(run("darwin", "/Users/x/Proj", ["/users/x/proj/"])).toBe("match");
    expect(run("linux", "/Users/x/Proj", ["/Users/x/Proj"])).toBe("match");
    expect(run("linux", "/Users/x/Proj", ["/users/x/proj"])).toBe("no-match");
    expect(run("darwin", "/Users/x/Proj", ["/Users/x/Other"])).toBe("no-match");
    expect(run("darwin", "/Users/x/Proj", [])).toBe("no-match");
  });
});
