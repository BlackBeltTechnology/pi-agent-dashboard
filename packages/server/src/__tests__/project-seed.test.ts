/**
 * Auto-seed project defaults (change: auto-seed-project-defaults).
 *
 * Covers: gap-fill (only absent artifacts written), non-destructive behavior on
 * a half-configured project, idempotency via the per-root memo, the $HOME /
 * filesystem-root refusals, stack-detected vs. inert `worktreeInit`, and the
 * `autoSeedProjects: false` switch.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveProfiles } from "@blackbelt-technology/pi-dashboard-extension/project-init/profiles.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configureProjectSeed,
  resetSeededRoots,
  resolveAutoSeedEnabled,
  type SeedProjectDefaultsOptions,
  seedProjectDefaults,
  sweepKnownProjects,
} from "../project-seed.js";

// Pass-through spy on the git root probe, so tests can count probes.
const probe = vi.hoisted(() => ({ calls: 0, override: undefined as undefined | (() => unknown) }));
vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/git.js", async (orig) => {
  const mod = await orig<typeof import("@blackbelt-technology/pi-dashboard-shared/platform/git.js")>();
  return {
    ...mod,
    checkoutRoots: (...args: Parameters<typeof mod.checkoutRoots>) => {
      probe.calls++;
      if (probe.override) return probe.override() as ReturnType<typeof mod.checkoutRoots>;
      return mod.checkoutRoots(...args);
    },
  };
});

let tmp: string;

/**
 * Shipped-only profile set: a developer's `~/.pi/project-profiles/coding` must
 * not shadow the profile the exact-content assertions below expect.
 */
const SHIPPED = resolveProfiles({ userDir: path.join(os.tmpdir(), "project-seed-no-user-profiles") });
const seed = (dir: string, opts: SeedProjectDefaultsOptions = {}) =>
  seedProjectDefaults(dir, { profiles: SHIPPED, ...opts });

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "project-seed-"));
  resetSeededRoots();
  probe.override = undefined;
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  resetSeededRoots();
});

const read = (...rel: string[]) => fs.readFileSync(path.join(tmp, ...rel), "utf8");
const exists = (...rel: string[]) => fs.existsSync(path.join(tmp, ...rel));

