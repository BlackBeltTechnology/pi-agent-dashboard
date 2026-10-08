/**
 * KbJobRegistry — coalescing + error-state tests (task 1.3).
 * See change: add-kb-folder-slot.
 */
import { describe, expect, it } from "vitest";
import { KbJobRegistry } from "../job-registry.js";

describe("KbJobRegistry", () => {
  it("coalesces concurrent starts onto one walk", async () => {
    const registry = new KbJobRegistry();
    let walks = 0;
    const fn = async () => {
      walks++;
      await new Promise((r) => setTimeout(r, 30));
      return { changed: 2, chunks: 5 };
    };
    const a = registry.start("/c", fn);
    // Second call arrives while the first is in-flight → must coalesce.
    const b = registry.start("/c", fn);
    expect(registry.isRunning("/c")).toBe(true);
    expect(b.coalesced).toBe(true);
    await Promise.all([a.promise, b.promise]);
    expect(walks).toBe(1);
    expect(registry.isRunning("/c")).toBe(false);
    expect(registry.statusFor("/c")).toBe("idle");
  });

  it("records error state + message after a failed job", async () => {
    const registry = new KbJobRegistry();
    const { promise } = registry.start("/c", async () => {
      throw new Error("boom");
    });
    await expect(promise).rejects.toThrow("boom");
    expect(registry.isRunning("/c")).toBe(false);
    expect(registry.statusFor("/c")).toBe("error");
    expect(registry.get("/c")?.error).toBe("boom");
  });

  it("clears the error status once a later job succeeds", async () => {
    const registry = new KbJobRegistry();
    await registry.start("/c", async () => { throw new Error("boom"); }).promise.catch(() => {});
    expect(registry.statusFor("/c")).toBe("error");
    await registry.start("/c", async () => ({ changed: 1, chunks: 3 })).promise;
    expect(registry.statusFor("/c")).toBe("idle");
  });
  it("X4 retains per-source outcomes; error outcomes derive a bounded job error, untrusted alone stays done", async () => {
    const registry = new KbJobRegistry();
    const t0 = Date.now();
    const mixed = [
      { ref: "docs", status: "ok" as const, at: Date.now() },
      { ref: "https://h/x.git", status: "error" as const, error: "e".repeat(800), at: Date.now() },
      { ref: "https://h/y.git", status: "untrusted" as const, error: "not trusted", at: Date.now() },
    ];
    await registry.start("/c", async () => ({ changed: 1, chunks: 2, outcomes: mixed })).promise;
    expect(registry.statusFor("/c")).toBe("error");
    const job = registry.get("/c");
    expect(job?.error?.startsWith("1 source(s) failed:")).toBe(true);
    expect(job?.error?.length).toBeLessThanOrEqual(500);
    expect(registry.outcomesFor("/c").map((o) => o.ref)).toEqual(["docs", "https://h/x.git", "https://h/y.git"]);
    for (const o of registry.outcomesFor("/c")) expect(o.at).toBeGreaterThanOrEqual(t0);

    await registry.start("/d", async () => ({ changed: 0, chunks: 0, outcomes: [mixed[2]] })).promise;
    expect(registry.statusFor("/d")).toBe("idle");
  });

  it("keeps the last outcomes while a later job runs or throws", async () => {
    const registry = new KbJobRegistry();
    await registry.start("/c", async () => ({ changed: 0, chunks: 0, outcomes: [{ ref: "docs", status: "ok" as const, at: 1 }] })).promise;
    const running = registry.start("/c", async () => {
      await new Promise((r) => setTimeout(r, 10));
      throw new Error("boom");
    });
    expect(registry.outcomesFor("/c")).toHaveLength(1);
    await running.promise.catch(() => {});
    expect(registry.statusFor("/c")).toBe("error");
    expect(registry.outcomesFor("/c")).toHaveLength(1);
  });
});
