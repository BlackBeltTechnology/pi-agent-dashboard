/**
 * Loopback inject passes the REAL route guards (tasks 3.3 / 5.5; test 8.28, test-plan #S10).
 *
 * The app mounts the server package's own guards in enforce mode — the host gate, the universal
 * `networkGuard` hook, the per-route `networkGuard` and the route-tier gate — in front of the three routes
 * the profiles call. The plugin helper `createLoopbackInject` must pass them with NO credential:
 *  - `requireLocalProof` off: all three succeed;
 *  - `requireLocalProof` on: the credential-less loopback READ (observe tier) still passes, the WRITES are
 *    refused `local_proof_required` (403) — the route's own answer, which the callers map (`sync_forbidden`,
 *    a typed launch failure) and never retry;
 *  - negative control: a request whose `Host` is not admitted is refused by the host gate, which is what the
 *    forced loopback `host` header prevents.
 * The git route's explicit `path` is checked against the real `addWorktree` of the server package.
 * See change: add-agent-teams-openspec.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeRuntimeHost } from "../../../__tests__/harness/index.js";
import { createExtensionPoints } from "../../extension-points.js";
import { createTeamsRuntime } from "../../runtime.js";
import { createLoopbackInject, type HostLocalRequestFn } from "../inject.js";
import { git, makeRepo } from "./git-env.js";
import { LIVE_TOKEN, listenGuardedApp } from "./live-guarded-app.js";

const SERVER = fileURLToPath(new URL("../../../../../server/src/", import.meta.url));
// biome-ignore lint/suspicious/noExplicitAny: the server package is loaded dynamically (no compile-time dependency on it)
type Any = any;
const load = (rel: string): Promise<Any> => import(/* @vite-ignore */ path.join(SERVER, rel));

const open: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((a) => a.close()));
});

async function guardedApp(requireLocalProof: boolean, onResponse?: () => void): Promise<FastifyInstance> {
  const [guard, tierGate, hostGate, localProof, hostState] = await Promise.all([
    load("auth/localhost-guard.ts"),
    load("auth/route-tier-gate.ts"),
    load("auth/host-gate.ts"),
    load("auth/local-proof.ts"),
    load("auth/host-gate.ts"),
  ]);
  const localTrust = localProof.createLocalTrustContext("tok", () => requireLocalProof);
  const app = Fastify({ logger: false });
  open.push(app);
  app.addHook("onRequest", hostGate.createHostGate(() => ({ admission: { publicBaseUrls: [], allowedHosts: ["dash.example"], bindHost: "0.0.0.0" }, mode: "enforce", envOverridden: false }), new hostState.HostGateState(), () => 8000));
  app.addHook("onRequest", guard.createNetworkGuardHook({ trustedNetworks: [], localTrust, logDenial: () => {} }));
  app.addHook("onRequest", tierGate.createRouteTierGate({ getTrustedNetworks: () => [], localTrust, logRefusal: () => {} }));
  if (onResponse) app.addHook("onResponse", async () => onResponse());
  const networkGuard = guard.createNetworkGuard([], { localTrust });
  app.post("/api/git/worktree", { preHandler: networkGuard }, async () => ({ success: true, data: { path: "/x", branch: "b" } }));
  app.post("/api/openspec/tasks/toggle", { preHandler: networkGuard }, async () => ({ success: true }));
  app.get("/api/openspec/tasks", { preHandler: networkGuard }, async () => ({ success: true, data: { tasks: [] } }));
  await app.ready();
  return app;
}

