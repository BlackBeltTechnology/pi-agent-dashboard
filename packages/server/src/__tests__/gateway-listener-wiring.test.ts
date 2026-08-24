/**
 * The listener policy as the server actually applies it (tasks 8.1/8.6).
 *
 * The policy unit test proves the decision; this proves the WIRING — that the
 * default start binds the unix socket and no bridge TCP port, and that the
 * opt-in binds both. Without it, `startOnSocket` could go back to having no
 * production caller and every unit test would stay green.
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import { getGatewaySocketPath } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type DashboardServer } from "../server.js";

const posixOnly = process.platform === "win32" ? it.skip : it;

let handle: DashboardServer | undefined;
afterEach(async () => {
  await handle?.stop();
  handle = undefined;
});

/**
 * Booted directly rather than through `createTestServer`, which insists on a
 * numeric `piPort` — the very thing a socket-only start does not have.
 */
async function boot(gatewayTcp: boolean): Promise<DashboardServer> {
  const server = await createServer({
    port: 0,
    piPort: PI_PORT,
    host: "127.0.0.1",
    gatewayTcp,
    dev: true,
    autoShutdown: false,
    shutdownIdleSeconds: 999,
    tunnel: false,
  });
  await server.start();
  return server;
}

/** A fixed piPort — the socket path is keyed by it (D2). */
const PI_PORT = 39871;

function tcpListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: "127.0.0.1", port });
    const done = (v: boolean) => {
      sock.destroy();
      resolve(v);
    };
    sock.on("connect", () => done(true));
    sock.on("error", () => done(false));
    setTimeout(() => done(false), 1000);
  });
}

describe("gateway listener wiring", () => {
  posixOnly("binds the unix socket and NO bridge TCP port by default (8.1)", async () => {
    handle = await boot(false);
    const sockPath = getGatewaySocketPath({ homedir: os.homedir() }, PI_PORT);
    expect(fs.existsSync(sockPath)).toBe(true);
    expect(handle.piPort()).toBeNull();
    await expect(tcpListening(PI_PORT)).resolves.toBe(false);
  });

  posixOnly("binds BOTH listeners on the explicit opt-in (8.4/8.6)", async () => {
    handle = await boot(true);
    expect(fs.existsSync(getGatewaySocketPath({ homedir: os.homedir() }, PI_PORT))).toBe(true);
    await expect(tcpListening(PI_PORT)).resolves.toBe(true);
  });

  posixOnly("releases the socket path on stop, leaving no stale file behind", async () => {
    const h = await boot(false);
    const sockPath = getGatewaySocketPath({ homedir: os.homedir() }, PI_PORT);
    expect(fs.existsSync(sockPath)).toBe(true);
    await h.stop();
    expect(fs.existsSync(sockPath)).toBe(false);
  });
});
