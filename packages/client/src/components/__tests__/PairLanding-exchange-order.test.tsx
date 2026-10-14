/**
 * F1: PairLanding navigates only AFTER the device-cookie exchange resolves.
 * See change: harden-trust-and-credential-boundaries (D5).
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const challengeIdentity = vi.fn();
const postJson = vi.fn();
vi.mock("../../lib/pairing/pair-protocol.js", () => ({
  challengeIdentity: (...a: any[]) => challengeIdentity(...a),
  postJson: (...a: any[]) => postJson(...a),
}));

let release: () => void = () => {};
const finishDevicePairing = vi.fn(
  () => new Promise<void>((r) => { release = r; }),
);
vi.mock("../../lib/pairing/device-auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/pairing/device-auth.js")>();
  return {
    ...actual,
    // Default: the hand-released stub below. F7 swaps in the real implementation once.
    finishDevicePairing: (...a: any[]) => (finishDevicePairing as any)(...a),
    realFinishDevicePairing: actual.finishDevicePairing,
  };
});

import * as deviceAuth from "../../lib/pairing/device-auth.js";
import { encodePayloadString } from "../../lib/pairing/pairing-qr.js";
import { PairLanding } from "../connectivity/PairLanding.js";

describe("PairLanding exchange ordering (F1)", () => {
  const original = window.location;
  let hrefSets: string[];
  beforeEach(() => {
    hrefSets = [];
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...original,
        hash: `#${encodePayloadString({ v: 1, id: "sha256:fp", code: "482913", urls: ["https://relay.example.io"] })}`,
        get href() { return "http://localhost/"; },
        set href(v: string) { hrefSets.push(v); },
      },
    });
    challengeIdentity.mockResolvedValue({ fingerprint: "sha256:fp", publicKey: "pk", verified: true });
    postJson.mockImplementation(async (_b: string, path: string) => {
      if (path === "/api/pair/redeem") return { pendingId: "p1", confirmCode: "11 22 33" };
      return { status: "approved", token: "T" };
    });
  });
  afterEach(() => {
    cleanup();
    Object.defineProperty(window, "location", { configurable: true, value: original });
  });

  it("does not assign location.href until the exchange resolves", async () => {
    render(<PairLanding />);
    await waitFor(() => expect(finishDevicePairing).toHaveBeenCalledWith("T"));
    // fixed-tick-waits: opt-out — proves the ABSENCE of a navigation, nothing to poll for
    await new Promise((r) => setTimeout(r, 50));
    expect(hrefSets).toEqual([]);
    release();
    await waitFor(() => expect(hrefSets).toEqual(["/"]));
  });
});

/**
 * F7: request-mode approval stores the bearer through the REAL `finishDevicePairing`
 * (cookie exchange, cookie-only check), clears the stored bearer after the check, then
 * navigates to `/`. See change: add-lan-knock-pairing (test-plan #F7).
 */
describe("PairLanding request mode approval (F7)", () => {
  const original = window.location;
  const BEARER = "pi-dashboard:device-bearer";
  const MARKER = "pi-dashboard:device-paired";
  let hrefSets: string[];
  let fetchCalls: Array<{ url: string; headers: Headers; credentials?: RequestCredentials }>;

  beforeEach(() => {
    hrefSets = [];
    fetchCalls = [];
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...original,
        protocol: "http:",
        host: "192.168.16.204:8000",
        hostname: "192.168.16.204",
        search: "?request",
        hash: "",
        get href() { return "http://192.168.16.204:8000/pair?request"; },
        set href(v: string) { hrefSets.push(v); },
      },
    });
    // The real implementation, not the hand-released stub.
    finishDevicePairing.mockImplementationOnce(((deviceAuth as any).realFinishDevicePairing) as never);
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), headers: new Headers(init?.headers), credentials: init?.credentials });
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      if (String(url) === "/api/pair/request") {
        return json({ success: true, data: { pendingId: "p1", confirmCode: "48217730", expiresAt: Date.now() + 300_000, fingerprint: "sha256:x" } });
      }
      return json({ success: true });
    }));
    postJson.mockImplementation(async () => ({ status: "approved", token: "TOK" }));
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
    Object.defineProperty(window, "location", { configurable: true, value: original });
  });

  it("stores the bearer, proves the cookie, clears the bearer, then navigates to /", async () => {
    render(<PairLanding />);
    await act(async () => { fireEvent.click(screen.getByTestId("pair-landing-request-send")); await vi.advanceTimersByTimeAsync(0); });
    expect(hrefSets).toEqual([]);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(finishDevicePairing).toHaveBeenCalledWith("TOK");
    const urls = fetchCalls.map((c) => c.url);
    expect(urls).toEqual(["/api/pair/request", "/api/device-session", "/api/favorite-models"]);
    // The exchange presents the bearer; the proof request relies on the cookie alone.
    expect(fetchCalls[1].headers.get("Authorization")).toBe("Bearer TOK");
    expect(fetchCalls[2].headers.get("Authorization")).toBeNull();
    expect(fetchCalls[2].credentials).toBe("same-origin");
    expect(localStorage.getItem(BEARER)).toBeNull();
    expect(localStorage.getItem(MARKER)).toBe("1");
    expect(hrefSets).toEqual(["/"]);
  });
});
