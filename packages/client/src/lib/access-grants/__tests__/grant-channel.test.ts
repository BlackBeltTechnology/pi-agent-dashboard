/**
 * Prompt-capability wiring (change: add-access-grant-dialog, D1a).
 *
 * The capability is held in memory only, replaced on reconnect, cleared on
 * socket close, and echoed as `X-Pi-Grant-Channel` on same-origin `/api/*`
 * fetches only. Without this echo no denial is ever held (the server treats a
 * request without the header as prompt-ineligible).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearGrantChannel,
  GRANT_CHANNEL_HEADER,
  getGrantChannel,
  installGrantChannelFetch,
  setGrantChannel,
} from "../grant-channel.js";

/** Records the headers each fetch reached the network with. */
const seen: Array<{ url: string; header: string | null }> = [];

beforeAll(() => {
  window.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    seen.push({ url, header: new Headers(init?.headers).get(GRANT_CHANNEL_HEADER) });
    return Promise.resolve(new Response("{}"));
  }) as typeof fetch;
  installGrantChannelFetch();
  // Idempotent: a second install must not double-wrap.
  installGrantChannelFetch();
});

beforeEach(() => {
  seen.length = 0;
  clearGrantChannel();
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("grant channel capability", () => {
  it("attaches the capability to same-origin /api/* fetches", async () => {
    setGrantChannel("cap-1");
    await fetch("/api/file/read?path=/x");
    await fetch(`${window.location.origin}/api/file/tree`);
    expect(seen.map((s) => s.header)).toEqual(["cap-1", "cap-1"]);
  });

  it("never sends the capability cross-origin or outside /api/", async () => {
    setGrantChannel("cap-1");
    await fetch("https://evil.example.com/api/file/read");
    await fetch("/assets/app.js");
    expect(seen.map((s) => s.header)).toEqual([null, null]);
  });

  it("sends nothing when no capability is held", async () => {
    await fetch("/api/file/read");
    expect(seen[0].header).toBeNull();
  });

  it("replaces the capability on reconnect and clears it on close", async () => {
    setGrantChannel("cap-1");
    setGrantChannel("cap-2");
    await fetch("/api/file/exists");
    expect(seen[0].header).toBe("cap-2");
    clearGrantChannel();
    expect(getGrantChannel()).toBeNull();
    await fetch("/api/file/exists");
    expect(seen[1].header).toBeNull();
  });

  it("keeps the capability out of web storage", () => {
    setGrantChannel("cap-secret");
    const dump = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    expect(dump).not.toContain("cap-secret");
  });

  it("never overrides a header the caller set explicitly", async () => {
    setGrantChannel("cap-1");
    await fetch("/api/file/read", { headers: { [GRANT_CHANNEL_HEADER]: "explicit" } });
    expect(seen[0].header).toBe("explicit");
  });
});

describe("preview provenance fails closed (change: surface-denial-remedy-in-previews, D4; #E28)", () => {
  it("opts out with no provider and with an auto-opened provider; carries the capability only when operator-declared", async () => {
    const { previewFetchFor } = await import("../preview-provenance.js");
    setGrantChannel("cap-live");
    await previewFetchFor(null).fetch("/api/file/raw?path=/x");
    await previewFetchFor({ autoOpened: true }).fetch("/api/file/raw?path=/x");
    await previewFetchFor({ autoOpened: false }).fetch("/api/file/raw?path=/x");
    expect(seen.map((s) => s.header)).toEqual(["", "", "cap-live"]);
    expect(previewFetchFor(null).optedOut).toBe(true);
    expect(previewFetchFor({ autoOpened: false }).optedOut).toBe(false);
  });

  it("the hook reads the nearest provider", async () => {
    const { createElement } = await import("react");
    const { renderHook } = await import("@testing-library/react");
    const { PreviewProvenance, usePreviewFetch } = await import("../preview-provenance.js");
    const outside = renderHook(() => usePreviewFetch());
    expect(outside.result.current.optedOut).toBe(true);
    const inside = renderHook(() => usePreviewFetch(), {
      wrapper: ({ children }) => createElement(PreviewProvenance, { autoOpened: false, children }),
    });
    expect(inside.result.current.optedOut).toBe(false);
  });

  it("canCarryGrantChannel needs a live capability AND a same-origin /api/ URL", async () => {
    const { canCarryGrantChannel } = await import("../grant-channel.js");
    expect(canCarryGrantChannel("/api/file/raw")).toBe(false);
    setGrantChannel("cap-live");
    expect(canCarryGrantChannel("/api/file/raw")).toBe(true);
    expect(canCarryGrantChannel("http://other.example:8000/api/file/raw")).toBe(false);
  });
});
