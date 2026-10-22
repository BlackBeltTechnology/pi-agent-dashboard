/**
 * Known-servers client API: probe + accept-move degrade to `null` on any
 * transport failure or refusal (6.1). See change: stabilize-mdns-server-identity.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setGlobalApiBase } from "../api/api-context.js";
import {
  acceptKnownServerMove,
  addKnownServer,
  listKnownServersWithAccess,
  probeKnownServer,
  probeKnownServerResult,
  removeKnownServer,
  removeKnownServerByFingerprint,
} from "../api/known-servers-api.js";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch as unknown as typeof fetch;

const json = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  headers: new Headers({ "content-type": "application/json" }),
  text: async () => JSON.stringify(body),
  json: async () => body,
  clone() {
    return this;
  },
});

beforeEach(() => {
  mockFetch.mockReset();
  setGlobalApiBase("");
});

describe("probeKnownServer", () => {
  it("returns the server-reported status", async () => {
    mockFetch.mockResolvedValueOnce(json({ success: true, data: { status: "name-not-resolved" } }));
    expect(await probeKnownServer("a.local", 8000)).toBe("name-not-resolved");
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain("/api/known-servers/probe");
    expect(JSON.parse(init.body)).toEqual({ host: "a.local", port: 8000 });
  });

  it("returns null on a transport failure", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network down"));
    expect(await probeKnownServer("a.local", 8000)).toBeNull();
  });

  it("returns null when the server refuses (non-operator)", async () => {
    mockFetch.mockResolvedValueOnce(json({ success: false, error: "operator credential required" }, 401));
    expect(await probeKnownServer("a.local", 8000)).toBeNull();
  });
});

describe("acceptKnownServerMove", () => {
  it("returns true on success", async () => {
    mockFetch.mockResolvedValueOnce(json({ success: true }));
    expect(await acceptKnownServerMove("a.local", 8000)).toBe(true);
  });

  it("returns null on refusal or transport failure", async () => {
    mockFetch.mockResolvedValueOnce(json({ success: false, error: "stale_suggestion" }, 409));
    expect(await acceptKnownServerMove("a.local", 8000)).toBeNull();
    mockFetch.mockRejectedValueOnce(new Error("boom"));
    expect(await acceptKnownServerMove("a.local", 8000)).toBeNull();
  });
});

describe("list / add", () => {
  it("list carries canManage", async () => {
    mockFetch.mockResolvedValueOnce(json({ success: true, data: [{ host: "a", port: 1 }], canManage: true }));
    expect(await listKnownServersWithAccess()).toEqual({ servers: [{ host: "a", port: 1 }], canManage: true });
  });

  it("add forwards the fingerprint hint and reports an updated entry", async () => {
    mockFetch.mockResolvedValueOnce(json({ success: true, data: { updated: true } }));
    expect(await addKnownServer("a", 1, "L", "sha256:x")).toEqual({ updated: true });
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ host: "a", port: 1, label: "L", fingerprint: "sha256:x" });
  });
});

// See change: group-servers-by-identity (task 5.3, design D6).
describe("routes: scheme, remove by route / fingerprint, probe with fingerprint", () => {
  it("add sends the scheme only when given (default http stays implicit)", async () => {
    mockFetch.mockResolvedValue(json({ success: true, data: {} }));
    await addKnownServer("lab.example.org", 443, undefined, undefined, "https");
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ host: "lab.example.org", port: 443, scheme: "https" });
    await addKnownServer("a", 1);
    expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({ host: "a", port: 1 });
  });

  it("add without a refusal 409 already_known: success with updated:true is reported, not thrown", async () => {
    mockFetch.mockResolvedValueOnce(json({ success: true, data: { updated: true } }));
    expect(await addKnownServer("b", 2)).toEqual({ updated: true });
  });

  it("remove deletes one route (host, port, scheme) or a whole entry by fingerprint", async () => {
    mockFetch.mockResolvedValue(json({ success: true }));
    await removeKnownServer("a", 1, "https");
    expect(mockFetch.mock.calls[0][1].method).toBe("DELETE");
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ host: "a", port: 1, scheme: "https" });
    await removeKnownServer("a", 1);
    expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toEqual({ host: "a", port: 1 });
    await removeKnownServerByFingerprint("sha256:x");
    expect(JSON.parse(mockFetch.mock.calls[2][1].body)).toEqual({ fingerprint: "sha256:x" });
  });

  it("a failed remove throws", async () => {
    mockFetch.mockResolvedValueOnce(json({ success: false, error: "operator credential required" }, 401));
    await expect(removeKnownServer("a", 1)).rejects.toThrow("HTTP 401");
  });

  it("probe forwards the scheme and the full result carries the proven fingerprint", async () => {
    mockFetch.mockResolvedValueOnce(json({ success: true, data: { status: "reachable", scheme: "https", fingerprint: "sha256:x" } }));
    expect(await probeKnownServerResult("a.example", 443, "https")).toEqual({ status: "reachable", scheme: "https", fingerprint: "sha256:x" });
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ host: "a.example", port: 443, scheme: "https" });
    expect(await probeKnownServerResult("a.example", 443).catch(() => "threw")).toBeNull();
  });

  it("probeKnownServerResult is null on refusal and transport failure", async () => {
    mockFetch.mockResolvedValueOnce(json({ success: false, error: "no" }, 403));
    expect(await probeKnownServerResult("a", 1)).toBeNull();
    mockFetch.mockRejectedValueOnce(new Error("down"));
    expect(await probeKnownServerResult("a", 1)).toBeNull();
  });
});
