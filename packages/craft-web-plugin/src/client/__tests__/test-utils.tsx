/**
 * Shared RTL harness for the craft-web client tests: a fake `FileHandlerProps`, a status
 * `fetch` stub, renderer-probe stubs and a simulated shim (`shimSend`) that posts messages
 * "from" the iframe's window. Timers are faked per test file (`useFakeTimers`); `flush()`
 * drains promises + due timers.
 * See change: edit-office-in-pane-with-craft-web.
 */
import type { FileHandlerProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { type MockInstance, vi } from "vitest";
import { CraftFrameHost } from "../CraftFrameHost.js";
import { CRAFT_WEB_APPS, type CraftWebApp } from "../craft-apps-table.js";

export const bytesOf = (n: number): ArrayBuffer => new Uint8Array(n).fill(7).buffer;

export interface FakeFh extends FileHandlerProps {
  snapshot: ReturnType<typeof vi.fn> & FileHandlerProps["snapshot"];
  save: ReturnType<typeof vi.fn> & FileHandlerProps["save"];
  setDirty: ReturnType<typeof vi.fn> & FileHandlerProps["setDirty"];
}

export function makeFh(over: Partial<FileHandlerProps> = {}): FakeFh {
  return {
    cwd: "/ws",
    path: "docs/report.docx",
    session: null,
    isActive: true,
    snapshot: vi.fn(async () => ({ bytes: bytesOf(8), size: 8, mtime: 1, sha1: "aa" })),
    save: vi.fn(async () => ({ ok: true as const, path: "docs/report.docx", mtime: 2, sha1: "bb" })),
    setDirty: vi.fn(),
    context: null,
    ...over,
  } as FakeFh;
}

export type StatusBody = Record<string, { status: string; reason?: string; sizeGzip?: number }>;

export interface FetchStub {
  calls: Array<{ url: string; method: string; body?: string }>;
  fn: ReturnType<typeof vi.fn>;
}

type Reply = { status: number; body: unknown };
const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function statusReply(s: StatusBody | 404 | "throw"): Reply {
  if (s === "throw") throw new Error("down");
  return s === 404 ? { status: 404, body: {} } : { status: 200, body: { apps: s } };
}

function prepareReply(p: { ok: boolean; status?: number; body?: unknown } | "throw"): Reply {
  if (p === "throw") throw new Error("offline");
  return { status: p.status ?? (p.ok ? 200 : 502), body: p.body ?? (p.ok ? { ok: true } : { ok: false, reason: "offline" }) };
}

/** Stubs global `fetch`: `status` (re-read on every call, so tests can flip it), prepare + csp-report. */
export function stubFetch(opts: {
  status?: () => StatusBody | 404 | "throw";
  prepare?: () => { ok: boolean; status?: number; body?: unknown } | "throw";
}): FetchStub {
  const calls: FetchStub["calls"] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
    let r: Reply = { status: 200, body: {} };
    if (url.endsWith("/status")) r = statusReply(opts.status?.() ?? { wordcraft: { status: "ok" } });
    else if (url.includes("/prepare/")) r = prepareReply(opts.prepare?.() ?? { ok: true });
    return reply(r.status, r.body);
  });
  vi.stubGlobal("fetch", fn);
  return { calls, fn };
}

/** Renderer stubs: `gpu` toggles `navigator.gpu`; `webgl2` makes the offscreen canvas yield a context. */
export function stubRenderer(r: { gpu: boolean; webgl2: boolean }): void {
  Object.defineProperty(navigator, "gpu", { value: r.gpu ? {} : undefined, configurable: true });
  if (!r.gpu) delete (navigator as unknown as { gpu?: unknown }).gpu;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() =>
    r.webgl2 ? { getExtension: () => null } : null) as unknown as HTMLCanvasElement["getContext"]);
}

export async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
  });
}

export async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

export function nonceOf(iframe: HTMLIFrameElement): string {
  return /#n=([0-9a-f]+)/.exec(iframe.getAttribute("src") ?? "")?.[1] ?? "";
}

/** Post a message that appears to come from `source` (default: the iframe's own window). */
export async function shimSend(
  iframe: HTMLIFrameElement,
  data: Record<string, unknown>,
  o: { source?: Window | null; nonce?: string } = {},
): Promise<void> {
  const payload = { nonce: o.nonce ?? nonceOf(iframe), ...data };
  await act(async () => {
    window.dispatchEvent(new MessageEvent("message", { data: payload, source: o.source === undefined ? iframe.contentWindow : o.source }));
    await vi.advanceTimersByTimeAsync(0);
  });
}

type PostSpy = MockInstance<(message: unknown, targetOrigin: string, transfer?: Transferable[]) => void>;

export interface Mounted {
  fh: FakeFh;
  iframe: HTMLIFrameElement;
  post: PostSpy;
  container: HTMLElement;
  getByTestId: (id: string) => HTMLElement;
  queryByTestId: (id: string) => HTMLElement | null;
  rerenderApp: () => void;
}

/** Mounts the host with a ready status + working renderer; resolves once the iframe is in the DOM. */
export async function mountFrame(
  o: { app?: CraftWebApp; fh?: FakeFh; renderer?: { gpu: boolean; webgl2: boolean }; wrap?: (children: ReactNode) => ReactNode } = {},
): Promise<Mounted> {
  stubRenderer(o.renderer ?? { gpu: true, webgl2: true });
  const fh = o.fh ?? makeFh();
  const wrap = o.wrap ?? ((c: ReactNode) => c);
  const r = render(wrap(<CraftFrameHost app={o.app ?? CRAFT_WEB_APPS.wordcraft} {...fh} />));
  await flush();
  const iframe = r.getByTestId("craft-frame") as HTMLIFrameElement;
  const post = vi.spyOn(iframe.contentWindow as Window, "postMessage") as unknown as PostSpy;
  return {
    fh,
    iframe,
    post,
    container: r.container,
    getByTestId: r.getByTestId,
    queryByTestId: r.queryByTestId,
    rerenderApp: () => r.rerender(wrap(<CraftFrameHost app={o.app ?? CRAFT_WEB_APPS.wordcraft} {...fh} />)),
  };
}

/** Drive a mounted frame to the `open` state: ready → (host posts open) → opened. */
export async function openDoc(m: Mounted): Promise<void> {
  await shimSend(m.iframe, { type: "ready" });
  await shimSend(m.iframe, { type: "opened", title: "report" });
}

/** All `save-result` payloads the host posted to the frame so far. */
export const saveResults = (m: Mounted): Array<{ ok: boolean; error?: string }> =>
  m.post.mock.calls.map((c) => c[0] as { type: string; ok: boolean; error?: string }).filter((p) => p.type === "save-result");

export const opens = (m: Mounted): Array<{ type: string; name: string; bytes: ArrayBuffer }> =>
  m.post.mock.calls.map((c) => c[0] as { type: string; name: string; bytes: ArrayBuffer }).filter((p) => p.type === "open");
