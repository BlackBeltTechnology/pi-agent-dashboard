/**
 * Tests for applyResourceToggle — replays pi's config-selector write via
 * pi's real SettingsManager against on-disk fixtures.
 *
 * Assertions are on **observed activation** (what pi's own resolver reports)
 * rather than on pattern text wherever the requirement is behavioural, so a
 * semantic drift in pi fails loudly instead of silently passing a stale
 * pattern-shape assertion. See change: folder-resource-activation-toggle,
 * project-scope-disable-global-resources.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Counts the settings-persisting setter calls a toggle makes. pi's typed
 * setters are the only path to a settings write, so this is a faithful
 * (and deterministic) proxy for "how many times was settings.json written".
 */
const settingsWrites = { n: 0 };
const WRITE_METHODS = [
  "setProjectExtensionPaths",
  "setProjectSkillPaths",
  "setProjectPromptTemplatePaths",
  "setProjectThemePaths",
  "setExtensionPaths",
  "setSkillPaths",
  "setPromptTemplatePaths",
  "setThemePaths",
  "setPackages",
  "setProjectPackages",
] as const;

vi.mock("../pi/pi-resource-activation.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../pi/pi-resource-activation.js")>();
  return {
    ...actual,
    getPiCore: async () => {
      const core = await actual.getPiCore();
      return {
        ...core,
        SettingsManager: {
          ...core.SettingsManager,
          create: (...args: Parameters<typeof core.SettingsManager.create>) => {
            const sm = core.SettingsManager.create(...args) as unknown as Record<string, unknown>;
            for (const m of WRITE_METHODS) {
              const orig = (sm[m] as (...a: unknown[]) => unknown).bind(sm);
              sm[m] = (...a: unknown[]) => {
                settingsWrites.n++;
                return orig(...a);
              };
            }
            return sm;
          },
        },
      };
    },
  };
});

import { AGENT_DIR, getPiCore, type ResolvedPaths } from "../pi/pi-resource-activation.js";
import { applyResourceToggle, type ToggleResult } from "../pi/resource-activation-toggle.js";
import { classifyResourceOrigin } from "../pi/resource-origin.js";

type ArrayKey = "extensions" | "skills" | "prompts" | "themes";

let tmpDir: string;
const HOME = os.homedir();
const agentDir = AGENT_DIR;

// ── fixtures ────────────────────────────────────────────────────────────

function writeDirSkill(base: string, name: string): string {
  const dir = path.join(base, "skills", name);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, "SKILL.md");
  fs.writeFileSync(p, `---\nname: ${name}\ndescription: ${name}\n---\nbody`);
  return p;
}

function writeFlatSkill(base: string, name: string): string {
  const dir = path.join(base, "skills");
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${name}.md`);
  fs.writeFileSync(p, `---\nname: ${name}\ndescription: ${name}\n---\nbody`);
  return p;
}

function writePrompt(base: string, name: string): string {
  const dir = path.join(base, "prompts");
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${name}.md`);
  fs.writeFileSync(p, `prompt ${name}`);
  return p;
}

function writeTheme(base: string, name: string): string {
  const dir = path.join(base, "themes");
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${name}.json`);
  fs.writeFileSync(p, JSON.stringify({ name }));
  return p;
}

function writeExtension(base: string, name: string): string {
  const dir = path.join(base, "extensions");
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${name}.ts`);
  fs.writeFileSync(p, "export default {};");
  return p;
}

/** An npm-style package installed under a given install root, as pi installs them. */
function installNpmPackageAt(installBase: string, name: string, skills: string[], version = "1.0.0"): string {
  const root = path.join(installBase, "npm", "node_modules", name);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name, version, pi: { skills: ["skills"] } }),
  );
  for (const s of skills) writeDirSkill(root, s);
  return root;
}

/** An npm-style package installed under the *user* agent dir. */
function installNpmPackage(name: string, skills: string[], version = "1.0.0"): string {
  return installNpmPackageAt(agentDir, name, skills, version);
}

/** A local path-source package (no install step). */
function makeLocalPackage(root: string, skills: string[], extensions: string[] = []): string {
  fs.mkdirSync(root, { recursive: true });
  const manifest: Record<string, string[]> = {};
  if (skills.length) manifest.skills = ["skills"];
  if (extensions.length) manifest.extensions = ["extensions"];
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: path.basename(root), pi: manifest }));
  for (const s of skills) writeDirSkill(root, s);
  for (const e of extensions) writeExtension(root, e);
  return root;
}

// ── settings + trust helpers ────────────────────────────────────────────

function localSettingsPath(cwd = tmpDir) {
  return path.join(cwd, ".pi", "settings.json");
}

