/**
 * Live (server-lifetime) dashboard-trust sources: session worktree-init trust,
 * session access grants and YOLO roots — counting, recorded identity, the snapshot
 * `liveCount`, memory-only choices, and server-consumer visibility.
 *
 * Covers test-plan #E3 #E4 #E5 #E6 #E7 #E14 #E23 #E24 #X4 #X5.
 * See change: mirror-dashboard-trust-live-remote.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PiTrustMirrorConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { identityMatches, statFolderIdentity } from "@blackbelt-technology/pi-dashboard-shared/pi-trust-mirror.js";
import { hookDefHash } from "@blackbelt-technology/pi-dashboard-shared/worktree-init-hook.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetSessionTrust,
  listSessionTrust,
  recordTrust,
  revokeTrust,
  setSessionTrustChangedListener,
} from "../../git-worktree/worktree-init-trust.js";
import { coveringDashboardEntry, createHostProjectTrustService } from "../../pi/host-project-trust.js";
import {
  __resetAccessGrants,
  listGrants,
  recordGrant,
  revokeGrant,
  setSessionGrantsChangedListener,
} from "../access-grants.js";
import { createPiTrustLiveProvider } from "../pi-trust-live.js";
import { createPiTrustMirrorService, setPiTrustMirror } from "../pi-trust-mirror-service.js";
import { YoloController } from "../yolo-session.js";

const MIN = 60_000;
let root: string;
let home: string;
let clock: number;
let cfg: PiTrustMirrorConfig;
let deny: { exact: string[]; subtree: string[] };
let yolo: YoloController;
let rungs: string[];
let warn: ReturnType<typeof vi.fn<(msg: string) => void>>;

const hook = { gate: "true", run: { type: "script" as const, command: "echo" } };

function mkdir(...p: string[]): string {
  const d = path.join(root, ...p);
  fs.mkdirSync(d, { recursive: true });
  return fs.realpathSync(d);
}
function repoWithHook(name: string, h = hook): string {
  const r = mkdir(name);
  fs.mkdirSync(path.join(r, ".pi"), { recursive: true });
  fs.writeFileSync(path.join(r, ".pi", "settings.json"), JSON.stringify({ worktreeInit: h }));
  return r;
}

function build() {
  const live = createPiTrustLiveProvider({
    getConfig: () => cfg,
    listSessionTrust,
    listSessionGrants: () => listGrants().filter((g) => g.scope === "session"),
    getYolo: () => yolo,
    home,
    now: () => clock,
    denyRules: () => deny,
  });
  const svc = createPiTrustMirrorService({
    getConfig: () => cfg,
    listPinned: () => [],
    listWorkspaceFolders: () => [],
    listWorktreeTrust: () => [],
    listPersistedGrants: () => [],
    snapshotPath: path.join(root, "cfg", "pi-trust-mirror.json"),
    overridesPath: path.join(root, "cfg", "pi-trust-overrides.json"),
    home,
    denyRules: () => ({ exact: [], subtree: [] }),
    warn: (m) => warn(m),
    live,
  });
  setSessionTrustChangedListener(() => svc.noteLiveChanged());
  setSessionGrantsChangedListener(() => svc.noteLiveChanged());
  yolo.setChangeListener(() => svc.noteLiveChanged());
  return { live, svc };
}

const liveCount = (svc: ReturnType<typeof build>["svc"]): number | undefined => svc.readSnapshot()?.liveCount;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-trust-live-")));
  home = path.join(root, "home");
  fs.mkdirSync(home);
  process.env.HOME = home;
  clock = 1_000_000;
  cfg = {
    enabled: true,
    coverInteractive: false,
    liveQuery: true,
    sources: { worktreeInit: true, workflow: true, pinned: true, folderWorkspaces: true, accessGrants: false, yolo: true },
  };
  deny = { exact: [], subtree: [] };
  warn = vi.fn<(msg: string) => void>();
  rungs = [];
  yolo = new YoloController({
    now: () => clock,
    hostGateMode: () => "enforce",
    isRefused: () => false,
    ladder: async () => rungs,
    onLog: () => {},
  });
  __resetSessionTrust();
  __resetAccessGrants();
});

afterEach(() => {
  setSessionTrustChangedListener(undefined);
  setSessionGrantsChangedListener(undefined);
  setPiTrustMirror(undefined);
  vi.useRealTimers();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("#E3 YOLO as a live source", () => {
  it("scoped live counts; expired, ended and unscoped do not; env counts; source off drops it", async () => {
    const w = mkdir("w");
    const { live } = build();

    expect((await yolo.activate({ durationMs: 15 * MIN, base: w })).ok).toBe(true);
    expect(live.covering(path.join(w, "app"))?.sourceKind).toBe("yolo");

    cfg.sources.yolo = false;
    expect(live.covering(w)).toBeNull();
    cfg.sources.yolo = true;
    expect(live.covering(w)).not.toBeNull();

    clock += 16 * MIN; // expired
    expect(live.covering(w)).toBeNull();

    clock = 1_000_000;
    yolo.end();
    expect((await yolo.activate({ durationMs: 15 * MIN, base: w })).ok).toBe(true);
    yolo.end();
    expect(live.covering(w)).toBeNull();

    expect((await yolo.activate({ durationMs: 15 * MIN, base: w, unscoped: true })).ok).toBe(true);
    expect(live.covering(w)).toBeNull();
    yolo.end();

    expect(yolo.activateFromEnv(w).ok).toBe(true);
    clock += 24 * 60 * MIN;
    expect(live.covering(w)?.lifetime).toEqual({ kind: "yolo-process" });
  });

  it("a root inside a denied folder never counts", async () => {
    const x = mkdir("home", "Downloads", "x");
    deny = { exact: [], subtree: [path.join(home, "Downloads")] };
    const { live } = build();
    expect((await yolo.activate({ durationMs: 15 * MIN, base: x })).ok).toBe(true);
    expect(live.covering(x)).toBeNull();
    expect(live.enumerate().ignored[0]).toMatchObject({ reason: "forbidden-folder" });
  });
});

describe("#E4 session worktree trust", () => {
  it("is keyed by pi's key form, counts at H1 and is ignored hook-changed at H2", () => {
    const real = repoWithHook("repo");
    const link = path.join(root, "link");
    fs.symlinkSync(real, link);
    const { live } = build();
    recordTrust(link, hookDefHash(hook), "session");
    const entry = live.covering(path.join(real, "sub"));
    expect(entry).toMatchObject({ sourceKind: "worktreeInit", key: real, lifetime: { kind: "restart" } });

    fs.writeFileSync(path.join(real, ".pi", "settings.json"), JSON.stringify({ worktreeInit: { ...hook, gate: "false" } }));
    expect(live.covering(real)).toBeNull();
    expect(live.enumerate().ignored[0]).toMatchObject({ reason: "hook-changed" });
  });
});

describe("#E5 session access grant", () => {
  it("counts only for a project root with the choice true (accessGrants default off)", () => {
    const proj = mkdir("proj");
    fs.mkdirSync(path.join(proj, ".git"));
    const plain = mkdir("plain");
    const { live } = build();
    recordGrant({ subject: proj, scope: "session" });
    recordGrant({ subject: plain, scope: "session" });

    expect(live.enumerate().ignored.map((i) => [i.entry.key, i.reason])).toEqual(
      expect.arrayContaining([
        [proj, "source-off"],
        [plain, "not-project-root"],
      ]),
    );
    live.setChoice("accessGrants", proj, true);
    expect(live.covering(proj)?.sourceKind).toBe("accessGrants");
    live.setChoice("accessGrants", proj, false);
    expect(live.covering(proj)).toBeNull();
    live.setChoice("accessGrants", plain, true);
    expect(live.covering(plain)).toBeNull(); // still not a project root
  });
});

describe("#E6 snapshot liveCount transitions", () => {
  it("session grant add → revoke", () => {
    const proj = mkdir("proj");
    fs.mkdirSync(path.join(proj, ".git"));
    const { live, svc } = build();
    live.setChoice("accessGrants", proj, true);
    svc.rebuildAtBoot();
    expect(liveCount(svc)).toBe(0);
    recordGrant({ subject: proj, scope: "session" });
    expect(liveCount(svc)).toBe(1); // already visible when recordGrant returned
    revokeGrant(proj, "session");
    expect(liveCount(svc)).toBe(0);
  });

  it("worktree session trust add → revoke", () => {
    const r = repoWithHook("repo");
    const { svc } = build();
    svc.rebuildAtBoot();
    recordTrust(r, hookDefHash(hook), "session");
    expect(liveCount(svc)).toBe(1);
    revokeTrust(r, hookDefHash(hook));
    expect(liveCount(svc)).toBe(0);
  });

  it("YOLO activate → addRoot → end counts one per root", async () => {
    const a = mkdir("a");
    rungs = [mkdir("b")];
    const { svc } = build();
    svc.rebuildAtBoot();
    await yolo.activate({ durationMs: 15 * MIN, base: a });
    expect(liveCount(svc)).toBe(1);
    expect((await yolo.addRoot({ base: a, root: rungs[0] })).ok).toBe(true);
    expect(liveCount(svc)).toBe(2);
    yolo.end();
    expect(liveCount(svc)).toBe(0);
  });

  it("the unref'd expiry timer drops the count with no denial", async () => {
    vi.useFakeTimers();
    const w = mkdir("w");
    const { svc } = build();
    svc.rebuildAtBoot();
    await yolo.activate({ durationMs: 15 * MIN, base: w });
    expect(liveCount(svc)).toBe(1);
    clock += 15 * MIN + 1;
    await vi.advanceTimersByTimeAsync(15 * MIN + 1);
    expect(liveCount(svc)).toBe(0);
  });

  it("the snapshot file holds no live path, device or inode", async () => {
    const w = mkdir("w");
    const { svc } = build();
    svc.rebuildAtBoot();
    await yolo.activate({ durationMs: 15 * MIN, base: w });
    const raw = fs.readFileSync(path.join(root, "cfg", "pi-trust-mirror.json"), "utf8");
    const parsed = JSON.parse(raw);
    expect(Object.keys(parsed).sort()).toEqual(["entries", "generation", "liveCount", "version"]);
    expect(parsed.entries).toEqual([]);
    expect(raw).not.toContain(w);
    const id = statFolderIdentity(w);
    expect(raw).not.toContain(`"${id?.ino}"`);
  });
});

describe("#E7 session-scope choice stays in memory", () => {
  it("choice false: not covered, no file records it; a restart forgets entry and choice", () => {
    const r = repoWithHook("repo");
    const { live, svc } = build();
    live.setChoice("worktreeInit", r, false);
    recordTrust(r, hookDefHash(hook), "session");
    expect(live.covering(r)).toBeNull();
    expect(fs.existsSync(path.join(root, "cfg", "pi-trust-overrides.json"))).toBe(false);
    expect(fs.existsSync(path.join(home, ".pi", "dashboard", "worktree-init-trust.json"))).toBe(false);
    expect(svc.readSnapshot() === null || svc.readSnapshot()?.liveCount === 0).toBe(true);

    // simulated restart: fresh process memory
    __resetSessionTrust();
    const second = build();
    expect(second.live.enumerate().candidates).toHaveLength(0);
    recordTrust(r, hookDefHash(hook), "session"); // new dialog, no stored choice
    expect(second.live.covering(r)).not.toBeNull();
  });
});

describe("#E14 recorded identity", () => {
  it("a deleted-and-re-created session-trusted folder and YOLO root no longer match", async () => {
    const r = repoWithHook("repo");
    const w = mkdir("w");
    const { live } = build();
    recordTrust(r, hookDefHash(hook), "session");
    await yolo.activate({ durationMs: 15 * MIN, base: w });

    for (const [dir, kind] of [[r, "worktreeInit"], [w, "yolo"]] as const) {
      const entry = live.covering(dir);
      expect(entry?.sourceKind).toBe(kind);
      expect(identityMatches(entry!.identity, statFolderIdentity(dir))).toBe(true);
    }

    const decoys: string[] = [];
    for (const dir of [r, w]) {
      fs.rmSync(dir, { recursive: true, force: true });
      decoys.push(mkdir(`decoy-${path.basename(dir)}`)); // occupy a freed inode
      fs.mkdirSync(dir);
      if (dir === r) {
        fs.mkdirSync(path.join(r, ".pi"));
        fs.writeFileSync(path.join(r, ".pi", "settings.json"), JSON.stringify({ worktreeInit: hook }));
      }
    }
    for (const dir of [r, w]) {
      const entry = live.covering(dir);
      expect(entry, dir).not.toBeNull();
      expect(identityMatches(entry!.identity, statFolderIdentity(dir)), dir).toBe(false);
    }
  });

  it("an unstatable folder at creation never counts, even once it exists", async () => {
    const gone = path.join(root, "later");
    const { live } = build();
    // session grant on a missing path: recorded, but no identity can be taken
    recordGrant({ subject: gone, scope: "session" });
    live.setChoice("accessGrants", gone, true);
    fs.mkdirSync(gone);
    fs.mkdirSync(path.join(gone, ".git"));
    expect(live.covering(gone)).toBeNull();
  });
});

describe("#E23 server consumers see live trust", () => {
  it("host.isProjectTrusted is true with the worktree-init (until dashboard restarts) source", () => {
    const r = repoWithHook("repo");
    const { svc } = build();
    setPiTrustMirror(svc);
    recordTrust(r, hookDefHash(hook), "session");
    const host = createHostProjectTrustService({
      hasTrustRequiringResources: () => true,
      recordedEntry: () => null,
      defaultProjectTrust: () => "ask",
      mirror: { enabled: () => true, covering: (cwd) => coveringDashboardEntry(cwd, home) },
    });
    expect(host.isProjectTrusted(r)).toBe(true);
    expect(host.projectTrustSource(r)).toEqual({
      kind: "dashboard",
      sourceKind: "worktreeInit",
      entry: r,
      lifetime: "until dashboard restarts",
    });
    revokeTrust(r, hookDefHash(hook));
    expect(host.isProjectTrusted(r)).toBe(false);
  });

  it("the resource-toggle view of dashboard trust stays durable-only", () => {
    const r = repoWithHook("repo");
    const { svc } = build();
    setPiTrustMirror(svc);
    recordTrust(r, hookDefHash(hook), "session");
    expect(coveringDashboardEntry(r, home, { live: false })).toBeNull();
  });
});

describe("#E24 YOLO liveness re-check", () => {
  it("isStillLive turns false once the clock crosses the expiry after the lookup", async () => {
    const w = mkdir("w");
    const { live } = build();
    await yolo.activate({ durationMs: 15 * MIN, base: w });
    const entry = live.covering(w);
    expect(entry).not.toBeNull();
    expect(live.isStillLive(entry!)).toBe(true);
    clock += 15 * MIN; // crosses T
    expect(live.isStillLive(entry!)).toBe(false);
  });

  it("isStillLive is false after end and when the source is switched off", async () => {
    const w = mkdir("w");
    const { live } = build();
    await yolo.activate({ durationMs: 15 * MIN, base: w });
    const entry = live.covering(w)!;
    cfg.sources.yolo = false;
    expect(live.isStillLive(entry)).toBe(false);
    cfg.sources.yolo = true;
    yolo.end();
    expect(live.isStillLive(entry)).toBe(false);
  });
});

describe("#X4 snapshot write failure never fails the action", () => {
  it("grant succeeds, one warning, disk unchanged", () => {
    const proj = mkdir("proj");
    fs.mkdirSync(path.join(proj, ".git"));
    const { live, svc } = build();
    live.setChoice("accessGrants", proj, true);
    svc.rebuildAtBoot();
    const file = path.join(root, "cfg", "pi-trust-mirror.json");
    const before = fs.readFileSync(file, "utf8");
    fs.chmodSync(path.join(root, "cfg"), 0o500);
    try {
      if (process.getuid?.() === 0) return; // root ignores directory modes
      const result = recordGrant({ subject: proj, scope: "session" });
      expect(result.ok).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(fs.readFileSync(file, "utf8")).toBe(before);
    } finally {
      fs.chmodSync(path.join(root, "cfg"), 0o700);
    }
  });
});

describe("#X5 boot resets the count", () => {
  it("a snapshot left with liveCount 3 is rewritten to 0 at boot", () => {
    fs.mkdirSync(path.join(root, "cfg"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "cfg", "pi-trust-mirror.json"),
      JSON.stringify({ version: 1, generation: 9, entries: [], liveCount: 3 }),
    );
    const { svc } = build();
    expect(liveCount(svc)).toBe(3);
    svc.rebuildAtBoot();
    expect(liveCount(svc)).toBe(0);
  });
});
