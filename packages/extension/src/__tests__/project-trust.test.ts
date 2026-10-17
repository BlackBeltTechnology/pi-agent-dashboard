/**
 * `project_trust` bridge decision: activation rule + snapshot mirror rule.
 *
 * Covers test-plan #E5 #E10 #E11 #E12 #E13 #E14 #E15 #E16 #E27 #P1 and #X1–#X4 #X11.
 * See change: adopt-pi-074-080-features (A.3), mirror-dashboard-trust-to-pi.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PiTrustMirrorConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { statFolderIdentity } from "@blackbelt-technology/pi-dashboard-shared/pi-trust-mirror.js";
import { readPiTrustFileLockless, readPiTrustMirrorSnapshot } from "@blackbelt-technology/pi-dashboard-shared/pi-trust-mirror-snapshot.js";
import type { PiTrustSnapshot, PiTrustSnapshotEntry } from "@blackbelt-technology/pi-dashboard-shared/pi-trust-mirror-types.js";
import { hookDefHash } from "@blackbelt-technology/pi-dashboard-shared/worktree-init-hook.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decideBridgeProjectTrust, type ProjectTrustDecisionInput, type ProjectTrustDeps, readEventCwd } from "../project-trust.js";
import { __resetSpawnToken, captureSpawnTokenAtActivation, consumeSpawnToken } from "../spawn-token.js";

let root: string;
let agentDir: string;
const logs: string[] = [];

const cfg = (over: Partial<PiTrustMirrorConfig> = {}): PiTrustMirrorConfig => ({
  enabled: true,
  coverInteractive: false,
  sources: { worktreeInit: true, workflow: true, pinned: true, folderWorkspaces: true, accessGrants: false },
  ...over,
});
const NO_DENY = { exact: [], subtree: [] };

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-bridge-trust-")));
  agentDir = path.join(root, "agent");
  fs.mkdirSync(agentDir);
  logs.length = 0;
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function mkdir(...p: string[]): string {
  const d = path.join(root, ...p);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function entryFor(dir: string, over: Partial<PiTrustSnapshotEntry> = {}): PiTrustSnapshotEntry {
  const id = statFolderIdentity(dir)!;
  return { key: dir, sourceKind: "pinned", ...id, ...over };
}

const snap = (...entries: PiTrustSnapshotEntry[]): PiTrustSnapshot => ({ version: 1, generation: 1, entries });

function decide(
  input: Partial<ProjectTrustDecisionInput> & { eventCwd: string },
  deps: Partial<ProjectTrustDeps> = {},
) {
  return decideBridgeProjectTrust(
    { dashboardSpawned: true, isHeadless: true, activationCwd: "/nowhere/else", ...input },
    {
      home: root,
      agentDir,
      readConfig: () => cfg(),
      readSnapshot: () => null,
      denyRules: () => NO_DENY,
      log: (l) => logs.push(l),
      ...deps,
    },
  );
}

describe("readEventCwd", () => {
  it("returns undefined when the cwd getter throws; prefers event over ctx", () => {
    const staleCtx = {
      get cwd(): string {
        throw new Error("session replaced");
      },
    };
    expect(readEventCwd(undefined, staleCtx)).toBeUndefined();
    expect(readEventCwd({ cwd: "/from/event" }, { cwd: "/from/ctx" })).toBe("/from/event");
    expect(readEventCwd({}, { cwd: "/from/ctx" })).toBe("/from/ctx");
    expect(readEventCwd(null, null)).toBeUndefined();
  });

  it("an undefined event cwd is undecided even for a dashboard-spawned headless session", () => {
    expect(decideBridgeProjectTrust({ dashboardSpawned: true, isHeadless: true, eventCwd: undefined, activationCwd: root }).trusted).toBe("undecided");
  });
});

describe("activation rule (#E12 #E13 #E14)", () => {
  it("#E12 canonical compare: symlinked activation cwd equals the real event cwd", () => {
    const repo = mkdir("repo");
    const link = path.join(root, "link");
    fs.symlinkSync(repo, link);
    expect(decide({ eventCwd: repo, activationCwd: link }).trusted).toBe("yes");
  });

  it("only the activation cwd, only dashboard-spawned headless (matrix)", () => {
    const repo = mkdir("repo2");
    const rows: Array<[boolean, boolean, string, "yes" | "undecided"]> = [
      [true, true, repo, "yes"],
      [true, true, path.join(root, "other"), "undecided"],
      [true, false, repo, "undecided"],
      [false, true, repo, "undecided"],
      [false, false, repo, "undecided"],
    ];
    for (const [dashboardSpawned, isHeadless, eventCwd, expected] of rows) {
      expect(decide({ dashboardSpawned, isHeadless, eventCwd, activationCwd: repo }).trusted).toBe(expected);
    }
  });

  it("#E13 forbidden/temporary activation cwd is not auto-trusted and is logged", () => {
    const r = decideBridgeProjectTrust(
      { dashboardSpawned: true, isHeadless: true, eventCwd: "/private/tmp/clone", activationCwd: "/private/tmp/clone" },
      { home: root, agentDir, readConfig: () => cfg(), readSnapshot: () => null, log: (l) => logs.push(l) },
    );
    expect(r).toMatchObject({ trusted: "undecided", reason: "forbidden-folder" });
    expect(logs.join("\n")).toContain("forbidden-folder");
  });

  it("#E14 a recorded refusal stops the activation rule and is logged", () => {
    const repo = mkdir("rec");
    fs.writeFileSync(path.join(agentDir, "trust.json"), JSON.stringify({ [repo]: false }));
    const r = decide({ eventCwd: repo, activationCwd: repo });
    expect(r).toMatchObject({ trusted: "undecided", reason: "recorded-entry" });
    expect(logs.join("\n")).toContain("recorded-entry");
  });
});

describe("#E15 lockless trust.json rules", () => {
  const cases: Array<[string, string | null, "yes" | "undecided", string | undefined]> = [
    ["BOM + recorded true", "\ufeff{\"@\":true}", "undecided", "recorded-entry"],
    ["null value = absent", "{\"@\":null}", "yes", undefined],
    ["non-boolean string", "{\"@\":\"yes\"}", "undecided", "store-unreadable"],
    ["torn", "{\"@\":tr", "undecided", "store-unreadable"],
    ["absent file", null, "yes", undefined],
  ];
  it.each(cases)("%s", (_n, body, expected, reason) => {
    const r = mkdir("p");
    const app = mkdir("p", "app");
    if (body !== null) fs.writeFileSync(path.join(agentDir, "trust.json"), body.replace("@", r));
    const out = decide({ eventCwd: app }, { readSnapshot: () => snap(entryFor(r)) });
    expect(out.trusted).toBe(expected);
    expect(out.reason).toBe(reason);
  });
});

describe("mirror rule", () => {
  it("#E11 session classes × coverInteractive", () => {
    const r = mkdir("pin");
    const readSnapshot = () => snap(entryFor(r));
    const classes: Array<[string, boolean, boolean]> = [
      ["spawned headless", true, true],
      ["spawned interactive", true, false],
      ["plain headless", false, true],
      ["plain interactive", false, false],
    ];
    for (const [, dashboardSpawned, isHeadless] of classes) {
      const off = decide({ eventCwd: r, dashboardSpawned, isHeadless }, { readSnapshot });
      const spawnedHeadless = dashboardSpawned && isHeadless;
      expect(off.trusted).toBe(spawnedHeadless ? "yes" : "undecided");
      if (!spawnedHeadless) expect(off.reason).toBe("not-covered-session");
      const on = decide({ eventCwd: r, dashboardSpawned, isHeadless }, { readSnapshot, readConfig: () => cfg({ coverInteractive: true }) });
      expect(on.trusted).toBe("yes");
    }
  });

  it("#E10 identity: unchanged yes; re-created folder undecided; entry without birthtime compares dev+ino", () => {
    const r = mkdir("ident");
    const entry = entryFor(r);
    expect(decide({ eventCwd: r }, { readSnapshot: () => snap(entry) }).trusted).toBe("yes");
    fs.rmSync(r, { recursive: true });
    fs.mkdirSync(r);
    const recreated = decide({ eventCwd: r }, { readSnapshot: () => snap(entry) });
    // A re-created folder usually gets a new inode; where the fs reuses it, the birth time differs.
    const withBirth = entry.birthtimeMs !== undefined;
    const sameIno = statFolderIdentity(r)!.ino === entry.ino;
    if (!sameIno || withBirth) expect(recreated).toMatchObject({ trusted: "undecided", reason: "identity-mismatch" });
    const { birthtimeMs: _drop, ...noBirth } = entryFor(r);
    expect(decide({ eventCwd: r }, { readSnapshot: () => snap(noBirth) }).trusted).toBe("yes");
  });

  it("#E5 access-grant entry stops counting once .git is gone", () => {
    const r = mkdir("grant");
    fs.mkdirSync(path.join(r, ".git"));
    const app = mkdir("grant", "app");
    const readSnapshot = () => snap(entryFor(r, { sourceKind: "accessGrants" }));
    expect(decide({ eventCwd: app }, { readSnapshot }).trusted).toBe("yes");
    fs.rmSync(path.join(r, ".git"), { recursive: true });
    expect(decide({ eventCwd: app }, { readSnapshot })).toMatchObject({ trusted: "undecided", reason: "not-project-root" });
  });

  it("#X1 snapshot answers without a network call", () => {
    const r = mkdir("offline");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(decide({ eventCwd: r }, { readSnapshot: () => snap(entryFor(r)) }).trusted).toBe("yes");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("#X2 snapshot absent / truncated is undecided without throwing", () => {
    const r = mkdir("nosnap");
    expect(decide({ eventCwd: r }).trusted).toBe("undecided");
    const file = path.join(root, "snap.json");
    fs.writeFileSync(file, '{"generation":');
    // Same reader as production, pointed at the truncated file.
    const readSnapshot = () => readPiTrustMirrorSnapshot(file);
    expect(() => decide({ eventCwd: r }, { readSnapshot })).not.toThrow();
    expect(decide({ eventCwd: r }, { readSnapshot }).trusted).toBe("undecided");
  });

  it("#X3 rollback while down: enabled:false ignores the snapshot", () => {
    const r = mkdir("rb");
    const out = decide({ eventCwd: r, activationCwd: "/elsewhere" }, { readSnapshot: () => snap(entryFor(r)), readConfig: () => cfg({ enabled: false }) });
    expect(out.trusted).toBe("undecided");
  });

  it("#X4 hook edited after the snapshot → undecided hook-changed", () => {
    const r = mkdir("hooked");
    const hook = { gate: "true", run: { type: "script" as const, command: "echo hi" } };
    fs.mkdirSync(path.join(r, ".pi"));
    fs.writeFileSync(path.join(r, ".pi", "settings.json"), JSON.stringify({ worktreeInit: hook }));
    const entry = entryFor(r, { sourceKind: "worktreeInit", configRoot: r, hookHash: hookDefHash(hook) });
    expect(decide({ eventCwd: r }, { readSnapshot: () => snap(entry) }).trusted).toBe("yes");
    fs.writeFileSync(path.join(r, ".pi", "settings.json"), JSON.stringify({ worktreeInit: { ...hook, gate: "false" } }));
    expect(decide({ eventCwd: r }, { readSnapshot: () => snap(entry) })).toMatchObject({ trusted: "undecided", reason: "hook-changed" });
  });

  it("#X11 unreadable parent folder → identity-mismatch, no throw", () => {
    const outer = mkdir("outer");
    const r = mkdir("outer", "inner");
    const entry = entryFor(r);
    fs.chmodSync(outer, 0o000);
    try {
      const out = decide({ eventCwd: r }, { readSnapshot: () => snap(entry) });
      expect(out.trusted).toBe("undecided");
      // Running as root (CI containers) ignores chmod; then the folder is simply readable.
      if (process.getuid?.() !== 0) expect(out.reason).toBe("identity-mismatch");
    } finally {
      fs.chmodSync(outer, 0o755);
    }
  });
});

describe("#E27 never writes trust.json", () => {
  it("50 decisions leave trust.json bytes and mtime unchanged", () => {
    const r = mkdir("inv");
    const file = path.join(agentDir, "trust.json");
    fs.writeFileSync(file, JSON.stringify({ "/some/other": true }));
    const before = fs.readFileSync(file);
    const mtime = fs.statSync(file).mtimeMs;
    for (let i = 0; i < 50; i++) decide({ eventCwd: i % 2 ? r : path.join(root, "x") }, { readSnapshot: () => snap(entryFor(r)), readTrustFile: readPiTrustFileLockless });
    expect(fs.readFileSync(file).equals(before)).toBe(true);
    expect(fs.statSync(file).mtimeMs).toBe(mtime);
  });
});

describe("#P1 handler budget", () => {
  it("p95 < 20 ms with 1,000 entries and a cwd 20 levels deep", () => {
    const parts = Array.from({ length: 20 }, (_, i) => `d${i}`);
    const deep = mkdir(...parts);
    const covered = path.join(root, ...parts.slice(0, 3));
    const entries: PiTrustSnapshotEntry[] = Array.from({ length: 999 }, (_, i) => ({ key: `/fake/entry-${i}`, sourceKind: "pinned", dev: "1", ino: String(i) }));
    entries.push(entryFor(covered));
    const file = path.join(root, "snapshot.json");
    fs.writeFileSync(file, JSON.stringify(snap(...entries)));
    const times: number[] = [];
    for (let i = 0; i < 200; i++) {
      const t0 = performance.now();
      const out = decideBridgeProjectTrust(
        { dashboardSpawned: true, isHeadless: true, eventCwd: deep, activationCwd: "/elsewhere" },
        {
          home: root,
          agentDir,
          readConfig: () => cfg(),
          readSnapshot: () => JSON.parse(fs.readFileSync(file, "utf8")),
          denyRules: () => NO_DENY,
          log: () => {},
        },
      );
      times.push(performance.now() - t0);
      expect(out.trusted).toBe("yes");
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length * 0.95)]).toBeLessThan(20);
  });
});

describe("#E16 spawn token: captured + scrubbed at activation, consumed once", () => {
  const VAR = "PI_DASHBOARD_SPAWN_TOKEN";
  beforeEach(() => __resetSpawnToken());
  afterEach(() => {
    delete process.env[VAR];
    __resetSpawnToken();
  });

  it("non-empty token: env removed at once, dashboardSpawned true, exactly one consumer gets it (also after a reload)", () => {
    process.env[VAR] = "t1";
    expect(captureSpawnTokenAtActivation()).toBe(true);
    expect(process.env[VAR]).toBeUndefined();
    // /reload before the first register: the module re-runs, env already gone.
    expect(captureSpawnTokenAtActivation()).toBe(false);
    // Two register paths racing: only the first gets the token.
    expect(consumeSpawnToken()).toBe("t1");
    expect(consumeSpawnToken()).toBeUndefined();
    // A nested child inherits an env without the token.
    expect(JSON.stringify(process.env)).not.toContain('"PI_DASHBOARD_SPAWN_TOKEN"');
  });

  it("empty token: dashboardSpawned false, no spawnToken, env cleared", () => {
    process.env[VAR] = "";
    expect(captureSpawnTokenAtActivation()).toBe(false);
    expect(process.env[VAR]).toBeUndefined();
    expect(consumeSpawnToken()).toBeUndefined();
  });
});
