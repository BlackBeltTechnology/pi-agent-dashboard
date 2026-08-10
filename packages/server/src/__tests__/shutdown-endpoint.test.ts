/**
 * Tests for POST /api/shutdown endpoint.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { createServer, type DashboardServer } from "../server.js";

let httpPort: number;
let piPort: number;
let server: DashboardServer;

// Mock process.exit to prevent actually exiting
const mockExit = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);

describe("POST /api/shutdown", () => {
  afterEach(async () => {
    mockExit.mockClear();
    if (server) {
      try { await server.stop(); } catch { /* already stopped */ }
    }
  });

  it("should respond with { ok: true }", async () => {
    server = await createServer({
      port: 0, piPort: 0, host: "127.0.0.1", dev: true,
      autoShutdown: false, shutdownIdleSeconds: 999, tunnel: false,
    });
    await server.start();
    httpPort = server.httpPort()!;
    piPort = server.piPort()!;

    const res = await fetch(`http://127.0.0.1:${httpPort}/api/shutdown`, {
      method: "POST",
    });

    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body).toEqual({ ok: true });

    // Give the setTimeout a chance to fire
    await new Promise((r) => setTimeout(r, 200));
    expect(mockExit).toHaveBeenCalledWith(0);
  });
});
