/**
 * `fetchVault` keeps the machine code and remedies of a refusal instead of folding
 * the envelope into one message string.
 * See change: surface-operate-required-remedy (test-plan E14).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchVault } from "../vault-api.js";

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) })));
}
afterEach(() => vi.unstubAllGlobals());

describe("E14 fetchVault envelope parsing", () => {
  it("a 403 operate_required with remedies exposes code + remedies", async () => {
    stubFetch(403, { success: false, error: "operate_required", message: "the vault needs an operate-tier credential or a locally trusted caller", reason: "no-credential", remedies: ["use-host", "sign-in"] });
    const res = await fetchVault();
    expect(res.ok).toBe(false);
    expect(res.status).toBe(403);
    expect(res.code).toBe("operate_required");
    expect(res.remedies).toEqual(["use-host", "sign-in"]);
    expect(res.error).toBe("the vault needs an operate-tier credential or a locally trusted caller");
  });

  it("a 403 without remedies leaves remedies undefined", async () => {
    stubFetch(403, { success: false, error: "operate_required", message: "m" });
    const res = await fetchVault();
    expect(res.code).toBe("operate_required");
    expect(res.remedies).toBeUndefined();
  });

  it("a non-array remedies value is ignored", async () => {
    stubFetch(403, { success: false, error: "operate_required", message: "m", remedies: "use-host" });
    expect((await fetchVault()).remedies).toBeUndefined();
  });

  it("a 500 carries no operate code", async () => {
    stubFetch(500, { success: false, error: "internal", message: "internal error (see server.log)" });
    const res = await fetchVault();
    expect(res.code).toBe("internal");
    expect(res.remedies).toBeUndefined();
  });
});
