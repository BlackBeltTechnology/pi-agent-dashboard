/**
 * WebPagePreview — operator-gated frame-policy probe, opaque-origin frame.
 * See change: rich-chat-links (D11, tasks 8.2–8.5; test-plan #E29–#E32).
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));

import { EDITOR_PANE_KEY_PREFIX, loadEditorPaneState, saveEditorPaneState } from "../../../lib/layout/editor-pane-state.js";
import { WebPagePreview } from "../WebPagePreview.js";

const URL_OK = "https://example.com/x";
const target = (url: string) => ({ kind: "url" as const, url });
const iframe = () => document.querySelector("iframe") as HTMLIFrameElement | null;

type Reply = { status: number; body: unknown } | "network";
let fetchMock: ReturnType<typeof vi.fn>;
let reply: Reply;

const verdict = (v: string): Reply => ({ status: 200, body: { verdict: v } });

beforeEach(() => {
  reply = verdict("allowed");
  fetchMock = vi.fn(async () => {
    if (reply === "network") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const probeCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).endsWith("/api/web/frame-policy"));

describe("E29 — probe only after an operator action", () => {
  it("operator-click: exactly one POST carrying only the origin", async () => {
    render(<WebPagePreview target={target(URL_OK)} opener="operator-click" />);
    await waitFor(() => expect(iframe()).toBeTruthy());
    expect(probeCalls()).toHaveLength(1);
    const [, init] = probeCalls()[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ origin: "https://example.com" });
  });

  it.each([
    ["agent", "agent" as const],
    ["route", undefined],
    ["restored", undefined],
    ["none", undefined],
  ])("opener %s: no request, card with Check and embed; choosing it probes once", async (_name, opener) => {
    render(<WebPagePreview target={target(URL_OK)} opener={opener} />);
    expect(probeCalls()).toHaveLength(0);
    expect(iframe()).toBeNull();
    const btn = screen.getByRole("button", { name: "Check and embed" });
    expect(screen.getByRole("button", { name: "Open in browser" })).toBeTruthy();
    fireEvent.click(btn);
    await waitFor(() => expect(iframe()).toBeTruthy());
    expect(probeCalls()).toHaveLength(1);
  });

  it("re-runs the check when an operator re-click bumps reloadNonce", async () => {
    const { rerender } = render(<WebPagePreview target={target(URL_OK)} opener="agent" reloadNonce={0} />);
    expect(probeCalls()).toHaveLength(0);
    rerender(<WebPagePreview target={target(URL_OK)} opener="operator-click" reloadNonce={1} />);
    await waitFor(() => expect(iframe()).toBeTruthy());
    expect(probeCalls()).toHaveLength(1);
    rerender(<WebPagePreview target={target(URL_OK)} opener="operator-click" reloadNonce={2} />);
    await waitFor(() => expect(probeCalls()).toHaveLength(2));
  });
});

describe("E30 — client pre-check", () => {
  it.each([
    "http://example.com/",
    "https://example.com:8443/",
    "https://10.0.0.5/",
    "https://[::1]/",
    "https://intranet/",
    "https://x.local/",
  ])("operator-click for %s: no request, no Try to embed, never framed", async (url) => {
    render(<WebPagePreview target={target(url)} opener="operator-click" />);
    await Promise.resolve();
    expect(probeCalls()).toHaveLength(0);
    expect(iframe()).toBeNull();
    expect(screen.queryByRole("button", { name: "Try to embed" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open in browser" })).toBeTruthy();
  });
});

describe("E31 — framing verdicts", () => {
  it("allowed → opaque sandbox frame, no referrer, titled", async () => {
    render(<WebPagePreview target={target(URL_OK)} opener="operator-click" />);
    await waitFor(() => expect(iframe()).toBeTruthy());
    const f = iframe() as HTMLIFrameElement;
    expect(f.getAttribute("sandbox")).toBe("allow-scripts allow-forms");
    expect(f.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(f.getAttribute("src")).toBe(URL_OK);
    expect(f.getAttribute("title")).toBeTruthy();
    expect(f.hasAttribute("srcdoc")).toBe(false);
  });

  it.each(["refused", "ineligible"])("%s → card only", async (v) => {
    reply = verdict(v);
    render(<WebPagePreview target={target(URL_OK)} opener="operator-click" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Open in browser" })).toBeTruthy());
    expect(iframe()).toBeNull();
    expect(screen.queryByRole("button", { name: "Try to embed" })).toBeNull();
  });

  it("undetermined → card + Try to embed, which frames under the same sandbox", async () => {
    reply = verdict("undetermined");
    render(<WebPagePreview target={target(URL_OK)} opener="operator-click" />);
    const btn = await screen.findByRole("button", { name: "Try to embed" });
    expect(iframe()).toBeNull();
    fireEvent.click(btn);
    const f = iframe() as HTMLIFrameElement;
    expect(f.getAttribute("sandbox")).toBe("allow-scripts allow-forms");
    expect(f.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(probeCalls()).toHaveLength(1);
  });

  it.each([404, 400, 401, 403, 429, 500])("HTTP %i → card only", async (status) => {
    reply = { status, body: { success: false, error: "nope" } };
    render(<WebPagePreview target={target(URL_OK)} opener="operator-click" />);
    await waitFor(() => expect(probeCalls()).toHaveLength(1));
    await screen.findByRole("button", { name: "Open in browser" });
    expect(iframe()).toBeNull();
    expect(screen.queryByRole("button", { name: "Try to embed" })).toBeNull();
  });

  it("network error → card only", async () => {
    reply = "network";
    render(<WebPagePreview target={target(URL_OK)} opener="operator-click" />);
    await screen.findByRole("button", { name: "Open in browser" });
    expect(iframe()).toBeNull();
    expect(screen.queryByRole("button", { name: "Try to embed" })).toBeNull();
  });

  it("an unrecognised verdict body is treated as an error (card only)", async () => {
    reply = { status: 200, body: { verdict: "yes-please" } };
    render(<WebPagePreview target={target(URL_OK)} opener="operator-click" />);
    await screen.findByRole("button", { name: "Open in browser" });
    expect(iframe()).toBeNull();
  });
});

describe("E32 — opener is never persisted", () => {
  const tab = (extra: Record<string, unknown> = {}) => ({ path: `url:${URL_OK}`, viewer: "url", ...extra });

  it("an operator-click url tab round-trips without its opener and mounts as a card", () => {
    saveEditorPaneState("s1", {
      openFiles: [tab({ opener: "operator-click" })],
      activeIndex: 0,
      treeOpenRoots: [],
    } as never);
    expect(localStorage.getItem(`${EDITOR_PANE_KEY_PREFIX}s1`)).not.toContain("operator-click");
    const restored = loadEditorPaneState("s1").openFiles[0] as { opener?: string };
    expect(restored.opener).toBeUndefined();
    render(<WebPagePreview target={target(URL_OK)} opener={restored.opener as never} />);
    expect(probeCalls()).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Check and embed" })).toBeTruthy();
  });

  it("a hand-edited stored blob cannot smuggle an opener in", () => {
    localStorage.setItem(`${EDITOR_PANE_KEY_PREFIX}s2`, JSON.stringify({ openFiles: [tab({ opener: "operator-click" })], activeIndex: 0, treeOpenRoots: [] }));
    expect((loadEditorPaneState("s2").openFiles[0] as { opener?: string }).opener).toBeUndefined();
  });
});
