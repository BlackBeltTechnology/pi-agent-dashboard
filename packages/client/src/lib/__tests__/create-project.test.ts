/**
 * App wiring for Landing's Create project: POST → pin through the same
 * optimistic path as AddFoldersDialog. See change: streamline-first-run (F15).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectAndPin } from "../create-project.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

function deps() {
  let pinned: string[] = [];
  return {
    send: vi.fn(),
    setPinned: vi.fn((updater: (prev: string[]) => string[]) => {
      pinned = updater(pinned);
    }),
    get pinned() {
      return pinned;
    },
  };
}

describe("createProjectAndPin (F15)", () => {
  it("success: posts the name, pins the returned real path once, updates the list optimistically", async () => {
    const fetchMock = vi.fn(async () => json({ success: true, data: { path: "/real/x", existed: false } }));
    vi.stubGlobal("fetch", fetchMock);
    const d = deps();
    const out = await createProjectAndPin("x", d);
    expect(out).toEqual({ ok: true, path: "/real/x", existed: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/browse/create-project");
    expect(JSON.parse(String(init.body))).toEqual({ name: "x" });
    expect(d.send).toHaveBeenCalledTimes(1);
    expect(d.send).toHaveBeenCalledWith({ type: "pin_directory", path: "/real/x" });
    expect(d.pinned).toEqual(["/real/x"]);
  });

  it("does not duplicate an already-pinned path in the optimistic list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ success: true, data: { path: "/real/x", existed: true } })));
    const d = deps();
    await createProjectAndPin("x", d);
    await createProjectAndPin("x", d);
    expect(d.pinned).toEqual(["/real/x"]);
  });

  it("a 409 pins nothing and surfaces the server reason", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ success: false, error: "x", reason: "not_a_directory" }, 409)));
    const d = deps();
    expect(await createProjectAndPin("x", d)).toEqual({ ok: false, reason: "not_a_directory" });
    expect(d.send).not.toHaveBeenCalled();
    expect(d.setPinned).not.toHaveBeenCalled();
  });

  it("a non-ApiResponse body (older server 404) and a network error resolve to ok:false without a reason", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ statusCode: 404, error: "Not Found", message: "Route POST:/api/browse/create-project not found" }, 404)));
    const d = deps();
    expect(await createProjectAndPin("x", d)).toEqual({ ok: false, reason: undefined });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await createProjectAndPin("x", d)).toEqual({ ok: false });
    expect(d.send).not.toHaveBeenCalled();
  });
});
