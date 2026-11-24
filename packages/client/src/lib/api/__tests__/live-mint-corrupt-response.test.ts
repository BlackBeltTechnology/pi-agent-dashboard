/**
 * `mintLiveCapability` against answers that are 2xx but not a capability: never throws, always an error result.
 * See change: serve-live-previews-on-capability-origin (test-plan #X48, D7).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mintLiveCapability } from "../live-server-api.js";

const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});

const answer = (json: () => Promise<unknown>, status = 200) => {
  globalThis.fetch = vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json }) as unknown as Response) as unknown as typeof fetch;
};

describe("T.X48 / #X48 — mint 200 with a corrupt body", () => {
  it("HTML 200 (res.json() rejects) resolves to a typed error, not a throw", async () => {
    answer(() => Promise.reject(new SyntaxError("Unexpected token < in JSON")));
    const res = await mintLiveCapability("abc12345");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/capability mint returned an unexpected response|capability mint failed \(200\)/);
    expect(res.rejected).toBeUndefined(); // a transport-level garbage answer is not a validator rejection
  });

  it("200 with {} resolves to a typed error", async () => {
    answer(async () => ({}));
    const res = await mintLiveCapability("abc12345");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/capability mint returned an unexpected response|capability mint failed \(200\)/);
  });

  it("200 with null / a JSON array resolves to a typed error", async () => {
    for (const body of [null, [], "ok"]) {
      answer(async () => body);
      const res = await mintLiveCapability("abc12345");
      expect(res.ok).toBe(false);
    }
  });
});
