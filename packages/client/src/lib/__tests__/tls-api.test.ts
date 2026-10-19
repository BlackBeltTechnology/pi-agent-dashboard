import { afterEach, describe, expect, it, vi } from "vitest";
import { getStoredTlsConfig } from "../gateway/tls-api.js";
import { describeApplyError, planApply } from "../gateway/tls-view.js";

/**
 * `getStoredTlsConfig` reads strictly (a failed read must never look like "no tls block"),
 * plus the pure Apply planning / error mapping of the Built-in HTTPS section.
 * See change: add-tailscale-cert-tls.
 */
const reply = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
  }) as Response;

afterEach(() => vi.restoreAllMocks());

describe("getStoredTlsConfig", () => {
  it("returns the stored block, or {} when the read succeeded and there is none", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(reply(200, { success: true, data: { tls: { port: 9443, sources: [] } } }));
    expect(await getStoredTlsConfig()).toEqual({ port: 9443, sources: [] });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(reply(200, { success: true, data: {} }));
    expect(await getStoredTlsConfig()).toEqual({});
  });

  it.each([
    ["HTTP 500", reply(500, { success: false, error: "boom" })],
    ["success:false at 200", reply(200, { success: false })],
    ["no data", reply(200, { success: true })],
  ])("throws on %s instead of answering {}", async (_label, response) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response);
    await expect(getStoredTlsConfig()).rejects.toThrow(/Could not read/);
  });
});

describe("planApply", () => {
  const status = { port: 8443, host: "127.0.0.1" };
  it("unchanged / minimal patch / invalid port (BVA)", () => {
    expect(planApply(status, null, null)).toEqual({ kind: "unchanged" });
    expect(planApply(status, "8443", " 127.0.0.1 ")).toEqual({ kind: "unchanged" });
    expect(planApply(status, "9443", null)).toEqual({ kind: "send", patch: { port: 9443 } });
    expect(planApply(status, null, "100.83.0.1")).toEqual({ kind: "send", patch: { host: "100.83.0.1" } });
    for (const bad of ["0", "65536", "-1", "1.5", "abc", ""]) expect(planApply(status, bad, null)).toEqual({ kind: "invalid" });
    expect(planApply(status, "1", null)).toEqual({ kind: "send", patch: { port: 1 } });
    expect(planApply(status, "65535", null)).toEqual({ kind: "send", patch: { port: 65535 } });
  });
});

describe("describeApplyError", () => {
  const t = (_k: string, vars?: Record<string, string | number>, fb = "") => fb.replace(/\{(\w+)\}/g, (_, n) => String(vars?.[n] ?? ""));
  it("maps server messages to the right field in plain words", () => {
    expect(describeApplyError("tls.host must be an IP address or localhost", 8443, t).field).toBe("host");
    expect(describeApplyError("tls.port 8000 is already used by port", 8000, t)).toMatchObject({ field: "port", message: expect.stringContaining("8000") });
    expect(describeApplyError("tls.port must be an integer between 1 and 65535", 0, t).message).toContain("1 to 65535");
    expect(describeApplyError("", 1, t).message).toContain("Could not save");
    expect(describeApplyError("weird", 1, t).message).toBe("weird");
  });
});