describe("the helper's credential-less loopback inject vs the real guards (8.28 #S10)", () => {
  it("requireLocalProof OFF: the git route, the toggle and the tasks read all succeed", async () => {
    const inject = createLoopbackInject(await guardedApp(false));
    const wt = await inject({ method: "POST", url: "/api/git/worktree", payload: { cwd: "/r", base: "develop" } });
    const toggle = await inject({ method: "POST", url: "/api/openspec/tasks/toggle", payload: { cwd: "/r" } });
    const read = await inject({ method: "GET", url: "/api/openspec/tasks?cwd=%2Fr&change=x" });
    expect([wt.statusCode, toggle.statusCode, read.statusCode]).toEqual([200, 200, 200]);
    expect(wt.body).toMatchObject({ success: true });
  });

  it("requireLocalProof ON: the observe-tier read passes; the writes are refused exactly as the route specifies (403, no retry)", async () => {
    let calls = 0;
    const app = await guardedApp(true, () => void calls++);
    const inject = createLoopbackInject(app);
    const read = await inject({ method: "GET", url: "/api/openspec/tasks?cwd=%2Fr&change=x" });
    expect(read.statusCode).toBe(200);
    const wt = await inject({ method: "POST", url: "/api/git/worktree", payload: { cwd: "/r", base: "develop" } });
    const toggle = await inject({ method: "POST", url: "/api/openspec/tasks/toggle", payload: { cwd: "/r" } });
    expect(wt.statusCode).toBe(403);
    expect(toggle.statusCode).toBe(403);
    expect(wt.body).toMatchObject({ success: false, error: "network_not_allowed", reason: "local_proof_required" });
    expect(calls).toBe(3); // one call each: the helper never retries
  });

  it("negative control: without an admitted Host the host gate refuses (what the forced loopback host prevents)", async () => {
    const app = await guardedApp(false);
    const bad = await app.inject({ method: "GET", url: "/api/openspec/tasks", headers: { host: "evil.example" }, remoteAddress: "127.0.0.1" });
    expect(bad.statusCode).toBe(403);
    // no host header at all: light-my-request defaults to `localhost:80`, itself a loopback literal (admitted)
    const none = await app.inject({ method: "GET", url: "/api/openspec/tasks", remoteAddress: "127.0.0.1" });
    expect(none.statusCode).toBe(200);
    const good = await app.inject({ method: "GET", url: "/api/openspec/tasks", headers: { host: "127.0.0.1" }, remoteAddress: "127.0.0.1" });
    expect(good.statusCode).toBe(200);
  });

  it("the helper sends no credential and no forwarding header (the request is genuinely local)", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const inject = createLoopbackInject({
      async inject(opts) {
        seen.push({ ...opts.headers, remoteAddress: opts.remoteAddress });
        return { statusCode: 200, body: "{}", json: () => ({}) };
      },
    });
    await inject({ method: "GET", url: "/api/openspec/tasks" });
    expect(seen[0]).toEqual({ host: "127.0.0.1", remoteAddress: "127.0.0.1" });
  });
});

describe("the git route honours an explicit path (3.3)", () => {
  it("the server's addWorktree creates exactly <repo>/.worktrees/os-<change> on os/<change> when given `path`", async () => {
    const repo = makeRepo();
    const ops = await load("git-worktree/git-operations.ts");
    const target = path.join(repo, ".worktrees", "os-fix-x");
    const res = ops.addWorktree({ cwd: repo, base: "develop", newBranch: "os/fix-x", path: target });
    expect(res).toMatchObject({ ok: true, path: target, branch: "os/fix-x" });
    expect(fs.existsSync(path.join(target, ".git"))).toBe(true);
    expect(git(repo, "rev-parse", "--abbrev-ref", "os/fix-x")).toBe("os/fix-x");
  });
});

