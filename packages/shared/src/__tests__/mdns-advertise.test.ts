import { beforeEach, describe, expect, it, vi } from "vitest";
import { advertiseDashboard, shouldAdvertise, stopAdvertising } from "../mdns-discovery.js";

/**
 * Honest advertisement (change: fix-bridge-mdns-migration-hijack, D4).
 *
 * A dashboard bound only to loopback used to advertise itself under the
 * machine's LAN hostname — a record every consumer resolves to an address the
 * server never answers on. That record is the poison the bridge-side
 * migration gate defends against; the server must not publish it in the first
 * place: bound to loopback, it advertises nothing.
 */

type PublishConfig = { name: string; type: string; port: number; txt: Record<string, string> };

describe("shouldAdvertise (bind-host gate)", () => {
  it.each([
    ["127.0.0.1"],
    ["::1"],
    ["localhost"],
    ["LOCALHOST"],
  ])("does not advertise when bound to loopback (%s)", (bindHost) => {
    expect(shouldAdvertise(bindHost).advertise).toBe(false);
  });

  it.each([
    ["0.0.0.0", "all interfaces"],
    ["::", "all interfaces (IPv6)"],
    ["", "unset (server default listen)"],
    [undefined, "legacy caller that passes no bind host"],
    ["192.168.1.10", "a specific LAN address"],
    ["myhost.local", "a LAN hostname the server actually serves on"],
  ])("advertises when bound to %s (%s)", (bindHost, _label) => {
    expect(shouldAdvertise(bindHost).advertise).toBe(true);
  });

  it("names the bind host in the refusal reason", () => {
    const verdict = shouldAdvertise("127.0.0.1");
    expect(verdict.reason).toContain("127.0.0.1");
  });
});

describe("advertiseDashboard (loopback-bound server publishes nothing)", () => {
  let publish: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    publish = vi.fn();
    stopAdvertising();
  });

  it("4.3 never publishes a record when the server is bound only to loopback", () => {
    advertiseDashboard(8478, 9999, { bindHost: "127.0.0.1", publish: publish as any });
    expect(publish).not.toHaveBeenCalled();
    stopAdvertising();
  });

  it("publishes when the server is bound to all interfaces (unchanged behaviour)", () => {
    advertiseDashboard(8478, 9999, { bindHost: "0.0.0.0", publish: publish as any });
    expect(publish).toHaveBeenCalledTimes(1);
    const cfg = publish.mock.calls[0][0] as PublishConfig;
    expect(cfg.port).toBe(8478);
    expect(cfg.txt.piPort).toBe("9999");
    stopAdvertising();
  });

  it("publishes when no bind host is given (back-compat for callers predating the gate)", () => {
    advertiseDashboard(8478, 9999, { publish: publish as any });
    expect(publish).toHaveBeenCalledTimes(1);
    stopAdvertising();
  });

  it("the skip decision equals shouldAdvertise's verdict", () => {
    expect(shouldAdvertise("::1").advertise).toBe(false);
    advertiseDashboard(8478, 9999, { bindHost: "::1", publish: publish as any });
    expect(publish).not.toHaveBeenCalled();
    stopAdvertising();
  });
});
