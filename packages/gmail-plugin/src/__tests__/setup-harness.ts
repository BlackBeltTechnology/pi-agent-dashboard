/**
 * Shared harness for the automatic-setup tests: the Gmail routes over a
 * `FakeConsole` (behind a fake CDP socket) and a fake `browser.dedicated`
 * service, plus the same `RunDeps` for driving a `SetupRun` directly (needed
 * under fake timers). `autopilot` plays the human: answers decisions, ticks the
 * policy box, confirms publishing. See change: add-gmail-auto-setup.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterEach } from "vitest";
import { AccountStore, CLIENT_KEY } from "../server/accounts.js";
import { mountGmailRoutes } from "../server/routes.js";
import type { DedicatedBrowserService } from "../server/setup/browser-service.js";
import type { RunDeps } from "../server/setup/run.js";
import type { Timing } from "../server/setup/steps.js";
import type { SetupRunView } from "../shared/auto-setup.js";
import { type FakeBrowserOptions, fakeBrowserService } from "./fake-browser-service.js";
import { FakeConsole } from "./fake-console.js";
import { CLIENT, capturingLogger, memoryCredentials, TEST_ENDPOINTS } from "./fakes.js";

export const OWNER = "owner@example.com";
export const PID = "pi-dashboard-abc123";

/** Fast polling for real-timer tests; limits stay at their defaults. */
const FAST: Partial<Timing> = { pollMs: 2, markerWaitMs: 100, verifyWaitMs: 300, publishGracePolls: 3 };

const dirs: string[] = [];
const apps: Array<ReturnType<typeof Fastify>> = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

export interface HarnessOptions {
  browser?: FakeBrowserOptions;
  /** `consume("browser.dedicated")` returns undefined until `h.provide()`. */
  noService?: boolean;
  timing?: Partial<Timing>;
  /** A client is already configured. */
  client?: boolean;
  initial?: Record<string, Record<string, unknown>>;
  pluginConfig?: Record<string, unknown>;
}

export async function makeHarness(o: HarnessOptions = {}) {
  const downloadsDir = mkdtempSync(path.join(tmpdir(), "gmail-dl-"));
  dirs.push(downloadsDir);
  const console_ = new FakeConsole(downloadsDir);
  const browser = fakeBrowserService({ downloadsDir, ...o.browser });
  let service: DedicatedBrowserService | undefined = o.noService ? undefined : browser.service;
  const creds = memoryCredentials({ ...(o.client ? { [CLIENT_KEY]: { ...CLIENT } } : {}), ...(o.initial ?? {}) });
  const store = new AccountStore(creds);
  const logger = capturingLogger();
  const pluginConfig: Record<string, unknown> = { ...(o.pluginConfig ?? {}) };
  const configUpdates: Array<Record<string, unknown>> = [];
  const config = {
    get: () => ({ ...pluginConfig }),
    update: async (partial: Record<string, unknown>) => {
      configUpdates.push(partial);
      Object.assign(pluginConfig, partial);
    },
  };
  let ids = 0;
  const timing = { ...FAST, ...o.timing };
  const deps: RunDeps = {
    getService: () => service,
    store,
    logger,
    saveSetup: (partial) => config.update(partial),
    timing,
    wsFactory: console_.wsFactory,
    newId: () => `run-${++ids}`,
  };
  const app = Fastify();
  apps.push(app);
  await mountGmailRoutes(app, {
    store,
    oauth: undefined,
    endpoints: TEST_ENDPOINTS,
    networkGuard: async () => {},
    logger,
    config,
    getBrowserService: () => service,
    setup: { timing, wsFactory: console_.wsFactory, newId: deps.newId },
  });
  const url = (p: string) => `/api/plugins/gmail${p}`;
  return {
    app,
    console: console_,
    browser,
    creds,
    store,
    logger,
    pluginConfig,
    configUpdates,
    deps,
    downloadsDir,
    /** The browser plugin loads later. */
    provide: () => {
      service = browser.service;
    },
    url,
    state: async (opts: { remoteAddress?: string; headers?: Record<string, string> } = {}) =>
      (await app.inject({ method: "GET", url: url("/state"), ...opts })).json(),
    start: (payload: unknown, opts: { remoteAddress?: string; headers?: Record<string, string> } = {}) =>
      app.inject({ method: "POST", url: url("/setup/run"), payload: payload as object, ...opts }),
    view: async (id: string): Promise<SetupRunView> => (await app.inject({ method: "GET", url: url(`/setup/run/${id}`) })).json(),
    post: (p: string, payload: unknown = {}) => app.inject({ method: "POST", url: url(p), payload: payload as object }),
    del: (p: string) => app.inject({ method: "DELETE", url: url(p) }),
  };
}
export type Harness = Awaited<ReturnType<typeof makeHarness>>;