describe("seedProjectDefaults", () => {
  it("seeds a bare directory with every project artifact", () => {
    const outcome = seed(tmp);

    expect(outcome.seeded).toBe(true);
    expect(exists("AGENTS.md")).toBe(true);
    expect(exists(".pi", "settings.json")).toBe(true);
    expect(exists(".pi", "dashboard", "knowledge_base.json")).toBe(true);
    expect(fs.readdirSync(path.join(tmp, ".pi", "prompts")).length).toBeGreaterThan(0);
  });

  it("fills the stack-detected worktreeInit hook", () => {
    fs.writeFileSync(path.join(tmp, "package.json"), "{}");
    fs.writeFileSync(path.join(tmp, "pnpm-lock.yaml"), "");

    seed(tmp);

    const settings = JSON.parse(read(".pi", "settings.json"));
    expect(settings.worktreeInit.run.command).toBe("pnpm install --frozen-lockfile");
    expect(settings.worktreeInit.gate).toBe("test ! -d node_modules");
    expect(read("AGENTS.md")).toContain("pnpm install --frozen-lockfile");
  });

  it("renders an INERT but valid hook when no stack is detected", () => {
    seed(tmp);

    const settings = JSON.parse(read(".pi", "settings.json"));
    // `false` never exits 0, so `evaluateGate` reports needsInit: false.
    expect(settings.worktreeInit.gate).toBe("false");
    expect(settings.worktreeInit.run.command).toBe("true");
    expect(read(".pi", "settings.json")).not.toContain("{{");
  });

  it("writes a kb config that enables the directory-level AGENTS.md toolset", () => {
    seed(tmp);

    const kb = JSON.parse(read(".pi", "dashboard", "knowledge_base.json"));
    expect(kb.indexAgentsFiles).toBe(true);
    expect(kb.directoryLevelAgents.enabled).toBe(true);
  });

  it("gap-fills a half-configured project without touching existing files", () => {
    const mine = "# my own instructions\n";
    fs.writeFileSync(path.join(tmp, "AGENTS.md"), mine);
    fs.mkdirSync(path.join(tmp, ".pi"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".pi", "settings.json"), '{"mine":true}\n');

    const outcome = seed(tmp);

    // Byte-identical — not even the append-only doctrine block.
    expect(read("AGENTS.md")).toBe(mine);
    expect(JSON.parse(read(".pi", "settings.json"))).toEqual({ mine: true });
    // The absent artifacts still arrive.
    expect(exists(".pi", "dashboard", "knowledge_base.json")).toBe(true);
    expect(outcome.written.some((p) => p.endsWith("knowledge_base.json"))).toBe(true);
    expect(outcome.skipped.some((p) => p.endsWith("AGENTS.md"))).toBe(true);
  });

  it("is idempotent — a second call writes nothing", () => {
    seed(tmp);
    const before = read(".pi", "settings.json");

    const second = seed(tmp);

    expect(second.seeded).toBe(false);
    expect(read(".pi", "settings.json")).toBe(before);
  });

  it("re-runs on a fully seeded project write nothing even without the memo", () => {
    seed(tmp);
    const agents = read("AGENTS.md");

    const again = seed(tmp, { force: true });

    expect(again.seeded).toBe(false);
    expect(read("AGENTS.md")).toBe(agents);
  });

  it("fills missing prompt files even when .pi/prompts exists and the other artifacts are present", () => {
    seed(tmp);
    const promptsDir = path.join(tmp, ".pi", "prompts");
    const prompts = fs.readdirSync(promptsDir);
    expect(prompts.length).toBeGreaterThan(0);
    for (const f of prompts) fs.rmSync(path.join(promptsDir, f));

    const again = seed(tmp, { force: true });

    expect(again.seeded).toBe(true);
    expect(fs.readdirSync(promptsDir).sort()).toEqual([...prompts].sort());
  });

  it("refuses $HOME", () => {
    const outcome = seed(tmp, { homeDir: tmp });

    expect(outcome.seeded).toBe(false);
    expect(outcome.reason).toMatch(/\$HOME/);
    expect(exists(".pi", "settings.json")).toBe(false);
  });

  it("refuses the filesystem root", () => {
    const root = path.parse(process.cwd()).root;

    const outcome = seed(root);

    expect(outcome.seeded).toBe(false);
    expect(outcome.reason).toMatch(/filesystem root/);
  });

  it("refuses a missing path and a file", () => {
    const file = path.join(tmp, "a-file.txt");
    fs.writeFileSync(file, "x");

    expect(seed(path.join(tmp, "nope")).reason).toBe("not found");
    expect(seed(file).reason).toBe("not a directory");
  });

  it("refuses a bare repository (no config root) instead of writing into the git dir", () => {
    const hub = path.join(tmp, "hub.git");
    execFileSync("git", ["init", "--bare", "-q", hub]);

    const outcome = seed(hub);

    expect(outcome.seeded).toBe(false);
    expect(outcome.reason).toBe("bare repository");
    expect(fs.existsSync(path.join(hub, ".pi"))).toBe(false);
    expect(fs.existsSync(path.join(hub, "AGENTS.md"))).toBe(false);
  });

  it("refuses a checkout root that does not exist (stale core.worktree) without creating it", () => {
    const ghost = path.join(tmp, "ghost-checkout");
    probe.override = () => ({ thisCheckout: null, isLinkedWorktree: true, mainCheckout: ghost, commonDir: tmp, gitDir: tmp });

    const outcome = seed(tmp);

    expect(outcome.seeded).toBe(false);
    expect(outcome.reason).toBe("checkout root not found");
    expect(fs.existsSync(ghost)).toBe(false);
  });

  it("does not seed or memoize inside a git checkout when the git probe fails", () => {
    fs.mkdirSync(path.join(tmp, ".git"));
    const sub = path.join(tmp, "src");
    fs.mkdirSync(sub);
    probe.override = () => null; // timeout / spawn failure, not "not a git dir"

    const outcome = seed(sub);

    expect(outcome.seeded).toBe(false);
    expect(outcome.reason).toBe("git probe failed");
    expect(fs.existsSync(path.join(sub, ".pi"))).toBe(false);

    probe.override = undefined; // git recovers: a repeat trigger must not be memoized as seeded
    expect(seed(sub).reason).not.toBe("already seeded");
  });

  it("does not re-probe git when the same directory is scheduled again", () => {
    seed(tmp);
    const after = probe.calls;

    const again = seed(tmp);

    expect(probe.calls).toBe(after);
    expect(again.reason).toBe("already seeded");
    expect(again.root).toBe(fs.realpathSync(tmp));
  });

  it("force bypasses the directory memo", () => {
    seed(tmp);
    const after = probe.calls;

    seed(tmp, { force: true });

    expect(probe.calls).toBe(after + 1);
  });

  it("refuses a symlink alias of $HOME (canonical comparison)", () => {
    const home = path.join(tmp, "home");
    fs.mkdirSync(home);
    const alias = path.join(tmp, "alias");
    fs.symlinkSync(home, alias, "dir");

    const outcome = seed(alias, { homeDir: home });

    expect(outcome.reason).toBe("refusing to seed $HOME");
    expect(fs.existsSync(path.join(home, "AGENTS.md"))).toBe(false);
  });

  it("refuses a profile whose settings template keeps an unfilled placeholder", () => {
    const profDir = path.join(tmp, "prof");
    fs.mkdirSync(profDir);
    fs.writeFileSync(path.join(profDir, "AGENTS.md.tmpl"), "# {{PROJECT_NAME}}\n");
    fs.writeFileSync(
      path.join(profDir, "settings.json.tmpl"),
      '{"worktreeInit":{"gate":"{{CUSTOM_GATE}}","run":{"command":"true"}}}\n',
    );
    const target = path.join(tmp, "proj");
    fs.mkdirSync(target);
    const profiles = [{ name: "coding", dir: profDir, dox: false, stackAware: false, source: "user" as const }];

    const outcome = seed(target, { profiles });

    expect(outcome.seeded).toBe(false);
    expect(outcome.reason).toBe("unresolved placeholders: CUSTOM_GATE");
    expect(fs.existsSync(path.join(target, ".pi", "settings.json"))).toBe(false);
    expect(fs.existsSync(path.join(target, "AGENTS.md"))).toBe(false);
  });

  it("ignores placeholders in a template whose target already exists", () => {
    const profDir = path.join(tmp, "prof");
    fs.mkdirSync(profDir);
    fs.writeFileSync(path.join(profDir, "AGENTS.md.tmpl"), "# {{CUSTOM_TITLE}}\n");
    fs.writeFileSync(path.join(profDir, "settings.json.tmpl"), "{}\n");
    const target = path.join(tmp, "proj");
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, "AGENTS.md"), "mine\n");
    const profiles = [{ name: "coding", dir: profDir, dox: false, stackAware: false, source: "user" as const }];

    const outcome = seed(target, { profiles });

    expect(outcome.seeded).toBe(true);
    expect(fs.existsSync(path.join(target, ".pi", "settings.json"))).toBe(true);
  });

  it("writes nothing when autoSeedProjects is disabled", () => {
    configureProjectSeed(false);

    const outcome = seed(tmp);

    expect(outcome.reason).toBe("disabled");
    expect(exists(".pi", "settings.json")).toBe(false);
  });
});

