/**
 * approvePending sends `tier` in the body only when provided (change:
 * add-lan-knock-pairing, task 6.2 — absent ⇒ the server defaults to operate).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const { fetchJsonResponse } = vi.hoisted(() => ({ fetchJsonResponse: vi.fn() }));
vi.mock("../../api/fetch-json.js", () => ({ fetchJson: vi.fn(), fetchJsonResponse }));

import { approvePending, denyPending } from "../pairing-approval-api.js";

const DEVICE = { id: "d1", label: "x", createdAt: "2026-01-01T00:00:00.000Z", lastSeen: null, source: "pairing" };

function sentBody(): Record<string, unknown> {
  const init = fetchJsonResponse.mock.calls.at(-1)?.[1] as RequestInit;
  return JSON.parse(init.body as string);
}

afterEach(() => fetchJsonResponse.mockReset());

describe("approvePending tier argument", () => {
  it("sends tier when provided", async () => {
    fetchJsonResponse.mockResolvedValue({ json: { success: true, data: DEVICE } });
    const out = await approvePending("pid", "12345678", "Laptop", "observe");
    expect(out.ok).toBe(true);
    expect(sentBody()).toEqual({ pendingId: "pid", confirmCode: "12345678", label: "Laptop", tier: "observe" });
  });

  it("omits tier (and label) when not provided — QR body unchanged", async () => {
    fetchJsonResponse.mockResolvedValue({ json: { success: true, data: DEVICE } });
    await approvePending("pid", "12345678");
    expect(sentBody()).toEqual({ pendingId: "pid", confirmCode: "12345678" });
    await approvePending("pid", "12345678", "Laptop");
    expect(sentBody()).toEqual({ pendingId: "pid", confirmCode: "12345678", label: "Laptop" });
  });

  it("sends tier without label", async () => {
    fetchJsonResponse.mockResolvedValue({ json: { success: true, data: DEVICE } });
    await approvePending("pid", "12345678", undefined, "control");
    expect(sentBody()).toEqual({ pendingId: "pid", confirmCode: "12345678", tier: "control" });
  });
});

/**
 * 401 refusal bodies carry `reason` + `remedies` (change:
 * fix-pairing-approval-credential, test-plan E54). Absent fields stay undefined
 * so an older server's bare two-key body degrades to the legacy sentence.
 */
describe("credential refusal surfaces reason + remedies (E54)", () => {
  const FULL = {
    success: false,
    error: "operator credential required",
    reason: "no-credential",
    remedies: ["authorize-browser", "approve-on-host"],
  };
  const LEGACY = { success: false, error: "operator credential required" };

  it("approvePending carries reason and remedies from the 401 body", async () => {
    fetchJsonResponse.mockResolvedValue({ json: FULL });
    expect(await approvePending("pid", "12345678")).toEqual({
      ok: false,
      error: "operator credential required",
      reason: "no-credential",
      remedies: ["authorize-browser", "approve-on-host"],
    });
  });

  it("approvePending: a legacy body leaves reason and remedies undefined", async () => {
    fetchJsonResponse.mockResolvedValue({ json: LEGACY });
    const out = await approvePending("pid", "12345678");
    expect(out).toMatchObject({ ok: false, error: "operator credential required" });
    expect((out as { reason?: unknown }).reason).toBeUndefined();
    expect((out as { remedies?: unknown }).remedies).toBeUndefined();
  });

  it("approvePending: an empty remedies array (device-credential) is kept, not dropped", async () => {
    fetchJsonResponse.mockResolvedValue({ json: { ...FULL, reason: "device-credential", remedies: [] } });
    expect(await approvePending("pid", "12345678")).toMatchObject({ reason: "device-credential", remedies: [] });
  });

  it("approvePending: malformed reason/remedies are ignored, not passed through", async () => {
    fetchJsonResponse.mockResolvedValue({ json: { ...FULL, reason: 7, remedies: "approve-on-host" } });
    const out = await approvePending("pid", "12345678");
    expect((out as { reason?: unknown }).reason).toBeUndefined();
    expect((out as { remedies?: unknown }).remedies).toBeUndefined();
  });

  it("denyPending carries reason and remedies from the 401 body", async () => {
    fetchJsonResponse.mockResolvedValue({ json: FULL });
    expect(await denyPending("pid")).toEqual({
      ok: false,
      error: "operator credential required",
      reason: "no-credential",
      remedies: ["authorize-browser", "approve-on-host"],
    });
  });

  it("denyPending: a legacy body leaves reason and remedies undefined; success is unchanged", async () => {
    fetchJsonResponse.mockResolvedValue({ json: LEGACY });
    const out = await denyPending("pid");
    expect(out.ok).toBe(false);
    expect(out.reason).toBeUndefined();
    expect(out.remedies).toBeUndefined();
    fetchJsonResponse.mockResolvedValue({ json: { success: true } });
    expect(await denyPending("pid")).toEqual({ ok: true });
  });
});
