import { beforeEach, describe, expect, it, vi } from "vitest";
import { setGlobalApiBase } from "../api/api-context.js";
import { reloadResourceSessions, toggleResource } from "../api/resources-api.js";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch as any;

function ok(data: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve({ success: true, data }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  setGlobalApiBase("");
});

describe("toggleResource", () => {
  it("POSTs a scope-aware body and returns affectedSessions", async () => {
    mockFetch.mockResolvedValueOnce(ok({ affectedSessions: ["s1", "s2"] }));
    const res = await toggleResource({
      scope: "local",
      cwd: "/proj",
      type: "extension",
      filePath: "/proj/.pi/e.ts",
      enabled: false,
    });
    expect(res.ok).toBe(true);
    expect(res.affectedSessions).toEqual(["s1", "s2"]);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/resources/toggle");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      scope: "local",
      cwd: "/proj",
      type: "extension",
      filePath: "/proj/.pi/e.ts",
      enabled: false,
    });
  });

  it("reports error status on failure", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, json: () => Promise.resolve({ success: false, error: "nope" }) });
    const res = await toggleResource({ scope: "global", type: "skill", filePath: "/x", enabled: true });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(res.error).toBe("nope");
    expect(res.affectedSessions).toEqual([]);
  });
});

describe("reloadResourceSessions", () => {
  it("POSTs scope + cwd and returns the reloaded count", async () => {
    mockFetch.mockResolvedValueOnce(ok({ reloaded: 3 }));
    const res = await reloadResourceSessions("local", "/proj");
    expect(res.ok).toBe(true);
    expect(res.reloaded).toBe(3);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/resources/reload");
    expect(JSON.parse(init.body)).toEqual({ scope: "local", cwd: "/proj" });
  });
});
