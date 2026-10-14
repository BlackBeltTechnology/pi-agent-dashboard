/**
 * approvePending sends `tier` in the body only when provided (change:
 * add-lan-knock-pairing, task 6.2 — absent ⇒ the server defaults to operate).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const { fetchJsonResponse } = vi.hoisted(() => ({ fetchJsonResponse: vi.fn() }));
vi.mock("../../api/fetch-json.js", () => ({ fetchJson: vi.fn(), fetchJsonResponse }));

import { approvePending } from "../pairing-approval-api.js";

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
