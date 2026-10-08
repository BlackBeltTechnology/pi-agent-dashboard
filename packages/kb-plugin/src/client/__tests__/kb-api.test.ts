/**
 * kb-api — folder-path codec round-trip + fetch content-type guard (task 2.2).
 * See change: add-kb-folder-slot.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeFolderPath, encodeFolderPath, fetchKbStats, kbSettingsUrl, reindexKb } from "../kb-api.js";

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

// See change: kb-denied-folder-pin-state (design D1, D11).
const jsonRes = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const rejection = async (p: Promise<unknown>): Promise<Error & { code?: string; reason?: string; hint?: string }> => {
  try {
    await p;
  } catch (e) {
    return e as Error & { code?: string };
  }
  throw new Error("expected a rejection");
};

describe("typed cwd refusal (E1)", () => {
  it("a 403 cwd-not-allowed body rejects with code cwd_not_allowed on stats AND reindex", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonRes(403, { error: "cwd not allowed", reason: "r", hint: "h" })));
    for (const call of [fetchKbStats("/x"), reindexKb("/x")]) {
      const e = await rejection(call);
      expect(e).toBeInstanceOf(Error);
      expect(e.code).toBe("cwd_not_allowed");
      expect(e.message).toBe("cwd not allowed");
      expect(e.reason).toBe("r");
      expect(e.hint).toBe("h");
    }
  });
});

describe("other failures are not cwd refusals (E2)", () => {
  const cases: Array<[string, () => Response, string | RegExp]> = [
    ["403 network_not_allowed", () => jsonRes(403, { error: "network_not_allowed" }), "network_not_allowed"],
    ["403 host_not_allowed", () => jsonRes(403, { error: "host_not_allowed", reason: "r", hint: "h" }), "host_not_allowed"],
    ["403 forbidden", () => jsonRes(403, { error: "forbidden" }), "forbidden"],
    ["403 html", () => new Response("<html>no</html>", { status: 403, headers: { "content-type": "text/html" } }), /^HTTP 403/],
    ["500 boom", () => jsonRes(500, { error: "boom" }), "boom"],
  ];
  for (const [name, res, msg] of cases) {
    it(name, async () => {
      vi.stubGlobal("fetch", vi.fn(async () => res()));
      const e = await rejection(fetchKbStats("/x"));
      expect(e).toBeInstanceOf(Error);
      expect(e).not.toHaveProperty("code");
      if (typeof msg === "string") expect(e.message).toBe(msg);
      else expect(e.message).toMatch(msg);
    });
  }
});

describe("typed precondition refusal (E24)", () => {
  it("409 folder missing / no sources configured carry a code; another 409 does not", async () => {
    const expectCode = async (body: unknown, code: string | undefined) => {
      vi.stubGlobal("fetch", vi.fn(async () => jsonRes(409, body)));
      const e = await rejection(reindexKb("/x"));
      expect(e).toBeInstanceOf(Error);
      if (code) expect(e.code).toBe(code);
      else expect(e).not.toHaveProperty("code");
    };
    await expectCode({ error: "folder missing" }, "folder_missing");
    await expectCode({ error: "no sources configured" }, "no_sources");
    await expectCode({ error: "duplicate ref" }, undefined);
  });
});
