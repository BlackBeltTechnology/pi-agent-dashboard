/**
 * Unsaved-buffer store: dirty registry, `confirmLeave` scoping / outcomes /
 * overlap / partial failure, publish-on-change, beforeunload arming, unmount
 * cleanup. See change: fix-file-link-editor-routing (D3, G2; test-plan #S42–#S44,
 * #S51, #S64, #S74, #S78, #S81).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUnsavedStore, type UnsavedEntry, type UnsavedStore, unsavedKey } from "../unsaved-store.js";

let store: UnsavedStore;
beforeEach(() => {
  store = createUnsavedStore();
});
afterEach(() => vi.restoreAllMocks());

const K = {
  s1a: unsavedKey("s1", "a.md"),
  s1b: unsavedKey("s1", "b.md"),
  s2a: unsavedKey("s2", "a.md"),
  fa: unsavedKey("folder:/f", "a.md"),
};

function entry(over: Partial<UnsavedEntry> = {}): UnsavedEntry & { save: ReturnType<typeof vi.fn>; discard: ReturnType<typeof vi.fn> } {
  return {
    label: "x.md",
    dirty: true,
    save: vi.fn(async () => true),
    discard: vi.fn(),
    ...over,
  } as never;
}

describe("dirty registry (#S42)", () => {
  it("hasUnsaved mirrors the dirty state across edit / revert / edit / save", () => {
    const seen: boolean[] = [];
    const unsub = store.subscribe(() => seen.push(store.hasUnsaved()));
    const e = (dirty: boolean) => entry({ dirty });
    store.registerUnsaved(K.s1a, e(false));
    expect(store.hasUnsaved()).toBe(false);
    store.registerUnsaved(K.s1a, e(true)); // "ab"
    expect(store.hasUnsaved()).toBe(true);
    store.registerUnsaved(K.s1a, e(false)); // back to "a"
    expect(store.hasUnsaved()).toBe(false);
    store.registerUnsaved(K.s1a, e(true)); // edited again
    store.registerUnsaved(K.s1a, e(false)); // saved
    expect(store.hasUnsaved()).toBe(false);
    unsub();
    expect(seen).toEqual([true, false, true, false]);
  });

  it("leaving with a clean buffer shows no dialog", async () => {
    store.registerUnsaved(K.s1a, entry({ dirty: false }));
    await expect(store.confirmLeave()).resolves.toBe(true);
    expect(store.getState().dialog).toBeNull();
  });
});

describe("confirmLeave key scoping (#S43)", () => {
  beforeEach(() => {
    store.registerUnsaved(K.s1a, entry({ label: "s1a" }));
    store.registerUnsaved(K.s1b, entry({ label: "s1b", dirty: false }));
    store.registerUnsaved(K.s2a, entry({ label: "s2a" }));
    store.registerUnsaved(K.fa, entry({ label: "fa" }));
  });
  const ask = (keys?: string[]) => {
    const p = store.confirmLeave(keys);
    const items = store.getState().dialog?.items.map((i) => i.label) ?? null;
    store.resolveDialog("cancel");
    return { p, items };
  };

  it("one tab ⇒ that tab only", () => {
    expect(ask([K.s2a]).items).toEqual(["s2a"]);
  });
  it("session scope ⇒ the dirty tab of that session only (same tabPath in two sessions never collides)", () => {
    expect(ask([K.s1a, K.s1b]).items).toEqual(["s1a"]);
  });
  it("no scope ⇒ all dirty tabs (session + folder panes)", () => {
    expect(ask().items).toEqual(["s1a", "s2a", "fa"]);
  });
  it("a clean-only scope resolves true with no dialog", async () => {
    await expect(store.confirmLeave([K.s1b])).resolves.toBe(true);
    expect(store.getState().dialog).toBeNull();
  });
});

describe("confirmLeave outcomes (#S44)", () => {
  it("Save ok ⇒ true", async () => {
    const e = entry();
    store.registerUnsaved(K.s1a, e);
    const p = store.confirmLeave();
    store.resolveDialog("save");
    await expect(p).resolves.toBe(true);
    expect(e.save).toHaveBeenCalledTimes(1);
    expect(store.getState().dialog).toBeNull();
  });
  it.each([
    ["409 / 403 / 500 (viewer returns false)", () => vi.fn(async () => false)],
    ["network error (throws)", () => vi.fn(async () => Promise.reject(new Error("net")))],
  ])("Save failure %s ⇒ false, buffer intact, discard never called", async (_n, mk) => {
    const e = entry({ save: mk() as never });
    store.registerUnsaved(K.s1a, e);
    const p = store.confirmLeave();
    store.resolveDialog("save");
    await expect(p).resolves.toBe(false);
    expect(e.discard).not.toHaveBeenCalled();
    expect(store.hasUnsaved()).toBe(true);
  });
  it("Discard ⇒ true, buffer dropped, no save", async () => {
    const e = entry();
    store.registerUnsaved(K.s1a, e);
    const p = store.confirmLeave();
    store.resolveDialog("discard");
    await expect(p).resolves.toBe(true);
    expect(e.discard).toHaveBeenCalledTimes(1);
    expect(e.save).not.toHaveBeenCalled();
  });
  it("Cancel ⇒ false, nothing touched", async () => {
    const e = entry();
    store.registerUnsaved(K.s1a, e);
    const p = store.confirmLeave();
    store.resolveDialog("cancel");
    await expect(p).resolves.toBe(false);
    expect(e.save).not.toHaveBeenCalled();
    expect(e.discard).not.toHaveBeenCalled();
  });
});

describe("publish on dirty change only (#S51)", () => {
  it("500 edit events with the buffer staying dirty notify once and arm beforeunload once", () => {
    const add = vi.spyOn(window, "addEventListener");
    const notified = vi.fn();
    store.subscribe(notified);
    for (let i = 0; i < 500; i++) store.registerUnsaved(K.s1a, entry());
    expect(notified).toHaveBeenCalledTimes(1);
    expect(add.mock.calls.filter(([n]) => n === "beforeunload")).toHaveLength(1);
  });
});

describe("unmount cleanup (#S64)", () => {
  it("unregister clears the entry and removes beforeunload exactly once", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const off = store.registerUnsaved(K.s1a, entry());
    store.registerUnsaved(K.s1b, entry());
    expect(store.hasUnsaved()).toBe(true);
    off();
    off(); // idempotent
    expect(store.hasUnsaved()).toBe(true); // b still dirty: stays armed
    expect(remove.mock.calls.filter(([n]) => n === "beforeunload")).toHaveLength(0);
    store.unregisterUnsaved(K.s1b);
    expect(store.hasUnsaved()).toBe(false);
    expect(remove.mock.calls.filter(([n]) => n === "beforeunload")).toHaveLength(1);
  });
  it("a stale unregister of a replaced entry does not drop the new one", () => {
    const off = store.registerUnsaved(K.s1a, entry());
    store.registerUnsaved(K.s1a, entry());
    off();
    expect(store.hasUnsaved()).toBe(true);
  });
  it("beforeunload handler warns only while dirty", () => {
    let handler: ((e: BeforeUnloadEvent) => void) | undefined;
    vi.spyOn(window, "addEventListener").mockImplementation(((n: string, h: never) => {
      if (n === "beforeunload") handler = h;
    }) as never);
    store.registerUnsaved(K.s1a, entry());
    const ev = { preventDefault: vi.fn(), returnValue: undefined as unknown } as unknown as BeforeUnloadEvent;
    handler?.(ev);
    expect(ev.preventDefault).toHaveBeenCalled();
  });
});

describe("Save failure never leaves (#S74)", () => {
  it.each([403, 409, 500, "abort"])("Save → %s keeps the buffer, resolves false", async (why) => {
    const e = entry({ save: vi.fn(async () => (why === "abort" ? Promise.reject(new DOMException("a", "AbortError")) : false)) as never });
    store.registerUnsaved(K.s1a, e);
    const leave = vi.fn();
    const p = store.confirmLeave().then((ok) => ok && leave());
    store.resolveDialog("save");
    await p;
    expect(leave).not.toHaveBeenCalled();
    expect(e.discard).not.toHaveBeenCalled();
    expect(store.getState().dialog).toBeNull();
  });
});

describe("overlapping leave attempts (#S78, G2)", () => {
  beforeEach(() => {
    store.registerUnsaved(K.s1a, entry({ label: "a" }));
    store.registerUnsaved(K.s1b, entry({ label: "b" }));
  });
  it.each([
    ["save", true],
    ["discard", true],
    ["cancel", false],
  ] as const)("second confirmLeave joins the open dialog: %s", async (verdict, expected) => {
    const dialogs: unknown[] = [];
    store.subscribe(() => {
      const d = store.getState().dialog;
      if (d && !dialogs.includes(d.id)) dialogs.push(d.id);
    });
    const first = store.confirmLeave(); // handleSelect (all)
    const second = store.confirmLeave([K.s1a, K.s1b]); // pane close
    expect(dialogs).toHaveLength(1);
    store.resolveDialog(verdict);
    await expect(first).resolves.toBe(expected);
    await expect(second).resolves.toBe(expected);
    expect(dialogs).toHaveLength(1);
  });
  it("each dirty buffer is saved at most once", async () => {
    const a = entry();
    const b = entry();
    store = createUnsavedStore();
    store.registerUnsaved(K.s1a, a);
    store.registerUnsaved(K.s1b, b);
    const first = store.confirmLeave();
    const second = store.confirmLeave();
    store.resolveDialog("save");
    await Promise.all([first, second]);
    expect(a.save).toHaveBeenCalledTimes(1);
    expect(b.save).toHaveBeenCalledTimes(1);
  });
  it("a leave covering a tab the open dialog does not list waits, then asks for its own scope (never stacks)", async () => {
    store = createUnsavedStore();
    store.registerUnsaved(K.s1a, entry({ label: "a" }));
    const first = store.confirmLeave([K.s1a]);
    store.registerUnsaved(K.s2a, entry({ label: "s2a" }));
    const second = store.confirmLeave();
    expect(store.getState().dialog?.items.map((i) => i.label)).toEqual(["a"]);
    store.resolveDialog("cancel");
    await expect(first).resolves.toBe(false);
    await vi.waitFor(() => expect(store.getState().dialog?.items.map((i) => i.label)).toEqual(["a", "s2a"]));
    store.resolveDialog("cancel");
    await expect(second).resolves.toBe(false);
  });
});

describe("multi-dirty leave: partial Save failure (#S81, G2)", () => {
  const setup = () => {
    const order: string[] = [];
    const a = entry({ label: "a", save: vi.fn(async () => (order.push("a"), true)) as never });
    const b = entry({ label: "b", save: vi.fn(async () => (order.push("b"), false)) as never });
    store.registerUnsaved(K.s1a, a);
    store.registerUnsaved(K.s1b, b);
    return { a, b, order };
  };
  it("Save: a then b, b fails ⇒ false; a is not rolled back; b not discarded", async () => {
    const { a, b, order } = setup();
    const p = store.confirmLeave();
    store.resolveDialog("save");
    await expect(p).resolves.toBe(false);
    expect(order).toEqual(["a", "b"]);
    expect(a.discard).not.toHaveBeenCalled();
    expect(b.discard).not.toHaveBeenCalled();
  });
  it("a failure stops the sequence (later tabs are not attempted)", async () => {
    const { a, b } = setup();
    (a.save as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const p = store.confirmLeave();
    store.resolveDialog("save");
    await expect(p).resolves.toBe(false);
    expect(b.save).not.toHaveBeenCalled();
  });
  it("Discard ⇒ both dropped, true, zero saves", async () => {
    const { a, b } = setup();
    const p = store.confirmLeave();
    store.resolveDialog("discard");
    await expect(p).resolves.toBe(true);
    expect(a.discard).toHaveBeenCalled();
    expect(b.discard).toHaveBeenCalled();
    expect(a.save).not.toHaveBeenCalled();
    expect(b.save).not.toHaveBeenCalled();
  });
  it("Cancel ⇒ zero saves, buffers intact", async () => {
    const { a, b } = setup();
    const p = store.confirmLeave();
    store.resolveDialog("cancel");
    await expect(p).resolves.toBe(false);
    expect(a.save).not.toHaveBeenCalled();
    expect(b.save).not.toHaveBeenCalled();
    expect(a.discard).not.toHaveBeenCalled();
  });
});
