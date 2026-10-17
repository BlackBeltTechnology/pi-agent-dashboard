/**
 * Connect to another machine — pure/API semantics. Test-plan #E14, #E16, #X9.
 * See change: add-remote-access-wizard.
 */
import type { KnownServerListEntry } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureKnown, knockDecision, parseAddress, remoteRequestUrl, sameAddress } from "../connect-machine.js";

afterEach(() => vi.restoreAllMocks());

const known = [{ host: "macbook.local", port: 8000, label: "MacBook" }] as KnownServerListEntry[];
const jsonRes = (body: unknown, status: number) =>
  ({ ok: status < 400, status, headers: new Headers({ "content-type": "application/json" }), json: async () => body }) as Response;

describe("parseAddress / sameAddress", () => {
  it("accepts host, host:port and URLs; defaults the port", () => {
    expect(parseAddress("MacBook.local:8000")).toEqual({ host: "MacBook.local", port: 8000 });
    expect(parseAddress("http://192.168.16.204:8000/pair")).toEqual({ host: "192.168.16.204", port: 8000 });
    expect(parseAddress("box.local")).toEqual({ host: "box.local", port: 8000 });
    expect(parseAddress("")).toBeNull();
    expect(parseAddress("host:99999")).toBeNull();
  });
  it("compares host case-insensitively", () => {
    expect(sameAddress({ host: "MacBook.local", port: 8000 }, { host: "macbook.local", port: 8000 })).toBe(true);
    expect(sameAddress({ host: "a", port: 8000 }, { host: "a", port: 8001 })).toBe(false);
  });
});

describe("ensureKnown (E14, X9)", () => {
  it("E14: a typed address matching a known server is used and NOT re-posted", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const out = await ensureKnown({ host: "MacBook.local", port: 8000 }, known);
    expect(out).toEqual({ kind: "known", address: { host: "MacBook.local", port: 8000 } });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("E14: an unknown address is added and remembered as created by this run", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonRes({ success: true, data: {} }, 200));
    const out = await ensureKnown({ host: "192.168.16.204", port: 8000 }, known);
    expect(out).toEqual({ kind: "created", address: { host: "192.168.16.204", port: 8000 } });
    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0][1] as RequestInit).method).toBe("POST");
  });

  it("E14: 409 already_known uses the existing entry's address, created=false", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonRes({ success: false, error: "already_known", host: "other.local", port: 8000 }, 409));
    expect(await ensureKnown({ host: "10.0.0.9", port: 8000 }, known)).toEqual({
      kind: "known-elsewhere",
      address: { host: "other.local", port: 8000 },
    });
  });

  it("X9: 409 identity_changed stops the task", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonRes({ success: false, error: "identity_changed" }, 409));
    expect(await ensureKnown({ host: "10.0.0.9", port: 8000 }, known)).toEqual({ kind: "identity-changed" });
  });

  it("a 403 is a refusal, not a failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonRes({ success: false, error: "forbidden" }, 403));
    expect(await ensureKnown({ host: "10.0.0.9", port: 8000 }, known)).toEqual({ kind: "refused" });
  });
});

describe("knockDecision (E16)", () => {
  it("knocks only when every present fingerprint equals the proven one", () => {
    expect(knockDecision({ pin: "F", proven: "F" })).toEqual({ kind: "knock", fingerprint: "F" });
    expect(knockDecision({ pin: "F", advert: "G", proven: "F" })).toMatchObject({ kind: "mismatch", against: "advert" });
    expect(knockDecision({ pin: "F", proven: "G" })).toMatchObject({ kind: "mismatch", against: "pin" });
  });
  it("with neither a pin nor an advert the proven fingerprint needs operator confirmation", () => {
    expect(knockDecision({ proven: "H" })).toEqual({ kind: "confirm", fingerprint: "H" });
  });
});

describe("remoteRequestUrl", () => {
  it("builds the remote's own request page", () => {
    expect(remoteRequestUrl({ host: "192.168.16.204", port: 8000 })).toBe("http://192.168.16.204:8000/pair?request");
  });
});
