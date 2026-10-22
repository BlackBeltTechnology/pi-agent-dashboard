/**
 * PairLanding (browser `/pair`) tests — change: make-pairing-qr-camera-scannable.
 * Covers 1.4 (hash → decode → redeem→confirm→poll→store bearer) and
 * 5.2 (refuse to proceed on server-fingerprint mismatch).
 * Mocks the pair-protocol handshake so no real transport/crypto runs.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const challengeIdentity = vi.fn();
const postJson = vi.fn();
vi.mock("../../lib/pairing/pair-protocol.js", () => ({
  challengeIdentity: (...a: any[]) => challengeIdentity(...a),
  postJson: (...a: any[]) => postJson(...a),
}));

const storeDeviceBearer = vi.fn();
vi.mock("../../lib/pairing/device-auth.js", () => ({
  storeDeviceBearer: (...a: any[]) => storeDeviceBearer(...a),
  // The cookie exchange is covered in device-auth-cookie.test.ts; here it just stores.
  finishDevicePairing: async (...a: any[]) => storeDeviceBearer(...a),
}));

const requestAccess = vi.fn();
vi.mock("../../lib/pairing/pairing-api.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/pairing/pairing-api.js")>()),
  requestAccess: (...a: any[]) => requestAccess(...a),
}));

import type { PairingPayload } from "../../lib/pairing/pairing-api.js";
import { encodePayloadString } from "../../lib/pairing/pairing-qr.js";
import { PairLanding } from "../connectivity/PairLanding.js";

const PAYLOAD: PairingPayload = {
  v: 1,
  id: "sha256:server-fp",
  code: "482913",
  urls: ["https://relay.example.io"],
};

function setHash(payload: PairingPayload) {
  window.location.hash = `#${encodePayloadString(payload)}`;
}

beforeEach(() => {
  challengeIdentity.mockReset();
  postJson.mockReset();
  storeDeviceBearer.mockReset();
  requestAccess.mockReset();
  window.location.hash = "";
});
afterEach(() => cleanup());

describe("PairLanding", () => {
  it("1.4 decodes the hash, redeems, shows the confirm code, then stores the bearer on approval", async () => {
    setHash(PAYLOAD);
    challengeIdentity.mockResolvedValue({ fingerprint: "sha256:server-fp", publicKey: "pk", verified: true });
    postJson.mockImplementation(async (_base: string, path: string) => {
      if (path === "/api/pair/redeem") return { pendingId: "p1", confirmCode: "77 88 99" };
      if (path === "/api/pair/poll") {
        // Yield a macrotask so React commits the polling/confirm-code render
        // before approval flips the phase to done. This is a mock-internal
        // yield, not an assertion barrier — hence the opt-out below.
        // fixed-tick-waits: opt-out — mock-internal macrotask yield, gates no assertion
        await new Promise((r) => setTimeout(r, 0));
        return { status: "approved", token: "BEARER-XYZ" };
      }
      throw new Error(`unexpected ${path}`);
    });

    const onPaired = vi.fn();
    render(<PairLanding onPaired={onPaired} />);

    await waitFor(() => expect(screen.getByTestId("pair-landing-confirm-code").textContent).toBe("77 88 99"));
    await waitFor(() => expect(storeDeviceBearer).toHaveBeenCalledWith("BEARER-XYZ"));
    expect(onPaired).toHaveBeenCalledWith("BEARER-XYZ");
    // Redeem carried the one-time code from the payload.
    expect(postJson).toHaveBeenCalledWith("https://relay.example.io", "/api/pair/redeem", { code: "482913" });
    await waitFor(() => expect(screen.getByTestId("pair-landing-done")).toBeDefined());
  });

  it("5.2 refuses to redeem when the server fingerprint does not match the pinned payload.id", async () => {
    setHash(PAYLOAD);
    challengeIdentity.mockResolvedValue({ fingerprint: "sha256:IMPOSTOR", publicKey: "pk", verified: true });

    render(<PairLanding />);

    await waitFor(() => expect(screen.getByTestId("pair-landing-error")).toBeDefined());
    expect(screen.getByTestId("pair-landing-error").textContent).toMatch(/identity|refused|mismatch/i);
    // Never redeemed, never stored a bearer.
    expect(postJson).not.toHaveBeenCalled();
    expect(storeDeviceBearer).not.toHaveBeenCalled();
  });

  // change: add-pairing-approval-dialog — test-plan F11 / X12.
  function pollReturning(status: string) {
    setHash(PAYLOAD);
    challengeIdentity.mockResolvedValue({ fingerprint: "sha256:server-fp", publicKey: "pk", verified: true });
    postJson.mockImplementation(async (_base: string, path: string) => {
      if (path === "/api/pair/redeem") return { pendingId: "p1", confirmCode: "12345678" };
      if (path === "/api/pair/poll") return { status };
      throw new Error(`unexpected ${path}`);
    });
  }
  const pollCalls = () => postJson.mock.calls.filter((c) => c[1] === "/api/pair/poll").length;

  it("F11 shows the decline on `rejected`, offers no restart, and stops polling", async () => {
    pollReturning("rejected");
    render(<PairLanding />);
    await waitFor(() => expect(screen.getByTestId("pair-landing-rejected")).toBeDefined());
    expect(screen.getByTestId("pair-landing-rejected").textContent).toContain("The dashboard declined this device");
    expect(screen.queryByTestId("pair-landing-restart")).toBeNull();
    const calls = pollCalls();
    expect(calls).toBe(1);
    // Past one poll interval (2s): no further poll was issued.
    // fixed-tick-waits: opt-out — proves ABSENCE of a poll past the 2s interval
    await new Promise((r) => setTimeout(r, 2100));
    expect(pollCalls()).toBe(calls);
  });

  it("X12 an unknown status is terminal: polling stops and an error shows", async () => {
    pollReturning("weird");
    render(<PairLanding />);
    await waitFor(() => expect(screen.getByTestId("pair-landing-error")).toBeDefined());
    const calls = pollCalls();
    expect(calls).toBe(1);
    // fixed-tick-waits: opt-out — proves ABSENCE of a poll past the 2s interval
    await new Promise((r) => setTimeout(r, 2100));
    expect(pollCalls()).toBe(calls);
  });

  it("shows an error + restart affordance when the hash is missing", async () => {
    window.location.hash = "";
    render(<PairLanding />);
    await waitFor(() => expect(screen.getByTestId("pair-landing-error")).toBeDefined());
    expect(screen.getByTestId("pair-landing-restart")).toBeDefined();
    expect(challengeIdentity).not.toHaveBeenCalled();
  });

  it("styles from theme tokens, never a hardcoded dark-only palette (readable in light + dark)", async () => {
    window.location.hash = "";
    const { container } = render(<PairLanding />);
    await waitFor(() => expect(screen.getByTestId("pair-landing-error")).toBeDefined());
    const classes = Array.from(container.querySelectorAll("[class]")).map((el) => el.getAttribute("class")).join(" ");
    expect(classes).not.toMatch(/\b(?:text|bg|border)-(?:neutral|red|green|blue)-\d/);
    expect(screen.getByTestId("pair-landing").className).toContain("text-[var(--text-primary)]");
    expect(screen.getByTestId("pair-landing-error").innerHTML).toContain("var(--severity-error-fg)");
  });
});

// ─── Request mode (`/pair?request`) — change: add-lan-knock-pairing ──────────
describe("PairLanding QR mode keeps its bearer message (F8)", () => {
  it("QR landing shows the keep-failed message when the cookie could not be proven", async () => {
    setHash(PAYLOAD);
    challengeIdentity.mockResolvedValue({ fingerprint: "sha256:server-fp", publicKey: "pk", verified: true });
    postJson.mockImplementation(async (_b: string, path: string) =>
      path === "/api/pair/redeem" ? { pendingId: "p1", confirmCode: "12345678" } : { status: "approved", token: "TOK" },
    );
    storeDeviceBearer.mockReturnValueOnce({ keepFailed: true });
    const onPaired = vi.fn();
    render(<PairLanding onPaired={onPaired} />);
    await waitFor(() => expect(screen.getByTestId("pair-landing-keep-failed").textContent).toContain("couldn't keep its access"));
    expect(onPaired).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("pair-landing-open"));
    expect(onPaired).toHaveBeenCalledWith("TOK");
  });
});

describe("PairLanding request mode", () => {
  const original = window.location;
  const STORE = "pi-dashboard:pair-request";
  let hrefSets: string[];

  function mockLocation(over: { protocol?: string; host?: string; search?: string; hash?: string } = {}) {
    const protocol = over.protocol ?? "http:";
    const host = over.host ?? "192.168.16.204:8000";
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...original,
        protocol,
        host,
        hostname: host.split(":")[0],
        search: over.search ?? "?request",
        hash: over.hash ?? "",
        get href() { return `${protocol}//${host}/pair?request`; },
        set href(v: string) { hrefSets.push(v); },
      },
    });
  }
  const setVisibility = (state: "visible" | "hidden") =>
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  const click = (testId: string) => act(async () => { fireEvent.click(screen.getByTestId(testId)); await vi.advanceTimersByTimeAsync(0); });
  const knock = (over: Record<string, unknown> = {}) => ({
    ok: true, pendingId: "p1", confirmCode: "48217730", expiresAt: Date.now() + 300_000, fingerprint: "sha256:x", ...over,
  });
  const pollCount = () => postJson.mock.calls.filter((c) => c[1] === "/api/pair/poll").length;
  const pollWith = (status: string, token?: string) =>
    postJson.mockImplementation(async (_b: string, path: string) => {
      if (path === "/api/pair/poll") return { status, ...(token ? { token } : {}) };
      throw new Error(`unexpected ${path}`);
    });

  beforeEach(() => {
    hrefSets = [];
    sessionStorage.clear();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    mockLocation();
    setVisibility("visible");
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Object.defineProperty(window, "location", { configurable: true, value: original });
    sessionStorage.clear();
  });

  it("F1 intro works in a non-secure context: host, unencrypted note, primary action, no challenge, no throw", () => {
    vi.stubGlobal("crypto", {}); // no subtle, no randomUUID, no getRandomValues
    render(<PairLanding />);
    expect(screen.getByTestId("pair-landing-request-host").textContent).toBe("192.168.16.204:8000");
    expect(screen.getByTestId("pair-landing-request-unencrypted").textContent).toContain("This page isn't encrypted");
    const send = screen.getByTestId("pair-landing-request-send") as HTMLButtonElement;
    expect(send.textContent).toBe("Request access");
    expect(send.disabled).toBe(false);
    expect(screen.getByLabelText(/Device name/)).toBeDefined();
    expect(challengeIdentity).not.toHaveBeenCalled();
    expect(postJson).not.toHaveBeenCalled();
  });

  it("F1 an https origin has no unencrypted note", () => {
    mockLocation({ protocol: "https:", host: "pi.example.io" });
    render(<PairLanding />);
    expect(screen.queryByTestId("pair-landing-request-unencrypted")).toBeNull();
  });

  it("a payload fragment keeps QR mode even with ?request", async () => {
    mockLocation({ hash: `#${encodePayloadString(PAYLOAD)}` });
    challengeIdentity.mockResolvedValue({ fingerprint: "sha256:IMPOSTOR", publicKey: "pk", verified: true });
    render(<PairLanding />);
    await flush();
    expect(challengeIdentity).toHaveBeenCalled();
    expect(screen.queryByTestId("pair-landing-request-send")).toBeNull();
  });

  it("F2 waiting: grouped code, spoken in two groups, countdown, status region, no Cancel", async () => {
    requestAccess.mockResolvedValue(knock());
    pollWith("pending");
    render(<PairLanding />);
    fireEvent.change(screen.getByLabelText(/Device name/), { target: { value: "Laptop" } });
    await click("pair-landing-request-send");
    expect(requestAccess).toHaveBeenCalledWith("Laptop");
    const code = screen.getByTestId("pair-landing-request-code");
    expect(code.textContent).toBe("4821 7730");
    expect(code.getAttribute("aria-label")).toBe("4 8 2 1, 7 7 3 0");
    expect(screen.getByTestId("pair-landing-request-countdown").textContent).toContain("5:00");
    expect(screen.getByTestId("pair-landing-request-status").getAttribute("role")).toBe("status");
    expect(screen.getByTestId("pair-landing-request-status").textContent).toContain("(192.168.16.204)");
    expect(screen.queryByRole("button")).toBeNull(); // no Cancel, no retry while waiting
    await flush(1000);
    expect(screen.getByTestId("pair-landing-request-countdown").textContent).toContain("4:59");
    expect(JSON.parse(sessionStorage.getItem(STORE) ?? "{}")).toMatchObject({ pendingId: "p1", confirmCode: "48217730" });
  });

  it("F3 reload resumes the same code with no second knock and polls", async () => {
    sessionStorage.setItem(STORE, JSON.stringify({ pendingId: "p1", confirmCode: "48217730", expiresAt: Date.now() + 100_000 }));
    pollWith("pending");
    render(<PairLanding />);
    await flush();
    expect(screen.getByTestId("pair-landing-request-code").textContent).toBe("4821 7730");
    expect(requestAccess).not.toHaveBeenCalled();
    expect(postJson).toHaveBeenCalledWith("", "/api/pair/poll", { pendingId: "p1" });
  });

  it("F3 a corrupt stored request is ignored", () => {
    sessionStorage.setItem(STORE, "{nope");
    render(<PairLanding />);
    expect(screen.getByTestId("pair-landing-request-send")).toBeDefined();
  });

  it.each([["approved"], ["rejected"], ["unknown"]])("F3 storage is cleared once the request resolves (%s)", async (status) => {
    sessionStorage.setItem(STORE, JSON.stringify({ pendingId: "p1", confirmCode: "48217730", expiresAt: Date.now() + 100_000 }));
    pollWith(status, status === "approved" ? "TOK" : undefined);
    render(<PairLanding onPaired={() => {}} />);
    await flush();
    expect(sessionStorage.getItem(STORE)).toBeNull();
  });

  it("F3 storage is cleared at expiry", async () => {
    sessionStorage.setItem(STORE, JSON.stringify({ pendingId: "p1", confirmCode: "48217730", expiresAt: Date.now() + 5_000 }));
    pollWith("pending");
    render(<PairLanding />);
    await flush(7_000);
    expect(screen.getByTestId("pair-landing-request-expired")).toBeDefined();
    expect(sessionStorage.getItem(STORE)).toBeNull();
  });

  it("F4 visibilitychange to visible polls immediately; hidden does not", async () => {
    requestAccess.mockResolvedValue(knock());
    pollWith("pending");
    render(<PairLanding />);
    await click("pair-landing-request-send");
    await flush(500); // the 2 s timer is not due
    expect(pollCount()).toBe(0);
    setVisibility("hidden");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(0); });
    expect(pollCount()).toBe(0);
    setVisibility("visible");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(0); });
    expect(pollCount()).toBe(1);
  });

  it("a transient poll failure keeps waiting and retries", async () => {
    requestAccess.mockResolvedValue(knock());
    let n = 0;
    postJson.mockImplementation(async () => { if (n++ === 0) throw new Error("blip"); return { status: "pending" }; });
    render(<PairLanding />);
    await click("pair-landing-request-send");
    await flush(2000);
    expect(screen.getByTestId("pair-landing-request-code")).toBeDefined();
    await flush(2000);
    expect(pollCount()).toBe(2);
  });

  it("F5 unknown BEFORE expiry → may have been decided + Request again", async () => {
    requestAccess.mockResolvedValue(knock());
    pollWith("unknown");
    render(<PairLanding />);
    await click("pair-landing-request-send");
    await flush(2000);
    expect(screen.getByTestId("pair-landing-request-missed").textContent).toContain("may have been decided while this page was away");
    expect(screen.getByTestId("pair-landing-request-retry").textContent).toBe("Request again");
    requestAccess.mockResolvedValue(knock({ pendingId: "p2" }));
    await click("pair-landing-request-retry");
    expect(requestAccess).toHaveBeenCalledTimes(2);
  });

  it("F5 unknown AFTER expiry → expired + Request again", async () => {
    requestAccess.mockResolvedValue(knock({ expiresAt: Date.now() + 1_000 }));
    pollWith("unknown");
    render(<PairLanding />);
    await click("pair-landing-request-send");
    await flush(2000);
    expect(screen.getByTestId("pair-landing-request-expired").textContent).toContain("The request expired before anyone approved it");
    expect(screen.getByTestId("pair-landing-request-retry").textContent).toBe("Request again");
  });

  it("rejected → declined, no immediate retry, polling stops", async () => {
    requestAccess.mockResolvedValue(knock());
    pollWith("rejected");
    render(<PairLanding />);
    await click("pair-landing-request-send");
    await flush(2000);
    const box = screen.getByTestId("pair-landing-request-rejected");
    expect(box.textContent).toContain("The dashboard declined this request");
    expect(box.getAttribute("role")).toBe("alert");
    expect(screen.queryByRole("button")).toBeNull();
    const calls = pollCount();
    await flush(10_000);
    expect(pollCount()).toBe(calls);
  });

  const GENERIC = "This dashboard refused the request.";
  it.each([
    ["knock_disabled", "isn't accepting requests from the network", true, undefined],
    ["knock_not_lan", "only accepted from the same local network", false, undefined],
    ["knock_pending", "already waiting", false, undefined],
    ["knock_busy", "Several devices are already waiting", true, 60],
    ["host_not_admitted", GENERIC, true, undefined],
    ["untrusted origin", GENERIC, true, undefined],
    ["unsupported_media_type", GENERIC, true, undefined],
    ["something_new", GENERIC, true, undefined],
  ])("F6 refusal %s → its copy", async (error, copy, retry, retryAfter) => {
    requestAccess.mockResolvedValue({ ok: false, error, ...(retryAfter ? { retryAfter } : {}) });
    render(<PairLanding />);
    await click("pair-landing-request-send");
    expect(screen.getByTestId("pair-landing-request-refused").textContent).toContain(copy);
    expect(screen.queryByTestId("pair-landing-request-retry") !== null).toBe(retry);
    expect(sessionStorage.getItem(STORE)).toBeNull();
  });

  it("F6 knock_rate_limited shows a disabled m:ss countdown button that re-enables", async () => {
    requestAccess.mockResolvedValue({ ok: false, error: "knock_rate_limited", retryAfter: 420 });
    render(<PairLanding />);
    await click("pair-landing-request-send");
    const btn = screen.getByTestId("pair-landing-request-retry") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain("7:00");
    expect(screen.getByTestId("pair-landing-request-refused").textContent).toContain("Too many requests from this device");
    await flush(1000);
    expect(btn.textContent).toContain("6:59");
    await flush(420_000);
    const after = screen.getByTestId("pair-landing-request-retry") as HTMLButtonElement;
    expect(after.disabled).toBe(false);
    expect(after.textContent).toBe("Request again");
  });

  it("X3 a transport failure shows an error, re-enables the button and stores nothing", async () => {
    requestAccess.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<PairLanding />);
    await click("pair-landing-request-send");
    expect(screen.getByTestId("pair-landing-request-error").textContent).toContain("Failed to fetch");
    const send = screen.getByTestId("pair-landing-request-send") as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    expect(sessionStorage.getItem(STORE)).toBeNull();
    expect(postJson).not.toHaveBeenCalled();
  });

  it("the send button is disabled and busy while the knock is in flight", async () => {
    let release: (v: unknown) => void = () => {};
    requestAccess.mockReturnValue(new Promise((r) => { release = r; }));
    render(<PairLanding />);
    await click("pair-landing-request-send");
    const send = screen.getByTestId("pair-landing-request-send") as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(send.getAttribute("aria-busy")).toBe("true");
    expect(send.textContent).toContain("Sending request");
    pollWith("pending");
    await act(async () => { release(knock()); await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByTestId("pair-landing-request-code")).toBeDefined();
  });

  // See change: group-servers-by-identity (test-plan #X16, task 4.4, design D7).
  it("X16 an approved answer carrying routes: bearer stored as before, no route contacted or stored", async () => {
    const fetchSpy = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchSpy);
    requestAccess.mockResolvedValue(knock());
    postJson.mockImplementation(async (_b: string, path: string) => {
      if (path === "/api/pair/poll") return { status: "approved", token: "TOK", routes: ["https://k3x9p2.share.zrok.io"] };
      throw new Error(`unexpected ${path}`);
    });
    render(<PairLanding />);
    await click("pair-landing-request-send");
    await flush(2000);
    expect(storeDeviceBearer).toHaveBeenCalledTimes(1);
    expect(storeDeviceBearer).toHaveBeenCalledWith("TOK");
    expect(hrefSets).toEqual(["/"]);
    // Nothing contacts the delivered route: every request goes to this page's own origin.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(postJson.mock.calls.every(([base]) => base === "")).toBe(true);
    // Nothing stores it: no storage write mentions it.
    const stored = [localStorage, sessionStorage].flatMap((st) => Object.keys(st).map((k) => `${k}=${st.getItem(k)}`)).join("\n");
    expect(stored).not.toContain("k3x9p2");
    expect(storeDeviceBearer.mock.calls.flat().join(" ")).not.toContain("k3x9p2");
  });

  it("approved stores the bearer through finishDevicePairing then loads the dashboard", async () => {
    requestAccess.mockResolvedValue(knock());
    pollWith("approved", "TOK");
    render(<PairLanding />);
    await click("pair-landing-request-send");
    await flush(2000);
    expect(storeDeviceBearer).toHaveBeenCalledWith("TOK");
    expect(screen.getByTestId("pair-landing-request-approved").textContent).toContain("Approved. Opening the dashboard");
    expect(hrefSets).toEqual(["/"]);
    expect(sessionStorage.getItem(STORE)).toBeNull();
  });

  it("F8 keep-failed after approval: message shown, no navigation, Open the dashboard + Request again offered", async () => {
    requestAccess.mockResolvedValue(knock());
    pollWith("approved", "TOK");
    storeDeviceBearer.mockReturnValueOnce({ keepFailed: true });
    render(<PairLanding />);
    await click("pair-landing-request-send");
    await flush(2000);
    expect(screen.getByTestId("pair-landing-keep-failed").textContent).toContain("couldn't keep its access");
    expect(hrefSets).toEqual([]);
    fireEvent.click(screen.getByTestId("pair-landing-open"));
    expect(hrefSets).toEqual(["/"]);
    expect(screen.getByTestId("pair-landing-request-retry")).toBeDefined();
  });

  it("styles request mode from theme tokens only", async () => {
    requestAccess.mockResolvedValue(knock());
    pollWith("pending");
    const { container } = render(<PairLanding />);
    await click("pair-landing-request-send");
    const html = container.innerHTML;
    expect(html).not.toMatch(/\b(?:text|bg|border)-(?:neutral|red|green|blue|amber|yellow|gray|slate)-\d/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