describe("sweepKnownProjects", () => {
  const tick = () => new Promise<void>((r) => setImmediate(r));

  it("seeds one folder per event-loop iteration, in order", async () => {
    const a = path.join(tmp, "a");
    const b = path.join(tmp, "b");
    fs.mkdirSync(a);
    fs.mkdirSync(b);

    sweepKnownProjects([a, b]);
    await tick();
    expect(fs.existsSync(path.join(a, ".pi", "settings.json"))).toBe(true);
    expect(fs.existsSync(path.join(b, ".pi", "settings.json"))).toBe(false);

    await tick();
    await tick();
    expect(fs.existsSync(path.join(b, ".pi", "settings.json"))).toBe(true);
  });
});

describe("resolveAutoSeedEnabled", () => {
  const cfgFile = () => path.join(tmp, "config.json");

  it("uses the loaded config value when present", () => {
    expect(resolveAutoSeedEnabled({ autoSeedProjects: false }, cfgFile())).toBe(false);
    expect(resolveAutoSeedEnabled({ autoSeedProjects: true }, cfgFile())).toBe(true);
  });

  it("preserves a file opt-out when an older loader dropped the field", () => {
    fs.writeFileSync(cfgFile(), JSON.stringify({ autoSeedProjects: false }));
    expect(resolveAutoSeedEnabled({}, cfgFile())).toBe(false);
  });

  it("defaults to true when the field is absent, non-boolean, or the file is unreadable", () => {
    expect(resolveAutoSeedEnabled({}, cfgFile())).toBe(true);
    fs.writeFileSync(cfgFile(), JSON.stringify({ autoSeedProjects: "false" }));
    expect(resolveAutoSeedEnabled({}, cfgFile())).toBe(true);
    fs.writeFileSync(cfgFile(), "not json");
    expect(resolveAutoSeedEnabled({}, cfgFile())).toBe(true);
  });
});
