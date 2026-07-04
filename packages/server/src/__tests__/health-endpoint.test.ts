/**
 * Tests for GET /api/health endpoint.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { DashboardServer } from "../server.js";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";

let handle: TestServerHandle | undefined;
let server: DashboardServer | undefined;

describe("GET /api/health", () => {
  afterEach(async () => {
    if (handle) {
      try { await handle.stop(); } catch { /* already stopped */ }
      handle = undefined;
      server = undefined;
    }
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
});
