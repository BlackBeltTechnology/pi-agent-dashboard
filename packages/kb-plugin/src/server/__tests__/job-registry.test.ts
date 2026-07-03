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
});
