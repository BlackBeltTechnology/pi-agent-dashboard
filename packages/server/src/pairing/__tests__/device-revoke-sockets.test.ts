/**
 * X14 end to end: on a REAL server, an operator revoke closes the device's open browser and bridge
 * sockets with 4401 / `device revoked`, refuses a ticket minted before the revoke, and a restored
 * device connects again. See change: device-key-mutual-check (D7).
 */
import path from "node:path";
import { getDashboardConfigDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { proofHeaders } from "../../test-support/local-credential-stamp.js";
import { PairedDeviceRegistry } from "../paired-devices.js";
import { createTestServer, type TestServerHandle } from "../../test-support/test-server.js";

let handle: TestServerHandle | undefined;
afterEach(async () => {
  await handle?.stop();
  handle = undefined;
});

/** `operator` adds a fresh local proof (an operator route needs a genuinely-local caller). */
const api = (port: number, method: string, url: string, init: { token?: string; body?: unknown; operator?: boolean } = {}) =>
  fetch(`http://127.0.0.1:${port}${url}`, {
    method,
    headers: {
      ...(init.operator ? proofHeaders(`http://127.0.0.1:${port}${url}`, method) : {}),
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

async function ticket(port: number, token: string, scope: "browser" | "bridge"): Promise<string> {
  const res = await api(port, "POST", "/api/ws-ticket", { token, body: { scope } });
  expect(res.status).toBe(200);
  return (await res.json()).data.ticket as string;
}

interface Dial {
  ws: WebSocket;
  opened: Promise<"open" | string>;
  closed: Promise<{ code: number; reason: string }>;
}
function dial(url: string): Dial {
  const ws = new WebSocket(url);
  const opened = new Promise<"open" | string>((resolve) => {
    ws.on("open", () => resolve("open"));
    ws.on("unexpected-response", (_r, res) => resolve(`http-${res.statusCode}`));
    ws.on("error", (e) => resolve(`error:${(e as Error).message}`));
  });
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    ws.on("close", (code, reason) => resolve({ code, reason: reason.toString() })),
  );
  return { ws, opened, closed };
}
const within = <T,>(p: Promise<T>, ms = 5000) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

describe("X14 revoke on a live server", () => {
  it("closes the browser and bridge sockets of the revoked device only; refuses a stale ticket; restore reconnects", async () => {
    const dir = getDashboardConfigDir();
    const seed = new PairedDeviceRegistry(path.join(dir, "paired-devices.json"));
    const a = seed.add("device-a", "manual", "operate");
    const b = seed.add("device-b", "manual", "operate");
    handle = await createTestServer();
    const { httpPort, piPort } = handle;

    const browserA = dial(`ws://127.0.0.1:${httpPort}/ws?ticket=${await ticket(httpPort, a.token, "browser")}`);
    const bridgeA = dial(`ws://127.0.0.1:${piPort}/?ticket=${await ticket(httpPort, a.token, "bridge")}`);
    const browserB = dial(`ws://127.0.0.1:${httpPort}/ws?ticket=${await ticket(httpPort, b.token, "browser")}`);
    expect(await within(browserA.opened)).toBe("open");
    expect(await within(bridgeA.opened)).toBe("open");
    expect(await within(browserB.opened)).toBe("open");

    const stale = await ticket(httpPort, a.token, "browser");
    const revoked = await api(httpPort, "DELETE", `/api/paired-devices/${a.device.id}`, { operator: true });
    expect(revoked.status, await revoked.clone().text()).toBe(200);

    expect(await within(browserA.closed)).toEqual({ code: 4401, reason: "device revoked" });
    expect(await within(bridgeA.closed)).toEqual({ code: 4401, reason: "device revoked" });
    expect(browserB.ws.readyState).toBe(WebSocket.OPEN);

    expect(await within(dial(`ws://127.0.0.1:${httpPort}/ws?ticket=${stale}`).opened)).not.toBe("open");

    expect((await api(httpPort, "POST", `/api/paired-devices/${a.device.id}/restore`, { operator: true })).status).toBe(200);
    const again = dial(`ws://127.0.0.1:${httpPort}/ws?ticket=${await ticket(httpPort, a.token, "browser")}`);
    expect(await within(again.opened)).toBe("open");
    for (const d of [again, browserB]) d.ws.close();
  });
});
