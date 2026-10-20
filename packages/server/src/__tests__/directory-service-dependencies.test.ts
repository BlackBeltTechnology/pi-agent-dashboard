/**
 * Dependency graph in the `status --all` poll: gate tracked paths (#E15),
 * TOCTOU cwd-level stamp (#E17) and the always-recomputed `dependencies`
 * field of TOCTOU-kept entries (#E14). Same real-tmp-tree fixture CLI as
 * `directory-service-status-all.test.ts`.
 *
 * See change: add-openspec-change-dependencies.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULT_OPENSPEC_POLL } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import * as poller from "@blackbelt-technology/pi-dashboard-shared/openspec-poller.js";
import type { OpenSpecChange, OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDirectoryService, type DirectoryService } from "../directory-service.js";
import type { PreferencesStore } from "../persistence/preferences-store.js";
import type { SessionManager } from "../session/memory-session-manager.js";
import { backdate, createFixtureCli, type FixtureCli, mkTmpCwd, seedChanges, touchFuture, writeFile } from "./helpers/status-all-fixture.js";

const h = vi.hoisted(() => ({ cli: null as null | { run: (cwd: string) => Promise<unknown> } }));

vi.mock("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js")>();
  return {
    ...actual,
    pollOpenSpecAsync: vi.fn(async () => ({ initialized: false, changes: [] })),
    runOpenSpecStatusAll: vi.fn((cwd: string) => h.cli!.run(cwd)),
    runOpenSpecList: vi.fn(async () => null),
    runOpenSpecStatus: vi.fn(async () => null),
  };
});
vi.mock("../pi/pi-resource-scanner.js", () => ({
  scanPiResources: vi.fn(async () => ({ local: { extensions: [], skills: [], prompts: [] }, global: { extensions: [], skills: [], prompts: [] }, packages: [] })),
}));
vi.mock("../session/session-discovery.js", () => ({ discoverSessionsForCwd: vi.fn(() => []) }));

const prefs = () =>
  ({
    getPinnedDirectories: () => [],
    getOpenSpecUpdateSignature: vi.fn(() => undefined),
    getWorkspaces: vi.fn(() => []),
    flush: vi.fn(),
    dispose: vi.fn(),
  }) as unknown as PreferencesStore;
const sessions = () =>
  ({ register: vi.fn(), unregister: vi.fn(), update: vi.fn(), get: () => undefined, listActive: () => [], listAll: () => [] }) as unknown as SessionManager;

describe("DirectoryService — dependency graph in the poll", () => {
  let cwd: string;
  let cli: FixtureCli;
  let service: DirectoryService;
  const cleanup: string[] = [];
  const data = (): OpenSpecData => service.getOpenSpecData(cwd) as OpenSpecData;
  const change = (name: string): OpenSpecChange => data().changes.find((c) => c.name === name)!;

  beforeEach(() => {
    vi.clearAllMocks();
    cwd = mkTmpCwd("ds-deps");
    cleanup.push(cwd);
    cli = createFixtureCli();
    h.cli = cli;
    service = createDirectoryService(prefs(), sessions(), { ...DEFAULT_OPENSPEC_POLL, useWorker: false }, { openspecVersionResolver: async () => "1.14.3" });
  });
  afterEach(() => {
    service?.stopPolling();
    for (const d of cleanup.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  /** Prime: cold poll + one gate hit, so the next tick's spawn count is the signal. */
  async function prime(): Promise<void> {
    await service.pollDirectoryGated(cwd);
    await service.pollDirectoryGated(cwd);
    expect(cli.calls).toBe(1);
    cli.calls = 0;
  }

  describe("#E15 gate tracked paths", () => {
    beforeEach(() => {
      seedChanges(cwd, 3);
      backdate(path.join(cwd, "openspec"));
    });

    it("every poll payload carries the computed dependencies per change", async () => {
      await service.pollDirectoryGated(cwd);
      for (const c of data().changes) expect(c.dependencies).toBeDefined();
    });

    it("dependencies.yaml created for a change → next tick spawns", async () => {
      await prime();
      writeFile(cwd, "openspec/changes/c001/dependencies.yaml", "blocked_by: [c000]\n");
      await service.pollDirectoryGated(cwd);
      expect(cli.calls).toBe(1);
      expect(change("c001").dependencies?.blockedBy.map((e) => e.change)).toEqual(["c000"]);
      expect(change("c000").dependencies?.blocks).toEqual(["c001"]);
      await service.pollDirectoryGated(cwd);
      expect(cli.calls).toBe(1); // stable
    });

    it("a main spec created and then deleted for a touched capability → spawns each time", async () => {
      await prime();
      writeFile(cwd, "openspec/specs/cap/spec.md", "## Purpose\n");
      await service.pollDirectoryGated(cwd);
      expect(cli.calls).toBe(1);
      // The capability is now born: no duplicate-capability warning any more.
      expect(change("c000").dependencies?.issues.map((i) => i.code)).not.toContain("duplicate-capability");
      await service.pollDirectoryGated(cwd);
      expect(cli.calls).toBe(1);
      fs.rmSync(path.join(cwd, "openspec/specs/cap"), { recursive: true });
      await service.pollDirectoryGated(cwd);
      expect(cli.calls).toBe(2);
      expect(change("c000").dependencies?.issues.map((i) => i.code)).toContain("duplicate-capability");
    });

    it("a change archived → next tick spawns and the edge turns satisfied", async () => {
      writeFile(cwd, "openspec/changes/c001/dependencies.yaml", "blocked_by: [c000]\n");
      backdate(path.join(cwd, "openspec"));
      await prime();
      expect(change("c001").dependencies?.wave).toBe(2);
      fs.mkdirSync(path.join(cwd, "openspec/changes/archive"), { recursive: true });
      fs.renameSync(path.join(cwd, "openspec/changes/c000"), path.join(cwd, "openspec/changes/archive/2026-10-01-c000"));
      await service.pollDirectoryGated(cwd);
      expect(cli.calls).toBe(1);
      expect(change("c001").dependencies?.blockedBy).toMatchObject([{ change: "c000", state: "satisfied" }]);
      expect(change("c001").dependencies?.wave).toBe(1);
    });

    it("capability ids absent from the stamp → the gate does not skip", async () => {
      const { statusAllGateHit } = await import("../directory-service.js");
      await prime();
      // Build a cache like the service's, with and without capability ids.
      const pre = { cwdMtime: 5, names: ["c000"], changes: { c000: 7 } };
      const base = {
        allData: { initialized: true, changes: [] },
        allCwdMtime: 5,
        changes: new Map([["c000", { mtimeMs: 7, change: {} }]]),
      };
      expect(statusAllGateHit({ ...base, allCapIds: ["cap"] } as never, pre)).toBe(true);
      expect(statusAllGateHit({ ...base, allCapIds: null } as never, pre)).toBe(false);
    });
  });

  describe("TOCTOU", () => {
    beforeEach(() => {
      seedChanges(cwd, 3);
      backdate(path.join(cwd, "openspec"));
    });

    it("#E17 a change dir moved into archive/ during the call keeps the cwd stamp back; the next tick re-polls", async () => {
      await prime();
      touchFuture(path.join(cwd, "openspec/changes/c000/tasks.md"));
      cli.options.duringCall = () => {
        cli.options.duringCall = undefined;
        fs.mkdirSync(path.join(cwd, "openspec/changes/archive"), { recursive: true });
        fs.renameSync(path.join(cwd, "openspec/changes/c002"), path.join(cwd, "openspec/changes/archive/2026-10-01-c002"));
      };
      await service.pollDirectoryGated(cwd);
      expect(cli.calls).toBe(1);
      await service.pollDirectoryGated(cwd);
      expect(cli.calls).toBe(2);
      await service.pollDirectoryGated(cwd);
      expect(cli.calls).toBe(2); // stabilized
      expect(data().changes.map((c) => c.name)).not.toContain("c002");
    });

    it("#E14 a racy change keeps its previous entry but `dependencies` stays inverse", async () => {
      // c000 (a) blocked by c001 (b) through b's `Blocks:` label.
      writeFile(cwd, "openspec/changes/c001/proposal.md", "# b\n\n**Blocks:** `c000`\n");
      backdate(path.join(cwd, "openspec"));
      await service.pollDirectoryGated(cwd);
      expect(change("c000").dependencies?.blockedBy.map((e) => e.change)).toEqual(["c001"]);
      expect(change("c001").dependencies?.blocks).toEqual(["c000"]);
      const prevTotal = change("c001").totalTasks;

      // Something else changes first, so the tick spawns; then b drops the
      // label and b/tasks.md changes — both during the CLI call.
      touchFuture(path.join(cwd, "openspec/changes/c002/tasks.md"));
      cli.options.duringCall = () => {
        cli.options.duringCall = undefined;
        writeFile(cwd, "openspec/changes/c001/proposal.md", "# b\n");
        writeFile(cwd, "openspec/changes/c001/tasks.md", "- [x] a\n- [x] b\n- [x] c\n");
        touchFuture(path.join(cwd, "openspec/changes/c001/tasks.md"), 180_000);
      };
      cli.calls = 0;
      await service.pollDirectoryGated(cwd);
      expect(cli.calls).toBe(1);
      expect(change("c001").totalTasks).toBe(prevTotal); // kept (racy)
      expect(change("c000").dependencies?.blockedBy).toEqual([]);
      expect(change("c001").dependencies?.blocks).toEqual([]);
    });
  });

  it("#E18 on the fallback path (CLI without `status --all`) no change carries `dependencies`", async () => {
    seedChanges(cwd, 3);
    h.cli = { run: async () => ({ stdout: "", stderr: "error: unknown option '--all'", exitCode: 1 }) };
    vi.mocked(poller.runOpenSpecList).mockResolvedValue({
      changes: ["a", "b", "c"].map((name) => ({ name, status: "in-progress", completedTasks: 0, totalTasks: 1 })),
    } as never);
    vi.mocked(poller.runOpenSpecStatus).mockResolvedValue({ artifacts: [{ id: "proposal", status: "done" }], isComplete: false } as never);
    const out = await service.refreshOpenSpec(cwd);
    expect(out.changes).toHaveLength(3);
    for (const c of out.changes) expect("dependencies" in c).toBe(false);
  });
});
