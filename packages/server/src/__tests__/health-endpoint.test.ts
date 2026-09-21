/**
 * Tests for GET /api/health endpoint.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Registry-failure seam (test-plan X10/X11). The OAuth registry is built lazily
 * from the pi runtime; here it is replaced by a mutable stub so booting a server
 * with "the runtime exposes no provider definitions" is a one-line toggle rather
 * than a real SDK failure.
 * See change: delegate-provider-oauth-to-pi-ai (D3).
 */
const registryState = vi.hoisted(() => ({ error: null as string | null }));

vi.mock("../auth/provider-auth-registry.js", () => ({
  oauthRegistryReady: async () => {},
  getOAuthRegistry: () => [],
  getRegistryError: () => registryState.error,
  initOAuthRegistry: async () => {},
}));
import { createKeeperManager, EMPTY_KEEPER_LOG_STATS } from "../rpc-keeper/keeper-manager.js";
import { setKeeperManager } from "../spawn-process/process-manager.js";
import type { DashboardServer } from "../server.js";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";

let handle: TestServerHandle | undefined;
let server: DashboardServer | undefined;
/**
 * Prior config.json bytes, or `ABSENT` when there was no file to begin with.
 * A plain `null` sentinel could not tell "nothing to restore" apart from "the
 * file did not exist", so teardown left the seeded file behind and later tests
 * inherited `bindHost` / `auth.bypassHosts` — an order-dependent suite.
 */
const ABSENT = Symbol("absent");
let configBackup: string | typeof ABSENT | null = null;

function configPath(): string {
  // HOME is ephemeral (see the setup-home global setup, which HARD-FAILS if it
  // still points at the developer's real home), so this never touches the real
  // user config. The save/restore below is sibling-test isolation, not
  // user-data protection.
  return path.join(os.homedir(), ".pi", "dashboard", "config.json");
}

function seedConfig(patch: Record<string, unknown>): void {
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const present = fs.existsSync(file);
  // Only the FIRST seed in a test captures the baseline, so repeated calls
  // cannot overwrite it with an already-seeded snapshot.
  if (configBackup === null) configBackup = present ? fs.readFileSync(file, "utf-8") : ABSENT;
  const existing = present ? JSON.parse(fs.readFileSync(file, "utf-8")) : {};
  fs.writeFileSync(file, JSON.stringify({ ...existing, ...patch }));
}

function restoreConfig(): void {
  if (configBackup === null) return;
  if (configBackup === ABSENT) fs.rmSync(configPath(), { force: true });
  else fs.writeFileSync(configPath(), configBackup);
  configBackup = null;
}

describe("GET /api/health", () => {
  afterEach(async () => {
    if (handle) {
      try { await handle.stop(); } catch { /* already stopped */ }
      handle = undefined;
      server = undefined;
    }
    registryState.error = null;
    restoreConfig();
  });

  it("should return ok, pid, and uptime", async () => {
    handle = await createTestServer();
    server = handle.server;

    const res = await fetch(`http://localhost:${handle.httpPort}/api/health`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.pid).toBe(process.pid);
    expect(typeof body.uptime).toBe("number");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    // Additive event-loop stall retention buffer. See change:
    // attribute-openspec-poll-eventloop-stalls.
    expect(Array.isArray(body.eventLoopSpikes)).toBe(true);
    // Existing telemetry fields still present (regression pins).
    expect(body.eventLoopDelay).toBeTypeOf("object");
    expect(Array.isArray(body.hydration)).toBe(true);
    // Status-reconcile counters + socket-buffer occupancy must be present and
    // numeric BEFORE any shed has happened — a back-pressure claim is otherwise
    // only inferrable from cumulative drop totals.
    // See change: fix-backpressure-status-and-subagent-frames (test-plan #E7).
    expect(body.droppedFrames.statusReconcileQueued).toBe(0);
    expect(body.droppedFrames.statusReconcileSent).toBe(0);
    expect(body.socketBufferOccupancy.max).toBeTypeOf("number");
    expect(body.socketBufferOccupancy.p95).toBeTypeOf("number");
    expect(body.socketBufferOccupancy.msAboveThreshold).toBeTypeOf("number");
  });

  // test-plan #X2 — `/api/health` carries NO preHandler, so it must never
  // disclose the operator's private network topology. The resolved bind host
  // and the unreachable trusted entries ride the GUARDED `/api/config` surface
  // instead; in the flagship configuration the peer that can reach this port is
  // exactly the untrusted host the guard just denied.
  // See change: warn-unreachable-trusted-networks.
  it("#X2 discloses no bind-host or trusted-entry topology", async () => {
    // Seed a REAL trusted entry first, so there is something that could leak.
    // Without it the assertion would pass even on a server that started
    // publishing `auth.bypassHosts` on health, because the list would be empty.
    seedConfig({ bindHost: "127.0.0.1", auth: { bypassHosts: [TOPOLOGY_SECRET] } });

    handle = await createTestServer();
    server = handle.server;

    const res = await fetch(`http://localhost:${handle.httpPort}/api/health`);
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain("resolvedBindHost");
    expect(raw).not.toContain("pendingBindHost");
    expect(raw).not.toContain("reachability");
    expect(raw).not.toContain(TOPOLOGY_SECRET);
    expect(JSON.parse(raw).reachability).toBeUndefined();
  });

  // The positive half of the same wiring: the GUARDED surface really does carry
  // the object. Pinned against the live route because the L3 spec MERGES a
  // `reachability` into the config response, and would therefore stay green if
  // the route stopped producing one at all.
  it("serves a well-shaped `reachability` on the guarded /api/config", async () => {
    seedConfig({ bindHost: "127.0.0.1", auth: { bypassHosts: [TOPOLOGY_SECRET] } });

    handle = await createTestServer();
    server = handle.server;

    const res = await fetch(`http://localhost:${handle.httpPort}/api/config`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data?: { reachability?: { resolvedBindHost?: string; pendingBindHost?: string; unreachable?: string[] } };
    };
    const reachability = body.data?.reachability;
    expect(reachability).toBeDefined();
    expect(typeof reachability?.resolvedBindHost).toBe("string");
    expect(typeof reachability?.pendingBindHost).toBe("string");
    expect(reachability?.unreachable).toContain(TOPOLOGY_SECRET);
  });
});

