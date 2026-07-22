/**
 * Real-boot smoke: the full DashboardServer boots with the embed-lifecycle
 * controller wired (reaper start/stop, /api/health snapshot) and the health
 * endpoint exposes the `embedLifecycle` diagnostics field.
 * See change: add-embed-session-lifecycle.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";

describe("embed-lifecycle server boot smoke", () => {
  let handle: TestServerHandle;

  beforeAll(async () => {
    handle = await createTestServer();
  });
  afterAll(async () => {
    await handle?.stop();
  });

  it("boots with the lifecycle controller and exposes embedLifecycle on /api/health", async () => {
    const res = await fetch(`http://127.0.0.1:${handle.httpPort}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      embedLifecycle?: {
        activeEphemeral: number;
        idleEphemeral: number;
        reaped: Record<string, number>;
        capacityRejections: number;
        reuseHits: number;
        reuseMisses: number;
      };
    };
    expect(body.ok).toBe(true);
    expect(body.embedLifecycle).toBeDefined();
    // Fresh server: no ephemeral sessions, no reaps yet.
    expect(body.embedLifecycle?.activeEphemeral).toBe(0);
    expect(body.embedLifecycle?.reaped).toEqual({
      idle: 0,
      "stop-after-turn": 0,
      phantom: 0,
    });
  });
});
