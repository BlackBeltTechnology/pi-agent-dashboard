/**
 * R4: the paired-device bearer goes only to a PINNED endpoint (configured, or a
 * pin-store `lastEndpoint`) — never to a discovery-only host, and a lone stored
 * pin never pins anything else.
 *
 * Covers test-plan BE25, BE26, BX4.
 * See change: harden-bridge-inbound-and-discovery (D19).
 */
import { describe, expect, it, vi } from "vitest";
import { canonicalEndpointKey, isPinnedEndpoint } from "../pinned-endpoint.js";
import { createRemoteUpgradePreparer } from "../remote-upgrade-preparer.js";
import type { PinnedServer, ServerPinStore } from "../server-pin-store.js";
import { resolvePinForEndpoint } from "../server-pin-store.js";

const pin = (lastEndpoint: string | undefined, i = 0): PinnedServer => ({
  fingerprint: `sha256:${i}`,
  publicKeyB64: "k",
  lastEndpoint,
  pairedAt: "2026-01-01T00:00:00Z",
});
const store = (...eps: Array<string | undefined>): ServerPinStore => ({ servers: eps.map((e, i) => pin(e, i)) });

describe("BE25: pinned = canonical host:port equality, no sole-pin fallback", () => {
  const configured = "a.local:8000";
  type Row = { pins: ServerPinStore; candidate: string; pinned: boolean };
  const rows: Row[] = [
    { pins: store(), candidate: "a.local:8000", pinned: true }, // configured
    { pins: store(), candidate: "b.local:8000", pinned: false },
    { pins: store(), candidate: "a.local:9000", pinned: false },
    { pins: store("a.local:8000"), candidate: "a.local:8000", pinned: true },
    { pins: store("a.local:8000"), candidate: "b.local:8000", pinned: false }, // lone pin is NOT a fallback
    { pins: store("a.local:8000"), candidate: "a.local:9000", pinned: false },
    { pins: store("x.local:1", "y.local:2"), candidate: "b.local:8000", pinned: false },
    { pins: store("x.local:1", "y.local:2"), candidate: "y.local:2", pinned: true }, // multi-entry: exact lastEndpoint only
    { pins: store("x.local:1", "y.local:2"), candidate: "z.local:3", pinned: false },
    { pins: store(), candidate: "A.LOCAL:8000", pinned: true }, // case
    { pins: store(), candidate: "a.local.:8000", pinned: true }, // trailing dot
    { pins: store(), candidate: "a.local", pinned: false }, // default port 80 ≠ 8000
    { pins: store("[fe80::1]:8000"), candidate: "[FE80::1]:8000", pinned: true }, // IPv6 case + brackets
    { pins: store("[fe80::1]:8000"), candidate: "[fe80::2]:8000", pinned: false },
    { pins: store(undefined), candidate: "b.local:8000", pinned: false }, // a pin with no recorded endpoint pins nothing
  ];
  rows.forEach((r, i) => {
    it(`#${i} ${r.candidate} with ${r.pins.servers.length} pin(s) → ${r.pinned ? "pinned" : "unpinned"}`, () => {
      // IPv6 rows are about the pin store only; the configured endpoint stays a.local:8000.
      expect(isPinnedEndpoint(r.candidate, { configured: [configured], pins: r.pins })).toBe(r.pinned);
    });
  });

  it("scheme-qualified spellings of the same endpoint are equal; default ports follow the scheme", () => {
    expect(canonicalEndpointKey("ws://Home.Local.:443")).toBe("home.local:443");
    expect(canonicalEndpointKey("wss://home.local")).toBe("home.local:443");
    expect(canonicalEndpointKey("ws://home.local")).toBe("home.local:80");
    expect(isPinnedEndpoint("wss://home.local", { configured: ["Home.Local.:443"], pins: store() })).toBe(true);
    expect(isPinnedEndpoint("home.local:443", { configured: ["wss://home.local"], pins: store() })).toBe(true);
  });

  it("unparseable candidates are unpinned, never an error", () => {
    for (const c of ["", "   ", "ws://", "http://[bad"]) {
      expect(isPinnedEndpoint(c, { configured: ["a.local:8000"], pins: store("a.local:8000") })).toBe(false);
    }
  });

  it("the legacy sole-pin fallback is exactly what this gate must NOT use", () => {
    const lone = store("a.local:8000");
    expect(resolvePinForEndpoint(lone, "b.local:8000")).toBeDefined(); // fallback says "pinned"…
    expect(isPinnedEndpoint("b.local:8000", { configured: [], pins: lone })).toBe(false); // …the bearer gate says no
  });
});

