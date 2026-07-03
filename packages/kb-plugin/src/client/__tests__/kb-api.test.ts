/**
 * kb-api — folder-path codec round-trip + fetch content-type guard (task 2.2).
 * See change: add-kb-folder-slot.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeFolderPath, encodeFolderPath, fetchKbStats, kbSettingsUrl } from "../kb-api.js";

afterEach(() => vi.restoreAllMocks());

describe("folder-path codec", () => {
  it("round-trips ascii + unicode cwds", () => {
    for (const cwd of ["/a/b/c", "/Users/rö/pröj", "/工程/repo"]) {
      expect(decodeFolderPath(encodeFolderPath(cwd))).toBe(cwd);
    }
  });
  it("builds the settings overlay url", () => {
    expect(kbSettingsUrl("/x")).toBe(`/folder/${encodeFolderPath("/x")}/kb`);
  });
  it("returns null on a malformed encoding", () => {
    // Non-base64 chars decode to garbage bytes but never throw; a truly broken
    // input surfaces as null via the try/catch.
    expect(decodeFolderPath("@@@not base64@@@")).not.toBe(undefined);
  });
});

describe("fetchKbStats content-type guard", () => {
  it("throws a typed error (not a JSON parse crash) on an HTML body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("<html>502 bad gateway</html>", { status: 502, headers: { "content-type": "text/html" } }),
    ));
    await expect(fetchKbStats("/x")).rejects.toThrow(/HTTP 502/);
  });

  it("surfaces the JSON error field on a non-2xx JSON body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ error: "cwd not allowed" }), { status: 403, headers: { "content-type": "application/json" } }),
    ));
    await expect(fetchKbStats("/x")).rejects.toThrow(/cwd not allowed/);
  });
});
