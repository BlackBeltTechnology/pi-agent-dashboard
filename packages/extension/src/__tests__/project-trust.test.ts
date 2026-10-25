/**
 * `project_trust` bridge decision: activation rule + snapshot mirror rule.
 *
 * Covers test-plan #E5 #E10 #E11 #E12 #E13 #E14 #E15 #E16 #E27 #P1 and #X1–#X4 #X11, and the
 * live-query step: #E8 #E9 #E10(handler) #E14 #E25 #P2 #P4 and #X1–#X3 #X6 of
 * mirror-dashboard-trust-live-remote (see the "live query" blocks below).
 * See change: adopt-pi-074-080-features (A.3), mirror-dashboard-trust-to-pi, mirror-dashboard-trust-live-remote.
 */
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import type { PiTrustMirrorConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { statFolderIdentity } from "@blackbelt-technology/pi-dashboard-shared/pi-trust-mirror.js";
import { readPiTrustFileLockless, readPiTrustMirrorSnapshot } from "@blackbelt-technology/pi-dashboard-shared/pi-trust-mirror-snapshot.js";
import type { PiTrustSnapshot, PiTrustSnapshotEntry } from "@blackbelt-technology/pi-dashboard-shared/pi-trust-mirror-types.js";
import {
  newTrustSalt,
  trustResourceDigest,
  trustResourceManifest,
} from "@blackbelt-technology/pi-dashboard-shared/pi-trust-resource-digest.js";
import { hookDefHash } from "@blackbelt-technology/pi-dashboard-shared/worktree-init-hook.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerProjectTrust } from "../bridge-handlers/lifecycle.js";
import { decideBridgeProjectTrust, type ProjectTrustDecisionInput, type ProjectTrustDeps, readEventCwd } from "../project-trust.js";
import { createHttpLiveQuery, isRemoteBridge, type LiveQueryFn, type LiveQueryResult } from "../project-trust-live.js";
import { __resetSpawnToken, captureSpawnTokenAtActivation, consumeSpawnToken } from "../spawn-token.js";

let root: string;
let agentDir: string;
const logs: string[] = [];

const cfg = (over: Partial<PiTrustMirrorConfig> = {}): PiTrustMirrorConfig => ({
  enabled: true,
  coverInteractive: false,
  liveQuery: true,
  sources: { worktreeInit: true, workflow: true, pinned: true, folderWorkspaces: true, accessGrants: false, yolo: true },
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

const snap = (...entries: PiTrustSnapshotEntry[]): PiTrustSnapshot => ({ version: 1, generation: 1, entries, liveCount: 0 });

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
  it("returns undefined when the cwd getter throws; prefers event over ctx", async () => {
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

  it("an undefined event cwd is undecided even for a dashboard-spawned headless session", async () => {
    expect((await decideBridgeProjectTrust({ dashboardSpawned: true, isHeadless: true, eventCwd: undefined, activationCwd: root })).trusted).toBe("undecided");
  });
});

describe("activation rule (#E12 #E13 #E14)", () => {
  it("#E12 canonical compare: symlinked activation cwd equals the real event cwd", async () => {
    const repo = mkdir("repo");
    const link = path.join(root, "link");
    fs.symlinkSync(repo, link);
    expect((await decide({ eventCwd: repo, activationCwd: link })).trusted).toBe("yes");
  });

  it("only the activation cwd, only dashboard-spawned headless (matrix)", async () => {
    const repo = mkdir("repo2");
    const rows: Array<[boolean, boolean, string, "yes" | "undecided"]> = [
      [true, true, repo, "yes"],
      [true, true, path.join(root, "other"), "undecided"],
      [true, false, repo, "undecided"],
      [false, true, repo, "undecided"],
      [false, false, repo, "undecided"],
    ];
    for (const [dashboardSpawned, isHeadless, eventCwd, expected] of rows) {
      expect((await decide({ dashboardSpawned, isHeadless, eventCwd, activationCwd: repo })).trusted).toBe(expected);
    }
  });

  it("#E13 forbidden/temporary activation cwd is not auto-trusted and is logged", async () => {
    const r = (await decideBridgeProjectTrust(
      { dashboardSpawned: true, isHeadless: true, eventCwd: "/private/tmp/clone", activationCwd: "/private/tmp/clone" },
      { home: root, agentDir, readConfig: () => cfg(), readSnapshot: () => null, log: (l) => logs.push(l) },
    ));
    expect(r).toMatchObject({ trusted: "undecided", reason: "forbidden-folder" });
    expect(logs.join("\n")).toContain("forbidden-folder");
  });

  it("#E14 a recorded refusal stops the activation rule and is logged", async () => {
    const repo = mkdir("rec");
    fs.writeFileSync(path.join(agentDir, "trust.json"), JSON.stringify({ [repo]: false }));
    const r = (await decide({ eventCwd: repo, activationCwd: repo }));
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
  it.each(cases)("%s", async (_n, body, expected, reason) => {
    const r = mkdir("p");
    const app = mkdir("p", "app");
    if (body !== null) fs.writeFileSync(path.join(agentDir, "trust.json"), body.replace("@", r));
    const out = (await decide({ eventCwd: app }, { readSnapshot: () => snap(entryFor(r)) }));
    expect(out.trusted).toBe(expected);
    expect(out.reason).toBe(reason);
  });
});

describe("mirror rule", () => {
  it("#E11 session classes × coverInteractive", async () => {
    const r = mkdir("pin");
    const readSnapshot = () => snap(entryFor(r));
    const classes: Array<[string, boolean, boolean]> = [
      ["spawned headless", true, true],
      ["spawned interactive", true, false],
      ["plain headless", false, true],
      ["plain interactive", false, false],
    ];
    for (const [, dashboardSpawned, isHeadless] of classes) {
      const off = (await decide({ eventCwd: r, dashboardSpawned, isHeadless }, { readSnapshot }));
      const spawnedHeadless = dashboardSpawned && isHeadless;
      expect(off.trusted).toBe(spawnedHeadless ? "yes" : "undecided");
      if (!spawnedHeadless) expect(off.reason).toBe("not-covered-session");
      const on = (await decide({ eventCwd: r, dashboardSpawned, isHeadless }, { readSnapshot, readConfig: () => cfg({ coverInteractive: true }) }));
      expect(on.trusted).toBe("yes");
    }
  });

  it("#E10 identity: unchanged yes; re-created folder undecided; entry without birthtime compares dev+ino", async () => {
    const r = mkdir("ident");
    const entry = entryFor(r);
    expect((await decide({ eventCwd: r }, { readSnapshot: () => snap(entry) })).trusted).toBe("yes");
    fs.rmSync(r, { recursive: true });
    fs.mkdirSync(r);
    const recreated = (await decide({ eventCwd: r }, { readSnapshot: () => snap(entry) }));
    // A re-created folder usually gets a new inode; where the fs reuses it, the birth time differs.
    const withBirth = entry.birthtimeMs !== undefined;
    const sameIno = statFolderIdentity(r)!.ino === entry.ino;
    if (!sameIno || withBirth) expect(recreated).toMatchObject({ trusted: "undecided", reason: "identity-mismatch" });
    const { birthtimeMs: _drop, ...noBirth } = entryFor(r);
    expect((await decide({ eventCwd: r }, { readSnapshot: () => snap(noBirth) })).trusted).toBe("yes");
  });

  it("#E5 access-grant entry stops counting once .git is gone", async () => {
    const r = mkdir("grant");
    fs.mkdirSync(path.join(r, ".git"));
    const app = mkdir("grant", "app");
    const readSnapshot = () => snap(entryFor(r, { sourceKind: "accessGrants" }));
    expect((await decide({ eventCwd: app }, { readSnapshot })).trusted).toBe("yes");
    fs.rmSync(path.join(r, ".git"), { recursive: true });
    expect((await decide({ eventCwd: app }, { readSnapshot }))).toMatchObject({ trusted: "undecided", reason: "not-project-root" });
  });

  it("#X1 snapshot answers without a network call", async () => {
    const r = mkdir("offline");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect((await decide({ eventCwd: r }, { readSnapshot: () => snap(entryFor(r)) })).trusted).toBe("yes");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("#X2 snapshot absent / truncated is undecided without throwing", async () => {
    const r = mkdir("nosnap");
    expect((await decide({ eventCwd: r })).trusted).toBe("undecided");
    const file = path.join(root, "snap.json");
    fs.writeFileSync(file, '{"generation":');
    // Same reader as production, pointed at the truncated file.
    const readSnapshot = () => readPiTrustMirrorSnapshot(file);
    await expect(decide({ eventCwd: r }, { readSnapshot })).resolves.toBeDefined();
    expect((await decide({ eventCwd: r }, { readSnapshot })).trusted).toBe("undecided");
  });

  it("#X3 rollback while down: enabled:false ignores the snapshot", async () => {
    const r = mkdir("rb");
    const out = (await decide({ eventCwd: r, activationCwd: "/elsewhere" }, { readSnapshot: () => snap(entryFor(r)), readConfig: () => cfg({ enabled: false }) }));
    expect(out.trusted).toBe("undecided");
  });

  it("#X4 hook edited after the snapshot → undecided hook-changed", async () => {
    const r = mkdir("hooked");
    const hook = { gate: "true", run: { type: "script" as const, command: "echo hi" } };
    fs.mkdirSync(path.join(r, ".pi"));
    fs.writeFileSync(path.join(r, ".pi", "settings.json"), JSON.stringify({ worktreeInit: hook }));
    const entry = entryFor(r, { sourceKind: "worktreeInit", configRoot: r, hookHash: hookDefHash(hook) });
    expect((await decide({ eventCwd: r }, { readSnapshot: () => snap(entry) })).trusted).toBe("yes");
    fs.writeFileSync(path.join(r, ".pi", "settings.json"), JSON.stringify({ worktreeInit: { ...hook, gate: "false" } }));
    expect((await decide({ eventCwd: r }, { readSnapshot: () => snap(entry) }))).toMatchObject({ trusted: "undecided", reason: "hook-changed" });
  });

  it("#X11 unreadable parent folder → identity-mismatch, no throw", async () => {
    const outer = mkdir("outer");
    const r = mkdir("outer", "inner");
    const entry = entryFor(r);
    fs.chmodSync(outer, 0o000);
    try {
      const out = (await decide({ eventCwd: r }, { readSnapshot: () => snap(entry) }));
      expect(out.trusted).toBe("undecided");
      // Running as root (CI containers) ignores chmod; then the folder is simply readable.
      if (process.getuid?.() !== 0) expect(out.reason).toBe("identity-mismatch");
    } finally {
      fs.chmodSync(outer, 0o755);
    }
  });
});

describe("#E27 never writes trust.json", () => {
  it("50 decisions leave trust.json bytes and mtime unchanged", async () => {
    const r = mkdir("inv");
    const file = path.join(agentDir, "trust.json");
    fs.writeFileSync(file, JSON.stringify({ "/some/other": true }));
    const before = fs.readFileSync(file);
    const mtime = fs.statSync(file).mtimeMs;
    for (let i = 0; i < 50; i++) (await decide({ eventCwd: i % 2 ? r : path.join(root, "x") }, { readSnapshot: () => snap(entryFor(r)), readTrustFile: readPiTrustFileLockless }));
    expect(fs.readFileSync(file).equals(before)).toBe(true);
    expect(fs.statSync(file).mtimeMs).toBe(mtime);
  });
});

describe("#P1 handler budget", () => {
  it("p95 < 20 ms with 1,000 entries and a cwd 20 levels deep", async () => {
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
      const out = (await decideBridgeProjectTrust(
        { dashboardSpawned: true, isHeadless: true, eventCwd: deep, activationCwd: "/elsewhere" },
        {
          home: root,
          agentDir,
          readConfig: () => cfg(),
          readSnapshot: () => JSON.parse(fs.readFileSync(file, "utf8")),
          denyRules: () => NO_DENY,
          log: () => {},
        },
      ));
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

  it("non-empty token: env removed at once, dashboardSpawned true, exactly one consumer gets it (also after a reload)", async () => {
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

  it("empty token: dashboardSpawned false, no spawnToken, env cleared", async () => {
    process.env[VAR] = "";
    expect(captureSpawnTokenAtActivation()).toBe(false);
    expect(process.env[VAR]).toBeUndefined();
    expect(consumeSpawnToken()).toBeUndefined();
  });
});

// ── live query (mirror-dashboard-trust-live-remote) ─────────────────────────

const liveSnap = (liveCount: number, ...entries: PiTrustSnapshotEntry[]): PiTrustSnapshot => ({
  version: 1,
  generation: 1,
  entries,
  liveCount,
});

type LiveDeps = Partial<ProjectTrustDeps> & { liveQuery: LiveQueryFn };

function decideLive(
  input: Partial<ProjectTrustDecisionInput> & { eventCwd: string },
  deps: LiveDeps,
  over: { cfg?: Partial<PiTrustMirrorConfig>; liveCount?: number; snapshot?: PiTrustSnapshot; remote?: boolean } = {},
) {
  return decide(input, {
    readConfig: () => cfg(over.cfg),
    readSnapshot: () => over.snapshot ?? liveSnap(over.liveCount ?? 1),
    isRemoteBridge: () => over.remote === true,
    ...deps,
  });
}

const covered = (r: string, over: Record<string, unknown> = {}): LiveQueryResult => ({
  kind: "response",
  status: 200,
  body: { covered: true, key: r, sourceKind: "worktreeInit", ...statFolderIdentity(r)!, ...over },
});

/** Every combination of the given option lists (first list varies slowest). */
function combinations<T extends Record<string, readonly unknown[]>>(axes: T): Array<{ [K in keyof T]: T[K][number] }> {
  let out: Array<Record<string, unknown>> = [{}];
  for (const [name, values] of Object.entries(axes)) {
    out = out.flatMap((acc) => values.map((v) => ({ ...acc, [name]: v })));
  }
  return out as Array<{ [K in keyof T]: T[K][number] }>;
}

type AskCase = {
  enabled: boolean;
  liveQuery: boolean;
  session: "spawned-headless" | "plain-interactive";
  coverInteractive: boolean;
  recorded: boolean;
  isDenied: boolean;
  snapshotKind: "cover" | "identity-mismatch" | "none";
  liveCount: number;
  remote: boolean;
};

function snapshotEntriesFor(kind: AskCase["snapshotKind"], cwd: string): PiTrustSnapshotEntry[] {
  if (kind === "cover") return [entryFor(cwd)];
  if (kind === "identity-mismatch") return [{ ...entryFor(cwd), ino: "999999999" }];
  return [];
}

/** The spec's condition list, written once and independently of the implementation. */
function shouldHaveAsked(c: AskCase): boolean {
  const sessionAllowed = c.session === "spawned-headless" || c.coverInteractive;
  const switchesOn = c.enabled && c.liveQuery;
  const nothingElseDecided = !c.recorded && !c.isDenied && c.snapshotKind !== "cover";
  return switchesOn && sessionAllowed && nothingElseDecided && (c.liveCount > 0 || c.remote);
}

describe("#E8 when the bridge asks", () => {
  it("queries exactly when every condition holds, and never on a snapshot cover", async () => {
    const dir = mkdir("live-e8");
    const denied = mkdir("live-e8-denied");
    const cases = combinations({
      enabled: [true, false],
      liveQuery: [true, false],
      session: ["spawned-headless", "plain-interactive"],
      coverInteractive: [true, false],
      recorded: [true, false],
      isDenied: [true, false],
      snapshotKind: ["cover", "identity-mismatch", "none"],
      liveCount: [0, 1],
      remote: [true, false],
    } as const) as AskCase[];
    expect(cases).toHaveLength(2 * 2 * 2 * 2 * 2 * 2 * 3 * 2 * 2);

    for (const c of cases) {
      const cwd = c.isDenied ? denied : dir;
      fs.writeFileSync(path.join(agentDir, "trust.json"), c.recorded ? JSON.stringify({ [cwd]: true }) : "{}");
      const calls: Array<{ cwdKey: string; remote: boolean }> = [];
      const spawnedHeadless = c.session === "spawned-headless";
      await decideLive(
        { eventCwd: cwd, dashboardSpawned: spawnedHeadless, isHeadless: spawnedHeadless },
        {
          liveQuery: async (req) => {
            calls.push(req);
            return { kind: "response", status: 200, body: { covered: false } };
          },
          denyRules: () => ({ exact: [], subtree: [denied] }),
        },
        {
          cfg: { enabled: c.enabled, liveQuery: c.liveQuery, coverInteractive: c.coverInteractive },
          snapshot: liveSnap(c.liveCount, ...snapshotEntriesFor(c.snapshotKind, cwd)),
          remote: c.remote,
        },
      );
      expect(calls.length > 0, JSON.stringify(c)).toBe(shouldHaveAsked(c));
      expect(calls.every((r) => r.cwdKey === cwd && r.remote === c.remote)).toBe(true);
    }
  });
});

describe("#E9 outcome mapping", () => {
  const rows: Array<[string, LiveQueryResult, string]> = [
    ["connection refused", { kind: "unreachable" }, "live-unreachable"],
    ["401", { kind: "response", status: 401, body: undefined }, "live-refused"],
    ["403", { kind: "response", status: 403, body: undefined }, "live-refused"],
    ["404", { kind: "response", status: 404, body: undefined }, "live-unsupported"],
    ["429", { kind: "response", status: 429, body: undefined }, "live-rate-limited"],
    ["not covered", { kind: "response", status: 200, body: { covered: false } }, "live-not-covered"],
    ["500", { kind: "response", status: 500, body: undefined }, "live-error"],
    ["malformed body", { kind: "response", status: 200, body: "garbage" }, "live-error"],
    ["302 as a response", { kind: "response", status: 302, body: undefined }, "live-error"],
    ["redirect refused by the transport", { kind: "error" }, "live-error"],
    ["covered without proof fields", { kind: "response", status: 200, body: { covered: true } }, "live-error"],
  ];
  it.each(rows)("%s → %s (and the line is logged for a dashboard-spawned session)", async (_n, result, reason) => {
    const dir = mkdir("live-e9");
    logs.length = 0;
    const out = await decideLive({ eventCwd: dir }, { liveQuery: async () => result });
    expect(out).toMatchObject({ trusted: "undecided", reason });
    expect(logs.join("\n")).toContain(reason);
  });

  it("a thrown liveQuery is undecided live-error, never a throw", async () => {
    const dir = mkdir("live-e9-throw");
    const out = await decideLive({ eventCwd: dir }, {
      liveQuery: async () => {
        throw new Error("boom");
      },
    });
    expect(out).toMatchObject({ trusted: "undecided", reason: "live-error" });
  });
});

describe("#E14 local proof = recorded identity", () => {
  it("trusted while the folder is the recorded one; identity-mismatch once it is re-created", async () => {
    const r = mkdir("live-e14");
    const answer = covered(r);
    const q: LiveDeps = { liveQuery: async () => answer };
    expect(await decideLive({ eventCwd: r }, q)).toMatchObject({ trusted: "yes", via: "live" });

    fs.rmSync(r, { recursive: true });
    mkdir("live-e14-decoy"); // occupy a freed inode
    fs.mkdirSync(r);
    expect(await decideLive({ eventCwd: r }, q)).toMatchObject({ trusted: "undecided", reason: "identity-mismatch" });
  });

  it("an answer naming a folder that is not the cwd or an ancestor is live-error", async () => {
    const r = mkdir("live-e14-key");
    const other = mkdir("live-e14-other");
    expect(await decideLive({ eventCwd: r }, { liveQuery: async () => covered(other) })).toMatchObject({ reason: "live-error" });
  });

  it("an ancestor key covers a nested cwd", async () => {
    const r = mkdir("live-e14-anc");
    const nested = mkdir("live-e14-anc", "wt");
    expect(await decideLive({ eventCwd: nested }, { liveQuery: async () => covered(r) })).toMatchObject({ trusted: "yes" });
  });
});

describe("remote proof on the bridge (#X6 #E9)", () => {
  function tree(name: string): string {
    const dir = mkdir(name);
    fs.mkdirSync(path.join(dir, ".pi", "extensions"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".pi", "settings.json"), "{}");
    fs.writeFileSync(path.join(dir, ".pi", "extensions", "a.ts"), "export default 1;");
    return dir;
  }
  const remoteAnswer = async (dir: string, mutate?: () => void): Promise<LiveQueryResult> => {
    const manifest = (await trustResourceManifest(dir, { home: root })) as string;
    const salt = newTrustSalt();
    const digest = trustResourceDigest(salt, dir, manifest);
    mutate?.();
    return { kind: "response", status: 200, body: { covered: true, salt, digest } };
  };

  it("equal digests → trusted", async () => {
    const dir = tree("live-r1");
    expect(await decideLive({ eventCwd: dir }, { liveQuery: () => remoteAnswer(dir) }, { remote: true, liveCount: 0 })).toMatchObject({ trusted: "yes", via: "live" });
  });

  it("#X6 a file under .pi/extensions that changes between server and bridge hashing → identity-mismatch", async () => {
    const dir = tree("live-r2");
    const out = await decideLive(
      { eventCwd: dir },
      { liveQuery: () => remoteAnswer(dir, () => fs.writeFileSync(path.join(dir, ".pi", "extensions", "a.ts"), "evil()")) },
      { remote: true, liveCount: 0 },
    );
    expect(out).toMatchObject({ trusted: "undecided", reason: "identity-mismatch" });
  });

  it("a set the bridge cannot bind (symlink) → identity-weak", async () => {
    const dir = tree("live-r3");
    const answer = await remoteAnswer(dir);
    fs.symlinkSync(path.join(dir, ".pi", "settings.json"), path.join(dir, ".pi", "extensions", "link.ts"));
    expect(await decideLive({ eventCwd: dir }, { liveQuery: async () => answer }, { remote: true, liveCount: 0 })).toMatchObject({
      reason: "identity-weak",
    });
  });

  it("an answer replayed for another cwd → identity-mismatch", async () => {
    const a = tree("live-r4a");
    const b = tree("live-r4b");
    const answer = await remoteAnswer(a);
    expect(await decideLive({ eventCwd: b }, { liveQuery: async () => answer }, { remote: true, liveCount: 0 })).toMatchObject({
      reason: "identity-mismatch",
    });
  });
});

describe("#E25 isRemoteBridge", () => {
  const env = { PI_DASHBOARD_TOKEN: "tok" };
  it.each([
    ["ws://127.0.0.1:8001", false],
    ["ws://127.0.0.2:8001", false],
    ["ws://[::1]:8001", false],
    ["ws://localhost:8001", false],
    ["ws+unix:/tmp/pi.sock", false],
    ["wss://dash.example.com", true],
    ["ws://10.0.0.5:8001", true],
  ])("%s → remote=%s with a device token", (endpoint, expected) => {
    expect(isRemoteBridge(endpoint, env)).toBe(expected);
  });
  it("a non-loopback endpoint without a device token is not a remote bridge", () => {
    expect(isRemoteBridge("wss://dash.example.com", {})).toBe(false);
  });
});

describe("the real transport against a live HTTP server (#P2 #P4 #X1–#X3)", () => {
  let server: http.Server | undefined;
  let port = 0;
  let hits: string[] = [];
  let closedByClient = false;
  let respond: (req: http.IncomingMessage, res: http.ServerResponse) => void = () => {};

  beforeEach(async () => {
    hits = [];
    closedByClient = false;
    respond = () => {};
    server = http.createServer((req, res) => {
      hits.push(`${req.method} ${req.url}`);
      req.on("close", () => {
        if (!res.writableEnded) closedByClient = true;
      });
      respond(req, res);
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterEach(async () => {
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((r) => server!.close(() => r()));
  });

  const bridgeDeps = (over: Partial<ProjectTrustDeps> = {}): LiveDeps => ({
    isRemoteBridge: () => true,
    liveQuery: createHttpLiveQuery({
      endpoint: () => `ws://127.0.0.1:${port}`,
      // The HTTP listener is addressed on purpose: the endpoint is the gateway, `PI_DASHBOARD_PORT` the HTTP port.
      env: { PI_DASHBOARD_TOKEN: "dev-token", PI_DASHBOARD_PORT: String(port) },
    }),
    ...over,
  });
  const budget = (ms: number) => ({ cfg: { liveQueryTimeoutMs: ms }, remote: true, liveCount: 0 });

  it("sends one POST with the bearer and the cwd key, and never follows a redirect", async () => {
    const dir = mkdir("live-t1");
    let auth = "";
    let body = "";
    respond = (req, res) => {
      auth = String(req.headers.authorization);
      req.on("data", (c) => {
        body += c;
      });
      req.on("end", () => {
        res.writeHead(302, { location: "/elsewhere" });
        res.end();
      });
    };
    const out = await decideLive({ eventCwd: dir }, bridgeDeps(), budget(1000));
    expect(out).toMatchObject({ reason: "live-error" });
    expect(auth).toBe("Bearer dev-token");
    expect(JSON.parse(body)).toEqual({ cwd: dir });
    expect(hits).toEqual(["POST /api/pi-trust/query"]);
  });

  it("#X3 a 404 → live-unsupported", async () => {
    const dir = mkdir("live-t2");
    respond = (_req, res) => {
      res.writeHead(404);
      res.end();
    };
    expect(await decideLive({ eventCwd: dir }, bridgeDeps(), budget(1000))).toMatchObject({ reason: "live-unsupported" });
  });

  it("#X1 a closed port → live-unreachable well inside the budget", async () => {
    const dir = mkdir("live-t3");
    await new Promise<void>((r) => server!.close(() => r()));
    const t0 = performance.now();
    const out = await decideLive({ eventCwd: dir }, bridgeDeps(), budget(300));
    expect(out).toMatchObject({ trusted: "undecided", reason: "live-unreachable" });
    expect(performance.now() - t0).toBeLessThan(400);
    server = undefined;
  });

  it("#X2 a server that delays 2 s → live-timeout ≤ 400 ms, and the server sees the request aborted", async () => {
    const dir = mkdir("live-t4");
    respond = () => {
      /* never answers */
    };
    const t0 = performance.now();
    const out = await decideLive({ eventCwd: dir }, bridgeDeps(), budget(300));
    expect(out).toMatchObject({ trusted: "undecided", reason: "live-timeout" });
    expect(performance.now() - t0).toBeLessThan(400);
    await new Promise((r) => setTimeout(r, 100));
    expect(closedByClient).toBe(true);
  });

  it("#P2 a server that accepts and never answers: resolves within 400 ms on every one of 20 runs", async () => {
    const dir = mkdir("live-t5");
    respond = () => {
      /* never answers */
    };
    for (let i = 0; i < 20; i += 1) {
      const t0 = performance.now();
      const out = await decideLive({ eventCwd: dir }, bridgeDeps(), budget(300));
      const took = performance.now() - t0;
      expect(out.reason).toBe("live-timeout");
      expect(took, `run ${i}`).toBeLessThanOrEqual(400);
    }
  }, 30_000);
});

describe("#P4 the deadline covers the proof check", () => {
  it("answer at 250 ms + a walker reading 50 ms at a time: live-timeout by 400 ms, and the walk stops", async () => {
    const dir = mkdir("live-p4");
    for (let run = 0; run < 20; run += 1) {
      let reads = 0;
      let running = false;
      const t0 = performance.now();
      const out = await decideLive(
        { eventCwd: dir },
        {
          liveQuery: async () => {
            await new Promise((r) => setTimeout(r, 250));
            return { kind: "response", status: 200, body: { covered: true, salt: "s", digest: "d" } };
          },
          manifest: async (_cwd, o) => {
            running = true;
            for (let i = 0; i < 10; i += 1) {
              if (o.signal?.aborted) break;
              await new Promise((r) => setTimeout(r, 50));
              reads += 1;
            }
            running = false;
            return o.signal?.aborted ? null : "m";
          },
        },
        { cfg: { liveQueryTimeoutMs: 300 }, remote: true, liveCount: 0 },
      );
      const took = performance.now() - t0;
      expect(out).toMatchObject({ trusted: "undecided", reason: "live-timeout" });
      expect(took, `run ${run}`).toBeLessThanOrEqual(400);
      const readsAtResolve = reads;
      await new Promise((r) => setTimeout(r, 120));
      expect(running).toBe(false); // the walk observed the abort and ended
      expect(reads - readsAtResolve).toBeLessThanOrEqual(1);
    }
  }, 30_000);
});

describe("the registered handler (#E10)", () => {
  function fakeInst(state: { active: boolean }) {
    let registered: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
    const inst = {
      pi: { on: (_name: string, fn: typeof registered) => { registered = fn; } },
      safe: (fn: unknown) => fn,
      isActive: () => state.active,
      dashboardSpawned: true,
      activationCwd: "/nowhere/else",
      dashboardUrl: "ws://127.0.0.1:1",
      rendezvous: null,
    };
    return { inst, handler: () => registered! };
  }

  it("a covered answer with a valid proof is a per-run yes", async () => {
    const r = mkdir("live-h1");
    const state = { active: true };
    const { inst, handler } = fakeInst(state);
    registerProjectTrust(inst as never, {
      home: root,
      agentDir,
      readConfig: () => cfg({ coverInteractive: true }), // the test process is not a headless RPC session
      readSnapshot: () => liveSnap(1),
      denyRules: () => NO_DENY,
      liveQuery: async () => covered(r),
      log: () => {},
    });
    expect(await handler()({ cwd: r }, {})).toEqual({ trusted: "yes", remember: false });
  });

  it("the instance flipping inactive while the query is pending yields undecided", async () => {
    const r = mkdir("live-h2");
    const state = { active: true };
    const { inst, handler } = fakeInst(state);
    registerProjectTrust(inst as never, {
      home: root,
      agentDir,
      readConfig: () => cfg({ coverInteractive: true }),
      readSnapshot: () => liveSnap(1),
      denyRules: () => NO_DENY,
      liveQuery: async () => {
        state.active = false; // a reload replaced this bridge mid-query
        return covered(r);
      },
      log: () => {},
    });
    expect(await handler()({ cwd: r }, {})).toEqual({ trusted: "undecided" });
  });

  it("an inactive instance never queries", async () => {
    const r = mkdir("live-h3");
    let called = false;
    const { inst, handler } = fakeInst({ active: false });
    registerProjectTrust(inst as never, {
      readSnapshot: () => liveSnap(1),
      liveQuery: async () => {
        called = true;
        return covered(r);
      },
    });
    expect(await handler()({ cwd: r }, {})).toEqual({ trusted: "undecided" });
    expect(called).toBe(false);
  });
});

describe("remote live query targets the dashboard HTTP origin (fix-remote-bridge-ticket-origin)", () => {
  const signal = () => new AbortController().signal;

  it("#E12 queries the HTTP origin, not the gateway port", async () => {
    const fetchImpl = vi.fn(async () => ({ status: 404 }) as unknown as Response);
    const query = createHttpLiveQuery({
      endpoint: () => "ws://dash.example:9999",
      env: { PI_DASHBOARD_TOKEN: "t" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await query({ cwdKey: "/x", remote: true, signal: signal() });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((fetchImpl.mock.calls[0] as unknown[])[0]).toBe("http://dash.example:8000/api/pi-trust/query");
  });

  it("#X6 fails closed on a bad override and logs the cause once", async () => {
    const fetchImpl = vi.fn();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const query = createHttpLiveQuery({
        endpoint: () => "ws://dash.example:9999",
        env: { PI_DASHBOARD_TOKEN: "t", PI_DASHBOARD_HTTP_URL: "not a url" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(await query({ cwdKey: "/x", remote: true, signal: signal() })).toEqual({ kind: "error" });
      expect(await query({ cwdKey: "/x", remote: true, signal: signal() })).toEqual({ kind: "error" });
      expect(fetchImpl).not.toHaveBeenCalled();
      const lines = err.mock.calls.map((c) => c.join(" ")).filter((l) => l.includes("bad-http-url"));
      expect(lines).toHaveLength(1);
    } finally {
      err.mockRestore();
    }
  });
});

describe("remote live query TLS checks (prove-vault-bridge-tls D7, D9)", () => {
  const signal = () => new AbortController().signal;
  const run = async (endpoint: string, env: Record<string, string>) => {
    const fetchImpl = vi.fn(async () => ({ status: 404 }) as unknown as Response);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const query = createHttpLiveQuery({
        endpoint: () => endpoint,
        env: { PI_DASHBOARD_TOKEN: "plain-token", ...env },
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      const out = await query({ cwdKey: "/x", remote: true, signal: signal() });
      return { out, fetchImpl, lines: err.mock.calls.map((c) => c.join(" ")) };
    } finally {
      err.mockRestore();
    }
  };

  it("validation disabled on a wss endpoint: no request, named cause", async () => {
    const { out, fetchImpl, lines } = await run("wss://dash.example:8443", { NODE_TLS_REJECT_UNAUTHORIZED: "0" });
    expect(out).toEqual({ kind: "error" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(lines.some((l) => l.includes("tls-verify-disabled"))).toBe(true);
  });

  it("a pi_tls_ token with a plaintext origin: no request, named cause, token never logged", async () => {
    const { out, fetchImpl, lines } = await run("ws://dash.example:9999", { PI_DASHBOARD_TOKEN: "pi_tls_secret" });
    expect(out).toEqual({ kind: "error" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(lines.some((l) => l.includes("tls-only-token"))).toBe(true);
    expect(lines.join("\n")).not.toContain("pi_tls_secret");
  });

  it("plain ws with a plain token still queries while validation is disabled", async () => {
    const { fetchImpl } = await run("ws://dash.example:9999", { NODE_TLS_REJECT_UNAUTHORIZED: "0" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
