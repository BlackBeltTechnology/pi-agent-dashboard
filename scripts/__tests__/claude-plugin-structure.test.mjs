/**
 * Structure contract for the Claude plugin (`packages/claude-plugin/`) and the
 * root marketplace manifest. Deny-list style: new optional manifest keys never
 * break CI; only keys the Claude validator rejects, and components that make
 * Cowork / claude.ai refuse the whole plugin, are forbidden.
 *
 * See change: add-claude-code-plugin (test-plan E1, E2, E37).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PLUGIN_DIR = path.join(REPO_ROOT, "packages", "claude-plugin");
const MANIFEST = path.join(PLUGIN_DIR, ".claude-plugin", "plugin.json");
const MARKETPLACE = path.join(REPO_ROOT, ".claude-plugin", "marketplace.json");

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

/** Every file under `dir`, recursively (relative paths). */
function walk(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full, base));
    else out.push(path.relative(base, full));
  }
  return out;
}

/** Words of a markdown document outside fenced code blocks. */
function wordsOutsideFences(md) {
  const stripped = md.replace(/```[\s\S]*?```/g, " ");
  return stripped.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
}

describe("plugin layout (E1)", () => {
  const manifest = readJson(MANIFEST);

  it("manifest carries every required key", () => {
    expect(manifest.name).toBe("pi-dashboard");
    for (const key of ["name", "version", "description", "author", "license"]) {
      expect(manifest[key], key).toBeTruthy();
    }
  });

  it("manifest has no displayName (the validator rejects it)", () => {
    expect(manifest).not.toHaveProperty("displayName");
  });

  it("has no top-level bin/, .mcp.json or hooks/ (they block Cowork / claude.ai)", () => {
    for (const forbidden of ["bin", ".mcp.json", "hooks"]) {
      expect(fs.existsSync(path.join(PLUGIN_DIR, forbidden)), forbidden).toBe(false);
    }
  });

  it("README has at least 40 words outside code blocks", () => {
    const readme = fs.readFileSync(path.join(PLUGIN_DIR, "README.md"), "utf8");
    expect(wordsOutsideFences(readme).length).toBeGreaterThanOrEqual(40);
  });

  it("ships a license", () => {
    expect(fs.existsSync(path.join(PLUGIN_DIR, "LICENSE"))).toBe(true);
  });

  it("ships all three skills", () => {
    for (const skill of ["pi-dashboard-bootstrap", "pi-dashboard-control", "pi-dashboard-watch"]) {
      expect(fs.existsSync(path.join(PLUGIN_DIR, "skills", skill, "SKILL.md")), skill).toBe(true);
    }
  });
});

describe("marketplace manifest (E2)", () => {
  const marketplace = readJson(MARKETPLACE);

  it("is named pi-agent-dashboard with a description", () => {
    expect(marketplace.name).toBe("pi-agent-dashboard");
    expect(typeof marketplace.description).toBe("string");
    expect(marketplace.description.length).toBeGreaterThan(0);
  });

  it("has a pi-dashboard entry whose source resolves to the plugin directory", () => {
    const entry = (marketplace.plugins ?? []).find((p) => p.name === "pi-dashboard");
    expect(entry, "pi-dashboard entry").toBeTruthy();
    expect(typeof entry.source).toBe("string");
    expect(path.resolve(REPO_ROOT, entry.source)).toBe(PLUGIN_DIR);
  });
});

describe("forbidden references (E37)", () => {
  const FORBIDDEN = ["dashboard-bus", "bus-client", "dashboard-api.sh", "WebSocket bus", "commands/dashboard-"];

  it("no shipped plugin file mentions the bus client, dashboard-api.sh or pi command templates", () => {
    const offenders = [];
    for (const rel of walk(PLUGIN_DIR)) {
      const text = fs.readFileSync(path.join(PLUGIN_DIR, rel), "utf8");
      for (const token of FORBIDDEN) {
        if (text.includes(token)) offenders.push(`${rel}: ${token}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("skill content contract (E39)", () => {
  const skillText = (name) => fs.readFileSync(path.join(PLUGIN_DIR, "skills", name, "SKILL.md"), "utf8");

  /** Frontmatter `name` / `description` of a SKILL.md (single-line scalars). */
  function frontmatter(text) {
    const m = text.match(/^---\n([\s\S]*?)\n---\n/);
    expect(m, "frontmatter block").toBeTruthy();
    const field = (k) => (m[1].match(new RegExp(`^${k}:\\s*(.+)$`, "m")) ?? [])[1];
    return { name: field("name"), description: field("description") };
  }

  it.each(["pi-dashboard-bootstrap", "pi-dashboard-control", "pi-dashboard-watch"])("%s has valid frontmatter and a description ≤ 400 chars", (name) => {
    const fm = frontmatter(skillText(name));
    expect(fm.name).toBe(name);
    expect(fm.description?.length ?? 0).toBeGreaterThan(0);
    expect(fm.description.length).toBeLessThanOrEqual(400);
  });

  it("bootstrap: one foreground command, 600 s timeout, never background", () => {
    const text = skillText("pi-dashboard-bootstrap");
    const commands = text.match(/ensure-dashboard\.sh"/g) ?? [];
    expect(commands.length).toBeGreaterThanOrEqual(1);
    expect(text).toContain('sh "${CLAUDE_SKILL_DIR}/scripts/ensure-dashboard.sh"');
    expect(text).toMatch(/600\s?(s|000)/);
    expect(text).toMatch(/[Nn]ever run it in the background/);
    expect(text).toContain("--install");
  });

  it("control: token command, header file, --check chaining, no verbose/trace curl", () => {
    const text = skillText("pi-dashboard-control");
    expect(text).toContain("token create --label claude-code --tier control");
    expect(text).toContain("-H @");
    expect(text).toContain("--check &&");
    expect(text).not.toMatch(/curl[^\n]*\s(-v|--verbose|--trace|--trace-ascii)\b/);
  });
});

/**
 * Test-plan #E14 — the control skill teaches showing a session in the browser
 * and never puts a credential in a UI URL.
 * See change: add-session-ui-deep-links-for-agents.
 */
describe("control skill: view a session in the browser (E14)", () => {
  const skill = fs.readFileSync(path.join(PLUGIN_DIR, "skills", "pi-dashboard-control", "SKILL.md"), "utf8");

  it("has the section and the key strings", () => {
    expect(skill).toContain("View a session in the browser");
    for (const needle of ["uiUrl", "?embed=1", "/api/sessions/archived", "?archived=1"]) {
      expect(skill, needle).toContain(needle);
    }
  });

  it("cross-references the refusal rules and forbids tokens in URLs", () => {
    expect(skill).toContain("When a call is refused");
    expect(skill).toMatch(/never[^.\n]*(token|credential)[^.\n]*URL/i);
  });
});
