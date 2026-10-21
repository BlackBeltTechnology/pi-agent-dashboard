/**
 * The REST workflow-schema route and the poll share ONE spawn semaphore:
 * #P9 a route validate never overlaps a poll `status --all` spawn at cap 1,
 * #P10 a `reconfigurePolling` resize reaches the route.
 * See change: move-workflow-schema-status-to-poll-worker.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULT_OPENSPEC_POLL } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDirectoryService, type DirectoryService } from "../directory-service.js";
import type { CliCall } from "../openspec/workflow-schema.js";
import type { PreferencesStore } from "../persistence/preferences-store.js";
import { registerOpenSpecRoutes } from "../routes/openspec-routes.js";
import type { SessionManager } from "../session/memory-session-manager.js";
import { createFixtureCli, mkTmpCwd, seedChanges } from "./helpers/status-all-fixture.js";
import { makeFakeCli, mkRepo, stubDeps, writeSchemaDir } from "./helpers/workflow-schema-fixtures.js";

const h = vi.hoisted(() => ({ statusAll: null as null | ((cwd: string) => Promise<unknown>) }));
vi.mock("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@blackbelt-technology/pi-dashboard-shared/openspec-poller.js")>()),
  runOpenSpecStatusAll: vi.fn((cwd: string) => h.statusAll!(cwd)),
  runOpenSpecList: vi.fn(async () => null),
  runOpenSpecStatus: vi.fn(async () => null),
}));
vi.mock("../pi/pi-resource-scanner.js", () => ({
  scanPiResources: vi.fn(async () => ({ local: { extensions: [], skills: [], prompts: [] }, global: { extensions: [], skills: [], prompts: [] }, packages: [] })),
}));
vi.mock("../session/session-discovery.js", () => ({ discoverSessionsForCwd: vi.fn(() => []) }));

const prefs = (cwds: string[]) =>
  ({ getPinnedDirectories: () => cwds, getOpenSpecUpdateSignature: () => undefined, getWorkspaces: () => [], flush: vi.fn(), dispose: vi.fn() }) as unknown as PreferencesStore;
const sessions = (cwds: string[]) =>
  ({ register: vi.fn(), unregister: vi.fn(), update: vi.fn(), get: () => undefined, listActive: () => [], listAll: () => cwds.map((cwd) => ({ id: `s-${cwd}`, cwd })) }) as unknown as SessionManager;

let fastify: FastifyInstance | undefined;
let service: DirectoryService | undefined;
const dirs: string[] = [];
afterEach(async () => {
  await fastify?.close();
  service?.stopPolling();
  fastify = service = undefined;
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
beforeEach(() => {
  h.statusAll = createFixtureCli().run;
});

/** A project whose schema stamp is `newer`, so `remove` runs the local `schema validate`. */
function newerRepo(): string {
  const root = mkRepo({ config: "schema: spec-driven\n" });
  dirs.push(root);
  writeSchemaDir(root, { base: "1.12.0", patch: 1 });
  return root;
}

async function boot(maxConcurrentSpawns: number, repos: string[], cli: (call: CliCall, ctx: { cwd: string }) => Promise<unknown>) {
  service = createDirectoryService(
    prefs(repos),
    sessions(repos),
    { ...DEFAULT_OPENSPEC_POLL, useWorker: false, maxConcurrentSpawns },
    { openspecVersionResolver: async () => "1.11.0" },
  );
  const fake = makeFakeCli();
  fastify = Fastify();
  registerOpenSpecRoutes(fastify, {
    sessionManager: sessions(repos),
    preferencesStore: prefs(repos),
    directoryService: service,
    networkGuard: async () => {},
    getOpenSpecConfig: () => ({ enabled: true, optOutDirectories: [], workflowSchema: { defaultForNewProjects: false } }),
    // The wiring under test (`server.ts`): the route gets the directory service's semaphore.
    spawnSemaphore: service.semaphore,
    workflowSchemaDeps: stubDeps(fake, {
      cli: async (call, ctx) => (call.op === "validate" && !ctx.cwd.includes("pi-wfs-") ? ((await cli(call, ctx)) as never) : fake.cli(call, ctx)),
    }),
  });
  await fastify.ready();
  return service;
}
const remove = (cwd: string) =>
  fastify!.inject({ method: "POST", url: "/api/openspec/workflow-schema", payload: { cwd, action: "remove", confirm: true } });
const flush = (ms = 40) => new Promise((r) => setTimeout(r, ms));

describe("route and poll share one spawn semaphore", () => {
  it("#P9 at cap 1 the route's schema validate starts only after the poll's status --all spawn ends", async () => {
    const pollCwd = mkTmpCwd("ds-shared-sem");
    dirs.push(pollCwd);
    seedChanges(pollCwd, 1);
    const root = newerRepo();
    const events: string[] = [];
    let releasePoll!: () => void;
    const pollGate = new Promise<void>((r) => (releasePoll = r));
    const fixture = createFixtureCli();
    h.statusAll = async (cwd) => {
      events.push("statusAll:start");
      await pollGate;
      events.push("statusAll:end");
      return fixture.run(cwd);
    };
    await boot(1, [pollCwd, root], async () => {
      events.push("validate:start");
      return { ok: true, stdout: JSON.stringify({ valid: true }) };
    });
    const poll = service!.pollDirectoryGated(pollCwd);
    await vi.waitFor(() => expect(events).toContain("statusAll:start"));
    const route = remove(root);
    await flush(); // the validate is queued behind the poll's spawn
    expect(events).toEqual(["statusAll:start"]);
    releasePoll();
    await poll;
    expect((await route).statusCode).toBe(200);
    // (the route's forced refresh may add a later poll spawn; only the first three matter)
    expect(events.slice(0, 3)).toEqual(["statusAll:start", "statusAll:end", "validate:start"]);
  });

  it("#P10 a reconfigurePolling resize (1 → 3) reaches the route: two validates run concurrently", async () => {
    const a = newerRepo();
    const b = newerRepo();
    let active = 0;
    let peak = 0;
    await boot(1, [a, b], async () => {
      active++;
      peak = Math.max(peak, active);
      await flush(60);
      active--;
      return { ok: true, stdout: JSON.stringify({ valid: true }) };
    });
    service!.reconfigurePolling({ ...DEFAULT_OPENSPEC_POLL, useWorker: false, maxConcurrentSpawns: 3 });
    const res = await Promise.all([remove(a), remove(b)]);
    expect(res.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(peak).toBe(2);
  });
});