function rig(pinned: (e: string) => boolean, fetchImpl?: typeof fetch, token = "BEARER-XYZ") {
  const out: string[] = [];
  const fetchSpy = vi.fn(
    fetchImpl ?? ((async () => ({ ok: true, status: 200, json: async () => ({ data: { ticket: "tkt" } }) })) as unknown as typeof fetch),
  );
  const prepare = createRemoteUpgradePreparer({
    env: { PI_DASHBOARD_TOKEN: token },
    fetchImpl: fetchSpy as unknown as typeof fetch,
    log: { log: (...a: unknown[]) => out.push(a.join(" ")), error: (...a: unknown[]) => out.push(a.join(" ")) },
    record: () => {},
    isPinned: pinned,
  });
  return { prepare, out, fetchSpy };
}

describe("BE26: no bearer to an unpinned discovered host", () => {
  it("sends zero requests, logs `unpinned_discovered_host`, never logs the bearer; a pinned host still gets it", async () => {
    const pins = store("pinned.local:9999");
    const isPinned = (e: string) => isPinnedEndpoint(e, { configured: ["ws://configured.local:9999"], pins });
    const { prepare, out, fetchSpy } = rig(isPinned);

    await expect(prepare("ws://discovered.local:9999")).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled(); // not even the ticket mint
    const joined = out.join("\n");
    expect(joined).toContain("bridge ticket unpinned_discovered_host");
    expect(joined).not.toContain("BEARER-XYZ");

    const res = await prepare("ws://pinned.local:9999");
    expect(res).toEqual({ url: "ws://pinned.local:9999?ticket=tkt" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((fetchSpy.mock.calls[0][1] as { headers: Record<string, string> }).headers.Authorization).toBe("Bearer BEARER-XYZ");

    // The configured endpoint is pinned by definition.
    await prepare("ws://configured.local:9999");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("a loopback endpoint mints nothing and is not subject to the gate", async () => {
    const { prepare, fetchSpy, out } = rig(() => false);
    expect(await prepare("ws://127.0.0.1:9999")).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(out.join("\n")).not.toContain("unpinned_discovered_host");
  });

  it("a lone stored pin never pins a different discovered host", async () => {
    const lone = store("a.local:8000");
    const { prepare, fetchSpy } = rig((e) => isPinnedEndpoint(e, { configured: [], pins: lone }));
    await expect(prepare("ws://b.local:8000")).rejects.toThrow();
    await expect(prepare("ws://a.local:9000")).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("BX4: a failing mint on a pinned endpoint never falls back to another host", () => {
  const failures: Array<[string, typeof fetch, RegExp]> = [
    ["401", (async () => ({ ok: false, status: 401 })) as unknown as typeof fetch, /bridge ticket refused/],
    ["network reset", (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch, /bridge ticket unreachable/],
    ["stall > timeout", (async () => { throw new Error("The operation was aborted due to timeout"); }) as unknown as typeof fetch, /bridge ticket unreachable/],
  ];
  for (const [label, fetchImpl, logRe] of failures) {
    it(`${label}: existing \`bridge ticket <cause>\` log; the bearer is never retried elsewhere`, async () => {
      const hosts: string[] = [];
      const spying = (async (url: string, init: unknown) => {
        hosts.push(new URL(url).host);
        return (fetchImpl as unknown as (u: string, i: unknown) => Promise<Response>)(url, init);
      }) as unknown as typeof fetch;
      const { prepare, out } = rig((e) => e.includes("pinned.local"), spying);
      await expect(prepare("ws://pinned.local:9999")).rejects.toThrow();
      expect(out.join("\n")).toMatch(logRe);
      expect(out.join("\n")).not.toContain("BEARER-XYZ");
      expect(new Set(hosts)).toEqual(new Set(["pinned.local:8000"])); // only the pinned host was ever contacted
    });
  }
});
