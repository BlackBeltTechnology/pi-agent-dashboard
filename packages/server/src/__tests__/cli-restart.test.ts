/**
 * Tests for `cmdRestart` — `pi-dashboard restart` delegates to `/api/restart`
 * when the dashboard is up, falls back to local stop/start when it is not.
 * See change: fix-restart-bridge-auto-start-race.
 */
import { describe, it, expect, vi } from "vitest";
import { cmdRestart } from "../cli.js";
import type { ServerConfig } from "../server.js";

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    port: 8000,
    piPort: 9999,
    dev: false,
    autoShutdown: false,
    shutdownIdleSeconds: 0,
    tunnel: false,
    maxWsBufferBytes: 0,
    ...overrides,
  } as ServerConfig;
}

describe("cmdRestart", () => {
  it("delegates to /api/restart when dashboard is running", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, text: async () => "" })) as unknown as typeof fetch;
    const cmdStopImpl = vi.fn(async () => {});
    const cmdStartImpl = vi.fn(async () => {});
    const isDashboardRunning = vi.fn(async () => ({ running: true }));

    await cmdRestart(makeConfig({ dev: true }), { isDashboardRunning, fetchImpl, cmdStopImpl, cmdStartImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as any).mock.calls[0];
    expect(url).toBe("http://localhost:8000/api/restart");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ dev: true });
    expect(cmdStopImpl).not.toHaveBeenCalled();
    expect(cmdStartImpl).not.toHaveBeenCalled();
  });

  it("falls back to cmdStop + cmdStart when dashboard is NOT running", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const cmdStopImpl = vi.fn(async () => {});
    const cmdStartImpl = vi.fn(async () => {});
    const isDashboardRunning = vi.fn(async () => ({ running: false }));

    await cmdRestart(makeConfig(), { isDashboardRunning, fetchImpl, cmdStopImpl, cmdStartImpl });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(cmdStopImpl).toHaveBeenCalledTimes(1);
    expect(cmdStartImpl).toHaveBeenCalledTimes(1);
  });

  it("falls back to local stop/start when /api/restart returns non-2xx", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500, text: async () => "boom" })) as unknown as typeof fetch;
    const cmdStopImpl = vi.fn(async () => {});
    const cmdStartImpl = vi.fn(async () => {});
    const isDashboardRunning = vi.fn(async () => ({ running: true }));

    await cmdRestart(makeConfig(), { isDashboardRunning, fetchImpl, cmdStopImpl, cmdStartImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(cmdStopImpl).toHaveBeenCalledTimes(1);
    expect(cmdStartImpl).toHaveBeenCalledTimes(1);
  });

  it("falls back to local stop/start when fetch throws", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    const cmdStopImpl = vi.fn(async () => {});
    const cmdStartImpl = vi.fn(async () => {});
    const isDashboardRunning = vi.fn(async () => ({ running: true }));

    await cmdRestart(makeConfig(), { isDashboardRunning, fetchImpl, cmdStopImpl, cmdStartImpl });

    expect(cmdStopImpl).toHaveBeenCalledTimes(1);
    expect(cmdStartImpl).toHaveBeenCalledTimes(1);
  });
});
