/**
 * LinkResolutionProvider + store — pre-confirmation of transcript file links.
 * See change: rich-chat-links (test-plan #F2, #F3, #F4, #X1; design D1/D2).
 *
 * Fake timers + a mocked `IntersectionObserver` + a routed `fetch`. The store is passed in explicitly so each
 * test owns an isolated cache.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LinkResolutionStore, makeLinkKey, notifyAccessGrantsChanged } from "../../../lib/chat/link-resolution-store.js";
import { loadEditorPaneState } from "../../../lib/layout/editor-pane-state.js";
import { SplitWorkspaceProvider } from "../../split/SplitWorkspaceContext.js";
import { FileLink } from "../../tool-renderers/FileLink.js";
import type { ToolContext } from "../../tool-renderers/types.js";
import { LinkResolutionProvider } from "../LinkResolutionProvider.js";

// --- IntersectionObserver mock -------------------------------------------------------------------------------
class FakeIO {
  static instances: FakeIO[] = [];
  observed = new Set<Element>();
  cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
    FakeIO.instances.push(this);
  }
  observe(el: Element) {
    this.observed.add(el);
  }
  unobserve(el: Element) {
    this.observed.delete(el);
  }
  disconnect() {
    this.observed.clear();
  }
  takeRecords() {
    return [];
  }
}
/** Report `el` entering/leaving the viewport on whichever observer holds it. */
function intersect(el: Element, isIntersecting: boolean) {
  const io = FakeIO.instances.find((i) => i.observed.has(el));
  if (!io) throw new Error("element is not observed");
  act(() => io.cb([{ target: el, isIntersecting } as IntersectionObserverEntry], io as unknown as IntersectionObserver));
}
function intersectAll(isIntersecting = true) {
  for (const io of FakeIO.instances) for (const el of [...io.observed]) intersect(el, isIntersecting);
}

// --- fetch routing -------------------------------------------------------------------------------------------
interface BatchBody {
  cwd: string;
  items: { mention: string; toolCwd?: string; reRooted?: string }[];
}
type BatchReply = (body: BatchBody, call: number) => Response | Promise<Response>;

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
const found = (m: string) => ({ state: "found", resolved: `/repo/${m}`, kind: "relative" });

let batchCalls: BatchBody[] = [];
let singleCalls: Record<string, unknown>[] = [];
let batchReply: BatchReply;
let singleReply: (body: Record<string, unknown>) => Response;

