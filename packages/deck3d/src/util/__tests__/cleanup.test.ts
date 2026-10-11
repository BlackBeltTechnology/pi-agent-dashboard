import { describe, expect, it } from "vitest";
import { closeQuietly } from "../cleanup.js";

describe("closeQuietly (R4-B1 sibling sweep)", () => {
  it("closes once and swallows a failing close, so cleanup never decides the outcome", async () => {
    let calls = 0;
    await expect(
      closeQuietly({
        close: async () => {
          calls++;
          throw new Error("browser did not close");
        },
      }),
    ).resolves.toBeUndefined();
    expect(calls).toBe(1);
  });

  it("accepts nothing to close", async () => {
    await expect(closeQuietly(undefined)).resolves.toBeUndefined();
  });

  it("does not replace an earlier error when used in finally", async () => {
    const run = async () => {
      try {
        throw new Error("the real failure");
      } finally {
        await closeQuietly({ close: async () => Promise.reject(new Error("close failure")) });
      }
    };
    await expect(run()).rejects.toThrow("the real failure");
  });
});
