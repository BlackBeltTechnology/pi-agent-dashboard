/**
 * Tests for server-derived OpenSpec readiness (add-openspec-init-affordances).
 *
 * Covers:
 *   - `deriveOpenSpecReadiness` precedence decision table (E1–E13, E16, E19)
 *   - config-root resolution for `hasOpenSpecSkills` incl. worktree
 *     inheritance + unresolvable fallback (E14, E15, X11)
 *   - per-tick signature provider memoization + invalidation (P1, P2, X10)
 *   - memoized per-cwd stat-pass cost (P4)
 *   - `reconfigurePolling` readiness diffing (E24, E25, E26)
 *
 * See change: add-openspec-init-affordances.
 */

import { DEFAULT_OPENSPEC_POLL } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { DashboardSession, OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDirectoryService, type DirectoryService } from "../directory-service.js";
import { deriveOpenSpecReadiness, type ReadinessInputs } from "../openspec/readiness.js";
import type { PreferencesStore } from "../persistence/preferences-store.js";
import type { SessionManager } from "../session/memory-session-manager.js";

// ── git-operations mock: resolveConfigRoot is faked (configurable per test);
// everything else stays real (folder-head-poll needs readHeadDisplayAsync).
let fakeConfigRoot: (cwd: string) => string | null = (cwd) => cwd;
let configRootCalls = 0;
vi.mock("../git-worktree/git-operations.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../git-worktree/git-operations.js")>();
  return {
    ...actual,
    resolveConfigRoot: (cwd: string) => {
      configRootCalls += 1;
      return fakeConfigRoot(cwd);
    },
  };
});

// Mock CLI entry points so polls are deterministic and spawn-free.
vi.mock("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js")
  >();
  return {
    ...actual,
    pollOpenSpecAsync: vi.fn(async () => ({ initialized: true, changes: [] })),
    runOpenSpecList: vi.fn(async () => ({ changes: [] })),
    runOpenSpecStatus: vi.fn(async () => null),
  };
});

vi.mock("../pi/pi-resource-scanner.js", () => ({
  scanPiResources: vi.fn(async () => ({
    local: { extensions: [], skills: [], prompts: [] },
    global: { extensions: [], skills: [], prompts: [] },
    packages: [],
  })),
}));
vi.mock("@blackbelt-technology/pi-dashboard-shared/state-replay.js", () => ({
  replayEntriesAsEvents: vi.fn(() => []),
}));
vi.mock("../session/session-discovery.js", () => ({
  discoverSessionsForCwd: vi.fn(() => []),
}));
vi.mock("../session/session-file-reader.js", () => ({
  loadSessionEntries: vi.fn(() => []),
}));
vi.mock("@earendil-works/pi-coding-agent", () => ({
  SessionManager: {
    list: vi.fn(async () => []),
    open: vi.fn(() => ({ getBranch: vi.fn(() => []) })),
  },
}));

function makePrefs(opts: {
  pinnedDirs?: string[];
  recordedSignature?: string;
  setOpenSpecUpdateSignature?: ReturnType<typeof vi.fn>;
} = {}): PreferencesStore {
  return {
    getPinnedDirectories: () => opts.pinnedDirs ?? [],
    getSessionOrder: () => ({}),
    setSessionOrder: vi.fn(),
    setPinnedDirectories: vi.fn(),
    pinDirectory: vi.fn(),
    unpinDirectory: vi.fn(),
    reorderPinnedDirs: vi.fn(),
    getFavoriteModels: () => [],
    setFavoriteModels: vi.fn(),
    addFavoriteModel: vi.fn(),
    removeFavoriteModel: vi.fn(),
    getWorkspaces: () => [],
    createWorkspace: vi.fn(() => null),
    renameWorkspace: vi.fn(() => false),
    deleteWorkspace: vi.fn(() => false),
    setWorkspaceCollapsed: vi.fn(() => false),
    addFolderToWorkspace: vi.fn(() => false),
    removeFolderFromWorkspace: vi.fn(() => false),
    moveFolderToWorkspace: vi.fn(() => false),
    reorderWorkspaceFolders: vi.fn(),
    reorderWorkspaces: vi.fn(),
    flush: vi.fn(),
    getDisplayPrefs: () => undefined,
    getOpenSpecUpdateSignature: () => opts.recordedSignature,
    getAutoInitWorktreeOnSpawn: () => false,
    getAutoNameSessions: () => true,
    setAutoNameSessions: vi.fn(),
    getLiveServers: () => [],
    setLiveServers: vi.fn(),
    setAutoInitWorktreeOnSpawn: vi.fn(),
    setOpenSpecUpdateSignature: opts.setOpenSpecUpdateSignature ?? vi.fn(),
    setDisplayPrefs: vi.fn((p) => p as any),
    dispose: vi.fn(),
  } as unknown as PreferencesStore;
}

