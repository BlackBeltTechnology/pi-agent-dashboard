/**
 * The pre-register gate (tasks 7.2, 7.3): a remote bridge proves the server
 * behind the endpoint holds the pinned key BEFORE it registers a session.
 *
 * See change: add-pi-gateway-transport-identity (D8).
 */

import type { PinVerdict } from "@blackbelt-technology/pi-dashboard-shared/server-pinning.js";
import { describe, expect, it, vi } from "vitest";
import { gateRemoteRegistration, httpBaseUrlFor, isRemoteEndpoint } from "../remote-registration-gate.js";
import type { PinnedServer, ServerPinStore } from "../server-pin-store.js";

const PIN: PinnedServer = { fingerprint: "sha256:AAA", publicKeyB64: "keyA", pairedAt: "now", lastEndpoint: "ws://dash.example:8000" };

const verdict = (v: Partial<PinVerdict>): PinVerdict => ({ accept: false, cause: "unreachable", reason: "", ...v });

describe("isRemoteEndpoint", () => {
  it.each([
    ["ws+unix:///tmp/gateway-8000.sock", false],
    ["ws://localhost:8000", false],
    ["ws://127.0.0.1:8000", false],
    ["ws://[::1]:8000", false],
    ["ws://dash.example:8000", true],
    ["wss://dash.example", true],
    ["ws://192.168.1.20:8000", true],
  ])("%s → remote=%s", (url, expected) => {
    expect(isRemoteEndpoint(url)).toBe(expected);
  });
});

describe("httpBaseUrlFor", () => {
  it("maps the ws endpoint onto the http origin that serves the challenge", () => {
    expect(httpBaseUrlFor("ws://dash.example:8000")).toBe("http://dash.example:8000");
    expect(httpBaseUrlFor("wss://dash.example")).toBe("https://dash.example");
  });
  it("returns null for a transport with no http origin", () => {
    expect(httpBaseUrlFor("ws+unix:///tmp/x.sock")).toBeNull();
  });
});

describe("gateRemoteRegistration", () => {
  const store = (servers: PinnedServer[]): ServerPinStore => ({ servers });

  it("does not challenge a local endpoint — the socket already authorises it", async () => {
    const challenge = vi.fn();
    const res = await gateRemoteRegistration({
      endpoint: "ws+unix:///tmp/gateway-8000.sock",
      store: store([PIN]),
      challenge,
    });
    expect(res).toMatchObject({ allow: true, cause: "local" });
    expect(challenge).not.toHaveBeenCalled();
  });

  it("allows a remote endpoint when the bridge has never paired, and says so", async () => {
    const challenge = vi.fn();
    const res = await gateRemoteRegistration({
      endpoint: "ws://dash.example:8000",
      store: store([]),
      challenge,
    });
    expect(res).toMatchObject({ allow: true, cause: "unpinned-legacy" });
    expect(res.reason).toMatch(/unverified/i);
    expect(challenge).not.toHaveBeenCalled();
  });

  it("registers only after the pinned identity proves possession (7.2)", async () => {
    const challenge = vi.fn(async () => verdict({ accept: true, cause: "verified", reason: "ok" }));
    const res = await gateRemoteRegistration({
      endpoint: "ws://dash.example:8000",
      store: store([PIN]),
      challenge,
    });
    expect(challenge).toHaveBeenCalledWith("http://dash.example:8000", PIN);
    expect(res).toMatchObject({ allow: true, cause: "verified", fingerprint: "sha256:AAA" });
  });

  it("refuses on mismatch with a distinct cause (7.3)", async () => {
    const challenge = vi.fn(async () =>
      verdict({ cause: "fingerprint-mismatch", reason: "refused: pinned sha256:AAA, endpoint presented sha256:ZZZ" }),
    );
    const res = await gateRemoteRegistration({
      endpoint: "ws://dash.example:8000",
      store: store([PIN]),
      challenge,
    });
    expect(res.allow).toBe(false);
    expect(res.cause).toBe("fingerprint-mismatch");
    expect(res.reason).toContain("sha256:ZZZ");
  });

  it("refuses a remote endpoint that no existing pin covers, rather than pinning on sight", async () => {
    const other: PinnedServer = { ...PIN, fingerprint: "sha256:BBB", lastEndpoint: "ws://b:8000" };
    const challenge = vi.fn();
    const res = await gateRemoteRegistration({
      endpoint: "ws://unknown:9100",
      store: store([PIN, other]),
      challenge,
    });
    expect(res).toMatchObject({ allow: false, cause: "not-pinned" });
    expect(challenge).not.toHaveBeenCalled();
  });

  it("treats an unreachable challenge as a refusal, never a pass", async () => {
    const challenge = vi.fn(async () => verdict({ cause: "unreachable", reason: "no answer" }));
    const res = await gateRemoteRegistration({
      endpoint: "ws://dash.example:8000",
      store: store([PIN]),
      challenge,
    });
    expect(res).toMatchObject({ allow: false, cause: "unreachable" });
  });
});
