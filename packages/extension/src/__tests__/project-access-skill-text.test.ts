/**
 * Text guards + registration for the `project-access` skill and the project-init
 * access step. The skills are prose an agent executes, so the contract is pinned
 * by asserting the load-bearing rules stay present (profile v1, polling, 404
 * wording, consent-not-containment, never settling) and that the skill ships in
 * the published package. See change: add-access-provisioning (tasks 4.1, 4.2).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const PKG = path.resolve(__dirname, "../..");
const SKILLS = path.join(PKG, ".pi", "skills");
/** Prose wraps at ~80 columns; collapse whitespace so rules are matched as sentences. */
const flat = (src: string): string => src.replace(/\s+/g, " ");
const ACCESS = flat(fs.readFileSync(path.join(SKILLS, "project-access", "SKILL.md"), "utf-8"));
const INIT = flat(fs.readFileSync(path.join(SKILLS, "project-init", "SKILL.md"), "utf-8"));
const PKG_JSON = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf-8")) as {
  pi?: { skills?: string[] };
  files?: string[];
};

function section(src: string, from: string, to: string): string {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + from.length);
  if (a < 0 || b < 0) throw new Error(`section not found: ${from} .. ${to}`);
  return src.slice(a, b);
}

/**
 * @structural-pin SKILL.md is prose executed by an agent, so there is no code path to run; its load-bearing rules are pinned in its text
 */
describe("project-access skill — registration", () => {
  it("is declared in pi.skills and shipped in files", () => {
    expect(PKG_JSON.pi?.skills).toContain(".pi/skills/project-access");
    expect(PKG_JSON.files).toContain(".pi/skills/project-access/");
  });

  it("has frontmatter name + trigger-carrying description", () => {
    expect(ACCESS).toMatch(/^---\s+name:\s*project-access\s/);
    const description = /description:\s*(.*?)\s+license:/.exec(ACCESS)?.[1] ?? "";
    for (const trigger of ["folder access", "access.json", "map", "suggest", "provision"]) {
      expect(description, `description must carry "${trigger}"`).toContain(trigger);
    }
  });
});

describe("project-access skill — modes", () => {
  const MAP = section(ACCESS, "## Mode `map`", "## Mode `suggest`");
  const SUGGEST = section(ACCESS, "## Mode `suggest`", "## Mode `provision`");
  const PROVISION = section(ACCESS, "## Mode `provision`", "## Consent");

  it("map is read-only and reports the bash gap", () => {
    expect(MAP).toMatch(/read-only/i);
    expect(MAP).toMatch(/never writes/i);
    expect(MAP).toMatch(/`bash`[^.]*not gated/i);
    for (const source of ["/api/access/grants", "/api/access/prompts", "/api/access/pi-trust", "agentPathGate"]) {
      expect(MAP).toContain(source);
    }
  });

  it("suggest states skipped grants and partial coverage before asking to write", () => {
    expect(SUGGEST).toMatch(/skipped/i);
    expect(SUGGEST).toMatch(/may be partial/i);
    expect(SUGGEST).toMatch(/before (you )?ask/i);
    expect(SUGGEST).toContain("ask_user");
    expect(SUGGEST).toContain('"version": 1');
  });

  it("provision submits, polls until terminal and reports each outcome", () => {
    expect(PROVISION).toContain("POST $BASE/api/access/provision");
    expect(PROVISION).toContain("GET $BASE/api/access/provision/<requestId>");
    expect(PROVISION).toMatch(/until[^.]*(terminal|not `pending`)/i);
    expect(PROVISION).toContain("unknown — check Settings ▸ Access");
    expect(PROVISION).toMatch(/each line/i);
  });

  it("provision explains every refusal code, no-operator by opening the dashboard", () => {
    for (const code of [
      "empty",
      "too-many-lines",
      "pending-exists",
      "capacity",
      "rate-limited",
      "cooldown",
      "disabled",
      "prompting-disabled",
      "report-mode",
      "no-operator",
    ]) {
      expect(PROVISION, `refusal code ${code}`).toContain(`\`${code}\``);
    }
    expect(PROVISION).toMatch(/no-operator[^.]*open the dashboard[^.]*retry/i);
  });

  it("refuses an unknown profile version", () => {
    expect(ACCESS).toContain(".pi/access.json");
    expect(ACCESS).toMatch(/version[^.]*1/);
    expect(ACCESS).toMatch(/unknown `?version`?[^.]*refuse/i);
  });
});

describe("project-access skill — trust statements", () => {
  it("states consent, not containment", () => {
    const consent = section(ACCESS, "## Consent", "## Notes");
    expect(consent).toMatch(/consent, not (containment|protection)/i);
    expect(consent).toMatch(/every session on this machine/i);
  });

  it("never settles, dismisses or writes grants itself", () => {
    expect(ACCESS).toMatch(/never call[^.]*settle[^.]*dismiss-all/i);
    expect(ACCESS).toMatch(/never (write|edit).{0,80}access-grants\.json/i);
  });

  it("discovers the server URL like the pi-dashboard skill", () => {
    expect(ACCESS).toContain("~/.pi/dashboard/config.json");
    expect(ACCESS).toContain("pi-dashboard");
    expect(ACCESS).toMatch(/8000/);
  });
});

describe("project-init skill — access step (project-init-skill delta)", () => {
  const STEP = section(INIT, "## Step 4c", "## Step 5");

  it("is a separate opt-in question after the scaffold", () => {
    expect(INIT.indexOf("## Step 4c")).toBeGreaterThan(INIT.indexOf("## Step 4 "));
    expect(STEP).toContain("ask_user");
    expect(STEP).toMatch(/separate/i);
  });

  it("offers the profile's lines, else lets the user list folders", () => {
    expect(STEP).toContain(".pi/access.json");
    expect(STEP).toMatch(/list folders|names? (the )?folders/i);
  });

  it("submits through project-access provision and reports each outcome", () => {
    expect(STEP).toContain("project-access");
    expect(STEP).toMatch(/`provision`/);
    expect(STEP).toMatch(/each line/i);
  });

  it("never fails the init; no-operator → retry later with project-access", () => {
    expect(STEP).toMatch(/never fail/i);
    expect(STEP).toMatch(/declin/i);
    expect(STEP).toMatch(/no-operator[^.]*retry[^.]*project-access/i);
  });

  it("is listed in the preview (Step 3c) as a separate opt-in", () => {
    const preview = section(INIT, "### 3c", "## Step 4 ");
    expect(preview).toMatch(/access/i);
    expect(preview).toContain("Step 4c");
  });
});