function makeSessionMgr(sessions: DashboardSession[] = []): SessionManager {
  const map = new Map<string, DashboardSession>();
  for (const s of sessions) map.set(s.id, s);
  return {
    register: vi.fn(),
    restore: vi.fn(),
    unregister: vi.fn(),
    update: vi.fn(),
    get: (id: string) => map.get(id),
    listActive: () => Array.from(map.values()).filter((s) => s.status !== "ended"),
    listAll: () => Array.from(map.values()),
  } as unknown as SessionManager;
}

/** Minimal OpenSpecData builder for the pure derivation tests. */
function data(over: Partial<OpenSpecData>): OpenSpecData {
  return { initialized: false, changes: [], ...over };
}

function inputs(over: Partial<ReadinessInputs>): ReadinessInputs {
  return {
    enabled: true,
    optedOut: false,
    pending: false,
    hasOpenspecDir: true,
    initialized: true,
    ...over,
  };
}

/** Real fs fixture — hasOpenspecDir comes from a genuine stat. */
function mkProject(cwd: string, opts: { skills?: boolean } = {}): void {
  fs.mkdirSync(path.join(cwd, "openspec", "changes"), { recursive: true });
  if (opts.skills) {
    fs.mkdirSync(path.join(cwd, ".pi", "skills", "openspec-explore"), { recursive: true });
  }
}
function mkTmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "osx-readiness-"));
}

// ══════════════════════════════════════════════════════════════════
// Pure derivation — the precedence decision table
// ══════════════════════════════════════════════════════════════════