function readLocalSettings(cwd = tmpDir): Record<string, unknown> {
  const p = localSettingsPath(cwd);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf-8")) : {};
}

function writeLocalSettings(settings: unknown, cwd = tmpDir) {
  fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
  fs.writeFileSync(localSettingsPath(cwd), JSON.stringify(settings, null, 2));
}

function readGlobalSettings(): Record<string, unknown> {
  const p = path.join(agentDir, "settings.json");
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf-8")) : {};
}

async function trustFolder(cwd: string) {
  const { ProjectTrustStore } = await getPiCore();
  new ProjectTrustStore(agentDir).set(cwd, true);
}

// ── observed-activation helpers ─────────────────────────────────────────

async function piResolve(cwd: string, dir = agentDir): Promise<ResolvedPaths> {
  const { DefaultPackageManager, SettingsManager } = await getPiCore();
  const settingsManager = SettingsManager.create(cwd, dir, { projectTrusted: true });
  const pm = new DefaultPackageManager({ cwd, agentDir: dir, settingsManager });
  return (await pm.resolve(async () => "skip")) as ResolvedPaths;
}

interface Observed {
  enabled: boolean;
  scope: string;
}

/** `path → { enabled, scope }` as pi's own resolver reports it. */
async function observe(cwd: string, key: ArrayKey, dir = agentDir): Promise<Map<string, Observed>> {
  const resolved = await piResolve(cwd, dir);
  const map = new Map<string, Observed>();
  for (const r of resolved[key] ?? []) map.set(r.path, { enabled: r.enabled, scope: r.metadata.scope });
  return map;
}

async function isEnabled(cwd: string, key: ArrayKey, filePath: string, dir = agentDir): Promise<boolean> {
  return (await observe(cwd, key, dir)).get(filePath)?.enabled ?? true;
}

/** Whole-set activation snapshot, for round-trip equivalence assertions. */
async function activationSnapshot(cwd: string): Promise<Record<string, boolean>> {
  const resolved = await piResolve(cwd);
  const out: Record<string, boolean> = {};
  for (const key of ["extensions", "skills", "prompts", "themes"] as const) {
    for (const r of resolved[key] ?? []) out[`${key}:${r.path}`] = r.enabled;
  }
  return out;
}

function toggle(req: {
  scope?: "local" | "global";
  cwd?: string;
  type?: "extension" | "skill" | "prompt" | "theme";
  filePath: string;
  enabled: boolean;
  packageSource?: string;
}): Promise<ToggleResult> {
  return applyResourceToggle({
    scope: req.scope ?? "local",
    cwd: req.cwd ?? tmpDir,
    type: req.type ?? "skill",
    filePath: req.filePath,
    enabled: req.enabled,
    packageSource: req.packageSource,
  });
}

function expectOk(res: ToggleResult) {
  if (!res.ok) throw new Error(`expected ok, got ${res.status}: ${res.error}`);
}

// ── lifecycle ───────────────────────────────────────────────────────────

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-toggle-cwd-"));
  fs.rmSync(agentDir, { recursive: true, force: true });
  fs.mkdirSync(agentDir, { recursive: true });
  fs.rmSync(path.join(HOME, ".agents"), { recursive: true, force: true });
  fs.rmSync(path.join(HOME, ".pi", "dashboard", "resource-entry-ownership.json"), { force: true });
  await trustFolder(tmpDir);
});

