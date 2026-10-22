/**
 * #E14 — a remote bridge on the REAL two-port topology: the dashboard HTTP
 * listener (`/api/ws-ticket`) and the pi gateway (bridge WebSocket) are
 * different ports. The extension's origin resolver must mint on the former and
 * the ticket must open the latter; minting on the gateway answers 426.
 *
 * Harness after `pi-trust-live-integration.test.ts` (temp HOME, paired device,
 * `createTestServer`). See change: fix-remote-bridge-ticket-origin.
 */
import path from "node:path";
import { getDashboardConfigDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { mintBridgeTicket, withTicket } from "../../../extension/src/bridge-ticket-client.js";
import { resolveDashboardHttpOrigin } from "../../../extension/src/dashboard-http-origin.js";
import { PairedDeviceRegistry } from "../pairing/paired-devices.js";
import { createTestServer, type TestServerHandle } from "../test-support/test-server.js";

let handle: TestServerHandle | undefined;
afterEach(async () => {
  await handle?.stop();
  handle = undefined;
});

function dial(url: string): Promise<"open" | string> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.terminate();
      resolve("timeout");
    }, 5000);
    ws.on("open", () => {
      clearTimeout(timer);
      ws.close();
      resolve("open");
    });
    ws.on("unexpected-response", (_req, res) => {
      clearTimeout(timer);
      resolve(`http-${res.statusCode}`);
    });
    ws.on("error", (e) => {
      clearTimeout(timer);
      resolve(`error:${(e as Error).message}`);
    });
  });
}

describe("#E14 remote bridge ticket on the two-port topology", () => {
  it("mints on the HTTP origin and the ticket opens the gateway; minting on the gateway is a wrong origin", async () => {
    const registry = new PairedDeviceRegistry(path.join(getDashboardConfigDir(), "paired-devices.json"));
    const { token } = registry.add("remote-bridge", "manual", "operate");
    handle = await createTestServer();
    expect(handle.httpPort).not.toBe(handle.piPort);

    const endpoint = `ws://127.0.0.1:${handle.piPort}`;
    const resolved = resolveDashboardHttpOrigin(endpoint, { PI_DASHBOARD_PORT: String(handle.httpPort) });
    expect(resolved).toMatchObject({ ok: true, origin: `http://127.0.0.1:${handle.httpPort}` });
    if (!resolved.ok) return;

    const minted = await mintBridgeTicket({ httpBase: resolved.origin, token, originSource: resolved.source });
    expect(minted.ok).toBe(true);
    if (!minted.ok) return;
    expect(await dial(withTicket(endpoint, minted.ticket))).toBe("open");

    // Control arm: the gateway is not the dashboard's HTTP listener.
    const wrong = await mintBridgeTicket({ httpBase: `http://127.0.0.1:${handle.piPort}`, token });
    expect(wrong).toMatchObject({ ok: false, cause: "wrong-origin" });
    expect(wrong.ok === false && wrong.reason).toContain("426");
  });
});
