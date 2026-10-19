/**
 * Instance store — cap + LRU clean-only eviction (F4/F5), non-keepAlive
 * close-when-clean (F6), guards (F7), live plugin disable (F8), shared
 * instance across tabs (F10). See change: add-editor-pane-file-handlers (D5).
 */
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FileHandlerClaim, fileHandlerInstanceKey } from "../file-handler-claims.js";
import { createFileHandlerStore, type FileHandlerStore, MAX_LIVE_HANDLERS } from "../file-handler-store.js";

vi.mock("../../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));

const claim = (id: string, over: Partial<FileHandlerClaim["meta"]> = {}): FileHandlerClaim => ({
  key: `p/${id}`,
  pluginId: "p",
  claimId: id,
  priority: 1000,
  meta: { id, extensions: [".docx"], mode: "edit", label: `Edit ${id}`, keepAlive: { max: 3 }, copySuffix: "x", ...over },
  Component: undefined,
});
const spec = (path: string, c = claim("a"), sessionId = "s1") => ({ sessionId, cwd: "/proj", path, claim: c });
const keyOf = (path: string, c = claim("a"), sessionId = "s1") => fileHandlerInstanceKey(sessionId, "/proj", path, c.key);

let store: FileHandlerStore;
beforeEach(() => {
  store = createFileHandlerStore();
});

/** Answer the head dialog once it is queued. */
async function answer(actionId: string | null) {
  await vi.waitFor(() => expect(store.getState().dialogs.length).toBeGreaterThan(0));
  const d = store.getState().dialogs[0];
  store.resolveDialog(d.id, actionId);
  return d.request;
}

async function open(...paths: string[]) {
  for (const p of paths) expect(await store.activate(spec(p))).toBe(true);
}

describe("cap + eviction (F4, F5)", () => {
  it("F4: opening a 4th evicts the LRU clean instance, whose tab offers Resume", async () => {
    await open("a.docx", "b.docx", "c.docx");
    store.setDirty(keyOf("a.docx"), false); // LRU + clean
    store.setDirty(keyOf("b.docx"), true);
    store.setDirty(keyOf("c.docx"), true);
    expect(await store.activate(spec("d.docx"))).toBe(true);
    const s = store.getState();
    expect(s.instances.map((i) => i.path).sort()).toEqual(["b.docx", "c.docx", "d.docx"]);
    expect(s.evicted.has(keyOf("a.docx"))).toBe(true);
    // activating the evicted tab again does NOT remount; Resume clears the flag.
    expect(await store.activate(spec("a.docx"))).toBe(true);
    expect(store.getInstance(keyOf("a.docx"))).toBeUndefined();
    store.resume(keyOf("a.docx"));
    expect(store.getState().evicted.has(keyOf("a.docx"))).toBe(false);
  });

  it("evicts by last-activation time, not creation order", async () => {
    await open("a.docx", "b.docx", "c.docx");
    for (const p of ["a.docx", "b.docx", "c.docx"]) store.setDirty(keyOf(p), false);
    await store.activate(spec("a.docx")); // touch a → b is now the LRU
    await store.activate(spec("d.docx"));
    expect(store.getState().evicted.has(keyOf("b.docx"))).toBe(true);
  });

  it.each([[true], ["unknown" as const]])("F5: all %s → nothing closes, dialog names the tabs, Cancel leaves the 4th unmounted", async (state) => {
    await open("a.docx", "b.docx", "c.docx");
    for (const p of ["a.docx", "b.docx", "c.docx"]) store.setDirty(keyOf(p), state);
    const p4 = store.activate(spec("d.docx"));
    const req = await answer(null);
    expect(await p4).toBe(false);
    expect(req.list).toHaveLength(MAX_LIVE_HANDLERS);
    expect(req.list?.join("|")).toMatch(/a\.docx.*b\.docx.*c\.docx/);
    expect(store.getState().instances).toHaveLength(3);
    expect(store.getInstance(keyOf("d.docx"))).toBeUndefined();
  });

  it("F5: discarding one of the named tabs lets the 4th mount", async () => {
    await open("a.docx", "b.docx", "c.docx");
    for (const p of ["a.docx", "b.docx", "c.docx"]) store.setDirty(keyOf(p), true);
    const p4 = store.activate(spec("d.docx"));
    await answer(keyOf("b.docx"));
    expect(await p4).toBe(true);
    expect(store.getState().instances.map((i) => i.path).sort()).toEqual(["a.docx", "c.docx", "d.docx"]);
  });

  it("a claim's keepAlive.max lowers its own share", async () => {
    const c = claim("a", { keepAlive: { max: 1 } });
    expect(await store.activate(spec("a.docx", c))).toBe(true);
    store.setDirty(keyOf("a.docx", c), false);
    expect(await store.activate(spec("b.docx", c))).toBe(true);
    expect(store.getState().instances.map((i) => i.path)).toEqual(["b.docx"]);
  });
});

describe("non-keepAlive instances (F6)", () => {
  const nk = claim("n", { keepAlive: undefined });
  const act = async (path: string) => {
    await store.activate(spec(path, nk));
    store.setActive("s1", keyOf(path, nk));
  };

  it("clean → closed when its tab goes inactive", async () => {
    await act("a.docx");
    store.setDirty(keyOf("a.docx", nk), false);
    store.setActive("s1", null);
    expect(store.getInstance(keyOf("a.docx", nk))).toBeUndefined();
  });

  it.each([[true], ["unknown" as const]])("%s → stays mounted (hidden) and counts toward the cap", async (state) => {
    await act("a.docx");
    store.setDirty(keyOf("a.docx", nk), state);
    store.setActive("s1", null);
    expect(store.getInstance(keyOf("a.docx", nk))).toBeDefined();
    expect(store.getState().visibleKey).toBeNull();
  });

  it("keepAlive instances survive going inactive and a pane close", async () => {
    await open("a.docx");
    store.setActive("s1", keyOf("a.docx"));
    store.setDirty(keyOf("a.docx"), false);
    store.setActive("s1", null);
    store.paneClosed("s1");
    expect(store.getInstance(keyOf("a.docx"))).toBeDefined();
  });
});

describe("guards (F7)", () => {
  it.each([
    [false, true, false],
    [true, false, true],
    ["unknown" as const, false, true],
  ])("state %s: proceeds=%s, asks=%s; Cancel keeps the instance", async (state, _p, asks) => {
    await open("a.docx");
    store.setDirty(keyOf("a.docx"), state);
    const g = store.guardDiscard(keyOf("a.docx"), "switch-mode");
    if (asks) {
      const req = await answer(null);
      expect(req.message).toMatch(state === "unknown" ? /may have unsaved/ : /has unsaved/);
      expect(await g).toBe(false);
      expect(store.getInstance(keyOf("a.docx"))).toBeDefined();
    } else {
      expect(await g).toBe(true);
      expect(store.getState().dialogs).toHaveLength(0);
    }
  });

  it("confirming resolves true", async () => {
    await open("a.docx");
    const g = store.guardDiscard(keyOf("a.docx"), "close-tab");
    await answer("discard");
    expect(await g).toBe(true);
  });

  it("an unknown instance key has nothing to lose", async () => {
    expect(await store.guardDiscard("nope", "refresh")).toBe(true);
  });

  it("remount bumps the mount nonce and resets to unknown", async () => {
    await open("a.docx");
    store.setDirty(keyOf("a.docx"), true);
    store.remount(keyOf("a.docx"));
    const i = store.getInstance(keyOf("a.docx"))!;
    expect(i.mountNonce).toBe(1);
    expect(i.dirty).toBe("unknown");
  });

  it("hasUnsaved is true for dirty and unknown only (F9 input)", async () => {
    await open("a.docx");
    expect(store.hasUnsaved()).toBe(true); // initial unknown
    store.setDirty(keyOf("a.docx"), false);
    expect(store.hasUnsaved()).toBe(false);
    store.setDirty(keyOf("a.docx"), true);
    expect(store.hasUnsaved()).toBe(true);
  });
});

describe("live plugin disable (F8)", () => {
  it("clean → closed; dirty/unknown → kept, flagged claimGone; re-enable clears the flag", async () => {
    await open("clean.docx", "dirty.docx");
    store.setDirty(keyOf("clean.docx"), false);
    store.setDirty(keyOf("dirty.docx"), true);
    store.reconcileClaims(new Set());
    expect(store.getInstance(keyOf("clean.docx"))).toBeUndefined();
    expect(store.getInstance(keyOf("dirty.docx"))?.claimGone).toBe(true);
    store.reconcileClaims(new Set(["p/a"]));
    expect(store.getInstance(keyOf("dirty.docx"))?.claimGone).toBe(false);
  });
});

describe("shared instance (F10) and tab sync", () => {
  it("two activations of the same file+claim share ONE instance (same host, same first-overwrite state)", async () => {
    await open("a.docx");
    const first = store.getInstance(keyOf("a.docx"))!;
    await store.activate(spec("./a.docx")); // normalizes to the same key
    expect(store.getState().instances).toHaveLength(1);
    expect(store.getInstance(keyOf("a.docx"))!.host).toBe(first.host);
  });

  describe("first overwrite confirmed once per instance", () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => {
      globalThis.fetch = originalFetch;
    });
    it("no second confirmation when saving again through the shared instance", async () => {
      const sha = (s: string) => createHash("sha1").update(s).digest("hex");
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const u = new URL(String(input), "http://x");
        if (u.pathname === "/api/file/raw") return new Response("v1");
        if (u.pathname === "/api/file/digest")
          return new Response(JSON.stringify({ success: true, data: { size: 2, mtime: 1, sha1: sha("v1") } }));
        return new Response(JSON.stringify({ success: true, data: { path: "a.docx", mtime: 2, sha1: sha("n") } }));
      }) as unknown as typeof fetch;
      const c = claim("a", { firstOverwriteNotice: "careful" });
      await store.activate(spec("a.docx", c));
      const host = store.getInstance(keyOf("a.docx", c))!.host;
      await host.snapshot();
      const buf = new Uint8Array([1]).buffer;
      const r1 = host.save(buf, { target: "overwrite" });
      await answer("overwrite");
      expect(await r1).toMatchObject({ ok: true });
      // "tab B" resolves the same instance and saves: no dialog.
      await store.activate(spec("a.docx", c));
      const host2 = store.getInstance(keyOf("a.docx", c))!.host;
      expect(await host2.save(buf, { target: "overwrite" })).toMatchObject({ ok: true });
      expect(store.getState().dialogs).toHaveLength(0);
    });
  });

  it("syncTabs drops instances (and evicted marks) whose tab no longer exists, for that scope only", async () => {
    await open("a.docx", "b.docx");
    await store.activate(spec("z.docx", claim("a"), "s2"));
    store.syncTabs("s1", "/proj", new Set([keyOf("a.docx")]));
    expect(store.getState().instances.map((i) => i.path).sort()).toEqual(["a.docx", "z.docx"]);
  });
});

describe("snapshot too-large surfaces on the instance", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });
  it("sets instance.error with the limit", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: { size: 999, mtime: 1, sha1: "x" } })),
    ) as unknown as typeof fetch;
    const c = claim("a", { maxBytes: 10 });
    await store.activate(spec("big.docx", c));
    await expect(store.getInstance(keyOf("big.docx", c))!.host.snapshot()).rejects.toMatchObject({ code: "too-large" });
    expect(store.getInstance(keyOf("big.docx", c))!.error).toMatchObject({ code: "too-large", limit: 10 });
  });
});