describe("host.localRequest vs the REAL guards, strict requireLocalProof, a REAL listener (8.28 #S10)", () => {
  const hits: string[] = [];
  const routes = (app: FastifyInstance, { networkGuard }: { networkGuard: unknown }): void => {
    const pre = { preHandler: networkGuard as never };
    app.post("/api/git/worktree", pre, async () => (hits.push("worktree"), { success: true, data: { path: "/x", branch: "b" } }));
    app.post("/api/git/worktree/init", pre, async () => (hits.push("init"), { success: true }));
    app.post("/api/openspec/tasks/toggle", pre, async () => (hits.push("toggle"), { success: true }));
    app.get("/api/openspec/tasks", pre, async () => (hits.push("tasks"), { success: true, data: { tasks: [] } }));
    app.post("/api/shutdown", pre, async () => (hits.push("shutdown"), { success: true }));
  };
  const consumeOf = (service?: HostLocalRequestFn) => (<T,>(name: string): T | undefined => (name === "host.localRequest" ? (service as T | undefined) : undefined));
  const live: Array<{ close(): Promise<void> }> = [];
  afterEach(async () => {
    await Promise.all(live.splice(0).map((l) => l.close()));
    hits.length = 0;
  });
  const start = async (strict: boolean) => {
    const l = await listenGuardedApp(strict, routes);
    live.push(l);
    return l;
  };

  it("service present + requireLocalProof ON: the worktree, init and toggle WRITES and the tasks read all succeed end to end", async () => {
    const l = await start(true);
    const inject = createLoopbackInject(l.app, consumeOf(l.service));
    const wt = await inject({ method: "POST", url: "/api/git/worktree", payload: { cwd: "/r", base: "develop" } });
    const init = await inject({ method: "POST", url: "/api/git/worktree/init", payload: { cwd: "/r" } });
    const toggle = await inject({ method: "POST", url: "/api/openspec/tasks/toggle", payload: { cwd: "/r" } });
    const read = await inject({ method: "GET", url: "/api/openspec/tasks?cwd=%2Fr&change=x" });
    expect([wt.statusCode, init.statusCode, toggle.statusCode, read.statusCode]).toEqual([200, 200, 200, 200]);
    expect(wt.body).toMatchObject({ success: true, data: { branch: "b" } });
    expect(hits).toEqual(["worktree", "init", "toggle", "tasks"]);
  });

  it("control: the SAME listener refuses the credential-less fastify.inject write (the guards are real) while the service is admitted", async () => {
    const l = await start(true);
    const bare = await l.app.inject({ method: "POST", url: "/api/git/worktree", remoteAddress: "127.0.0.1", headers: { host: "127.0.0.1" }, payload: { cwd: "/r" } });
    expect(bare.statusCode).toBe(403);
    expect(bare.json()).toMatchObject({ reason: "local_proof_required" });
    expect(hits).toEqual([]);
  });

  it("service ABSENT + strict: falls back to fastify.inject and the write maps to the typed 403 local_proof_required", async () => {
    const l = await start(true);
    const inject = createLoopbackInject(l.app, consumeOf(undefined));
    const wt = await inject({ method: "POST", url: "/api/git/worktree", payload: { cwd: "/r", base: "develop" } });
    expect(wt.statusCode).toBe(403);
    expect(wt.body).toMatchObject({ success: false, error: "network_not_allowed", reason: "local_proof_required" });
    const read = await inject({ method: "GET", url: "/api/openspec/tasks?cwd=%2Fr&change=x" });
    expect(read.statusCode).toBe(200);
    expect(hits).toEqual(["tasks"]);
  });

  it("neither service nor fastify → rejects inject_unavailable", async () => {
    await expect(createLoopbackInject(undefined, consumeOf(undefined))({ method: "GET", url: "/api/openspec/tasks" })).rejects.toThrow("inject_unavailable");
  });

  it("a proof minted from the WRONG token is refused by the real verifier (the service is a client, not a bypass)", async () => {
    const l = await start(true);
    const { createHostLocalRequest } = await load("plugin-local-request.ts");
    const wrong: HostLocalRequestFn = createHostLocalRequest({ getToken: () => `${LIVE_TOKEN}-other`, host: "127.0.0.1", getPort: () => l.port });
    const res = await createLoopbackInject(undefined, consumeOf(wrong))({ method: "POST", url: "/api/git/worktree", payload: { cwd: "/r" } });
    expect(res.statusCode).toBe(403);
    expect(hits).toEqual([]);
  });

  const refusals: Array<[string, { method: "GET" | "POST"; url: string; payload?: unknown }, string]> = [
    ["absolute URL", { method: "GET", url: "http://127.0.0.1/api/openspec/tasks" }, "local_request_invalid_request"],
    ["dot-dot traversal", { method: "POST", url: "/api/git/worktree/../shutdown" }, "local_request_invalid_request"],
    ["non-allowlisted path (a real, guarded route)", { method: "POST", url: "/api/shutdown", payload: {} }, "local_request_path_not_allowed"],
    ["oversize body", { method: "POST", url: "/api/git/worktree", payload: { pad: "a".repeat(300 * 1024) } }, "local_request_body_too_large"],
  ];
  for (const [name, req, error] of refusals) {
    it(`refuses ${name} before anything is sent`, async () => {
      const l = await start(true);
      await expect(createLoopbackInject(l.app, consumeOf(l.service))(req)).rejects.toThrow(error);
      expect(hits).toEqual([]);
    });
  }

  it("an unsupported verb never reaches the host service; the proof and token are in no log or error", async () => {
    const l = await start(true);
    const spy = vi.fn(l.service);
    const inject = createLoopbackInject(l.app, consumeOf(spy));
    await expect(inject({ method: "DELETE", url: "/api/git/worktree" })).rejects.toThrow("local_request_path_not_allowed");
    expect(spy).not.toHaveBeenCalled();
    const errors: string[] = [];
    for (const req of [{ method: "POST" as const, url: "/api/git/worktree", payload: { cwd: "/r" } }, { method: "POST" as const, url: "/api/shutdown", payload: {} }]) {
      await inject(req).catch((e: Error) => errors.push(e.message));
    }
    const all = [...l.logs, ...errors, JSON.stringify(hits)].join("\n");
    expect(all).not.toContain(LIVE_TOKEN);
    expect(all).not.toMatch(/v1\.\d{13}\./);
  });
});

