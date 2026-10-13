// `git` config group (change: add-kb-git-forge-scope, test-plan #E22, #E40, #E41).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULTS, loadConfig, validateConfig } from "../config.js";

let home: string;
let project: string;
let prevHome: string | undefined;

function writeGlobal(cfg: unknown): void {
  mkdirSync(join(home, ".pi", "dashboard"), { recursive: true });
  writeFileSync(join(home, ".pi", "dashboard", "knowledge_base.json"), JSON.stringify(cfg));
}
function writeProject(cfg: unknown): void {
  mkdirSync(join(project, ".pi", "dashboard"), { recursive: true });
  writeFileSync(join(project, ".pi", "dashboard", "knowledge_base.json"), JSON.stringify(cfg));
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "kb-gitcfg-home-"));
  project = mkdtempSync(join(tmpdir(), "kb-gitcfg-proj-"));
  prevHome = process.env.HOME;
  process.env.HOME = home;
});
afterEach(() => {
  vi.restoreAllMocks();
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(project, { recursive: true, force: true });
});

describe("git config group", () => {
  it("defaults match design G8", () => {
    const g = loadConfig(project).git;
    expect(g.enabled).toBe(true);
    expect(g.remote).toBe("origin");
    expect(g.searchWaitMs).toBe(2000);
    expect(g.commits).toEqual({ maxInitial: 50000, maxPathsPerCommit: 200 });
    expect(g.forge).toMatchObject({ enabled: true, minSyncIntervalSeconds: 600, hintedMinSyncIntervalSeconds: 60, rateFloorPercent: 20, firstSyncWindowDays: 365, firstSyncMaxItems: 5000, pagesPerSync: 5, leaseSeconds: 60, hosts: {}, gitea: { tokenEnv: "GITEA_TOKEN" } });
  });

  it("E22: project hosts + gitea.tokenEnv are ignored with one warning naming them", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    writeProject({ git: { forge: { hosts: { "evil.example": "gitea" }, gitea: { tokenEnv: "AWS_SECRET_ACCESS_KEY" }, pagesPerSync: 2 } } });
    const g = loadConfig(project).git;
    expect(g.forge.hosts).toEqual({});
    expect(g.forge.gitea.tokenEnv).toBe("GITEA_TOKEN");
    expect(g.forge.pagesPerSync).toBe(2); // non-global-only project keys still apply
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toContain("git.forge.hosts");
    expect(msg).toContain("git.forge.gitea.tokenEnv");
  });

  it("E22: the global layer's hosts and tokenEnv are honoured", () => {
    writeGlobal({ git: { forge: { hosts: { "git.corp.example": "gitlab" }, gitea: { tokenEnv: "CORP_GITEA" } } } });
    const g = loadConfig(project).git;
    expect(g.forge.hosts).toEqual({ "git.corp.example": "gitlab" });
    expect(g.forge.gitea.tokenEnv).toBe("CORP_GITEA");
  });

  it("E41: every nested level keeps siblings from earlier layers", () => {
    writeGlobal({ git: { forge: { minSyncIntervalSeconds: 900, pagesPerSync: 3 } } });
    writeProject({ git: { forge: { pagesPerSync: 2 } } });
    const f = loadConfig(project).git.forge;
    expect(f.minSyncIntervalSeconds).toBe(900);
    expect(f.pagesPerSync).toBe(2);
    expect(f.rateFloorPercent).toBe(20);
    expect(f.gitea.tokenEnv).toBe("GITEA_TOKEN");
  });

  const bad = (git: unknown) => () => validateConfig({ git } as never);
  it("E40: validation table", () => {
    expect(bad({ forge: { rateFloorPercent: -1 } })).toThrow(/git\.forge\.rateFloorPercent/);
    expect(bad({ forge: { rateFloorPercent: 101 } })).toThrow(/git\.forge\.rateFloorPercent/);
    expect(bad({ forge: { pagesPerSync: 0 } })).toThrow(/git\.forge\.pagesPerSync/);
    expect(bad({ forge: { hosts: { "x.example": "bitbucket" } } })).toThrow(/git\.forge\.hosts/);
    expect(bad({ forge: { minSyncIntervalSeconds: 600, hintedMinSyncIntervalSeconds: 601 } })).toThrow(/git\.forge\.hintedMinSyncIntervalSeconds/);
    expect(bad({ commits: { maxInitial: 0 } })).toThrow(/git\.commits\.maxInitial/);
    expect(bad({ searchWaitMs: -5 })).toThrow(/git\.searchWaitMs/);
    expect(bad({ forge: { gitea: { tokenEnv: "not a var name" } } })).toThrow(/git\.forge\.gitea\.tokenEnv/);
    // accepted boundaries
    expect(bad({ forge: { rateFloorPercent: 0 } })).not.toThrow();
    expect(bad({ forge: { rateFloorPercent: 100 } })).not.toThrow();
    expect(bad({ forge: { pagesPerSync: 1 } })).not.toThrow();
    expect(bad({ forge: { minSyncIntervalSeconds: 600, hintedMinSyncIntervalSeconds: 600 } })).not.toThrow();
  });

  it("DEFAULTS is not mutated by validateConfig merging", () => {
    validateConfig({ git: { forge: { pagesPerSync: 9 } } } as never);
    expect(DEFAULTS.git.forge.pagesPerSync).toBe(5);
  });
});
