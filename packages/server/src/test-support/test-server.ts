/**
 * createTestServer — boot a real DashboardServer on OS-assigned ports for
 * integration tests, with safe defaults (no auto-shutdown, no tunnel).
 *
 * Use with the `setup-home` vitest setupFile (in @blackbelt-technology/pi-dashboard-shared/test-support)
 * so that HOME is also isolated.
 *
 * Example:
 *   const { server, httpPort, piPort, stop } = await createTestServer();
 *   const res = await fetch(`http://127.0.0.1:${httpPort}/api/health`);
 *   ...
 *   await stop();
 */
import { createServer, type DashboardServer, type ServerConfig } from "../server.js";

export interface TestServerHandle {
  server: DashboardServer;
  httpPort: number;
  piPort: number;
  stop: () => Promise<void>;
}

export type TestServerOverrides = Partial<ServerConfig>;

const DEFAULTS: ServerConfig = {
  port: 0,
  piPort: 0,
  host: "127.0.0.1",
  dev: true,
  autoShutdown: false,
  shutdownIdleSeconds: 999,
  tunnel: false,
};

export async function createTestServer(
  overrides: TestServerOverrides = {},
): Promise<TestServerHandle> {
  const config: ServerConfig = { ...DEFAULTS, ...overrides };
  const server = await createServer(config);
  await server.start();

  const httpPort = server.httpPort();
  const piPort = server.piPort();
  if (httpPort == null || piPort == null) {
    await server.stop();
    throw new Error(
      `createTestServer: failed to resolve ports (httpPort=${httpPort}, piPort=${piPort})`,
    );
  }

  return {
    server,
    httpPort,
    piPort,
    stop: async () => {
      try {
        await server.stop();
      } catch {
        // best-effort — tests may race on shutdown
      }
    },
  };
}
