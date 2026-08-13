/**
 * Tests for GET /api/health endpoint.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DashboardServer } from "../server.js";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";

let handle: TestServerHandle | undefined;
let server: DashboardServer | undefined;
/** Prior config.json bytes, so a seeding test cannot leak into its siblings. */
let configBackup: string | null = null;

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
  configBackup = fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : null;
  const existing = configBackup ? JSON.parse(configBackup) : {};
  fs.writeFileSync(file, JSON.stringify({ ...existing, ...patch }));
}

function restoreConfig(): void {
  if (configBackup === null) return;
  fs.writeFileSync(configPath(), configBackup);
  configBackup = null;
}

describe("GET /api/health", () => {
  afterEach(async () => {
    if (handle) {
      try { await handle.stop(); } catch { /* already stopped */ }
      handle = undefined;
      server = undefined;
    }
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
