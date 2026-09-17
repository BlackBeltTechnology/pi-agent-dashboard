/**
 * Auto-seed project defaults (change: auto-seed-project-defaults).
 *
 * Covers: gap-fill (only absent artifacts written), non-destructive behavior on
 * a half-configured project, idempotency via the per-root memo, the $HOME /
 * filesystem-root refusals, stack-detected vs. inert `worktreeInit`, and the
 * `autoSeedProjects: false` switch.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  configureProjectSeed,
  resetSeededRoots,
  seedProjectDefaults,
} from "../project-seed.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "project-seed-"));
  resetSeededRoots();
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  resetSeededRoots();
});

const read = (...rel: string[]) => fs.readFileSync(path.join(tmp, ...rel), "utf8");
const exists = (...rel: string[]) => fs.existsSync(path.join(tmp, ...rel));

describe("seedProjectDefaults", () => {
  it("seeds a bare directory with every project artifact", () => {
    const outcome = seedProjectDefaults(tmp);

    expect(outcome.seeded).toBe(true);
    expect(exists("AGENTS.md")).toBe(true);
    expect(exists(".pi", "settings.json")).toBe(true);
    expect(exists(".pi", "dashboard", "knowledge_base.json")).toBe(true);
    expect(fs.readdirSync(path.join(tmp, ".pi", "prompts")).length).toBeGreaterThan(0);
  });

  it("fills the stack-detected worktreeInit hook", () => {
    fs.writeFileSync(path.join(tmp, "package.json"), "{}");
    fs.writeFileSync(path.join(tmp, "pnpm-lock.yaml"), "");

    seedProjectDefaults(tmp);

    const settings = JSON.parse(read(".pi", "settings.json"));
    expect(settings.worktreeInit.run.command).toBe("pnpm install --frozen-lockfile");
    expect(settings.worktreeInit.gate).toBe("test ! -d node_modules");
    expect(read("AGENTS.md")).toContain("pnpm install --frozen-lockfile");
  });

  it("renders an INERT but valid hook when no stack is detected", () => {
    seedProjectDefaults(tmp);

    const settings = JSON.parse(read(".pi", "settings.json"));
    // `false` never exits 0, so `evaluateGate` reports needsInit: false.
    expect(settings.worktreeInit.gate).toBe("false");
    expect(settings.worktreeInit.run.command).toBe("true");
    expect(read(".pi", "settings.json")).not.toContain("{{");
  });

  it("writes a kb config that enables the directory-level AGENTS.md toolset", () => {
    seedProjectDefaults(tmp);

    const kb = JSON.parse(read(".pi", "dashboard", "knowledge_base.json"));
    expect(kb.indexAgentsFiles).toBe(true);
    expect(kb.directoryLevelAgents.enabled).toBe(true);
  });

  it("gap-fills a half-configured project without touching existing files", () => {
    const mine = "# my own instructions\n";
    fs.writeFileSync(path.join(tmp, "AGENTS.md"), mine);
    fs.mkdirSync(path.join(tmp, ".pi"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".pi", "settings.json"), '{"mine":true}\n');

    const outcome = seedProjectDefaults(tmp);

    // Byte-identical — not even the append-only doctrine block.
    expect(read("AGENTS.md")).toBe(mine);
    expect(JSON.parse(read(".pi", "settings.json"))).toEqual({ mine: true });
    // The absent artifacts still arrive.
    expect(exists(".pi", "dashboard", "knowledge_base.json")).toBe(true);
    expect(outcome.written.some((p) => p.endsWith("knowledge_base.json"))).toBe(true);
    expect(outcome.skipped.some((p) => p.endsWith("AGENTS.md"))).toBe(true);
  });

  it("is idempotent — a second call writes nothing", () => {
    seedProjectDefaults(tmp);
    const before = read(".pi", "settings.json");

    const second = seedProjectDefaults(tmp);

    expect(second.seeded).toBe(false);
    expect(read(".pi", "settings.json")).toBe(before);
  });

  it("re-runs on a fully seeded project write nothing even without the memo", () => {
    seedProjectDefaults(tmp);
    const agents = read("AGENTS.md");

    const again = seedProjectDefaults(tmp, { force: true });

    expect(again.seeded).toBe(false);
    expect(read("AGENTS.md")).toBe(agents);
  });

  it("refuses $HOME", () => {
    const outcome = seedProjectDefaults(tmp, { homeDir: tmp });

    expect(outcome.seeded).toBe(false);
    expect(outcome.reason).toMatch(/\$HOME/);
    expect(exists(".pi", "settings.json")).toBe(false);
  });

  it("refuses the filesystem root", () => {
    const root = path.parse(process.cwd()).root;

    const outcome = seedProjectDefaults(root);

    expect(outcome.seeded).toBe(false);
    expect(outcome.reason).toMatch(/filesystem root/);
  });

  it("refuses a missing path and a file", () => {
    const file = path.join(tmp, "a-file.txt");
    fs.writeFileSync(file, "x");

    expect(seedProjectDefaults(path.join(tmp, "nope")).reason).toBe("not found");
    expect(seedProjectDefaults(file).reason).toBe("not a directory");
  });

  it("writes nothing when autoSeedProjects is disabled", () => {
    configureProjectSeed(false);

    const outcome = seedProjectDefaults(tmp);

    expect(outcome.reason).toBe("disabled");
    expect(exists(".pi", "settings.json")).toBe(false);
  });
});
