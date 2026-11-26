/**
 * Bridge reserve-path protocol messages (D9): the `preview_path_request` / `preview_path_result` / `preview_path_release`
 * shapes in the shared protocol types, and the server handler that is their runtime parser: valid shapes accepted, malformed
 * payloads rejected without reserving anything, and `error` a closed set.
 * See change: serve-live-previews-on-capability-origin (D9; test-plan #E102).
 */
import type {
  ExtensionToServerMessage,
  PreviewPathReleaseMessage,
  PreviewPathRequestMessage,
  PreviewPathResultMessage,
  ServerToExtensionMessage,
} from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { describe, expect, expectTypeOf, it } from "vitest";
import { handlePreviewPathRelease, handlePreviewPathRequest } from "../live-server/preview-path-bridge.js";
import { PreviewPathStore } from "../live-server/preview-path-store.js";

/** The closed set `PreviewPathResultMessage["error"]` is declared with. */
const ERRORS = ["insufficient_scope", "reservation_limit", "invalid_port", "session_mismatch"] as const;

const local = { channel: { admission: "local-proof" as const, provenTls: false, ticketTls: false } };
const ticket = (deviceId = "d1") => ({ channel: { admission: "device-ticket" as const, provenTls: false, ticketTls: false, ticketDeviceId: deviceId } });

function setup(opts: { viewers?: boolean; tier?: "observe" | "control" | "operate" } = {}) {
  const store = new PreviewPathStore();
  const deps = {
    reserve: { store, hasTier5Viewer: () => opts.viewers ?? true, portRefusal: (p: number) => (p === 8000 ? "own port" : null) },
    deviceTier: () => opts.tier,
    isSessionLive: () => true,
  };
  return { store, deps };
}
const req = (over: Record<string, unknown> = {}): PreviewPathRequestMessage => ({ type: "preview_path_request", requestId: "r1", sessionId: "s1", port: 5299, ...over }) as PreviewPathRequestMessage;

describe("T.E102 — preview_path_* messages: shapes (types)", () => {
  it("the three messages are members of the bridge unions, with exactly the declared fields", () => {
    const request: ExtensionToServerMessage = { type: "preview_path_request", requestId: "r1", sessionId: "s1", port: 5299 };
    const release: ExtensionToServerMessage = { type: "preview_path_release", requestId: "r1", sessionId: "s1" };
    const result: ServerToExtensionMessage = { type: "preview_path_result", requestId: "r1", path: null, tier5Viewers: false };
    expect([request.type, release.type, result.type]).toEqual(["preview_path_request", "preview_path_release", "preview_path_result"]);
    expectTypeOf<PreviewPathRequestMessage["port"]>().toEqualTypeOf<number>();
    expectTypeOf<PreviewPathRequestMessage["requestId"]>().toEqualTypeOf<string>();
    expectTypeOf<PreviewPathReleaseMessage>().toEqualTypeOf<{ type: "preview_path_release"; requestId: string; sessionId: string }>();
    expectTypeOf<PreviewPathResultMessage["path"]>().toEqualTypeOf<string | null>();
    expectTypeOf<PreviewPathResultMessage["tier5Viewers"]>().toEqualTypeOf<boolean>();
    expectTypeOf<PreviewPathResultMessage["expiresAt"]>().toEqualTypeOf<number | undefined>();
  });

  it("`error` is a closed set of exactly four strings", () => {
    expectTypeOf<NonNullable<PreviewPathResultMessage["error"]>>().toEqualTypeOf<(typeof ERRORS)[number]>();
    // @ts-expect-error — not one of the declared error codes
    const bad: PreviewPathResultMessage = { type: "preview_path_result", requestId: "r", path: null, tier5Viewers: false, error: "boom" };
    expect(bad.error).toBe("boom"); // runtime is untyped; the compile-time rejection above is the contract
  });

  it("malformed literals do not type-check (requestId missing, port not a number)", () => {
    // @ts-expect-error — requestId is required
    const noId: PreviewPathRequestMessage = { type: "preview_path_request", sessionId: "s1", port: 5299 };
    // @ts-expect-error — port must be a number
    const strPort: PreviewPathRequestMessage = { type: "preview_path_request", requestId: "r", sessionId: "s1", port: "5299" };
    expect([noId, strPort]).toHaveLength(2);
  });
});

