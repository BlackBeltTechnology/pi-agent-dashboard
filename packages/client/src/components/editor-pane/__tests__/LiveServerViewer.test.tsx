/**
 * LiveServerViewer — opaque-origin sandbox (D7) + SSRF refusal (#6.3).
 * See change: improve-content-editor (tasks §6.3).
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api-context.js", () => ({ getApiBase: () => "" }));

import LiveServerViewer from "../LiveServerViewer.js";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn((url: string, init?: RequestInit) => {
    if (typeof url === "string" && url.includes("/api/live-server/list")) {
      return Promise.resolve({ json: () => Promise.resolve({ success: true, data: { servers: [] } }) });
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
    expect(iframe.getAttribute("src")).toBe("/live/abc12345/");
  });

  it("auto-launches a preset live:<url> target, skipping the picker, deep path preserved", async () => {
    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    render(<LiveServerViewer path="live:http://localhost:5173/report.html?x=1" />);
    const iframe = await screen.findByTestId("live-iframe");
    // No picker: the URL input is gone once the preview mounts.
    expect(screen.queryByTestId("live-url")).toBeNull();
    // Deep path + query survive into the iframe src.
    expect(iframe.getAttribute("src")).toBe("/live/abc12345/report.html?x=1");
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
    expect(iframe.getAttribute("src")).toBe("/live/abc12345/");
    expect(iframe.getAttribute("src")).not.toContain("report.html");
  });

  it("header Open ↗ anchor targets the system browser with the deep proxied path", async () => {
    render(<LiveServerViewer path="live:http://localhost:5173/report.html?x=1" />);
    await screen.findByTestId("live-iframe");
    const open = screen.getByText("Open").closest("a");
    expect(open?.getAttribute("target")).toBe("_blank");
    expect(open?.getAttribute("href")).toBe("/live/abc12345/report.html?x=1");
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
