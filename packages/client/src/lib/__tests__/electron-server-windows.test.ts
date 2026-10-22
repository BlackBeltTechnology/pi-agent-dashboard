/**
 * Main-window bridge wrappers: capability probe per method (loopback page only) and the
 * renderer-safe copy of `listServers`. See change: group-servers-by-identity (D8, D9; test-plan #F5, #F9).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { getListServers, getOpenServerWindow, getPairWithCode } from "../electron-server-windows.js";

const BEARER = "BEARER-SENTINEL";

afterEach(() => {
  delete (window as unknown as { piDashboard?: unknown }).piDashboard;
  vi.unstubAllGlobals();
});

describe("electron-server-windows capability wrappers", () => {
  it("are undefined without a bridge (a plain browser)", () => {
    expect(getListServers()).toBeUndefined();
    expect(getPairWithCode()).toBeUndefined();
    expect(getOpenServerWindow()).toBeUndefined();
  });

  it("each method is probed on its own: a bridge without listServers offers only what it has", () => {
    (window as unknown as { piDashboard: unknown }).piDashboard = { openServerWindow: vi.fn() };
    expect(getOpenServerWindow()).toBeDefined();
    expect(getListServers()).toBeUndefined();
    expect(getPairWithCode()).toBeUndefined();
  });

  it("pairWithCode passes the fingerprint through and returns the app's answer", async () => {
    const pairWithCode = vi.fn(async () => ({ ok: false as const, reason: "identity_mismatch" }));
    (window as unknown as { piDashboard: unknown }).piDashboard = { pairWithCode };
    await expect(getPairWithCode()!({ fingerprint: "sha256:abc" })).resolves.toEqual({ ok: false, reason: "identity_mismatch" });
    expect(pairWithCode).toHaveBeenCalledWith({ fingerprint: "sha256:abc" });
  });

  it("listServers keeps only renderer-safe fields, drops rows without identity and defaults unknown states", async () => {
    (window as unknown as { piDashboard: unknown }).piDashboard = {
      listServers: async () => ({
        paired: [
          { fingerprint: "sha256:a", label: "a", state: "paired", host: "a.lan:8000", bearer: BEARER, cookie: BEARER },
          { label: "no-fingerprint", state: "paired" },
          { fingerprint: "sha256:b", state: "weird" },
        ],
        discovered: [
          { name: "n", host: "h.lan", port: 8000, state: "paired", token: BEARER },
          { host: "no-port.lan" },
          { host: "x.lan", port: 1, state: "nonsense" },
        ],
        bearer: BEARER,
      }),
    };
    const state = await getListServers()!();
    expect(JSON.stringify(state)).not.toContain(BEARER);
    expect(state).toEqual({
      paired: [
        { fingerprint: "sha256:a", label: "a", state: "paired", host: "a.lan:8000" },
        { fingerprint: "sha256:b", label: "", state: "paired" },
      ],
      discovered: [
        { name: "n", host: "h.lan", port: 8000, state: "paired" },
        { name: "x.lan", host: "x.lan", port: 1, state: "not-paired" },
      ],
    });
  });

  it("a non-object bridge answer is null", async () => {
    (window as unknown as { piDashboard: unknown }).piDashboard = { listServers: async () => "nope" };
    await expect(getListServers()!()).resolves.toBeNull();
  });

  it("a remote-origin document never gets the capability", () => {
    const orig = window.location;
    Object.defineProperty(window, "location", { value: { ...orig, hostname: "dash.example.lan" }, configurable: true });
    try {
      (window as unknown as { piDashboard: unknown }).piDashboard = { listServers: vi.fn(), pairWithCode: vi.fn(), openServerWindow: vi.fn() };
      expect(getListServers()).toBeUndefined();
      expect(getPairWithCode()).toBeUndefined();
      expect(getOpenServerWindow()).toBeUndefined();
    } finally {
      Object.defineProperty(window, "location", { value: orig, configurable: true });
    }
  });
});
