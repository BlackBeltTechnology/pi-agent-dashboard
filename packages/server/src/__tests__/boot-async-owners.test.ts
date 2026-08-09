/**
 * Boot-path floating-promise owners: the two fire-and-forget calls the boot
 * path makes AFTER `fastify.listen` must each own a rejection. Boot still
 * reaches a listening state; the failure is logged, not floated.
 *
 *   - `cleanupStaleZrok().catch(log)`                    (test-plan #X4)
 *   - `discoverAndBroadcastSessions({...}).catch(log)`   (test-plan #X5)
 *
 * Focused file: mocks `tunnel.js` + `session-bootstrap.js` so the two boot
 * calls can be made to reject deterministically without a real zrok binary or
 * on-disk session scan. Full-server boot idiom mirrors `auto-shutdown.test.ts`.
 *
 * See change: cleanup-async-semantics-server-extension (test-plan #X4, #X5).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../tunnel/tunnel.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tunnel/tunnel.js")>();
  return {
    ...actual,
    detectZrokBinary: vi.fn(() => false),
    cleanupStaleZrok: vi.fn(async () => {}),
    scavengeOrphanZrokProcesses: vi.fn(() => []),
  };
});
vi.mock("../session/session-bootstrap.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../session/session-bootstrap.js")>();
  return { ...actual, discoverAndBroadcastSessions: vi.fn(async () => {}) };
});

import { createServer, type DashboardServer, type ServerConfig } from "../server.js";
import { cleanupStaleZrok, detectZrokBinary } from "../tunnel/tunnel.js";
import { discoverAndBroadcastSessions } from "../session/session-bootstrap.js";

const baseConfig: ServerConfig = {
  port: 0,
  piPort: 0,
  host: "127.0.0.1",
  dev: true,
  autoShutdown: false,
  tunnel: false,
  pingInterval: 0,
};

describe("boot path — fire-and-forget owners", () => {
  let server: DashboardServer | null;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let unhandled: unknown[];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  const prevNoMdns = process.env.PI_DASHBOARD_NO_MDNS;

  beforeEach(() => {
    process.env.PI_DASHBOARD_NO_MDNS = "1";
    server = null;
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    unhandled = [];
    process.on("unhandledRejection", onUnhandled);
    vi.mocked(detectZrokBinary).mockReturnValue(false);
    vi.mocked(cleanupStaleZrok).mockResolvedValue(undefined);
    vi.mocked(discoverAndBroadcastSessions).mockResolvedValue(undefined);
  });
  afterEach(async () => {
    process.off("unhandledRejection", onUnhandled);
    if (server) {
      try { await server.stop(); } catch { /* may already be stopped */ }
    }
    vi.restoreAllMocks();
    if (prevNoMdns === undefined) delete process.env.PI_DASHBOARD_NO_MDNS;
    else process.env.PI_DASHBOARD_NO_MDNS = prevNoMdns;
  });

  async function settle() {
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  }

  function warned(fragment: string): boolean {
    return warnSpy.mock.calls.some((c: unknown[]) => typeof c[0] === "string" && c[0].includes(fragment));
  }

  it("X4 a rejected stale-zrok cleanup is logged; boot reaches listening; no unhandled rejection", async () => {
    vi.mocked(detectZrokBinary).mockReturnValue(true);
    vi.mocked(cleanupStaleZrok).mockRejectedValue(new Error("zrok boom"));

    server = await createServer({ ...baseConfig });
    await server.start();
    await settle();

    expect(server.httpPort()).not.toBeNull(); // boot reached a listening state
    expect(warned("[zrok] stale-process cleanup failed")).toBe(true);
    expect(unhandled).toEqual([]);
  });

  it("X5 a rejected session discovery is logged; boot completes; no unhandled rejection", async () => {
    vi.mocked(discoverAndBroadcastSessions).mockRejectedValue(new Error("discovery boom"));

    server = await createServer({ ...baseConfig });
    await server.start();
    await settle();

    expect(server.httpPort()).not.toBeNull();
    expect(warned("[boot] session discovery failed")).toBe(true);
    expect(unhandled).toEqual([]);
  });
});