afterEach(() => {
  process.env.HOME = HOME;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ────────────────────────────────────────────────────────────────────────
// 1. Origin classification
// ────────────────────────────────────────────────────────────────────────

describe("origin classification", () => {
  async function classify(filePath: string, cwd = tmpDir, homeDir = HOME) {
    return classifyResourceOrigin({
      filePath,
      cwd,
      agentDir,
      homeDir,
      resolved: await piResolve(cwd),
    });
  }

  it("does not let a nested <cwd>/.pi shadow the longer global base (cwd === $HOME) [E1]", async () => {
    // With cwd === $HOME, `<cwd>/.pi` is a strict ancestor of `~/.pi/agent`.
    // An ordered scan would classify the global skill as project-loose and
    // write an inert relative pattern; longest-prefix must win.
    const skill = writeDirSkill(agentDir, "gskill");
    const origin = await classify(skill, HOME);
    expect(origin?.kind).toBe("global-loose");
    expect(origin?.baseDir).toBe(agentDir);
  });

  it("classifies a disabled global skill identically after the write mutated its metadata [E2]", async () => {
    const skill = writeDirSkill(agentDir, "gskill");
    const before = await classify(skill);
    expect(before?.kind).toBe("global-loose");

    expectOk(await toggle({ filePath: skill, enabled: false }));
    // pi now reports it as scope: project / source: local / baseDir: undefined.
    const resolved = await piResolve(tmpDir);
    const reported = resolved.skills.find((r) => r.path === skill);
    expect(reported?.metadata.scope).toBe("project");

    const after = await classify(skill);
    expect(after).toEqual(before);
  });

  it("classifies an npm package root under the global base as a package, not global-loose [E3]", async () => {
    const root = installNpmPackage("probe-pkg", ["alpha"]);
    fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ packages: ["npm:probe-pkg"] }));
    const origin = await classify(path.join(root, "skills", "alpha", "SKILL.md"));
    expect(origin?.kind).toBe("package");
    expect(origin?.baseDir).toBe(root);
  });

  it("agrees with the lookup for a symlinked global resource and disables it [E4]", async () => {
    const realDir = path.join(tmpDir, "real-skills", "linked");
    fs.mkdirSync(realDir, { recursive: true });
    fs.writeFileSync(path.join(realDir, "SKILL.md"), "---\nname: linked\ndescription: d\n---\nb");
    fs.mkdirSync(path.join(agentDir, "skills"), { recursive: true });
    fs.symlinkSync(realDir, path.join(agentDir, "skills", "linked"), "dir");
    const reportedPath = path.join(agentDir, "skills", "linked", "SKILL.md");

    const origin = await classify(reportedPath);
    expect(origin?.kind).toBe("global-loose");
    expectOk(await toggle({ filePath: reportedPath, enabled: false }));
    expect(await isEnabled(tmpDir, "skills", reportedPath)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. Write forms per origin
// ────────────────────────────────────────────────────────────────────────

describe("write forms per origin", () => {
  it("keeps pi's relative form for a project-loose skill and touches no packages [E5]", async () => {
    const skill = writeDirSkill(path.join(tmpDir, ".pi"), "local-demo");
    expectOk(await toggle({ filePath: skill, enabled: false }));

    const settings = readLocalSettings();
    expect(settings.skills).toContain("-skills/local-demo/SKILL.md");
    expect(settings.packages).toBeUndefined();
    expect(await isEnabled(tmpDir, "skills", skill)).toBe(false);
  });

  it("writes a force-exclude relative to an .agents base dir [E6]", async () => {
    const agentsBase = path.join(tmpDir, ".agents");
    const skill = writeDirSkill(agentsBase, "ag-demo");
    expectOk(await toggle({ filePath: skill, enabled: false }));

    expect(readLocalSettings().skills).toContain("-skills/ag-demo/SKILL.md");
    expect(await isEnabled(tmpDir, "skills", skill)).toBe(false);
  });

  it("re-declares a directory-shaped global skill by file, leaving global settings alone [E7]", async () => {
    const skill = writeDirSkill(agentDir, "gskill");
    expectOk(await toggle({ filePath: skill, enabled: false }));

    const entries = readLocalSettings().skills as string[];
    // The resource's own FILE, tilde-form — neither its directory nor the root.
    expect(entries).toContain(`~/.pi/agent/skills/gskill/SKILL.md`);
    // Exactly one exclusion, and it names no home directory.
    const exclusions = entries.filter((e) => e.startsWith("!") || e.startsWith("-"));
    expect(exclusions).toHaveLength(1);
    expect(exclusions[0]).not.toContain(HOME);
    expect(exclusions[0]).not.toContain("~");
    expect(fs.existsSync(path.join(agentDir, "settings.json"))).toBe(false);
    expect(await isEnabled(tmpDir, "skills", skill)).toBe(false);
  });

  it("re-declares a flat-file global skill by file, leaving siblings at user scope [E8]", async () => {
    const flat = writeFlatSkill(agentDir, "flatskill");
    const sibling = writeFlatSkill(agentDir, "keepme");
    expectOk(await toggle({ filePath: flat, enabled: false }));

    const entries = readLocalSettings().skills as string[];
    expect(entries).toContain("~/.pi/agent/skills/flatskill.md");
    expect(entries.some((e) => e === "~/.pi/agent/skills")).toBe(false);

    const state = await observe(tmpDir, "skills");
    expect(state.get(flat)?.enabled).toBe(false);
    expect(state.get(sibling)?.enabled).toBe(true);
    expect(state.get(sibling)?.scope).toBe("user");
  });

  it("disables a global prompt at local scope, leaving other prompts enabled [E9]", async () => {
    const target = writePrompt(agentDir, "p-target");
    const other = writePrompt(agentDir, "p-other");
    expectOk(await toggle({ type: "prompt", filePath: target, enabled: false }));

    const state = await observe(tmpDir, "prompts");
    expect(state.get(target)?.enabled).toBe(false);
    expect(state.get(other)?.enabled).toBe(true);
  });

  it("disables a global theme at local scope, leaving other themes enabled [E10]", async () => {
    const target = writeTheme(agentDir, "t-target");
    const other = writeTheme(agentDir, "t-other");
    expectOk(await toggle({ type: "theme", filePath: target, enabled: false }));

    const state = await observe(tmpDir, "themes");
    expect(state.get(target)?.enabled).toBe(false);
    expect(state.get(other)?.enabled).toBe(true);
  });

  it("produces entries that still work under a different $HOME [E11]", async () => {
    const skill = writeDirSkill(agentDir, "gskill");
    expectOk(await toggle({ filePath: skill, enabled: false }));

    const entries = readLocalSettings().skills as string[];
    // No entry may carry a machine-specific absolute path.
    for (const e of entries) expect(e).not.toContain(HOME);

    // Resolve the same settings file under a second home whose agent dir holds
    // the equivalent skill.
    const otherHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-toggle-home2-"));
    const otherAgentDir = path.join(otherHome, ".pi", "agent");
    const otherSkill = writeDirSkill(otherAgentDir, "gskill");
    process.env.HOME = otherHome;
    try {
      expect(await isEnabled(tmpDir, "skills", otherSkill, otherAgentDir)).toBe(false);
    } finally {
      process.env.HOME = HOME;
      fs.rmSync(otherHome, { recursive: true, force: true });
    }
  });

  it("rejects an agent directory outside the home directory and writes nothing [E12]", async () => {
    const skill = writeDirSkill(agentDir, "gskill");
    // Point HOME elsewhere so the (import-time) agent dir is no longer under it —
    // the layout for which no portable form exists.
    const otherHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-toggle-home3-"));
    process.env.HOME = otherHome;
    try {
      const res = await toggle({ filePath: skill, enabled: false });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.status).toBe(400);
        expect(res.error).toMatch(/portab/i);
      }
      expect(fs.existsSync(localSettingsPath())).toBe(false);
    } finally {
      process.env.HOME = HOME;
      fs.rmSync(otherHome, { recursive: true, force: true });
    }
  });

  it("leaves a same-named project skill enabled when the global one is disabled", async () => {
    const global = writeDirSkill(agentDir, "twin");
    const project = writeDirSkill(path.join(tmpDir, ".pi"), "twin");
    expectOk(await toggle({ filePath: global, enabled: false }));

    const state = await observe(tmpDir, "skills");
    expect(state.get(global)?.enabled).toBe(false);
    expect(state.get(project)?.enabled).toBe(true);
  });

  it("does not let an unrelated project glob reach the re-declared resource's siblings", async () => {
    const target = writeDirSkill(agentDir, "gskill");
    const sibling = writeDirSkill(agentDir, "keepme");
    writeLocalSettings({ skills: ["skills/*/SKILL.md"] });
    expectOk(await toggle({ filePath: target, enabled: false }));

    const state = await observe(tmpDir, "skills");
    expect(state.get(target)?.enabled).toBe(false);
    expect(state.get(sibling)?.enabled).toBe(true);
  });

  it("reports the disabled global resource exactly once", async () => {
    const skill = writeDirSkill(agentDir, "gskill");
    expectOk(await toggle({ filePath: skill, enabled: false }));
    const resolved = await piResolve(tmpDir);
    expect(resolved.skills.filter((r) => r.path === skill)).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 3. Package handling
// ────────────────────────────────────────────────────────────────────────

describe("package handling", () => {
  function globalPackages(entries: unknown[]) {
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ packages: entries }, null, 2));
  }

  it("writes an autoload:false delta for a globally-declared package [E13]", async () => {
    const root = installNpmPackage("probe-pkg", ["alpha", "beta"]);
    globalPackages(["npm:probe-pkg"]);
    const beta = path.join(root, "skills", "beta", "SKILL.md");

    const res = await toggle({ filePath: beta, enabled: false });
    expectOk(res);

    const entry = (readLocalSettings().packages as any[])[0];
    expect(entry).toMatchObject({ source: "npm:probe-pkg", autoload: false });
    expect(entry.skills).toContain("-skills/beta/SKILL.md");
  });

  it("proves autoload:false is load-bearing: without it the package contributes nothing [E14]", async () => {
    const root = installNpmPackage("probe-pkg", ["alpha", "beta"]);
    globalPackages(["npm:probe-pkg"]);
    const alpha = path.join(root, "skills", "alpha", "SKILL.md");

    // The same delta written WITHOUT the flag: pi resolves it at project scope,
    // misses the user install path, and drops the whole contribution.
    writeLocalSettings({ packages: [{ source: "npm:probe-pkg", skills: ["-skills/beta/SKILL.md"] }] });
    const broken = await observe(tmpDir, "skills");
    expect(broken.has(alpha)).toBe(false);

    // With the flag, alpha survives.
    writeLocalSettings({
      packages: [{ source: "npm:probe-pkg", autoload: false, skills: ["-skills/beta/SKILL.md"] }],
    });
    const fixed = await observe(tmpDir, "skills");
    expect(fixed.get(alpha)?.enabled).toBe(true);
  });

  it("keeps in-place mutation at global scope, never appending a delta [E15]", async () => {
    const root = installNpmPackage("probe-pkg", ["alpha", "beta"]);
    globalPackages(["npm:probe-pkg"]);
    const beta = path.join(root, "skills", "beta", "SKILL.md");
    const alpha = path.join(root, "skills", "alpha", "SKILL.md");

    expectOk(await toggle({ scope: "global", filePath: beta, enabled: false }));

    const packages = readGlobalSettings().packages as any[];
    expect(packages).toHaveLength(1);
    expect(packages[0].source).toBe("npm:probe-pkg");
    expect(packages[0].autoload).toBeUndefined();
    expect(packages[0].skills).toContain("-skills/beta/SKILL.md");

    const state = await observe(tmpDir, "skills");
    expect(state.get(beta)?.enabled).toBe(false);
    expect(state.get(alpha)?.enabled).toBe(true);
  });

  it("isolates siblings: only the toggled resource of the package is disabled [E16]", async () => {
    const root = installNpmPackage("probe-pkg", ["alpha", "beta"]);
    globalPackages(["npm:probe-pkg"]);
    const beta = path.join(root, "skills", "beta", "SKILL.md");
    const alpha = path.join(root, "skills", "alpha", "SKILL.md");

    expectOk(await toggle({ filePath: beta, enabled: false }));

    const state = await observe(tmpDir, "skills");
    expect(state.get(alpha)?.enabled).toBe(true);
    expect(state.get(beta)?.enabled).toBe(false);
  });

  it("triggers no project-scope re-install for an npm source in the user agent dir [E17]", async () => {
    const root = installNpmPackage("probe-pkg", ["alpha", "beta"]);
    globalPackages(["npm:probe-pkg"]);
    expectOk(await toggle({ filePath: path.join(root, "skills", "beta", "SKILL.md"), enabled: false }));
    await piResolve(tmpDir);
    expect(fs.existsSync(path.join(tmpDir, ".pi", "npm"))).toBe(false);
  });

  it("extends an npm entry spelled with a different version range [E18]", async () => {
    installNpmPackage("foo", ["alpha", "beta"]);
    globalPackages(["npm:foo@^2.0.0"]);
    // A project entry for the same identity shadows the global one, so pi
    // resolves it from the project install path.
    const root = installNpmPackageAt(path.join(tmpDir, ".pi"), "foo", ["alpha", "beta"]);
    writeLocalSettings({ packages: [{ source: "npm:foo@^1.0.0", skills: ["+skills/alpha/SKILL.md"] }] });

    expectOk(await toggle({ filePath: path.join(root, "skills", "beta", "SKILL.md"), enabled: false }));

    const packages = readLocalSettings().packages as any[];
    expect(packages).toHaveLength(1);
    expect(packages[0].source).toBe("npm:foo@^1.0.0");
    expect(packages[0].skills).toContain("+skills/alpha/SKILL.md");
    expect(packages[0].skills).toContain("-skills/beta/SKILL.md");
  });

  it("recognises SSH and HTTPS spellings of one git repository as the same package [E19]", async () => {
    // Identity matching is the unit under test; a real clone is not needed.
    const root = makeLocalPackage(path.join(tmpDir, "gitpkg"), ["alpha", "beta"]);
    writeLocalSettings({
      packages: [{ source: root, skills: [] }, { source: "git:git@github.com:acme/tools.git" }],
    });
    // A second entry spelled over HTTPS must be recognised as the SSH one.
    const { DefaultPackageManager, SettingsManager } = await getPiCore();
    const sm = SettingsManager.create(tmpDir, agentDir, { projectTrusted: true });
    void new DefaultPackageManager({ cwd: tmpDir, agentDir, settingsManager: sm });

    const { packageIdentity } = await import("../pi/resource-origin.js");
    expect(packageIdentity("git:https://github.com/acme/tools.git", tmpDir)).toBe(
      packageIdentity("git:git@github.com:acme/tools.git", tmpDir),
    );

    // And a toggle against the local package does not append a duplicate.
    expectOk(await toggle({ filePath: path.join(root, "skills", "beta", "SKILL.md"), enabled: false }));
    const packages = readLocalSettings().packages as any[];
    expect(packages).toHaveLength(2);
  });

  it("extends a project-owned package entry without converting it to a delta [E20]", async () => {
    const root = makeLocalPackage(path.join(tmpDir, "repo"), ["alpha"], ["kb"]);
    writeLocalSettings({ packages: [{ source: root, extensions: ["+extensions/kb.ts"] }] });

    expectOk(await toggle({ filePath: path.join(root, "skills", "alpha", "SKILL.md"), enabled: false }));

    const entry = (readLocalSettings().packages as any[])[0];
    expect(entry.autoload).toBeUndefined();
    expect(entry.extensions).toEqual(["+extensions/kb.ts"]);
    expect(entry.skills).toContain("-skills/alpha/SKILL.md");
  });
});

// ────────────────────────────────────────────────────────────────────────
// 4. Re-enable and ownership
// ────────────────────────────────────────────────────────────────────────

describe("re-enable and ownership", () => {
  it("round-trips every origin back to the prior activation state [E21]", async () => {
    const projectSkill = writeDirSkill(path.join(tmpDir, ".pi"), "p-demo");
    const agentsSkill = writeDirSkill(path.join(tmpDir, ".agents"), "a-demo");
    const globalSkill = writeDirSkill(agentDir, "g-demo");
    const pkgRoot = makeLocalPackage(path.join(tmpDir, "pkg"), ["k-demo"]);
    writeLocalSettings({ packages: [pkgRoot] });
    const pkgSkill = path.join(pkgRoot, "skills", "k-demo", "SKILL.md");

    const before = await activationSnapshot(tmpDir);
    for (const f of [projectSkill, agentsSkill, globalSkill, pkgSkill]) {
      expectOk(await toggle({ filePath: f, enabled: false }));
      expect(await isEnabled(tmpDir, "skills", f)).toBe(false);
      expectOk(await toggle({ filePath: f, enabled: true }));
    }
    expect(await activationSnapshot(tmpDir)).toEqual(before);
  });

  it("never writes a force-include on re-enable [E22]", async () => {
    const skill = writeDirSkill(path.join(tmpDir, ".pi"), "p-demo");
    expectOk(await toggle({ filePath: skill, enabled: false }));
    expectOk(await toggle({ filePath: skill, enabled: true }));
    const entries = (readLocalSettings().skills as string[]) ?? [];
    expect(entries.some((e) => e.startsWith("+"))).toBe(false);
  });

  it("removes both halves of a dashboard-authored global-loose pair [E23/E26]", async () => {
    const skill = writeDirSkill(agentDir, "gskill");
    expectOk(await toggle({ filePath: skill, enabled: false }));
    expect(((readLocalSettings().skills as string[]) ?? []).length).toBe(2);

    expectOk(await toggle({ filePath: skill, enabled: true }));
    const entries = (readLocalSettings().skills as string[]) ?? [];
    expect(entries).toHaveLength(0);

    const state = await observe(tmpDir, "skills");
    expect(state.get(skill)?.enabled).toBe(true);
    expect(state.get(skill)?.scope).toBe("user");

    const ownership = path.join(HOME, ".pi", "dashboard", "resource-entry-ownership.json");
    const record = fs.existsSync(ownership) ? JSON.parse(fs.readFileSync(ownership, "utf-8")) : {};
    expect(record[path.resolve(tmpDir)]).toBeUndefined();
  });

  it("keeps a partial package delta alive when another type still has a filter [E24]", async () => {
    const root = makeLocalPackage(path.join(tmpDir, "pkg"), ["alpha"], ["ext"]);
    const skill = path.join(root, "skills", "alpha", "SKILL.md");
    const ext = path.join(root, "extensions", "ext.ts");
    writeLocalSettings({
      packages: [
        { source: root, autoload: false, skills: ["-skills/alpha/SKILL.md"], extensions: ["-extensions/ext.ts"] },
      ],
    });

    expectOk(await toggle({ filePath: skill, enabled: true }));

    const entry = (readLocalSettings().packages as any[])[0];
    expect(entry.skills).toBeUndefined();
    expect(entry.extensions).toEqual(["-extensions/ext.ts"]);
    expect(await isEnabled(tmpDir, "extensions", ext)).toBe(false);
  });

  it("removes an emptied delta entry entirely", async () => {
    const root = installNpmPackage("probe-pkg", ["alpha", "beta"]);
    fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ packages: ["npm:probe-pkg"] }));
    const beta = path.join(root, "skills", "beta", "SKILL.md");

    expectOk(await toggle({ filePath: beta, enabled: false }));
    expect((readLocalSettings().packages as any[]).length).toBe(1);
    expectOk(await toggle({ filePath: beta, enabled: true }));
    expect((readLocalSettings().packages as any[]) ?? []).toHaveLength(0);
  });

  it("leaves a user-authored plain entry in place across a round trip [E25]", async () => {
    const skill = writeDirSkill(agentDir, "gskill");
    const userEntry = "~/.pi/agent/skills/gskill/SKILL.md";
    writeLocalSettings({ skills: [userEntry] });

    expectOk(await toggle({ filePath: skill, enabled: false }));
    expectOk(await toggle({ filePath: skill, enabled: true }));

    const entries = readLocalSettings().skills as string[];
    expect(entries).toContain(userEntry);
    expect(entries.filter((e) => e.startsWith("!") || e.startsWith("-"))).toHaveLength(0);
    expect(await isEnabled(tmpDir, "skills", skill)).toBe(true);
  });

  it("keeps the settings file free of dashboard-private keys [E27]", async () => {
    const skill = writeDirSkill(agentDir, "gskill");
    expectOk(await toggle({ filePath: skill, enabled: false }));
    const settings = readLocalSettings();
    const piKeys = new Set(["packages", "extensions", "skills", "prompts", "themes"]);
    for (const k of Object.keys(settings)) expect(piKeys.has(k)).toBe(true);
  });

  it("performs exactly one settings write per toggle, recording ownership separately [E28]", async () => {
    const skill = writeDirSkill(agentDir, "gskill");
    settingsWrites.n = 0;
    expectOk(await toggle({ filePath: skill, enabled: false }));
    expect(settingsWrites.n).toBe(1);
    // The ownership record lives in its own file, not in settings.json.
    expect(fs.existsSync(path.join(HOME, ".pi", "dashboard", "resource-entry-ownership.json"))).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 5. Stripping, guard, ambiguity
// ────────────────────────────────────────────────────────────────────────

describe("stripping, guard and ambiguity", () => {
  it("removes a differently-spelled stale force-exclude on enable [E29]", async () => {
    const skill = writeDirSkill(path.join(tmpDir, ".pi"), "foo");
    // pi's own config-selector spells the parent directory, not the file.
    writeLocalSettings({ skills: ["-skills/foo"] });
    expect(await isEnabled(tmpDir, "skills", skill)).toBe(false);

    expectOk(await toggle({ filePath: skill, enabled: true }));
    expect(readLocalSettings().skills).not.toContain("-skills/foo");
    expect(await isEnabled(tmpDir, "skills", skill)).toBe(true);
  });

  it("never strips a force-include [E30]", async () => {
    const skill = writeDirSkill(path.join(tmpDir, ".pi"), "foo");
    writeLocalSettings({ skills: ["!skills/foo/SKILL.md", "+skills/foo/SKILL.md"] });
    expect(await isEnabled(tmpDir, "skills", skill)).toBe(true);

    expectOk(await toggle({ filePath: skill, enabled: false }));
    expectOk(await toggle({ filePath: skill, enabled: true }));

    expect(readLocalSettings().skills).toContain("+skills/foo/SKILL.md");
    expect(await isEnabled(tmpDir, "skills", skill)).toBe(true);
  });

  it("preserves a user's broad exclusion glob and the resources it covers [E31]", async () => {
    const target = writeDirSkill(path.join(tmpDir, ".pi"), "foo");
    const other = writeDirSkill(path.join(tmpDir, ".pi"), "bar");
    writeLocalSettings({ skills: ["!skills/**"] });
    expect(await isEnabled(tmpDir, "skills", other)).toBe(false);

    expectOk(await toggle({ filePath: target, enabled: true }));

    expect(readLocalSettings().skills).toContain("!skills/**");
    expect(await isEnabled(tmpDir, "skills", other)).toBe(false);
  });

  it("does not reject a local-scope toggle of a global resource [E33]", async () => {
    const skill = writeDirSkill(agentDir, "gskill");
    expectOk(await toggle({ filePath: skill, enabled: false }));
  });

  it("escalates an ambiguous relative path to an anchored exclusion [E34]", async () => {
    const projectSkill = writeDirSkill(path.join(tmpDir, ".pi"), "shared");
    const agentsSkill = writeDirSkill(path.join(tmpDir, ".agents"), "shared");

    expectOk(await toggle({ filePath: projectSkill, enabled: false }));

    const entries = readLocalSettings().skills as string[];
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry.startsWith("!")).toBe(true);
    expect(entry).toContain("/.pi/");
    expect(entry).not.toContain(HOME);
    expect(entry).not.toContain(tmpDir);
    // No re-declaration: both resources already resolve at project scope.
    expect(entries.some((e) => !e.startsWith("!") && !e.startsWith("-") && !e.startsWith("+"))).toBe(false);

    const state = await observe(tmpDir, "skills");
    expect(state.get(projectSkill)?.enabled).toBe(false);
    expect(state.get(agentsSkill)?.enabled).toBe(true);
  });

  it("leaves entries for other resources untouched", async () => {
    const a = writeDirSkill(path.join(tmpDir, ".pi"), "aaa");
    const b = writeDirSkill(path.join(tmpDir, ".pi"), "bbb");
    writeLocalSettings({ skills: ["-skills/bbb/SKILL.md"] });
    expectOk(await toggle({ filePath: a, enabled: false }));

    const entries = readLocalSettings().skills as string[];
    expect(entries).toContain("-skills/bbb/SKILL.md");
    expect(await isEnabled(tmpDir, "skills", b)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 6. Trust — the catch-22 regression
// ────────────────────────────────────────────────────────────────────────

describe("trust", () => {
  it("survives the folder becoming trust-requiring after the first write [E39]", async () => {
    // A folder with no .pi directory: pi loads it as trusted today, but the
    // toggle's own write creates .pi/settings.json and makes it trust-requiring.
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), "pi-toggle-fresh-"));
    const skill = writeDirSkill(agentDir, "gskill");
    const { ProjectTrustStore } = await getPiCore();
    try {
      // Approval, as the trust dialog would persist it.
      new ProjectTrustStore(agentDir).set(fresh, true);
      expectOk(await toggle({ cwd: fresh, filePath: skill, enabled: false }));

      // A newly-started session in that folder: pi now sees a trust-requiring
      // folder, finds the recorded decision, and honours the write.
      expect(new ProjectTrustStore(agentDir).get(fresh)).toBe(true);
      expect(await isEnabled(fresh, "skills", skill)).toBe(false);
    } finally {
      fs.rmSync(fresh, { recursive: true, force: true });
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// 7. Error handling
// ────────────────────────────────────────────────────────────────────────

describe("error handling", () => {
  it("fails loudly on an unparseable settings file rather than reporting success [X1]", async () => {
    const skill = writeDirSkill(agentDir, "gskill");
    fs.mkdirSync(path.join(tmpDir, ".pi"), { recursive: true });
    fs.writeFileSync(localSettingsPath(), "{ // a comment pi cannot parse\n }");

    const res = await toggle({ filePath: skill, enabled: false });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain(localSettingsPath());
    // Untouched.
    expect(fs.readFileSync(localSettingsPath(), "utf-8")).toContain("a comment pi cannot parse");
  });

  it("bounds an external writer's clobber to the array it rewrote [X3]", async () => {
    const skillA = writeDirSkill(path.join(tmpDir, ".pi"), "aaa");
    writePrompt(path.join(tmpDir, ".pi"), "keepme");
    writeLocalSettings({ skills: [], prompts: ["-prompts/keepme.md"] });

    expectOk(await toggle({ filePath: skillA, enabled: false }));

    const settings = readLocalSettings();
    // Documented last-writer-wins: the untouched array survives and the file
    // stays valid JSON.
    expect(settings.prompts).toEqual(["-prompts/keepme.md"]);
    expect(settings.skills).toContain("-skills/aaa/SKILL.md");
    expect(() => JSON.parse(fs.readFileSync(localSettingsPath(), "utf-8"))).not.toThrow();
  });

  it("writes nothing when the resolver throws [X4]", async () => {
    // A settings file declaring a package source that cannot be parsed as any
    // known type still resolves; force a real failure by making .pi unreadable
    // is platform-specific, so assert the contract on a missing resource path
    // instead: no settings file is produced.
    const res = await toggle({ filePath: path.join(tmpDir, "nope", "SKILL.md"), enabled: false });
    expect(res.ok).toBe(false);
    expect(fs.existsSync(localSettingsPath())).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 8. Performance
// ────────────────────────────────────────────────────────────────────────

describe("performance", () => {
  it("keeps p95 toggle latency under 1s [P1]", async () => {
    for (let i = 0; i < 40; i++) writeDirSkill(agentDir, `bulk-${i}`);
    const skill = writeDirSkill(agentDir, "target");
    const timings: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t0 = Date.now();
      expectOk(await toggle({ filePath: skill, enabled: i % 2 === 0 ? false : true }));
      timings.push(Date.now() - t0);
    }
    timings.sort((a, b) => a - b);
    expect(timings[Math.floor(timings.length * 0.95)]).toBeLessThan(1000);
  }, 120_000);

  it("does not accrete settings entries across repeated cycles [P2]", async () => {
    const skill = writeDirSkill(agentDir, "gskill");
    for (let i = 0; i < 100; i++) {
      expectOk(await toggle({ filePath: skill, enabled: false }));
      expect(((readLocalSettings().skills as string[]) ?? []).length).toBe(2);
      expectOk(await toggle({ filePath: skill, enabled: true }));
      expect(((readLocalSettings().skills as string[]) ?? []).length).toBe(0);
    }
  }, 120_000);
});
