/**
 * D10 — which listeners the gateway binds, and why.
 *
 * The default POSIX start SHALL bind no TCP port at all (task 8.1); the
 * loopback fallback exists only where a unix socket is unrepresentable (D6,
 * D15) and is pinned to 127.0.0.1 (task 5.2); a remote/container deployment
 * opts in explicitly and gets the configured bind host (D10b, task 8.6).
 *
 * See change: add-pi-gateway-transport-identity.
 */
import { describe, expect, it } from "vitest";
import { decideGatewayListeners, isTcpOptIn } from "../pi/gateway-transport-policy.js";

const unix = { transport: "unix", path: "/home/u/.pi/dashboard/gateway-8001.sock" } as const;
const loopback = { transport: "loopback", port: 8001, reason: "win32 has no UDS transport" } as const;

describe("isTcpOptIn", () => {
  it("is off by default — a POSIX start binds no bridge TCP port (8.1)", () => {
    expect(isTcpOptIn({})).toBe(false);
  });
  it.each(["1", "true", "yes"])("is on for PI_GATEWAY_TCP=%s", (v) => {
    expect(isTcpOptIn({ PI_GATEWAY_TCP: v })).toBe(true);
  });
  it.each(["0", "false", "", "no"])("stays off for PI_GATEWAY_TCP=%s", (v) => {
    expect(isTcpOptIn({ PI_GATEWAY_TCP: v })).toBe(false);
  });
});

describe("decideGatewayListeners", () => {
  it("binds the socket and nothing else by default (8.1)", () => {
    const d = decideGatewayListeners({ local: unix, tcpOptIn: false, host: "0.0.0.0", piPort: 8001 });
    expect(d.socketPath).toBe(unix.path);
    expect(d.tcp).toBeUndefined();
    expect(d.reason).toMatch(/socket/);
  });

  it("adds TCP alongside the socket only on explicit opt-in, on the configured host (8.4/8.6)", () => {
    const d = decideGatewayListeners({ local: unix, tcpOptIn: true, host: "0.0.0.0", piPort: 8001 });
    expect(d.socketPath).toBe(unix.path);
    expect(d.tcp).toEqual({ host: "0.0.0.0", port: 8001 });
  });

  it("falls back to a 127.0.0.1 listener where no socket is representable (5.2, D15)", () => {
    const d = decideGatewayListeners({ local: loopback, tcpOptIn: false, host: "0.0.0.0", piPort: 8001 });
    expect(d.socketPath).toBeUndefined();
    // Pinned to loopback REGARDLESS of the configured bind host.
    expect(d.tcp).toEqual({ host: "127.0.0.1", port: 8001 });
    expect(d.reason).toContain(loopback.reason);
  });

  it("lets an explicit opt-in widen the fallback listener to the configured host", () => {
    const d = decideGatewayListeners({ local: loopback, tcpOptIn: true, host: "0.0.0.0", piPort: 8001 });
    expect(d.tcp).toEqual({ host: "0.0.0.0", port: 8001 });
  });

  it("always binds at least one listener — a gateway with none serves nobody", () => {
    for (const local of [unix, loopback]) {
      for (const tcpOptIn of [true, false]) {
        const d = decideGatewayListeners({ local, tcpOptIn, host: "0.0.0.0", piPort: 8001 });
        expect(Boolean(d.socketPath) || Boolean(d.tcp)).toBe(true);
      }
    }
  });
});