describe("deriveOpenSpecReadiness — precedence (add-openspec-init-affordances)", () => {
  it("E1: enabled:false dominates initialized:true → GLOBAL_OFF", () => {
    const r = deriveOpenSpecReadiness(inputs({ enabled: false }), data({ initialized: true }));
    expect(r).toEqual({ state: "GLOBAL_OFF" });
  });

  it("E2: opted-out + initialized:true → OPTED_OUT", () => {
    const r = deriveOpenSpecReadiness(inputs({ optedOut: true }), data({ initialized: true }));
    expect(r).toEqual({ state: "OPTED_OUT" });
  });

  it("E3: opted-out with no openspec/ → OPTED_OUT, not ABSENT", () => {
    const r = deriveOpenSpecReadiness(
      inputs({ optedOut: true, hasOpenspecDir: false, initialized: false }),
      data({ hasOpenspecDir: false, initialized: false }),
    );
    expect(r).toEqual({ state: "OPTED_OUT" });
  });

  it("E4: opted-out + broken → OPTED_OUT (no repair affordance derives from state)", () => {
    const r = deriveOpenSpecReadiness(
      inputs({ optedOut: true, initialized: false }),
      data({ initialized: false }),
      { breakReason: "missing-changes-dir" },
    );
    expect(r).toEqual({ state: "OPTED_OUT" });
  });

  it("E5: pending:true → PENDING", () => {
    const r = deriveOpenSpecReadiness(inputs({ pending: true }), data({ pending: true, hasOpenspecDir: true }));
    expect(r).toEqual({ state: "PENDING" });
  });

  it("E6: no openspec/, enabled, not opted out → ABSENT", () => {
    const r = deriveOpenSpecReadiness(
      inputs({ hasOpenspecDir: false, initialized: false }),
      data({ hasOpenspecDir: false, initialized: false }),
    );
    expect(r).toEqual({ state: "ABSENT" });
  });

  it("E7: hasOpenspecDir + !initialized + !pending → BROKEN", () => {
    const r = deriveOpenSpecReadiness(inputs({ initialized: false }), data({ initialized: false }));
    expect(r.state).toBe("BROKEN");
  });

  it("E8: openspec/ without changes/ → BROKEN reason missing-changes-dir", () => {
    const r = deriveOpenSpecReadiness(inputs({ initialized: false }), data({ initialized: false }), {
      breakReason: "missing-changes-dir",
    });
    expect(r).toEqual({ state: "BROKEN", reason: "missing-changes-dir" });
  });

  it("E9: openspec list non-array → BROKEN reason cli-failed", () => {
    const r = deriveOpenSpecReadiness(inputs({ initialized: false }), data({ initialized: false }), {
      breakReason: "cli-failed",
    });
    expect(r).toEqual({ state: "BROKEN", reason: "cli-failed" });
  });

  it("E10: skills absent + signature differs → STALE reason missing-skills wins", () => {
    const r = deriveOpenSpecReadiness(
      inputs({ hasOpenSpecSkills: false, recordedSignature: "old", currentSignature: "new" }),
      data({ initialized: true }),
    );
    expect(r).toEqual({ state: "STALE", reason: "missing-skills" });
  });

  it("E11: no recorded signature → READY, not STALE", () => {
    const r = deriveOpenSpecReadiness(
      inputs({ hasOpenSpecSkills: true, recordedSignature: undefined, currentSignature: "new" }),
      data({ initialized: true }),
    );
    expect(r).toEqual({ state: "READY" });
  });

  it("E12: recorded ≠ current → STALE reason profile-stale", () => {
    const r = deriveOpenSpecReadiness(
      inputs({ hasOpenSpecSkills: true, recordedSignature: "old", currentSignature: "new" }),
      data({ initialized: true }),
    );
    expect(r).toEqual({ state: "STALE", reason: "profile-stale" });
  });

  it("E13: zero-proposal project, skills present, sig matches → READY", () => {
    const r = deriveOpenSpecReadiness(
      inputs({ hasOpenSpecSkills: true, recordedSignature: "sig", currentSignature: "sig" }),
      data({ initialized: true, changes: [] }),
    );
    expect(r).toEqual({ state: "READY" });
  });

  it("E16: non-worktree missing skills → STALE reason missing-skills", () => {
    const r = deriveOpenSpecReadiness(
      inputs({ hasOpenSpecSkills: false }),
      data({ initialized: true }),
    );
    expect(r).toEqual({ state: "STALE", reason: "missing-skills" });
  });

  it("X10: current signature unavailable (provider failed) → no signature-based STALE", () => {
    const r = deriveOpenSpecReadiness(
      inputs({ hasOpenSpecSkills: true, recordedSignature: "old", currentSignature: undefined }),
      data({ initialized: true }),
    );
    expect(r).toEqual({ state: "READY" });
  });

  it("E19: offerInitialization does not alter BROKEN derivation (suppresses only ABSENT)", () => {
    // offerInitialization lives in cfg, not in the derivation inputs: a broken
    // project stays BROKEN under a fleet-off config by construction. The
    // render half (folder section still offers Repair) is covered client-side.
    const r = deriveOpenSpecReadiness(inputs({ initialized: false }), data({ initialized: false }), {
      breakReason: "missing-changes-dir",
    });
    expect(r.state).toBe("BROKEN");
  });

  it("hasOpenSpecSkills unknown (undefined) never marks STALE", () => {
    const r = deriveOpenSpecReadiness(inputs({ hasOpenSpecSkills: undefined }), data({ initialized: true }));
    expect(r).toEqual({ state: "READY" });
  });
});

// ══════════════════════════════════════════════════════════════════
// Through-the-service wiring
// ══════════════════════════════════════════════════════════════════