describe("runtime wiring: createTeamsRuntime hands the profile modules the service-backed inject", () => {
  const boot = (extra: Record<string, unknown>) => {
    const fake = createFakeRuntimeHost({ config: {} });
    const rt = createTeamsRuntime({ ...fake.host, ...extra } as never, {
      ext: createExtensionPoints(),
      starter: async () => undefined,
      templatesHost: { isProjectTrusted: () => true, knownFolderCwds: () => [], resolvePiAgentDir: () => fake.dataDir },
    });
    return rt;
  };

  it("with host.localRequest on the host (and no fastify) the module's inject calls the service", async () => {
    const calls: unknown[] = [];
    const service: HostLocalRequestFn = async (input) => (calls.push(input), { ok: true, statusCode: 200, body: { success: true } });
    const rt = boot({ consume: <T,>(n: string): T | undefined => (n === "host.localRequest" ? (service as T) : undefined) });
    const inject = rt.openspec?.inject;
    expect(inject).toBeTypeOf("function");
    expect(await (inject as NonNullable<typeof inject>)({ method: "POST", url: "/api/git/worktree", payload: { a: 1 } })).toEqual({ statusCode: 200, body: { success: true } });
    expect(calls).toEqual([{ method: "POST", url: "/api/git/worktree", body: { a: 1 } }]);
    rt.dispose();
  });

  it("an older host (no service) keeps the fastify.inject fallback", async () => {
    const seen: string[] = [];
    const fastify = { inject: async (o: { url: string }) => (seen.push(o.url), { statusCode: 200, body: "{}", json: () => ({}) }) };
    const rt = boot({ fastify, consume: <T,>(_n: string): T | undefined => undefined });
    const inject = rt.openspec?.inject;
    expect(inject).toBeTypeOf("function");
    await (inject as NonNullable<typeof inject>)({ method: "GET", url: "/api/openspec/tasks" });
    expect(seen).toEqual(["/api/openspec/tasks"]);
    rt.dispose();
  });
});
