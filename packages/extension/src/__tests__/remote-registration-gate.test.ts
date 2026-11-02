/**
 * The pre-register gate (tasks 7.2, 7.3): a remote bridge proves the server
 * behind the endpoint holds the pinned key BEFORE it registers a session.
 *
 * See change: add-pi-gateway-transport-identity (D8).
 */

import type { PinVerdict } from "@blackbelt-technology/pi-dashboard-shared/server-pinning.js";
import { describe, expect, it, vi } from "vitest";
import { gateRemoteRegistration, isRemoteEndpoint } from "../remote-registration-gate.js";
import type { PinnedServer, ServerPinStore } from "../server-pin-store.js";

const PIN: PinnedServer = { fingerprint: "sha256:AAA", publicKeyB64: "keyA", pairedAt: "now", lastEndpoint: "ws://dash.example:9999" };

const verdict = (v: Partial<PinVerdict>): PinVerdict => ({ accept: false, cause: "unreachable", reason: "", ...v });

describe("isRemoteEndpoint", () => {
  it.each([
    ["ws+unix:///tmp/gateway-8000.sock", false],
    ["ws://localhost:8000", false],
    ["ws://127.0.0.1:8000", false],
    ["ws://[::1]:8000", false],
    ["ws://dash.example:9999", true],
    ["wss://dash.example", true],
    ["ws://192.168.1.20:8000", true],
  ])("%s → remote=%s", (url, expected) => {
    expect(isRemoteEndpoint(url)).toBe(expected);
  });
});

describe("gateRemoteRegistration", () => {
  const store = (servers: PinnedServer[]): ServerPinStore => ({ servers });

  it("does not challenge a local endpoint — the socket already authorises it", async () => {
    const challenge = vi.fn();
    const res = await gateRemoteRegistration({
      endpoint: "ws+unix:///tmp/gateway-8000.sock",
      store: store([PIN]),
      env: {},
      challenge,
    });
    expect(res).toMatchObject({ allow: true, cause: "local" });
    expect(challenge).not.toHaveBeenCalled();
  });

  it("allows a remote endpoint when the bridge has never paired, and says so", async () => {
    const challenge = vi.fn();
    const res = await gateRemoteRegistration({
      endpoint: "ws://dash.example:9999",
      store: store([]),
      env: {},
      challenge,
    });
    expect(res).toMatchObject({ allow: true, cause: "unpinned-legacy" });
    expect(res.reason).toMatch(/unverified/i);
    expect(challenge).not.toHaveBeenCalled();
  });

  it("registers only after the pinned identity proves possession (7.2)", async () => {
    const challenge = vi.fn(async () => verdict({ accept: true, cause: "verified", reason: "ok" }));
    const res = await gateRemoteRegistration({
      endpoint: "ws://dash.example:9999",
      store: store([PIN]),
      env: {},
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
      endpoint: "ws://dash.example:9999",
      store: store([PIN]),
      env: {},
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
      env: {},
      challenge,
    });
    expect(res).toMatchObject({ allow: false, cause: "not-pinned" });
    expect(challenge).not.toHaveBeenCalled();
  });

  it("treats an unreachable challenge as a refusal, never a pass", async () => {
    const challenge = vi.fn(async () => verdict({ cause: "unreachable", reason: "no answer" }));
    const res = await gateRemoteRegistration({
      endpoint: "ws://dash.example:9999",
      store: store([PIN]),
      env: {},
      challenge,
    });
    expect(res).toMatchObject({ allow: false, cause: "unreachable" });
  });

  it("#E13 challenges the HTTP origin, not the gateway port", async () => {
    const challenge = vi.fn(async (_baseUrl: string, _pin: unknown) => verdict({ accept: true, cause: "verified", reason: "ok" }));
    await gateRemoteRegistration({ endpoint: "ws://dash.example:9999", store: store([PIN]), env: {}, challenge });
    expect(challenge).toHaveBeenCalledTimes(1);
    expect(challenge.mock.calls[0][0]).toBe("http://dash.example:8000");
  });

  it("#X5 refuses with the resolver cause when the override is invalid", async () => {
    const challenge = vi.fn();
    const res = await gateRemoteRegistration({
      endpoint: "ws://dash.example:9999",
      store: store([PIN]),
      env: { PI_DASHBOARD_HTTP_URL: "ftp://dash.example" },
      challenge,
    });
    expect(res).toMatchObject({ allow: false, cause: "bad-http-url" });
    expect(challenge).not.toHaveBeenCalled();
  });
});

/**
 * The identity challenge is a TLS credential call too: validation disabled in the
 * process refuses an https origin without a request. See change: prove-vault-bridge-tls (D7).
 */
describe("gateRemoteRegistration TLS checks", () => {
  const OFF = { NODE_TLS_REJECT_UNAUTHORIZED: "0" };
  const store = (servers: PinnedServer[]): ServerPinStore => ({ servers });

  it("refuses a wss endpoint with tls-verify-disabled and never challenges", async () => {
    const challenge = vi.fn();
    const res = await gateRemoteRegistration({ endpoint: "wss://dash.example:8443", store: store([PIN]), env: OFF, challenge });
    expect(res).toMatchObject({ allow: false, cause: "tls-verify-disabled" });
    expect(res.reason).toContain("NODE_TLS_REJECT_UNAUTHORIZED");
    expect(challenge).not.toHaveBeenCalled();
  });

  it("an invalid HTTP override is reported before tls-verify-disabled", async () => {
    const res = await gateRemoteRegistration({
      endpoint: "wss://dash.example:8443",
      store: store([PIN]),
      env: { ...OFF, PI_DASHBOARD_HTTP_URL: "ftp://dash.example" },
      challenge: vi.fn(),
    });
    expect(res).toMatchObject({ allow: false, cause: "bad-http-url" });
  });

  it("plain ws/http is unaffected by validation being disabled", async () => {
    const challenge = vi.fn(async () => verdict({ accept: true, cause: "verified", reason: "ok" }));
    const res = await gateRemoteRegistration({ endpoint: "ws://dash.example:9999", store: store([PIN]), env: OFF, challenge });
    expect(res).toMatchObject({ allow: true, cause: "verified" });
    expect(challenge).toHaveBeenCalledTimes(1);
  });

  it("the default challenge also refuses (env passed through) without a fetch", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    try {
      const res = await gateRemoteRegistration({ endpoint: "wss://dash.example:8443", store: store([PIN]), env: OFF });
      expect(res).toMatchObject({ allow: false, cause: "tls-verify-disabled" });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