/** A trusted entry distinctive enough that finding it in a body is unambiguous. */
const TOPOLOGY_SECRET = "192.168.177.0/24";

// X10 (fix-runaway-keeper-log-growth, task 4.5): sessionsDir deleted before a
// stats refresh → GET /api/health stays 200 and keeperLogs equals the typed
// zero constant. The singleton KeeperManager is INJECTED with a tiny stats
// TTL and an isolated sessions dir, so the server's route wiring (and only
// the wiring) is exercised here; the stats math lives in
// keeper-log-maintenance.test.ts.
describe("GET /api/health — keeperLogs degraded case (X10)", () => {
  afterEach(() => {
    setKeeperManager(null);
  });

  it("deleted sessionsDir → 200 and keeperLogs equals EMPTY_KEEPER_LOG_STATS", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "klog-x10-"));
    const sessionsDir = path.join(tmp, "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    setKeeperManager(
      createKeeperManager({
        sessionsDir,
        statsTtlMs: 30, // expired by the time the request fires
      }),
    );
    try {
      handle = await createTestServer();
      server = handle.server;
      expect(server).toBeDefined();

      // Delete the dir AFTER boot (the startup sweep already ran once).
      fs.rmSync(sessionsDir, { recursive: true, force: true });
      await new Promise((r) => setTimeout(r, 60)); // TTL expires

      const res = await fetch(`http://localhost:${handle.httpPort}/api/health`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.keeperLogs).toEqual(EMPTY_KEEPER_LOG_STATS);
    } finally {
      if (handle) {
        await handle.stop().catch(() => undefined);
        handle = undefined;
        server = undefined;
      }
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 15_000);

  // ── test-plan X10: the runtime surface is missing ────────────────────────────
  //
  // "On first use the server SHALL verify the runtime exposes provider
  // definitions … on failure it SHALL log the resolved package version, keep
  // serving every other route, and report the failure in GET /api/health."
  it("X10: a failed registry build degrades sign-in only", async () => {
    registryState.error =
      "the runtime exposes no provider with an OAuth login (pi-coding-agent 0.86.1)";

    handle = await createTestServer();
    server = handle.server;
    const base = `http://localhost:${handle.httpPort}`;

    const handlers = await fetch(`${base}/api/provider-auth/handlers`);
    expect(handlers.status).toBe(200);
    expect(await handlers.json()).toEqual({ ids: [] });

    const health = await fetch(`${base}/api/health`);
    expect(health.status).toBe(200);
    const healthBody = (await health.json()) as {
      providerAuth?: { error: string | null };
    };
    expect(healthBody.providerAuth?.error).toBeTruthy();
    expect(healthBody.providerAuth?.error).toContain("0.86.1");

    // Every other route keeps serving.
    const status = await fetch(`${base}/api/provider-auth/status`);
    expect(status.status).toBe(200);

    // Unknown-provider start is still a clean 400, not a 500.
    const start = await fetch(`${base}/api/provider-auth/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "anthropic" }),
    });
    expect(start.status).toBe(400);
  }, 20_000);

  // ── test-plan X11: a stored credential survives a registry failure ───────────
  //
  // A credential pi wrote must stay VISIBLE and REMOVABLE even when the
  // dashboard cannot offer a sign-in flow for it — otherwise a failed registry
  // strands the credential with no way to sign out.
  it("X11: a stored OAuth credential stays visible and removable", async () => {
    registryState.error = "runtime surface missing (pi-coding-agent unknown)";

    const authDir = path.join(os.homedir(), ".pi", "agent");
    const authPath = path.join(authDir, "auth.json");
    fs.mkdirSync(authDir, { recursive: true });
    const prior = fs.existsSync(authPath) ? fs.readFileSync(authPath, "utf-8") : null;
    fs.writeFileSync(
      authPath,
      JSON.stringify({ anthropic: { type: "oauth", access: "a", refresh: "r", expires: 1 } }),
    );

    try {
      handle = await createTestServer();
      server = handle.server;
      const base = `http://localhost:${handle.httpPort}`;

      const status = await fetch(`${base}/api/provider-auth/status`);
      const rows = (await status.json()) as Array<{
        id: string;
        flowType: string;
        authenticated: boolean;
      }>;
      const row = rows.find((r) => r.id === "anthropic");
      expect(row).toBeDefined();
      expect(row?.flowType).not.toBe("api_key");
      expect(row?.authenticated).toBe(true);

      const del = await fetch(`${base}/api/provider-auth/anthropic`, { method: "DELETE" });
      expect(del.status).toBe(200);
      expect(JSON.parse(fs.readFileSync(authPath, "utf-8")).anthropic).toBeUndefined();
    } finally {
      if (prior === null) fs.rmSync(authPath, { force: true });
      else fs.writeFileSync(authPath, prior);
    }
  }, 20_000);
});