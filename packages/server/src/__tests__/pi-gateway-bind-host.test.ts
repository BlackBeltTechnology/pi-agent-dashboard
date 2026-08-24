/**
 * Tests for configurable bind host on the pi gateway WebSocket server.
 * See change: configurable-bind-host.
 */

import os from "node:os";
import {
  bindHostSource,
  pendingEffectiveHost,
  resolveBindHost,
} from "@blackbelt-technology/pi-dashboard-shared/bind-reachability.js";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createPiGateway } from "../pi/pi-gateway.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    ws.on("open", () => resolve());
    ws.on("error", reject);
    setTimeout(() => reject(new Error("open timeout")), 3000);
  });
}

/** Poll gateway.address() until the async listen resolves a port. */
async function waitForBind(gateway: { address(): number | string | null }): Promise<number> {
  for (let i = 0; i < 100; i++) {
    const port = gateway.address();
    if (typeof port === "number") return port;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("gateway did not bind a port");
}

/** First non-internal IPv4 address, or null when host has none. */
function nonLoopbackIPv4(): string | null {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const info of addrs ?? []) {
      if (!info.internal && info.family === "IPv4") return info.address;
    }
  }
  return null;
}

describe("pi-gateway bind host", () => {
  let gateway: ReturnType<typeof createPiGateway>;

  afterEach(() => {
    gateway?.stop();
  });

  it("binds loopback only when host is 127.0.0.1", async () => {
    const lan = nonLoopbackIPv4();
    if (!lan) return; // No routable interface to probe — nothing to assert.

    const sessionManager = createMemorySessionManager();
    gateway = createPiGateway(sessionManager, { pingInterval: 0 });
    gateway.start(0, "127.0.0.1");
    const port = await waitForBind(gateway);

    // Loopback reachable.
    const loop = new WebSocket(`ws://127.0.0.1:${port}`);
    await expect(waitForOpen(loop)).resolves.toBeUndefined();
    loop.close();

    // Non-loopback interface NOT reachable (connection refused).
    const lanWs = new WebSocket(`ws://${lan}:${port}`);
    await expect(waitForOpen(lanWs)).rejects.toThrow();
    lanWs.terminate();
  });

  it("binds all interfaces when host is 0.0.0.0", async () => {
    const lan = nonLoopbackIPv4();
    if (!lan) return;

    const sessionManager = createMemorySessionManager();
    gateway = createPiGateway(sessionManager, { pingInterval: 0 });
    gateway.start(0, "0.0.0.0");
    const port = await waitForBind(gateway);

    const lanWs = new WebSocket(`ws://${lan}:${port}`);
    await expect(waitForOpen(lanWs)).resolves.toBeUndefined();
    lanWs.close();
  });
});

// ── Effective bind-host resolution (test-plan #E17–#E20) ──────────────
// `resolvedBindHost` is what THIS process bound; `pendingBindHost` is what the
// NEXT start would bind, re-resolved against the current config. The advisory
// must score against the pending value, and against an unsaved draft ahead of
// even that. See change: warn-unreachable-trusted-networks.
describe("effective bind host resolution", () => {
  it("#E17 lets an unsaved draft edit win over the saved and resolved values", () => {
    expect(
      pendingEffectiveHost({
        draftBindHost: "0.0.0.0",
        pendingBindHost: "127.0.0.1",
        resolvedBindHost: "127.0.0.1",
      }),
    ).toBe("0.0.0.0");
  });

  it("#E18 falls through to the saved config value when there is no draft", () => {
    const pending = resolveBindHost({ hostFlag: null, envHost: null, configBindHost: "0.0.0.0" });
    expect(pending).toBe("0.0.0.0");
    expect(pendingEffectiveHost({ pendingBindHost: pending, resolvedBindHost: "127.0.0.1" })).toBe("0.0.0.0");
  });

  it("#E19 keeps --host winning over config.bindHost on the next start too", () => {
    expect(
      resolveBindHost({ hostFlag: "127.0.0.1", envHost: null, configBindHost: "0.0.0.0" }),
    ).toBe("127.0.0.1");
  });

  it("#E20 resolves the container case from PI_DASHBOARD_HOST for both values", () => {
    const inputs = { hostFlag: null, envHost: "0.0.0.0", configBindHost: "127.0.0.1" };
    expect(resolveBindHost(inputs)).toBe("0.0.0.0");
    expect(pendingEffectiveHost({ pendingBindHost: resolveBindHost(inputs) })).toBe("0.0.0.0");
  });
});

// ── Remediation must not be offered where it cannot work ──────────────
// Both remediations (the inline control and the Server-page picker) write
// `config.bindHost`, which `--host` and `PI_DASHBOARD_HOST` outrank. Offering
// them under either would hand the user a fix that silently does nothing and
// an advisory that never clears. `bindHostSource` is what gates that.
// See change: warn-unreachable-trusted-networks.
describe("bindHostSource", () => {
  it("names the flag when --host is present, even with a config value", () => {
    expect(bindHostSource({ hostFlag: "127.0.0.1", envHost: null, configBindHost: "0.0.0.0" }))
      .toBe("flag");
  });

  it("names the env var when it is present and no flag is", () => {
    expect(bindHostSource({ hostFlag: null, envHost: "0.0.0.0", configBindHost: "127.0.0.1" }))
      .toBe("env");
  });

  it("names the config when it is the deciding link", () => {
    expect(bindHostSource({ hostFlag: null, envHost: null, configBindHost: "0.0.0.0" }))
      .toBe("config");
  });

  it("names the default when nothing supplies a bind host", () => {
    expect(bindHostSource({})).toBe("default");
  });

  it("agrees with resolveBindHost about which link won", () => {
    const chain = { hostFlag: "10.0.0.5", envHost: "0.0.0.0", configBindHost: "127.0.0.1" };
    expect(resolveBindHost(chain)).toBe("10.0.0.5");
    expect(bindHostSource(chain)).toBe("flag");
  });
});