function installFetch() {
  batchCalls = [];
  singleCalls = [];
  batchReply = (b) => json({ success: true, data: { results: b.items.map((i) => found(i.mention)) } });
  singleReply = (b) => json({ success: true, data: { resolved: `/repo/${String(b.mention)}`, kind: "relative" } });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url.endsWith("/api/file/resolve-mentions")) {
      batchCalls.push(body);
      return batchReply(body, batchCalls.length);
    }
    if (url.endsWith("/api/file/resolve-mention")) {
      singleCalls.push(body);
      return singleReply(body);
    }
    return json({ success: true, data: { type: "file", content: "" } });
  });
}

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  });
});
beforeEach(() => {
  FakeIO.instances = [];
  vi.stubGlobal("IntersectionObserver", FakeIO);
  vi.useFakeTimers();
  installFetch();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

function ctx(over: Partial<ToolContext> = {}): ToolContext {
  return { cwd: "/repo", sessionId: "S", ...over };
}
function links(paths: string[], context: ToolContext) {
  return paths.map((p) => (
    <FileLink key={p} path={p} context={context}>
      {p}
    </FileLink>
  ));
}
function mount(store: LinkResolutionStore, children: React.ReactNode, props: { toolCompletions?: number } = {}) {
  const ui = (p: { toolCompletions?: number }, kids: React.ReactNode) => (
    <LinkResolutionProvider store={store} sessionId="S" toolCompletions={p.toolCompletions}>
      {kids}
    </LinkResolutionProvider>
  );
  const r = render(ui(props, children));
  return { ...r, update: (p: { toolCompletions?: number }, kids: React.ReactNode = children) => r.rerender(ui(p, kids)) };
}
const stateOf = (name: string) => screen.getByText(name).closest("button")?.getAttribute("data-link-state");

describe("LinkResolutionProvider — settled + visible batching (F2)", () => {
  it("sends nothing for links in a running tool or streaming text, even when in view", async () => {
    const store = new LinkResolutionStore();
    mount(store, links(["a.ts"], ctx({ linkSettled: false })));
    intersectAll();
    await advance(3000);
    expect(batchCalls).toHaveLength(0);
  });

  it("a link becomes eligible when its content settles; flushes 250 ms after it is in view", async () => {
    const store = new LinkResolutionStore();
    const m = mount(store, links(["a.ts"], ctx({ linkSettled: false })));
    m.update({}, links(["a.ts"], ctx({ linkSettled: true }))); // the tool completed
    intersectAll();
    await advance(249);
    expect(batchCalls).toHaveLength(0);
    await advance(1);
    expect(batchCalls).toHaveLength(1);
    expect(batchCalls[0]).toEqual({ cwd: "/repo", items: [{ mention: "a.ts" }] });
    await advance(0);
    expect(stateOf("a.ts")).toBe("found");
  });

  it("settled off-screen links are sent only after they intersect", async () => {
    const store = new LinkResolutionStore();
    mount(store, links(["a.ts", "b.ts"], ctx()));
    await advance(5000);
    expect(batchCalls).toHaveLength(0);
    intersect(screen.getByText("b.ts").closest("button") as Element, true);
    await advance(250);
    expect(batchCalls).toHaveLength(1);
    expect(batchCalls[0].items.map((i) => i.mention)).toEqual(["b.ts"]);
  });

  it("40 mentions of one settled message share ONE request", async () => {
    const store = new LinkResolutionStore();
    const paths = Array.from({ length: 40 }, (_, i) => `src/f${i}.ts`);
    mount(store, links(paths, ctx()));
    intersectAll();
    await advance(250);
    expect(batchCalls).toHaveLength(1);
    expect(batchCalls[0].items).toHaveLength(40);
  });

  it("registrations that keep arriving flush at the 1 s cap, not never", async () => {
    const store = new LinkResolutionStore();
    const item = (i: number) => ({ key: makeLinkKey("S", undefined, `f${i}.ts`), sessionId: "S", cwd: "/repo", mention: `f${i}.ts` });
    store.register(item(0));
    for (let t = 1; t <= 9; t++) {
      await advance(100);
      store.register(item(t));
    }
    expect(batchCalls).toHaveLength(0); // 900 ms in, still debouncing
    await advance(100); // 1000 ms after the first pending item
    expect(batchCalls).toHaveLength(1);
    expect(batchCalls[0].items).toHaveLength(10);
  });

  it("never flushes more than once per second, even when registrations arrive in bursts 300 ms apart (test-plan P3)", async () => {
    const store = new LinkResolutionStore();
    const item = (i: number) => ({ key: makeLinkKey("S", undefined, `f${i}.ts`), sessionId: "S", cwd: "/repo", mention: `f${i}.ts` });
    store.register(item(0));
    await advance(250);
    expect(batchCalls).toHaveLength(1); // t = 250: the first flush
    await advance(50);
    store.register(item(1)); // t = 300: the 250 ms debounce alone would flush at 550
    await advance(900); // t = 1200: still inside the 1 s window that opened at the first flush
    expect(batchCalls).toHaveLength(1);
    await advance(50); // t = 1250: 1 s after the first flush
    expect(batchCalls).toHaveLength(2);
    expect(batchCalls[1].items).toHaveLength(1);
  });

  it("caps a request at 200 items per session; the overflow goes into the next window", async () => {
    const store = new LinkResolutionStore();
    for (let i = 0; i < 250; i++) store.register({ key: makeLinkKey("S", undefined, `f${i}`), sessionId: "S", cwd: "/repo", mention: `f${i}` });
    await advance(250);
    expect(batchCalls).toHaveLength(1);
    expect(batchCalls[0].items).toHaveLength(200);
    await advance(1000); // the next flush window opens 1 s after the previous flush
    expect(batchCalls).toHaveLength(2);
    expect(batchCalls[1].items).toHaveLength(50);
  });

  it("forwards toolCwd and the re-rooted candidate", async () => {
    const store = new LinkResolutionStore();
    mount(
      store,
      <FileLink path="/main/src/a.ts" absolute context={ctx({ toolCwd: "packages/client" })}>
        /main/src/a.ts
      </FileLink>,
    );
    intersectAll();
    await advance(250);
    expect(batchCalls[0].items[0]).toMatchObject({ mention: "/main/src/a.ts", toolCwd: "packages/client" });
  });
});

describe("LinkResolutionProvider — cache refresh (F3)", () => {
  async function seeded() {
    const store = new LinkResolutionStore();
    const sCtx = ctx({ cwd: "/repoS", sessionId: "S" });
    const tCtx = ctx({ cwd: "/repoT", sessionId: "T" });
    const m = mount(store, [...links(["s.ts"], sCtx), ...links(["t.ts"], tCtx)]);
    intersectAll();
    await advance(250);
    expect(batchCalls.map((b) => b.cwd).sort()).toEqual(["/repoS", "/repoT"]); // one request per session
    batchCalls.length = 0;
    return { store, m };
  }
  const cwds = () => batchCalls.map((b) => b.cwd);

  it("a tool completion of S re-requests S's visible links; T's cache is kept", async () => {
    const { m } = await seeded();
    m.update({ toolCompletions: 1 });
    // a refresh right after the seeding flush waits for the 1 s flush window (test-plan P3)
    await advance(1000);
    expect(cwds()).toEqual(["/repoS"]);
  });

  it("a completed tool of S drops S's entries that are not in view and re-requests them on the next intersection", async () => {
    const { store, m } = await seeded();
    const sBtn = screen.getByText("s.ts").closest("button") as Element;
    intersect(sBtn, false);
    m.update({ toolCompletions: 1 });
    await advance(1000);
    expect(batchCalls).toHaveLength(0);
    expect(store.getSnapshot(makeLinkKey("S", undefined, "s.ts"))).toBeUndefined();
    intersect(sBtn, true);
    await advance(250);
    expect(cwds()).toEqual(["/repoS"]);
  });

  it("an access-grant change drops every session's entries", async () => {
    await seeded();
    act(() => notifyAccessGrantsChanged());
    // a refresh right after the seeding flush waits for the 1 s flush window (test-plan P3)
    await advance(1000);
    expect(cwds().sort()).toEqual(["/repoS", "/repoT"]);
  });

  it("entries expire after 60 s and are re-requested while in view", async () => {
    await seeded();
    await advance(59_000);
    expect(batchCalls).toHaveLength(0);
    await advance(2_000);
    await advance(250);
    expect(cwds().sort()).toEqual(["/repoS", "/repoT"]);
  });

  it("a result that was in flight when the session's tool finished is not applied", async () => {
    const store = new LinkResolutionStore();
    let release: (r: Response) => void = () => {};
    batchReply = () => new Promise<Response>((r) => (release = r));
    const m = mount(store, links(["a.ts"], ctx()));
    intersectAll();
    await advance(250);
    m.update({ toolCompletions: 1 });
    batchReply = (b) => json({ success: true, data: { results: b.items.map(() => ({ state: "missing" })) } });
    release(json({ success: true, data: { results: [found("a.ts")] } }));
    await advance(0);
    expect(stateOf("a.ts")).toBe("unknown");
    // a refresh right after the seeding flush waits for the 1 s flush window (test-plan P3)
    await advance(1000);
    await advance(0);
    expect(stateOf("a.ts")).toBe("missing");
  });
});

describe("LinkResolutionStore — back-off and client guards (F4)", () => {
  it("retries a 429 after 1 s then 2 s, then applies the states; an overlong mention is never sent", async () => {
    const store = new LinkResolutionStore();
    batchReply = (b, call) =>
      call <= 2
        ? json({ success: false, error: "rate limited" }, 429)
        : json({ success: true, data: { results: b.items.map(() => ({ state: "missing" })) } });
    const key = makeLinkKey("S", undefined, "x.ts");
    const longKey = makeLinkKey("S", undefined, "y".repeat(1025));
    store.register({ key, sessionId: "S", cwd: "/repo", mention: "x.ts" });
    store.register({ key: longKey, sessionId: "S", cwd: "/repo", mention: "y".repeat(1025) });
    await advance(250);
    expect(batchCalls).toHaveLength(1);
    await advance(999);
    expect(batchCalls).toHaveLength(1);
    await advance(1);
    expect(batchCalls).toHaveLength(2);
    await advance(1999);
    expect(batchCalls).toHaveLength(2);
    await advance(1);
    expect(batchCalls).toHaveLength(3);
    expect(store.getSnapshot(key)?.state).toBe("missing");
    expect(store.getSnapshot(longKey)).toBeUndefined();
    for (const b of batchCalls) expect(b.items.map((i) => i.mention)).toEqual(["x.ts"]);
  });

  it("an over-long toolCwd is never sent either", async () => {
    const store = new LinkResolutionStore();
    store.register({ key: makeLinkKey("S", "d".repeat(1025), "x.ts"), sessionId: "S", cwd: "/repo", mention: "x.ts", toolCwd: "d".repeat(1025) });
    await advance(2000);
    expect(batchCalls).toHaveLength(0);
  });
});

describe("LinkResolutionProvider — batch failure keeps today's behaviour (X1)", () => {
  const cases: [string, () => void][] = [
    ["network error", () => (batchReply = () => Promise.reject(new TypeError("Failed to fetch")))],
    ["5xx", () => (batchReply = () => json({ success: false, error: "boom" }, 500))],
    ["404 (old server)", () => (batchReply = () => new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } }))],
  ];
  it.each(cases)("%s: links stay unknown and a click still resolves and opens", async (_n, inject) => {
    inject();
    const store = new LinkResolutionStore();
    render(
      <SplitWorkspaceProvider sessionId="S" cwd="/repo" orientation="h">
        <LinkResolutionProvider store={store} sessionId="S">
          {links(["src/a.ts"], ctx())}
        </LinkResolutionProvider>
      </SplitWorkspaceProvider>,
    );
    intersectAll();
    await advance(250);
    expect(batchCalls).toHaveLength(1);
    await advance(5000);
    expect(batchCalls).toHaveLength(1); // no retry storm for a non-429 failure
    expect(stateOf("src/a.ts")).toBe("unknown");

    vi.useRealTimers();
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(singleCalls).toHaveLength(1));
    expect(singleCalls[0]).toMatchObject({ cwd: "/repo", mention: "src/a.ts", recover: true });
    await waitFor(() => expect(loadEditorPaneState("S").openFiles.map((f) => f.path)).toEqual(["src/a.ts"]));
  });
});
