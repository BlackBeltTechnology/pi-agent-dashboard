/**
 * `GET /api/access/pi-trust` lists live (server-lifetime) entries with their
 * lifetime next to the durable ones (test-plan #F1/#F5 server half).
 * See change: mirror-dashboard-trust-live-remote.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PiTrustMirrorConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { hookDefHash } from "@blackbelt-technology/pi-dashboard-shared/worktree-init-hook.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetAccessGrants, listGrants } from "../access/access-grants.js";
import { createPiTrustLiveProvider } from "../access/pi-trust-live.js";
import { createPiTrustMirrorService, setPiTrustMirror } from "../access/pi-trust-mirror-service.js";
import { YoloController } from "../access/yolo-session.js";
import { __resetSessionTrust, listSessionTrust, recordTrust } from "../git-worktree/worktree-init-trust.js";
import { registerAccessRoutes } from "../routes/access-routes.js";

let root: string;
let app: FastifyInstance;
const MIN = 60_000;
const hook = { gate: "true", run: { type: "script" as const, command: "echo" } };

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-access-live-")));
  process.env.PI_ACCESS_GRANTS_STORE = path.join(root, "grants.json");
  __resetAccessGrants();
  __resetSessionTrust();
});
afterEach(async () => {
  await app?.close();
  setPiTrustMirror(undefined);
  delete process.env.PI_ACCESS_GRANTS_STORE;
  __resetAccessGrants();
  __resetSessionTrust();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("live rows on the Access page API", () => {
  it("lists session worktree trust and a YOLO root with their lifetimes, and explains an ignored live entry", async () => {
    const home = path.join(root, "home");
    fs.mkdirSync(home);
    const repo = path.join(root, "repo");
    fs.mkdirSync(path.join(repo, ".pi"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".pi", "settings.json"), JSON.stringify({ worktreeInit: hook }));
    const w = path.join(root, "w");
    fs.mkdirSync(w);
    const cfg: PiTrustMirrorConfig = {
      enabled: true,
      coverInteractive: false,
      liveQuery: true,
      sources: { worktreeInit: true, workflow: true, pinned: true, folderWorkspaces: true, accessGrants: false, yolo: true },
    };
    const clock = 1_000_000;
    const yolo = new YoloController({ now: () => clock, hostGateMode: () => "enforce", isRefused: () => false, ladder: async () => [], onLog: () => {} });
    const live = createPiTrustLiveProvider({
      getConfig: () => cfg,
      listSessionTrust,
      listSessionGrants: () => listGrants().filter((g) => g.scope === "session"),
      getYolo: () => yolo,
      home,
      now: () => clock,
      denyRules: () => ({ exact: [], subtree: [] }),
    });
    setPiTrustMirror(
      createPiTrustMirrorService({
        getConfig: () => cfg,
        listPinned: () => [],
        listWorkspaceFolders: () => [],
        listWorktreeTrust: () => [],
        listPersistedGrants: () => [],
        snapshotPath: path.join(root, "snap.json"),
        overridesPath: path.join(root, "over.json"),
        home,
        denyRules: () => ({ exact: [], subtree: [] }),
        warn: () => {},
        live,
      }),
    );
    recordTrust(repo, hookDefHash(hook), "session");
    await yolo.activate({ durationMs: 15 * MIN, base: w });

    app = Fastify({ logger: false });
    registerAccessRoutes(app, {
      networkGuard: async () => undefined,
      preferencesStore: { getPinnedDirectories: () => [], unpinDirectory: () => {} } as never,
      writeConfigPartial: () => ({ success: true }),
    });
    await app.ready();
    const body = (await app.inject({ method: "GET", url: "/api/access/pi-trust" })).json();
    const effective = body.data.effective as Array<Record<string, unknown>>;
    expect(effective).toContainEqual(expect.objectContaining({ folder: repo, sourceKind: "worktreeInit", live: true, lifetime: { kind: "restart" } }));
    expect(effective).toContainEqual(
      expect.objectContaining({ folder: w, sourceKind: "yolo", sourceLabel: "YOLO session", live: true, lifetime: { kind: "yolo-until", until: clock + 15 * MIN } }),
    );

    // switching the YOLO source off moves its row to "ignored" with a reason
    cfg.sources.yolo = false;
    const off = (await app.inject({ method: "GET", url: "/api/access/pi-trust" })).json();
    expect(off.data.effective.some((e: { sourceKind: string }) => e.sourceKind === "yolo")).toBe(false);
    expect(off.data.ignored).toContainEqual(expect.objectContaining({ sourceKind: "yolo", folder: w, confers: false, reason: "source-off" }));
  });
});
