/**
 * The browse helpers map a confinement refusal to a typed error, distinct from
 * the network-guard denial. See change: harden-server-capability-bounds (#F11).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { browseDirectory, createDirectory, NetworkNotAllowedError, PathOutsideRootsError } from "../browse-api.js";

function respond(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
    ),
  );
}
afterEach(() => vi.unstubAllGlobals());

const OUTSIDE = { success: false, error: "path outside allowed roots" };

describe("browse-api typed refusals (F11)", () => {
  it("browseDirectory: 403 path outside allowed roots -> PathOutsideRootsError", async () => {
    respond(403, OUTSIDE);
    const err = await browseDirectory("/").catch((e) => e);
    expect(err).toBeInstanceOf(PathOutsideRootsError);
    expect(err.code).toBe("path_outside_allowed_roots");
  });

  it("createDirectory: the same 403 -> PathOutsideRootsError", async () => {
    respond(403, OUTSIDE);
    const err = await createDirectory("/tmp", "n").catch((e) => e);
    expect(err).toBeInstanceOf(PathOutsideRootsError);
    expect(err.code).toBe("path_outside_allowed_roots");
  });

  it("network_not_allowed stays NetworkNotAllowedError (mapping unchanged)", async () => {
    respond(403, { success: false, error: "network_not_allowed", hint: "add this network" });
    const err = await browseDirectory("/x").catch((e) => e);
    expect(err).toBeInstanceOf(NetworkNotAllowedError);
    expect(err).not.toBeInstanceOf(PathOutsideRootsError);
  });

  it("other failures keep their old shape", async () => {
    respond(500, { success: false, error: "boom" });
    const a = await browseDirectory("/x").catch((e) => e);
    expect(a).not.toBeInstanceOf(PathOutsideRootsError);
    expect(a.message).toBe("boom");
    respond(409, { success: false, error: "already exists" });
    const b = await createDirectory("/h", "n").catch((e) => e);
    expect(b).not.toBeInstanceOf(PathOutsideRootsError);
  });

  it("a normal listing passes through, confined flag included", async () => {
    respond(200, { success: true, data: { entries: [], parent: null, current: "/h", confined: true } });
    expect((await browseDirectory("/h")).confined).toBe(true);
  });
});
