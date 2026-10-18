/**
 * LiveServerViewer — opaque-origin sandbox (D7) + SSRF refusal (#6.3), and the
 * per-preview capability path the frame loads (mint, re-mint, reopen).
 * See changes: improve-content-editor (tasks §6.3); retire-trusted-networks-bypass (test-plan #F9).
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));

import LiveServerViewer from "../LiveServerViewer.js";

const originalFetch = globalThis.fetch;

const CAP = "/live/abc12345/~c/tok_1/";
const TWELVE_HOURS = 12 * 60 * 60_000;

beforeEach(() => {
  globalThis.fetch = vi.fn((url: string, init?: RequestInit) => {
    if (typeof url === "string" && url.includes("/api/live-server/list")) {
      return Promise.resolve({ json: () => Promise.resolve({ success: true, data: { servers: [] } }) });
    }
    if (typeof url === "string" && url.endsWith("/capability")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true, path: CAP, expiresAt: Date.now() + TWELVE_HOURS }),
      });
    }
    // start
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: { id: "abc12345", label: "vite", host: "127.0.0.1", port: 5173, path: "/live/abc12345/" },
        }),
    });
  }) as unknown as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("LiveServerViewer", () => {
  it("iframes the proxied path with allow-scripts and NO allow-same-origin (D7)", async () => {
    render(<LiveServerViewer />);
    fireEvent.change(screen.getByTestId("live-url"), { target: { value: "http://localhost:5173" } });
    fireEvent.click(screen.getByTestId("live-confirm"));
    const iframe = await screen.findByTestId("live-iframe");
    const sandbox = iframe.getAttribute("sandbox") ?? "";
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).not.toContain("allow-same-origin");
    // The frame loads the minted capability path, never the bare /live/<id>/.
    expect(iframe.getAttribute("src")).toBe(CAP);
  });

  it("sandbox token set is exactly scripts/forms/popups/downloads (no same-origin, no without-user-activation)", async () => {
    render(<LiveServerViewer />);
    fireEvent.change(screen.getByTestId("live-url"), { target: { value: "http://localhost:5173" } });
    fireEvent.click(screen.getByTestId("live-confirm"));
    const iframe = await screen.findByTestId("live-iframe");
    const tokens = (iframe.getAttribute("sandbox") ?? "").split(/\s+/).filter(Boolean);
    // Exact set + no duplicates. See change: live-viewer-allow-downloads (test-plan #E1).
    expect([...tokens].sort()).toEqual(
      ["allow-downloads", "allow-forms", "allow-popups", "allow-scripts"],
    );
    expect(tokens).not.toContain("allow-same-origin");
    expect(tokens).not.toContain("allow-downloads-without-user-activation");
  });

  it("auto-launches a preset live:<url> target, skipping the picker, deep path preserved", async () => {
    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    render(<LiveServerViewer path="live:http://localhost:5173/report.html?x=1" />);
    const iframe = await screen.findByTestId("live-iframe");
    // No picker: the URL input is gone once the preview mounts.
    expect(screen.queryByTestId("live-url")).toBeNull();
    // Deep path + query survive into the iframe src.
    expect(iframe.getAttribute("src")).toBe(`${CAP}report.html?x=1`);
    // startLiveServer was POSTed with the parsed host/port.
    const startCall = fetchSpy.mock.calls.find(
      (c: any[]) => typeof c[0] === "string" && c[0].includes("/start"),
    );
    expect(startCall).toBeTruthy();
    expect(JSON.parse((startCall as any[])[1].body)).toMatchObject({ host: "localhost", port: 5173 });
  });

  it("resets the deep segment when a non-preset target is launched after a preset", async () => {
    // Open a preset (deep = report.html?x=1), go back to the picker, then launch
    // a plain target via the URL input; the stale deep must NOT leak into the src.
    render(<LiveServerViewer path="live:http://localhost:5173/report.html?x=1" />);
    await screen.findByTestId("live-iframe");
    fireEvent.click(screen.getByTestId("live-back"));
    fireEvent.change(screen.getByTestId("live-url"), { target: { value: "http://localhost:5173" } });
    fireEvent.click(screen.getByTestId("live-confirm"));
    const iframe = await screen.findByTestId("live-iframe");
    expect(iframe.getAttribute("src")).toBe(CAP);
    expect(iframe.getAttribute("src")).not.toContain("report.html");
  });

  it("header Open ↗ anchor targets the system browser with the deep proxied path", async () => {
    render(<LiveServerViewer path="live:http://localhost:5173/report.html?x=1" />);
    await screen.findByTestId("live-iframe");
    const open = screen.getByText("Open").closest("a");
    expect(open?.getAttribute("target")).toBe("_blank");
    // A new tab has no dashboard credential for /live/ either: it opens the capability path too.
    expect(open?.getAttribute("href")).toBe(`${CAP}report.html?x=1`);
  });

  it("live:preview preset still shows the picker", () => {
    render(<LiveServerViewer path="live:preview" />);
    expect(screen.getByTestId("live-url")).toBeTruthy();
    expect(screen.queryByTestId("live-iframe")).toBeNull();
  });

  it("a non-loopback preset surfaces the error state (server-side refusal)", async () => {
    // Force the server to reject a non-loopback target so the viewer error shows.
    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchSpy.mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/api/live-server/list")) {
        return Promise.resolve({ json: () => Promise.resolve({ success: true, data: { servers: [] } }) });
      }
      return Promise.resolve({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ success: false, error: "only loopback hosts are allowed" }),
      });
    });
    // A non-loopback preset never parses (isLoopbackUrl false), so it falls to
    // the picker; enter a remote host manually to exercise the error path.
    render(<LiveServerViewer path="live:http://evil.com/" />);
    fireEvent.change(screen.getByTestId("live-url"), { target: { value: "http://localhost:5173" } });
    fireEvent.click(screen.getByTestId("live-confirm"));
    expect(await screen.findByTestId("live-error")).toBeTruthy();
  });

  it("refuses a free-form remote host before any request (SSRF)", async () => {
    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    render(<LiveServerViewer />);
    // Clear the initial list() call so we can assert no start() fires.
    fetchSpy.mockClear();
    fireEvent.change(screen.getByTestId("live-url"), { target: { value: "http://169.254.169.254" } });
    fireEvent.click(screen.getByTestId("live-confirm"));
    expect(await screen.findByTestId("live-error")).toBeTruthy();
    // No POST to /api/live-server/start was made.
    const posted = fetchSpy.mock.calls.some((call: any[]) => {
      const [u, init] = call;
      return typeof u === "string" && u.includes("/start") && init?.method === "POST";
    });
    expect(posted).toBe(false);
    expect(screen.queryByTestId("live-iframe")).toBeNull();
  });
});

// #F9 — mint before framing, re-mint 10 minutes before expiry, mint again on reopen.
describe("LiveServerViewer — capability mint and re-mint", () => {
  let mints: string[];
  let expiresAtOf: (n: number) => number;
  let failMint = false;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    mints = [];
    failMint = false;
    const t0 = Date.now();
    expiresAtOf = () => t0 + TWELVE_HOURS;
    globalThis.fetch = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("/api/live-server/list")) {
        return Promise.resolve({ json: () => Promise.resolve({ success: true, data: { servers: [] } }) });
      }
      if (url.endsWith("/capability")) {
        if (failMint) return Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({ success: false, error: "tier too low" }) });
        mints.push(`${init?.method} ${url}`);
        const n = mints.length;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ success: true, path: `/live/abc12345/~c/tok_${n}/`, expiresAt: expiresAtOf(n) }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            success: true,
            data: { id: "abc12345", label: "vite", host: "127.0.0.1", port: 5173, path: "/live/abc12345/" },
          }),
      });
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  const src = () => screen.getByTestId("live-iframe").getAttribute("src");

  it("mints before framing: POST /capability, src = capability path, sandbox tokens unchanged", async () => {
    render(<LiveServerViewer path="live:http://localhost:5173/" />);
    await flush();
    expect(mints).toEqual(["POST /api/live-server/abc12345/capability"]);
    expect(src()).toBe("/live/abc12345/~c/tok_1/");
    const sandbox = (screen.getByTestId("live-iframe").getAttribute("sandbox") ?? "").split(/\s+/).filter(Boolean).sort();
    expect(sandbox).toEqual(["allow-downloads", "allow-forms", "allow-popups", "allow-scripts"]);
    // The visible header never shows the token.
    expect(screen.getByText("/live/abc12345/")).toBeTruthy();
    expect(document.body.textContent).not.toContain("tok_1");
  });

  it("re-mints 10 minutes before expiresAt: nothing at 11:49:59, a new mint + new src at 11:50:00", async () => {
    render(<LiveServerViewer path="live:http://localhost:5173/" />);
    await flush();
    expect(mints).toHaveLength(1);

    await flush(11 * 3600_000 + 49 * 60_000 + 59_000);
    expect(mints).toHaveLength(1);
    expect(src()).toBe("/live/abc12345/~c/tok_1/");

    await flush(1_000);
    expect(mints).toHaveLength(2);
    expect(src()).toBe("/live/abc12345/~c/tok_2/");
    expect((screen.getByTestId("live-iframe").getAttribute("sandbox") ?? "")).not.toContain("allow-same-origin");
  });

  it("close + reopen mints again", async () => {
    render(<LiveServerViewer path="live:http://localhost:5173/" />);
    await flush();
    fireEvent.click(screen.getByTestId("live-back"));
    expect(screen.queryByTestId("live-iframe")).toBeNull();
    fireEvent.click(screen.getByTestId("live-confirm"));
    await flush();
    expect(mints).toHaveLength(2);
    expect(src()).toBe("/live/abc12345/~c/tok_2/");
  });

  it("closing the frame cancels the pending re-mint", async () => {
    render(<LiveServerViewer path="live:http://localhost:5173/" />);
    await flush();
    fireEvent.click(screen.getByTestId("live-back"));
    await flush(13 * 3600_000);
    expect(mints).toHaveLength(1);
  });

  it("a refused mint shows the reason and never frames the bare path", async () => {
    failMint = true;
    render(<LiveServerViewer path="live:http://localhost:5173/" />);
    await flush();
    expect(screen.queryByTestId("live-iframe")).toBeNull();
    expect(screen.getByTestId("live-error").textContent).toContain("tier too low");
  });

  it("a malformed capability path from the server is refused (never framed)", async () => {
    const real = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<unknown>;
    globalThis.fetch = vi.fn((url: string, init?: RequestInit) =>
      url.endsWith("/capability")
        ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true, path: "https://evil.test/", expiresAt: Date.now() + TWELVE_HOURS }) })
        : real(url, init)) as unknown as typeof fetch;
    render(<LiveServerViewer path="live:http://localhost:5173/" />);
    await flush();
    expect(screen.queryByTestId("live-iframe")).toBeNull();
    expect(screen.getByTestId("live-error")).toBeTruthy();
  });

  it("a failed re-mint retries instead of leaving the frame on an expiring token", async () => {
    render(<LiveServerViewer path="live:http://localhost:5173/" />);
    await flush();
    failMint = true;
    await flush(11 * 3600_000 + 50 * 60_000);
    expect(src()).toBe("/live/abc12345/~c/tok_1/");
    failMint = false;
    await flush(30_000);
    expect(mints).toHaveLength(2);
    expect(src()).toBe("/live/abc12345/~c/tok_2/");
  });
});
