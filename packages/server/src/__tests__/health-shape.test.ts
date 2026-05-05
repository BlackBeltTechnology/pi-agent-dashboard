/**
 * Tests for /api/health response shape after Phase A additions.
 *
 * Asserts:
 *  - `pid` field is present (regression pin).
 *  - `starter` field is present, defaults to "Standalone".
 *
 * Note: the "Standalone default for missing DASHBOARD_STARTER" case is
 * also covered exhaustively in packages/shared/src/__tests__/dashboard-starter.test.ts.
 * This test pins the contract at the HTTP layer so a refactor cannot silently
 * drop either field from the health response.
 */
import { describe, it, expect, afterEach } from "vitest";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";

let handle: TestServerHandle | undefined;

describe("GET /api/health — Phase A shape", () => {
  afterEach(async () => {
    if (handle) {
      try { await handle.stop(); } catch { /* already stopped */ }
      handle = undefined;
    }
  });

  it("includes pid field (regression pin)", async () => {
    handle = await createTestServer();
    const res = await fetch(`http://localhost:${handle.httpPort}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.pid).toBe("number");
    expect(body.pid).toBe(process.pid);
  });

  it("includes starter field defaulting to Standalone", async () => {
    handle = await createTestServer();
    const res = await fetch(`http://localhost:${handle.httpPort}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    // When bootstrapState has no starter set, defaults to "Standalone".
    expect(body.starter).toBe("Standalone");
  });
});
