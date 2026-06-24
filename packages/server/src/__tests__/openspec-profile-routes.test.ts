/**
 * HTTP-level tests for the OpenSpec profile-config endpoints added in
 * change: add-openspec-profile-settings:
 *   POST /api/openspec/config
 *   POST /api/openspec/update
 *   GET  /api/openspec/update-status
 *
 * The shared platform/openspec module is mocked so no real `openspec` CLI
 * runs and no global config file is touched.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerOpenSpecRoutes } from "../routes/openspec-routes.js";

const PASSTHRU_GUARD = async () => {};

// Mutable mock state, reset per test.
const mock = {
  configProfile: vi.fn(),
  update: vi.fn(),
  writeOpenSpecConfigFile: vi.fn(),
  globalWorkflows: ["propose", "explore", "apply", "archive"] as string[],
  globalProfile: "core" as string | undefined,
  // null => simulate a failed/unparseable `openspec config list`.
  configListResult: undefined as Record<string, unknown> | null | undefined,
  configListAsyncCalls: 0,
};

function currentConfigListValue(): Record<string, unknown> | null {
  if (mock.configListResult !== undefined) return mock.configListResult;
  return { profile: mock.globalProfile, workflows: mock.globalWorkflows };
}

// `openspec init` gate: only cwds whose openspec/ dir "exists" are projects.
// Test treats any cwd in `openspecRoots` as initialized.
const openspecRoots = new Set<string>();
vi.mock("../directory-service.js", () => ({
  hasOpenSpecRoot: (cwd: string) => openspecRoots.has(cwd),
}));

vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/openspec.js", () => ({
  configListOr: () => ({ workflows: mock.globalWorkflows }),
  configListOrAsync: async () => {
    mock.configListAsyncCalls += 1;
    return currentConfigListValue();
  },
  configProfile: (...a: any[]) => mock.configProfile(...a),
  update: (...a: any[]) => mock.update(...a),
  writeOpenSpecConfigFile: (...a: any[]) => mock.writeOpenSpecConfigFile(...a),
  // Real signature semantics so staleness assertions are meaningful.
  workflowSetSignature: (wf: string[]) =>
    Array.from(new Set(wf.map((w) => w.trim()).filter(Boolean))).sort().join("|"),
  // Global config dir = <fakeHome>/.config/openspec; parent (~/.config) must
  // be excluded from the project list.
  openSpecConfigFilePath: () => "/fake-home/.config/openspec/config.json",
  EXPANDED_WORKFLOWS: [
    "propose", "explore", "new", "continue", "ff",
    "apply", "verify", "sync", "archive", "bulk-archive", "onboard",
  ],
  CORE_WORKFLOWS: ["propose", "explore", "apply", "archive"],
}));

describe("openspec profile-config REST routes", () => {
  let fastify: FastifyInstance;
  let signatures: Record<string, string>;
  let sessionCwds: string[];
  let pinnedDirs: string[];

  beforeEach(() => {
    mock.configProfile.mockReset().mockReturnValue({ ok: true, value: "" });
    mock.update.mockReset().mockReturnValue({ ok: true, value: "" });
    mock.writeOpenSpecConfigFile.mockReset().mockReturnValue({ success: true });
    mock.globalWorkflows = ["propose", "explore", "apply", "archive"];
    mock.globalProfile = "core";
    mock.configListResult = undefined;
    mock.configListAsyncCalls = 0;
    signatures = {};
    sessionCwds = ["/proj/a"];
    pinnedDirs = ["/proj/b"];
    // By default both test projects are OpenSpec-initialized.
    openspecRoots.clear();
    openspecRoots.add("/proj/a");
    openspecRoots.add("/proj/b");
  });

  afterEach(async () => {
    if (fastify) await fastify.close();
  });

  async function setup() {
    fastify = Fastify();
    registerOpenSpecRoutes(fastify, {
      sessionManager: { listAll: () => sessionCwds.map((cwd) => ({ cwd })) } as any,
      preferencesStore: {
        getPinnedDirectories: () => pinnedDirs,
        getOpenSpecUpdateSignature: (cwd: string) => signatures[cwd],
        setOpenSpecUpdateSignature: (cwd: string, sig: string) => { signatures[cwd] = sig; },
      } as any,
      directoryService: { refreshOpenSpec: vi.fn(), getOpenSpecData: vi.fn() } as any,
      networkGuard: PASSTHRU_GUARD,
    });
    await fastify.ready();
  }

  // ── POST /api/openspec/config ──────────────────────────────────────

  it("core profile uses the CLI preset, not a JSON write", async () => {
    await setup();
    const res = await fastify.inject({
      method: "POST", url: "/api/openspec/config",
      payload: { profile: "core", workflows: ["propose", "explore", "apply", "archive"], cwd: "/proj/a" },
    });
    expect(res.statusCode).toBe(200);
    expect(mock.configProfile).toHaveBeenCalledWith(expect.objectContaining({ preset: "core" }));
    expect(mock.writeOpenSpecConfigFile).not.toHaveBeenCalled();
  });

  // The openspec CLI's getProfileWorkflows() only honors an explicit workflow
  // list when the persisted profile is "custom"; a literal "expanded" silently
  // degrades to the 4 core workflows on `openspec update`. So the dashboard
  // must persist "expanded" AS custom + the 11-workflow set.
  // See change: fix-openspec-expanded-profile-update.
  it("expanded profile persists AS custom with the full 11-workflow set", async () => {
    await setup();
    const res = await fastify.inject({
      method: "POST", url: "/api/openspec/config",
      payload: { profile: "expanded", workflows: [] },
    });
    expect(res.statusCode).toBe(200);
    expect(mock.writeOpenSpecConfigFile).toHaveBeenCalledWith(
      expect.objectContaining({ profile: "custom" }),
    );
    const arg = mock.writeOpenSpecConfigFile.mock.calls[0][0];
    expect(arg.workflows).toHaveLength(11);
    expect(arg.workflows).toContain("verify");
    expect(mock.configProfile).not.toHaveBeenCalled();
  });

  it("custom profile writes the supplied subset", async () => {
    await setup();
    const res = await fastify.inject({
      method: "POST", url: "/api/openspec/config",
      payload: { profile: "custom", workflows: ["propose", "apply", "archive"] },
    });
    expect(res.statusCode).toBe(200);
    expect(mock.writeOpenSpecConfigFile).toHaveBeenCalledWith({
      profile: "custom", workflows: ["propose", "apply", "archive"],
    });
  });

  it("rejects an invalid profile", async () => {
    await setup();
    const res = await fastify.inject({
      method: "POST", url: "/api/openspec/config",
      payload: { profile: "bogus" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 500 when the JSON write fails", async () => {
    mock.writeOpenSpecConfigFile.mockReturnValue({ success: false, error: "disk full" });
    await setup();
    const res = await fastify.inject({
      method: "POST", url: "/api/openspec/config",
      payload: { profile: "custom", workflows: ["propose"] },
    });
    expect(res.statusCode).toBe(500);
  });

  // ── POST /api/openspec/update ──────────────────────────────────────

  it("updates a single cwd and records its signature", async () => {
    mock.globalWorkflows = ["propose", "apply"];
    await setup();
    const res = await fastify.inject({
      method: "POST", url: "/api/openspec/update",
      payload: { cwd: "/proj/a" },
    });
    expect(res.statusCode).toBe(200);
    expect(mock.update).toHaveBeenCalledWith({ cwd: "/proj/a" });
    expect(signatures["/proj/a"]).toBe("apply|propose");
  });

  it("updates all known cwds (session + pinned); one failure does not abort others", async () => {
    mock.update.mockImplementation(({ cwd }: any) =>
      cwd === "/proj/a" ? { ok: false, error: { kind: "exit" } } : { ok: true, value: "" });
    await setup();
    const res = await fastify.inject({
      method: "POST", url: "/api/openspec/update",
      payload: { all: true },
    });
    expect(res.statusCode).toBe(200);
    const { results } = JSON.parse(res.payload).data;
    const byCwd = Object.fromEntries(results.map((r: any) => [r.cwd, r.success]));
    expect(byCwd["/proj/a"]).toBe(false);
    expect(byCwd["/proj/b"]).toBe(true);
    // Only the successful cwd got a recorded signature.
    expect(signatures["/proj/b"]).toBeDefined();
    expect(signatures["/proj/a"]).toBeUndefined();
  });

  it("heals a stale literal 'expanded' config to custom+11 before updating", async () => {
    // Disk still holds the broken literal "expanded" (older build / external CLI).
    // The update endpoint must rewrite it to custom+11 so `openspec update`
    // honors all workflows. See change: fix-openspec-expanded-profile-update.
    mock.globalProfile = "expanded";
    mock.globalWorkflows = ["propose", "explore", "new", "continue", "ff", "apply", "verify", "sync", "archive", "bulk-archive", "onboard"];
    await setup();
    const res = await fastify.inject({
      method: "POST", url: "/api/openspec/update", payload: { cwd: "/proj/a" },
    });
    expect(res.statusCode).toBe(200);
    expect(mock.writeOpenSpecConfigFile).toHaveBeenCalledWith(
      expect.objectContaining({ profile: "custom" }),
    );
    expect(mock.update).toHaveBeenCalledWith({ cwd: "/proj/a" });
  });

  it("does NOT rewrite the config when profile is already custom", async () => {
    mock.globalProfile = "custom";
    mock.globalWorkflows = ["propose", "apply"];
    await setup();
    await fastify.inject({
      method: "POST", url: "/api/openspec/update", payload: { cwd: "/proj/a" },
    });
    expect(mock.writeOpenSpecConfigFile).not.toHaveBeenCalled();
  });

  it("returns 400 when neither cwd nor all is provided", async () => {
    await setup();
    const res = await fastify.inject({ method: "POST", url: "/api/openspec/update", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("update all skips cwds where openspec init has not run", async () => {
    // /proj/b is a known dir but NOT openspec-initialized.
    openspecRoots.delete("/proj/b");
    await setup();
    const res = await fastify.inject({
      method: "POST", url: "/api/openspec/update",
      payload: { all: true },
    });
    const { results } = JSON.parse(res.payload).data;
    const cwds = results.map((r: any) => r.cwd);
    expect(cwds).toContain("/proj/a");
    expect(cwds).not.toContain("/proj/b");
  });

  // ── GET /api/openspec/update-status ────────────────────────────────

  it("classifies cwds as up-to-date / needs-update / unknown", async () => {
    mock.globalWorkflows = ["propose", "apply"];
    sessionCwds = ["/proj/fresh", "/proj/stale"];
    pinnedDirs = ["/proj/never"];
    openspecRoots.clear();
    for (const c of ["/proj/fresh", "/proj/stale", "/proj/never"]) openspecRoots.add(c);
    await setup();
    // fresh matches current signature; stale has an old one; never has none.
    signatures["/proj/fresh"] = "apply|propose";
    signatures["/proj/stale"] = "old-signature";

    const res = await fastify.inject({ method: "GET", url: "/api/openspec/update-status" });
    expect(res.statusCode).toBe(200);
    const { statuses } = JSON.parse(res.payload).data;
    const byCwd = Object.fromEntries(statuses.map((s: any) => [s.cwd, s.status]));
    expect(byCwd["/proj/fresh"]).toBe("up-to-date");
    expect(byCwd["/proj/stale"]).toBe("needs-update");
    expect(byCwd["/proj/never"]).toBe("unknown");
  });

  it("update-status computes the global signature once, not once per cwd", async () => {
    // Many projects must NOT trigger one (blocking) CLI read each — the profile
    // is global, so a single async read drives the whole response.
    sessionCwds = ["/proj/a", "/proj/b", "/proj/c", "/proj/d"];
    pinnedDirs = [];
    openspecRoots.clear();
    for (const c of sessionCwds) openspecRoots.add(c);
    await setup();
    const res = await fastify.inject({ method: "GET", url: "/api/openspec/update-status" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).data.statuses).toHaveLength(4);
    expect(mock.configListAsyncCalls).toBe(1);
  });

  it("update-status excludes cwds where openspec init has not run", async () => {
    sessionCwds = ["/proj/initialized", "/home", "/tmp"];
    pinnedDirs = [];
    openspecRoots.clear();
    openspecRoots.add("/proj/initialized");
    await setup();
    const res = await fastify.inject({ method: "GET", url: "/api/openspec/update-status" });
    const { statuses } = JSON.parse(res.payload).data;
    const cwds = statuses.map((s: any) => s.cwd);
    expect(cwds).toEqual(["/proj/initialized"]);
  });

  // ── GET /api/openspec/config (cwd optional) ───────────────────────

  it("GET config without cwd returns the global config", async () => {
    mock.globalWorkflows = ["propose", "explore", "apply", "archive"];
    await setup();
    const res = await fastify.inject({ method: "GET", url: "/api/openspec/config" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(body.data.workflows).toEqual(["propose", "explore", "apply", "archive"]);
  });

  it("GET config (cold read) reflects the saved profile via the async path", async () => {
    mock.globalProfile = "expanded";
    mock.globalWorkflows = ["propose", "explore", "new", "continue", "ff", "apply", "verify", "sync", "archive", "bulk-archive", "onboard"];
    await setup();
    const res = await fastify.inject({ method: "GET", url: "/api/openspec/config?cwd=/proj/a" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.profile).toBe("expanded");
    expect(body.data.workflows).toHaveLength(11);
    // Async (non-blocking) read path was used.
    expect(mock.configListAsyncCalls).toBe(1);
  });

  it("GET config re-surfaces custom+expanded-set as the 'expanded' alias", async () => {
    // Disk stores "expanded" as custom + the 11 workflows (CLI constraint), so
    // the read path must map it back to "expanded" for the Settings radio.
    // See change: fix-openspec-expanded-profile-update.
    mock.globalProfile = "custom";
    mock.globalWorkflows = ["propose", "explore", "new", "continue", "ff", "apply", "verify", "sync", "archive", "bulk-archive", "onboard"];
    await setup();
    const res = await fastify.inject({ method: "GET", url: "/api/openspec/config?cwd=/proj/a" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.profile).toBe("expanded");
    expect(body.data.workflows).toHaveLength(11);
  });

  it("GET config keeps a genuine custom subset as 'custom'", async () => {
    mock.globalProfile = "custom";
    mock.globalWorkflows = ["propose", "apply", "archive"];
    await setup();
    const res = await fastify.inject({ method: "GET", url: "/api/openspec/config?cwd=/proj/a" });
    const body = JSON.parse(res.payload);
    expect(body.data.profile).toBe("custom");
  });

  it("GET config warm read is served from cache without spawning again", async () => {
    mock.globalProfile = "expanded";
    await setup();
    await fastify.inject({ method: "GET", url: "/api/openspec/config?cwd=/proj/a" });
    await fastify.inject({ method: "GET", url: "/api/openspec/config?cwd=/proj/a" });
    // Second request hit the 30s cache; the CLI ran only once.
    expect(mock.configListAsyncCalls).toBe(1);
  });

  it("GET config returns safe defaults when the CLI read fails", async () => {
    mock.configListResult = null; // simulate failed/unparseable `openspec config list`
    await setup();
    const res = await fastify.inject({ method: "GET", url: "/api/openspec/config?cwd=/proj/a" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.data.profile).toBe("custom");
    expect(body.data.delivery).toBe("both");
    expect(body.data.workflows).toEqual([]);
  });

  it("excludes the global config dir's parent (~/.config) even though it has openspec/", async () => {
    // /fake-home/.config has an openspec/ child (the CLI global config dir),
    // so hasOpenSpecRoot is true — but it is NOT a project.
    sessionCwds = ["/proj/real", "/fake-home/.config"];
    pinnedDirs = [];
    openspecRoots.clear();
    openspecRoots.add("/proj/real");
    openspecRoots.add("/fake-home/.config");
    await setup();
    const res = await fastify.inject({ method: "GET", url: "/api/openspec/update-status" });
    const cwds = JSON.parse(res.payload).data.statuses.map((s: any) => s.cwd);
    expect(cwds).toContain("/proj/real");
    expect(cwds).not.toContain("/fake-home/.config");
  });
});