const tick = (ms = 3) => new Promise<void>((r) => setTimeout(r, ms));

/** Poll a view source until `pred` holds (real timers). */
export async function until<T>(get: () => Promise<T> | T, pred: (v: T) => boolean, timeoutMs = 4000): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await get();
    if (pred(v)) return v;
    if (Date.now() > end) throw new Error(`timed out; last=${JSON.stringify(v).slice(0, 600)}`);
    await tick();
  }
}

export interface AutopilotOptions {
  audience?: "internal" | "external";
  /** What the human does at the "Push to production?" dialog. */
  publish?: "confirm" | "cancel";
  /** Skip answering the audience decision (leave it waiting). */
  stopAt?: (v: SetupRunView) => boolean;
}

/** One autopilot reaction to a polled view (answers decisions once, ticks checkpoints). */
async function autopilotStep(h: Harness, runId: string, o: AutopilotOptions, v: SetupRunView, handled: Set<string>): Promise<void> {
  const key = `${v.state}:${v.checkpoint?.kind ?? v.decision?.kind ?? ""}`;
  const decisionKind = v.state === "waiting_decision" && !handled.has(key) ? v.decision?.kind : undefined;
  if (decisionKind === "audience" && v.decision?.kind === "audience") {
    handled.add(key);
    await h.post(`/setup/run/${runId}/continue`, { audience: o.audience ?? v.decision.detected });
  } else if (decisionKind === "links") {
    handled.add(key);
    await h.post(`/setup/run/${runId}/continue`, { confirmLinks: true });
  } else if (v.state === "waiting_user" && v.checkpoint?.kind === "policy") {
    h.console.policyChecked = true;
  } else if (v.state === "waiting_user" && v.checkpoint?.kind === "publish") {
    if (o.publish === "cancel") h.console.cancelPublish();
    else h.console.confirmPublish();
  }
}

/** Plays the human until the run is terminal (or `stopAt` matches); returns the last view. */
export async function autopilot(h: Harness, runId: string, o: AutopilotOptions = {}): Promise<SetupRunView> {
  const handled = new Set<string>();
  return until(
    async () => {
      const v = await h.view(runId);
      if (o.stopAt?.(v)) return v;
      await autopilotStep(h, runId, o, v, handled);
      return v;
    },
    (v) => ["done", "handoff", "cancelled"].includes(v.state) || Boolean(o.stopAt?.(v)),
  );
}

/** Console state as if the recipe had already finished `through` (existing-mode runs). */
export function preset(
  c: FakeConsole,
  through: "none" | "project" | "api" | "branding" | "publish",
  o: { org?: string | null; audience?: "internal" | "external" } = {},
): void {
  if (through === "none") return;
  c.withProject(PID, o.org ?? null);
  if (through === "project") return;
  c.apiEnabled = true;
  if (through === "api") return;
  c.userType = o.audience ?? "external";
  if (through === "branding") return; // External, not yet published
  c.published = true;
}

export const EXISTING = { mode: "existing", projectId: PID, ownerEmail: OWNER } as const;

/** Start an existing-mode run over HTTP and return its id. */
export async function startExisting(h: Harness): Promise<string> {
  const r = await h.start(EXISTING);
  if (r.statusCode !== 200) throw new Error(`start failed: ${r.statusCode} ${r.body}`);
  return (r.json() as { runId: string }).runId;
}

/** Fake-timer helpers (`vi.useFakeTimers` must be active). */
export async function advanceUntil(pred: () => boolean, maxMs: number, stepMs = 250): Promise<void> {
  const { vi } = await import("vitest");
  await vi.advanceTimersByTimeAsync(0);
  for (let t = 0; t < maxMs && !pred(); t += stepMs) await vi.advanceTimersByTimeAsync(stepMs);
}