describe("DirectoryService — readiness fold wiring (add-openspec-init-affordances)", () => {
  let service: DirectoryService;
  let tmpRoot: string;

  beforeEach(() => {
    vi.clearAllMocks();
    configRootCalls = 0;
    fakeConfigRoot = (cwd) => cwd;
    tmpRoot = mkTmpRoot();
  });
  afterEach(() => {
    service?.stopPolling();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("attaches readiness GLOBAL_OFF on the disabled cleared payload", async () => {
    service = createDirectoryService(makePrefs(), makeSessionMgr(), { ...DEFAULT_OPENSPEC_POLL, enabled: false });
    const cleared = await service.refreshOpenSpec("/repo");
    expect(cleared.readiness).toEqual({ state: "GLOBAL_OFF" });
  });

  it("attaches readiness + hasOpenSpecSkills to a polled payload (STALE path)", async () => {
    const { runOpenSpecList } = await import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js");
    (runOpenSpecList as any).mockResolvedValue({ changes: [] });
    const repo = path.join(tmpRoot, "repo");
    mkProject(repo); // no skills dir → STALE missing-skills
    service = createDirectoryService(
      makePrefs({ recordedSignature: "sig" }),
      makeSessionMgr(),
      {},
      { currentGlobalSignature: vi.fn(async () => "sig") },
    );
    const out = await service.refreshOpenSpec(repo);
    expect(out.hasOpenSpecSkills).toBe(false);
    expect(out.readiness?.state).toBe("STALE");
    expect(out.readiness?.reason).toBe("missing-skills");
  });

  it("READY parity: initialized + skills + matching signature through the service", async () => {
    const { runOpenSpecList } = await import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js");
    (runOpenSpecList as any).mockResolvedValue({ changes: [] });
    const repo = path.join(tmpRoot, "repo");
    mkProject(repo, { skills: true });
    service = createDirectoryService(
      makePrefs({ recordedSignature: "sig" }),
      makeSessionMgr(),
      {},
      { currentGlobalSignature: vi.fn(async () => "sig") },
    );
    const out = await service.refreshOpenSpec(repo);
    expect(out.hasOpenSpecSkills).toBe(true);
    expect(out.readiness).toEqual({ state: "READY" });
  });

  it("E14: worktree cwd inherits the main checkout's skills answer via config root", async () => {
    const { runOpenSpecList } = await import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js");
    (runOpenSpecList as any).mockResolvedValue({ changes: [] });
    const mainRoot = path.join(tmpRoot, "main");
    const worktree = path.join(tmpRoot, "wt");
    mkProject(worktree); // polled cwd: openspec project, no own skills
    fs.mkdirSync(path.join(mainRoot, ".pi", "skills", "openspec-explore"), { recursive: true });
    fakeConfigRoot = (cwd) => (cwd === worktree ? mainRoot : cwd);

    service = createDirectoryService(
      makePrefs({ recordedSignature: "sig" }),
      makeSessionMgr(),
      {},
      { currentGlobalSignature: vi.fn(async () => "sig") },
    );
    const out = await service.refreshOpenSpec(worktree);
    expect(out.hasOpenSpecSkills).toBe(true);
    expect(out.readiness).toEqual({ state: "READY" });
  });

  it("E15/X11: unresolvable config root falls back to cwd, no throw, readiness still emitted", async () => {
    const { runOpenSpecList } = await import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js");
    (runOpenSpecList as any).mockResolvedValue({ changes: [] });
    const repo = path.join(tmpRoot, "repo");
    mkProject(repo, { skills: true });
    fakeConfigRoot = () => null;
    service = createDirectoryService(
      makePrefs(),
      makeSessionMgr(),
      {},
      { currentGlobalSignature: vi.fn(async () => "sig") },
    );
    const out = await service.refreshOpenSpec(repo);
    // Fallback stat found the skills AT the cwd — proves the fallback ran.
    expect(out.hasOpenSpecSkills).toBe(true);
    expect(out.readiness).toEqual({ state: "READY" }); // no recorded sig → never stale
  });

  it("P1: 20 cwds polled in one tick → signature provider called exactly once", async () => {
    const { runOpenSpecList } = await import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js");
    (runOpenSpecList as any).mockResolvedValue({ changes: [] });
    const provider = vi.fn(async () => "sig");
    const sessions = Array.from({ length: 20 }, (_, i) => {
      const cwd = path.join(tmpRoot, `repo-${i}`);
      mkProject(cwd, { skills: true }); // skills present → cwd reaches the signature check
      return { id: `s${i}`, cwd, status: "idle" } as unknown as DashboardSession;
    });
    service = createDirectoryService(
      makePrefs({ recordedSignature: "sig" }), // recorded sigs → each poll needs the signature
      makeSessionMgr(sessions),
      {},
      { currentGlobalSignature: provider },
    );

    // Drive one tick's worth of polls (no generation bump between them).
    await Promise.all(sessions.map((s) => service.pollDirectoryGated(s.cwd)));
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("P2: after invalidation the next tick recomputes the signature once (not stale-served)", async () => {
    const { runOpenSpecList } = await import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js");
    (runOpenSpecList as any).mockResolvedValue({ changes: [] });
    let current = "sig-a";
    const provider = vi.fn(async () => current);
    const repo = path.join(tmpRoot, "repo");
    mkProject(repo, { skills: true });
    service = createDirectoryService(
      makePrefs({ recordedSignature: "sig-a" }),
      makeSessionMgr(),
      {},
      { currentGlobalSignature: provider },
    );
    const a = await service.pollDirectoryGated(repo);
    expect(a.readiness).toEqual({ state: "READY" });

    // Profile save flips the global signature + invalidates the cache.
    current = "sig-b";
    service.invalidateOpenSpecSignatureCache();
    const b = await service.pollDirectoryGated(repo);
    expect(b.readiness).toEqual({ state: "STALE", reason: "profile-stale" });
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it("P4: 50-cwd stat pass is memoized per cwd — resolver called once per cwd across two ticks, fast", async () => {
    const { runOpenSpecList } = await import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js");
    (runOpenSpecList as any).mockResolvedValue({ changes: [] });
    const sessions = Array.from({ length: 50 }, (_, i) => {
      const cwd = path.join(tmpRoot, `repo-${i}`);
      mkProject(cwd);
      return { id: `s${i}`, cwd, status: "idle" } as unknown as DashboardSession;
    });
    service = createDirectoryService(
      makePrefs(),
      makeSessionMgr(sessions),
      // In-process derivation: isolates the stat-pass marginal cost from
      // worker-pool round-trips, which are not part of the P4 budget.
      { ...DEFAULT_OPENSPEC_POLL, useWorker: false },
      { currentGlobalSignature: async () => "sig" },
    );
    await Promise.all(sessions.map((s) => service.pollDirectoryGated(s.cwd)));
    const firstPassCalls = configRootCalls;
    const t0 = performance.now();
    await Promise.all(sessions.map((s) => service.pollDirectoryGated(s.cwd)));
    const elapsed = performance.now() - t0;
    expect(firstPassCalls).toBe(50); // memoized: once per cwd, not once per tick
    expect(configRootCalls).toBe(50); // second tick adds zero resolver calls
    expect(elapsed).toBeLessThan(50); // P4 threshold: added wall time < 50ms
  });

  it("X10: signature provider failure → readiness still emitted, no cwd falsely STALE", async () => {
    const { runOpenSpecList } = await import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js");
    (runOpenSpecList as any).mockResolvedValue({ changes: [] });
    const provider = vi.fn(async () => {
      throw new Error("cli spawn failed");
    });
    const repo = path.join(tmpRoot, "repo");
    mkProject(repo, { skills: true });
    service = createDirectoryService(
      makePrefs({ recordedSignature: "old" }),
      makeSessionMgr(),
      {},
      { currentGlobalSignature: provider },
    );
    const out = await service.refreshOpenSpec(repo);
    expect(out.readiness?.state).not.toBe("STALE");
    expect(out.readiness).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════
// reconfigurePolling — readiness diffing
// ══════════════════════════════════════════════════════════════════

describe("DirectoryService — reconfigurePolling readiness diffing (add-openspec-init-affordances)", () => {
  let service: DirectoryService;
  let tmpRoot: string;

  beforeEach(() => {
    vi.clearAllMocks();
    configRootCalls = 0;
    fakeConfigRoot = (cwd) => cwd;
    tmpRoot = mkTmpRoot();
  });
  afterEach(() => {
    service?.stopPolling();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  async function seedTwoCwds() {
    const { runOpenSpecList } = await import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js");
    (runOpenSpecList as any).mockResolvedValue({ changes: [] });
    const a = path.join(tmpRoot, "a");
    const b = path.join(tmpRoot, "b");
    mkProject(a);
    mkProject(b);
    service = createDirectoryService(makePrefs(), makeSessionMgr());
    await service.refreshOpenSpec(a);
    await service.refreshOpenSpec(b);
    const broadcasts: Array<{ cwd: string; d: OpenSpecData }> = [];
    service.startPolling((cwd, d) => broadcasts.push({ cwd, d }));
    return { broadcasts, a, b };
  }

  it("E24: reconfigure changing only pollIntervalSeconds → no readiness re-broadcast", async () => {
    const { broadcasts } = await seedTwoCwds();
    service.reconfigurePolling({ ...DEFAULT_OPENSPEC_POLL, pollIntervalSeconds: 120 });
    expect(broadcasts).toEqual([]);
  });

  it("E25: adding one cwd to optOutDirectories → only that cwd re-broadcast", async () => {
    const { broadcasts, a } = await seedTwoCwds();
    service.reconfigurePolling({ ...DEFAULT_OPENSPEC_POLL, optOutDirectories: [a] });
    expect(broadcasts.map((x) => x.cwd)).toEqual([a]);
    expect(broadcasts[0]!.d.readiness).toEqual({ state: "OPTED_OUT" });
  });

  it("E25b: removing a cwd from optOutDirectories re-broadcasts only that cwd (no longer OPTED_OUT)", async () => {
    const { broadcasts, a } = await seedTwoCwds();
    // First make `a` opted out so the removal edge is observable.
    service.reconfigurePolling({ ...DEFAULT_OPENSPEC_POLL, optOutDirectories: [a] });
    broadcasts.length = 0;
    service.reconfigurePolling({ ...DEFAULT_OPENSPEC_POLL, optOutDirectories: [] });
    expect(broadcasts.map((x) => x.cwd)).toEqual([a]);
    expect(broadcasts[0]!.d.readiness?.state).not.toBe("OPTED_OUT");
  });

  it("E26: enabled flips true→false → every cleared payload carries readiness GLOBAL_OFF", async () => {
    const { broadcasts } = await seedTwoCwds();
    service.reconfigurePolling({ ...DEFAULT_OPENSPEC_POLL, enabled: false });
    expect(broadcasts.length).toBe(2);
    for (const b of broadcasts) {
      expect(b.d.readiness).toEqual({ state: "GLOBAL_OFF" });
      expect(b.d.initialized).toBe(false);
    }
  });

  it("offerInitialization flip re-broadcasts every cached cwd (global switch)", async () => {
    const { broadcasts, a, b } = await seedTwoCwds();
    service.reconfigurePolling({ ...DEFAULT_OPENSPEC_POLL, offerInitialization: false });
    expect(new Set(broadcasts.map((x) => x.cwd))).toEqual(new Set([a, b]));
  });

  it("opted-out cwd is not polled (poll gate)", async () => {
    const { runOpenSpecList } = await import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js");
    (runOpenSpecList as any).mockClear();
    const opted = path.join(tmpRoot, "opted");
    mkProject(opted);
    service = createDirectoryService(makePrefs(), makeSessionMgr(), {
      ...DEFAULT_OPENSPEC_POLL,
      optOutDirectories: [opted],
    });
    const out = await service.pollDirectoryGated(opted);
    expect(out.readiness).toEqual({ state: "OPTED_OUT" });
    expect(runOpenSpecList).not.toHaveBeenCalled();
  });
});
