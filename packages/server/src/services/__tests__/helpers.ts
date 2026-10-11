/**
 * Shared fixtures for the service-layer tests: a fake clock, a recording
 * command runner, a scriptable in-memory driver, and a manager factory rooted
 * in a throwaway directory. See change: add-service-registry-core.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DriverName, ServiceDefinition } from "@blackbelt-technology/pi-dashboard-shared/services/schema.js";
import Fastify, { type FastifyInstance } from "fastify";
import { createNetworkGuard } from "../../auth/localhost-guard.js";
import type { CommandRunner, RunResult } from "../command-runner.js";
import type { AdoptResult, DriverInstance, PresenceResult, ServiceDriver, StartContext, StopOutcome } from "../driver.js";
import { servicesPaths } from "../paths.js";
import { registerServiceRoutes } from "../routes.js";
import { ServiceManager, type ServiceManagerDeps } from "../service-manager.js";

export const DIGEST = `ghcr.io/x/docling@sha256:${"a".repeat(64)}`;

export function tmpRoot(prefix = "svc-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export class FakeClock {
  t = 1_000_000;
  now = () => this.t;
  sleep = async (ms: number) => {
    this.t += ms;
  };
  advance(ms: number) {
    this.t += ms;
  }
}

interface RunCall {
  file: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
}

/** Records every call; answers with `respond` (default: exit 0, empty output). */
export function recordingRunner(respond?: (file: string, args: string[]) => Partial<RunResult> | Promise<Partial<RunResult>>) {
  const calls: RunCall[] = [];
  const run: CommandRunner = async (file, args, opts) => {
    calls.push({ file, args: [...args], env: opts?.env });
    const r = (await respond?.(file, [...args])) ?? {};
    return { code: 0, stdout: "", stderr: "", timedOut: false, ...r };
  };
  return { run, calls };
}

/** A driver whose world is a plain object the test scripts. */
export class FakeDriver implements ServiceDriver {
  presenceResult: PresenceResult = { ok: true };
  alive: boolean | "unknown" = true;
  stopOutcome: StopOutcome = "stopped";
  adoptResult: AdoptResult | (() => AdoptResult) = { kind: "none" };
  startable = true;
  stoppable = true;
  startDelayMs = 0;
  startError?: Error;
  endpoints: Record<string, string> = { http: "http://127.0.0.1:41000" };
  startedBy: "dashboard" | "external" = "dashboard";
  calls = { start: 0, stop: 0, presence: 0, adopt: 0, remove: [] as Array<{ purgeData: boolean }> };
  lastCtx?: StartContext;

  constructor(readonly name: DriverName = "oci:docker", private readonly delay: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))) {}

  async presence(): Promise<PresenceResult> {
    this.calls.presence++;
    return this.presenceResult;
  }
  canStart(): boolean {
    return this.startable;
  }
  canStop(): boolean {
    return this.stoppable;
  }
  async start(_def: ServiceDefinition, ctx: StartContext): Promise<DriverInstance> {
    this.calls.start++;
    this.lastCtx = ctx;
    if (this.startDelayMs) await this.delay(this.startDelayMs);
    if (this.startError) throw this.startError;
    return { driver: this.name, startedBy: this.startedBy, endpoints: { ...this.endpoints }, defHash: ctx.defHash, pid: 4242 };
  }
  async isAlive(): Promise<boolean | "unknown"> {
    return this.alive;
  }
  async stop(): Promise<StopOutcome> {
    this.calls.stop++;
    return this.stopOutcome;
  }
  async adopt(): Promise<AdoptResult> {
    this.calls.adopt++;
    return typeof this.adoptResult === "function" ? this.adoptResult() : this.adoptResult;
  }
  async remove(_def: ServiceDefinition, _iid: string, opts: { purgeData: boolean }): Promise<void> {
    this.calls.remove.push(opts);
  }
}

export function ociDef(overrides: Partial<ServiceDefinition> = {}): ServiceDefinition {
  return {
    id: "docling",
    mode: "managed",
    drivers: ["oci:docker"],
    oci: { image: DIGEST, ports: { http: { container: 5001, protocol: "http" } } },
    health: { kind: "http", endpoint: "http", path: "/health" },
    origin: "user",
    ...overrides,
  } as ServiceDefinition;
}

export function writeDefinitions(root: string, services: unknown[], instanceId = "iid-1"): void {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "services.json"), JSON.stringify({ schemaVersion: 1, instanceId, services }, null, 2));
}

export interface Harness {
  root: string;
  manager: ServiceManager;
  clock: FakeClock;
  logs: string[];
  probeOk: { value: boolean };
  probes: { count: number };
}

export function makeManager(
  root: string,
  opts: Partial<ServiceManagerDeps> & { drivers?: ServiceManagerDeps["drivers"]; clock?: FakeClock } = {},
): Harness {
  const clock = opts.clock ?? new FakeClock();
  const logs: string[] = [];
  const probeOk = { value: true };
  const probes = { count: 0 };
  const manager = new ServiceManager({
    ...opts,
    paths: servicesPaths(root),
    run: opts.run ?? recordingRunner().run,
    resolveBinary: opts.resolveBinary ?? ((n) => `/usr/bin/${n}`),
    now: clock.now,
    sleep: clock.sleep,
    log: (l) => logs.push(l),
    discoverOffers: opts.discoverOffers ?? (() => ({ offers: [], errors: [] })),
    probe:
      opts.probe ??
      (async () => {
        probes.count++;
        return probeOk.value;
      }),
    exposure: opts.exposure ?? (async () => "loopback"),
    lockOptions: { waitMs: 5_000, pollMs: 10, ...(opts.lockOptions ?? {}) },
    startPollMs: opts.startPollMs ?? 1_000,
  });
  return { root, manager, clock, logs, probeOk, probes };
}

// ── REST app + fetch adapter ────────────────────────────────────────────────


/** A minimal app: network guard + the service routes (loopback inject = locally trusted). */
export async function buildApp(manager: ServiceManager, trusted: string[] = []): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorateRequest("isAuthenticated", false);
  registerServiceRoutes(app, { manager, networkGuard: createNetworkGuard(trusted) });
  await app.ready();
  return app;
}

/** `fetch` routed into `app.inject` — lets the CLI talk to an in-process server. */
export function injectFetch(getApp: () => FastifyInstance | null): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const app = getApp();
    if (!app) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    const u = new URL(String(input));
    const r = await app.inject({
      method: (init?.method ?? "GET") as "GET",
      url: u.pathname + u.search,
      headers: (init?.headers ?? {}) as Record<string, string>,
      ...(init?.body !== undefined ? { payload: String(init.body) } : {}),
    });
    return new Response(r.body === "" ? null : r.body, { status: r.statusCode, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}