describe("T.E102 — preview_path_* messages: parse (handler)", () => {
  it("a valid request is accepted and answers the exact result shape (extra request fields are ignored, never echoed)", () => {
    const { deps, store } = setup();
    const r = handlePreviewPathRequest("s1", req({ extra: "x", port2: 1, __proto__: { polluted: true } }), local, deps);
    expect(Object.keys(r).sort()).toEqual(["expiresAt", "path", "requestId", "tier5Viewers", "type"]);
    expect(r).toMatchObject({ type: "preview_path_result", requestId: "r1", tier5Viewers: true });
    expect(r.path).toMatch(/^\/preview\/[A-Za-z0-9_-]{22}\/$/);
    expect(typeof r.expiresAt).toBe("number");
    expect(r.error).toBeUndefined();
    expect(store.reservationCount()).toBe(1);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("a missing / empty / non-string requestId is rejected (session_mismatch), reserves nothing and never throws", () => {
    for (const requestId of [undefined, "", null, 5, {}, ["r1"], true]) {
      const { deps, store } = setup();
      const r = handlePreviewPathRequest("s1", req({ requestId }), local, deps);
      expect(r, String(requestId)).toEqual({ type: "preview_path_result", requestId: "", path: null, tier5Viewers: false, error: "session_mismatch" });
      expect(store.reservationCount()).toBe(0);
    }
    // a missing sessionId is the same refusal
    const { deps } = setup();
    expect(handlePreviewPathRequest("s1", req({ sessionId: undefined }), local, deps)).toMatchObject({ path: null, error: "session_mismatch" });
  });

  it("a non-string requestId never leaks into the result (the answer is keyed by a string or the empty string)", () => {
    const { deps } = setup();
    const r = handlePreviewPathRequest("s1", req({ requestId: { toString: () => "evil" } }), local, deps);
    expect(r.requestId).toBe("");
  });

  it("a non-integer / out-of-range / non-number port is rejected as invalid_port and reserves nothing", () => {
    for (const port of ["5299", null, undefined, 5299.5, 0, -1, 65536, Number.NaN, Number.POSITIVE_INFINITY, [5299], { v: 5299 }, true, 8000]) {
      const { deps, store } = setup();
      const r = handlePreviewPathRequest("s1", req({ port }), local, deps);
      expect(r, String(port)).toEqual({ type: "preview_path_result", requestId: "r1", path: null, tier5Viewers: false, error: "invalid_port" });
      expect(store.reservationCount(), String(port)).toBe(0);
    }
  });

  it("`error` only ever takes a value from the closed set, across every refusal path", () => {
    const seen = new Set<string>();
    const note = (r: PreviewPathResultMessage) => {
      if (r.error !== undefined) seen.add(r.error);
      return r;
    };
    note(handlePreviewPathRequest("s1", req({ requestId: "" }), local, setup().deps)); // session_mismatch
    note(handlePreviewPathRequest("other", req(), local, setup().deps)); // session_mismatch (not this connection's session)
    note(handlePreviewPathRequest("s1", req({ port: "x" }), local, setup().deps)); // invalid_port
    note(handlePreviewPathRequest("s1", req({ port: 8000 }), local, setup().deps)); // invalid_port (own port)
    note(handlePreviewPathRequest("s1", req(), ticket(), setup({ tier: "observe" }).deps)); // insufficient_scope
    note(handlePreviewPathRequest("s1", req(), undefined, setup().deps)); // insufficient_scope (no admission record)
    const { deps } = setup();
    for (let p = 5000; p < 5008; p++) handlePreviewPathRequest("s1", req({ requestId: `q${p}`, port: p }), local, deps);
    note(handlePreviewPathRequest("s1", req({ requestId: "over", port: 5100 }), local, deps)); // reservation_limit
    expect([...seen].sort()).toEqual([...ERRORS].sort()); // every member reachable, nothing else
    for (const e of seen) expect(ERRORS as readonly string[]).toContain(e);
  });

  it("no-viewer and success results carry no `error` at all", () => {
    const none = handlePreviewPathRequest("s1", req(), local, setup({ viewers: false }).deps);
    expect(none).toEqual({ type: "preview_path_result", requestId: "r1", path: null, tier5Viewers: false });
    expect("error" in none).toBe(false);
    expect("error" in handlePreviewPathRequest("s1", req(), local, setup().deps)).toBe(false);
  });

  it("a release with a malformed requestId / sessionId is ignored; a valid one drops exactly the matching reservation", () => {
    const { deps, store } = setup();
    handlePreviewPathRequest("s1", req(), local, deps);
    const rel = (over: Record<string, unknown>, conn = "s1") => handlePreviewPathRelease(conn, { type: "preview_path_release", requestId: "r1", sessionId: "s1", ...over } as PreviewPathReleaseMessage, deps);
    for (const requestId of [undefined, "", null, 5, {}, ["r1"], "R1"]) rel({ requestId });
    rel({ sessionId: "s2" }); // body names another session than the connection's
    rel({}, "s2"); // the connection is another session
    expect(store.reservationCount()).toBe(1);
    expect(() => rel({ extra: 1 })).not.toThrow(); // extra fields are ignored
    expect(store.reservationCount()).toBe(0);
  });
});
