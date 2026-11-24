/**
 * One-shot pending sign-ins for callback paths (test-plan B22–B23, B34; scenario-gate A10/B4).
 * See change: add-google-connect.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { PendingFlows } from "../pending-flows.js";

afterEach(() => vi.useRealTimers());

describe("PendingFlows", () => {
  it("accepts a code once for the state it issued; a second delivery is refused (B23)", async () => {
    const p = new PendingFlows();
    const f = p.create({});
    expect(p.deliver(f.state, { code: "C" })).toEqual({ ok: true });
    await expect(f.result).resolves.toEqual({ code: "C" });
    expect(p.deliver(f.state, { code: "C" })).toEqual({ ok: false, status: 400, error: "invalid_state" });
    expect(p.size).toBe(0);
  });

  it("refuses unknown, empty, oversized and mismatched states without touching a waiting flow (B34)", () => {
    const p = new PendingFlows();
    const f = p.create({ origin: "https://dash.example.com" });
    for (const bad of ["", "nope", `${f.state}x`, f.state.replace("https://dash.example.com", "https://evil.example"), "x".repeat(5000)]) {
      expect(p.deliver(bad, { code: "C" })).toMatchObject({ ok: false, error: "invalid_state" });
    }
    expect(p.size).toBe(1);
    expect(p.deliver(f.state, { code: "C" }).ok).toBe(true);
  });

  it("the return-page state is the flow id + the dashboard origin and nothing else (B19)", () => {
    const p = new PendingFlows();
    const f = p.create({ id: "ID", origin: "https://dash.example.com" });
    expect(f.state).toBe("ID~https://dash.example.com");
    expect(PendingFlows.newId()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("expires after the flow lifetime with code `timeout` (A10)", async () => {
    vi.useFakeTimers();
    const p = new PendingFlows(300_000);
    const f = p.create({});
    const settled = f.result.catch((e: { code: string }) => e.code);
    await vi.advanceTimersByTimeAsync(300_001);
    await expect(settled).resolves.toBe("timeout");
    expect(p.deliver(f.state, { code: "late" }).ok).toBe(false);
  });

  it("an abort signal cancels the flow (`aborted`) and frees the entry", async () => {
    const p = new PendingFlows();
    const ac = new AbortController();
    const f = p.create({ signal: ac.signal });
    ac.abort();
    await expect(f.result).rejects.toMatchObject({ code: "aborted" });
    expect(p.size).toBe(0);
    f.cancel(); // idempotent
  });

  it("carries Google's error through", async () => {
    const p = new PendingFlows();
    const f = p.create({});
    p.deliver(f.state, { error: "access_denied" });
    await expect(f.result).resolves.toEqual({ error: "access_denied" });
  });
});
